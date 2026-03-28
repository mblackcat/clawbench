/**
 * Generic service for listing native CLI tool session history.
 *
 * Each AI coding tool stores sessions differently:
 * - Claude: ~/.claude/projects/<hash>/*.jsonl  (project-scoped)
 * - Codex:  ~/.codex/sessions/ + history.jsonl (global, with cwd in session_meta)
 * - Gemini: ~/.gemini/tmp/<sha256(path)>/chats/  (project-scoped, session JSON files)
 * - OpenCode: ~/.local/share/opencode/opencode.db (SQLite)
 *
 * This service provides a unified interface for listing sessions per tool type.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import * as readline from 'readline'
import { execFile } from 'child_process'
import type { AIToolType } from '../store/ai-workbench.store'

// ── Public types ──

export interface NativeSession {
  sessionId: string
  title: string
  modifiedAt: number   // ms timestamp
  sizeBytes?: number
}

// ── Provider interface ──

interface NativeSessionProvider {
  listSessions(workingDir: string): Promise<NativeSession[]>
}

// ════════════════════════════════════════════════════════════════
// Claude provider
// ════════════════════════════════════════════════════════════════

/** Convert absolute path to Claude's project hash: "/" → "-" */
function claudeProjectHash(dirPath: string): string {
  return dirPath.replace(/\//g, '-')
}

/** Extract title and slug from a Claude session JSONL (reads first ~100KB). */
async function parseClaudeSession(
  filePath: string
): Promise<{ title: string; slug?: string }> {
  let title = ''
  let slug: string | undefined

  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    let foundTitle = false
    let bytesRead = 0

    stream.on('data', (chunk: string) => {
      bytesRead += Buffer.byteLength(chunk)
      if (bytesRead > 100_000 && !foundTitle) {
        rl.close()
        stream.destroy()
      }
    })

    rl.on('line', (line) => {
      if (foundTitle && slug) { rl.close(); stream.destroy(); return }
      try {
        const data = JSON.parse(line)
        if (!slug && data.slug) slug = data.slug
        if (!foundTitle && data.type === 'user' && data.message?.content) {
          const contents = Array.isArray(data.message.content) ? data.message.content : []
          for (const block of contents) {
            if (block.type === 'text' && block.text) {
              const text = block.text.trim()
              if (text.startsWith('<ide_')) continue
              title = text.length > 80 ? text.slice(0, 80) + '…' : text
              foundTitle = true
              break
            }
          }
        }
      } catch { /* skip non-JSON */ }
    })

    rl.on('close', () => resolve({ title, slug }))
    rl.on('error', () => resolve({ title, slug }))
  })
}

/** Check if a title looks like a meaningful user message (not a slug, error, or system noise). */
function isValidSessionTitle(title: string): boolean {
  if (!title) return false
  // Slug pattern: word-word-word (Claude auto-generated session names)
  if (/^[a-z]+-[a-z]+-[a-z]+$/.test(title)) return false
  // Session ID fallback pattern
  if (/^Session [a-f0-9]{8}$/.test(title)) return false
  // Tool interruption / error noise
  if (title.startsWith('[Request interrupted')) return false
  if (title.startsWith('[Error')) return false
  return true
}

const claudeProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    const projectDir = path.join(os.homedir(), '.claude', 'projects', claudeProjectHash(workingDir))
    if (!fs.existsSync(projectDir)) return []

    let files: string[]
    try { files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl')) }
    catch { return [] }

    // Get stats and sort by mtime (newest first)
    const fileInfos: Array<{ name: string; mtime: number; size: number }> = []
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(projectDir, file))
        fileInfos.push({ name: file, mtime: stat.mtimeMs, size: stat.size })
      } catch { /* skip */ }
    }
    fileInfos.sort((a, b) => b.mtime - a.mtime)

    const recent = fileInfos.slice(0, 50)
    const sessions: NativeSession[] = []
    for (let i = 0; i < recent.length; i += 10) {
      const batch = recent.slice(i, i + 10)
      const results = await Promise.all(batch.map(async (info) => {
        const sessionId = info.name.replace('.jsonl', '')
        const { title, slug } = await parseClaudeSession(path.join(projectDir, info.name))
        const displayTitle = title || slug || `Session ${sessionId.slice(0, 8)}`
        // Skip sessions without a meaningful title
        if (!isValidSessionTitle(displayTitle)) return null
        return {
          sessionId,
          title: displayTitle,
          modifiedAt: info.mtime,
          sizeBytes: info.size
        }
      }))
      sessions.push(...results.filter(Boolean) as NativeSession[])
    }
    return sessions
  }
}

// ════════════════════════════════════════════════════════════════
// Codex provider
// ════════════════════════════════════════════════════════════════

/**
 * Codex stores sessions globally in ~/.codex/:
 * - history.jsonl: quick lookup with {session_id, ts, text}
 * - sessions/YYYY/MM/DD/rollout-TIMESTAMP-UUID.jsonl: full session data
 * - Session files contain session_meta with {id, cwd, ...} as first line
 *
 * We filter by cwd to match the workspace working directory.
 */
const codexProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    const codexDir = path.join(os.homedir(), '.codex')
    const historyFile = path.join(codexDir, 'history.jsonl')
    const sessionsDir = path.join(codexDir, 'sessions')

    if (!fs.existsSync(sessionsDir)) return []

    // Build title lookup from history.jsonl (first message per session)
    const titleMap = new Map<string, { ts: number; text: string }>()
    if (fs.existsSync(historyFile)) {
      try {
        const content = fs.readFileSync(historyFile, 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const entry = JSON.parse(line) as { session_id: string; ts: number; text: string }
            // Keep only the first entry per session (earliest message = title)
            if (!titleMap.has(entry.session_id)) {
              titleMap.set(entry.session_id, { ts: entry.ts * 1000, text: entry.text })
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    // Also check session_index.jsonl for thread_name (better title)
    const indexFile = path.join(codexDir, 'session_index.jsonl')
    const threadNames = new Map<string, string>()
    if (fs.existsSync(indexFile)) {
      try {
        const content = fs.readFileSync(indexFile, 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const entry = JSON.parse(line) as { id: string; thread_name?: string; updated_at?: string }
            if (entry.thread_name) threadNames.set(entry.id, entry.thread_name)
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    // Find all session files and filter by cwd
    const sessionFiles: string[] = []
    function walkDir(dir: string): void {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) walkDir(path.join(dir, entry.name))
          else if (entry.name.endsWith('.jsonl')) sessionFiles.push(path.join(dir, entry.name))
        }
      } catch { /* skip */ }
    }
    walkDir(sessionsDir)

    // Sort by mtime newest first, limit to 100 candidates to check
    const fileInfos = sessionFiles.map((f) => {
      try {
        const stat = fs.statSync(f)
        return { path: f, mtime: stat.mtimeMs, size: stat.size }
      } catch { return null }
    }).filter(Boolean) as Array<{ path: string; mtime: number; size: number }>
    fileInfos.sort((a, b) => b.mtime - a.mtime)

    const candidates = fileInfos.slice(0, 100)
    const sessions: NativeSession[] = []

    // Read first line of each candidate to check cwd
    for (const info of candidates) {
      try {
        const fd = fs.openSync(info.path, 'r')
        const buf = Buffer.alloc(2048)
        const bytesRead = fs.readSync(fd, buf, 0, 2048, 0)
        fs.closeSync(fd)
        const firstLine = buf.toString('utf-8', 0, bytesRead).split('\n')[0]
        const meta = JSON.parse(firstLine)
        if (meta.type !== 'session_meta') continue

        const sessionCwd = meta.payload?.cwd
        const sessionId = meta.payload?.id
        if (!sessionId) continue

        // Match: exact path or parent directory
        if (sessionCwd && (sessionCwd === workingDir || sessionCwd.startsWith(workingDir + '/'))) {
          const threadName = threadNames.get(sessionId)
          const historyEntry = titleMap.get(sessionId)
          const title = threadName
            || (historyEntry?.text ? (historyEntry.text.length > 80 ? historyEntry.text.slice(0, 80) + '…' : historyEntry.text) : '')
            || `Session ${sessionId.slice(0, 8)}`

          sessions.push({
            sessionId,
            title,
            modifiedAt: info.mtime,
            sizeBytes: info.size
          })
        }
      } catch { /* skip */ }

      if (sessions.length >= 50) break
    }

    return sessions
  }
}

// ════════════════════════════════════════════════════════════════
// Gemini provider
// ════════════════════════════════════════════════════════════════

/**
 * Gemini stores sessions per-project in ~/.gemini/tmp/<sha256(projectDir)>/chats/.
 * Session files are JSON: session-YYYY-MM-DDTHH-MM-<uuid>.json
 * Each contains { sessionId, projectHash, startTime, lastUpdated, messages }.
 *
 * The project hash is SHA-256 of the absolute project directory path.
 * We also check projects.json for name-based directories (legacy format).
 */

/** Compute Gemini's project hash: SHA-256 of absolute path */
function geminiProjectHash(dirPath: string): string {
  return crypto.createHash('sha256').update(dirPath).digest('hex')
}

/** Extract title from first user message in a Gemini session JSON file. */
function parseGeminiSessionTitle(data: { messages?: Array<{ role?: string; parts?: Array<{ text?: string }> }> }): string {
  const msgs = data.messages || []
  for (const msg of msgs) {
    if (msg.role === 'user' && msg.parts) {
      for (const part of msg.parts) {
        if (part.text) {
          const text = part.text.trim()
          return text.length > 80 ? text.slice(0, 80) + '…' : text
        }
      }
    }
  }
  return ''
}

const geminiProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp')
    if (!fs.existsSync(geminiTmpDir)) return []

    // Try hash-based directory first (current Gemini CLI format)
    const hash = geminiProjectHash(workingDir)
    let chatsDir = path.join(geminiTmpDir, hash, 'chats')

    // Fallback: check projects.json for name-based directory (legacy)
    if (!fs.existsSync(chatsDir)) {
      const projectsFile = path.join(os.homedir(), '.gemini', 'projects.json')
      if (fs.existsSync(projectsFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(projectsFile, 'utf-8'))
          const projects = data.projects || data
          let projectName = projects[workingDir]
          if (!projectName) {
            for (const [dir, name] of Object.entries(projects)) {
              if (workingDir.startsWith(dir + '/') && dir !== '/') {
                projectName = name as string
                break
              }
            }
          }
          if (projectName) {
            const nameChatsDir = path.join(geminiTmpDir, projectName, 'chats')
            if (fs.existsSync(nameChatsDir)) chatsDir = nameChatsDir
          }
        } catch { /* skip */ }
      }
    }

    if (!fs.existsSync(chatsDir)) return []

    // Read session files
    let files: string[]
    try { files = fs.readdirSync(chatsDir).filter((f) => f.endsWith('.json')) }
    catch { return [] }

    // Get stats and sort by mtime (newest first)
    const fileInfos: Array<{ name: string; mtime: number; size: number }> = []
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(chatsDir, file))
        fileInfos.push({ name: file, mtime: stat.mtimeMs, size: stat.size })
      } catch { /* skip */ }
    }
    fileInfos.sort((a, b) => b.mtime - a.mtime)

    const recent = fileInfos.slice(0, 50)
    const sessions: NativeSession[] = []

    for (const info of recent) {
      try {
        const content = fs.readFileSync(path.join(chatsDir, info.name), 'utf-8')
        const data = JSON.parse(content)
        const sessionId = data.sessionId || info.name.replace('.json', '')
        const title = parseGeminiSessionTitle(data) || `Session ${sessionId.slice(0, 8)}`

        sessions.push({
          sessionId,
          title,
          modifiedAt: data.lastUpdated ? new Date(data.lastUpdated).getTime() : info.mtime,
          sizeBytes: info.size
        })
      } catch { /* skip */ }
    }

    return sessions
  }
}

// ════════════════════════════════════════════════════════════════
// OpenCode provider
// ════════════════════════════════════════════════════════════════

/**
 * OpenCode uses SQLite for session storage (~/.local/share/opencode/opencode.db).
 * We use the `opencode session list` CLI command for portability.
 */
const opencodeProvider: NativeSessionProvider = {
  async listSessions(_workingDir: string): Promise<NativeSession[]> {
    return new Promise((resolve) => {
      try {
        execFile('opencode', ['session', 'list'], {
          timeout: 5000,
          env: { ...process.env }
        }, (err, stdout) => {
          if (err || !stdout.trim()) { resolve([]); return }

          // Parse CLI output into sessions
          const sessions: NativeSession[] = []
          const lines = stdout.trim().split('\n')
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            // Try to extract session ID and title from tabular output
            const parts = trimmed.split(/\s{2,}/)
            if (parts.length >= 2) {
              const sessionId = parts[0].trim()
              const title = parts[1]?.trim() || `Session ${sessionId.slice(0, 8)}`
              sessions.push({
                sessionId,
                title,
                modifiedAt: Date.now() // CLI doesn't provide timestamps easily
              })
            }
          }
          resolve(sessions)
        })
      } catch { resolve([]) }
    })
  }
}

// ════════════════════════════════════════════════════════════════
// Provider registry
// ════════════════════════════════════════════════════════════════

const providers: Partial<Record<AIToolType, NativeSessionProvider>> = {
  claude: claudeProvider,
  codex: codexProvider,
  gemini: geminiProvider
  // opencode: opencodeProvider  // TODO: enable after testing
}

/**
 * List native CLI tool sessions for a given workspace and tool type.
 * Returns sessions sorted by modification time (newest first).
 */
export async function listNativeSessions(
  workingDir: string,
  toolType: AIToolType
): Promise<NativeSession[]> {
  const provider = providers[toolType]
  if (!provider) return []

  try {
    return await provider.listSessions(workingDir)
  } catch (err) {
    console.error(`[NativeSessions] Failed to list ${toolType} sessions:`, err)
    return []
  }
}
