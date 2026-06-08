/**
 * Generic service for listing native CLI tool session history.
 *
 * Each AI coding tool stores sessions differently:
 * - Claude: ~/.claude/projects/<hash>/*.jsonl  (project-scoped)
 * - Codex:  ~/.codex/sessions/ + ~/.codex/archived_sessions/ (global, with cwd in session_meta)
 * - Gemini: ~/.gemini/tmp/<hash-or-project-name>/chats/  (project-scoped JSON/JSONL files)
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

function normalizeSessionPath(dirPath: string): string {
  if (!dirPath) return ''
  const resolved = path.resolve(dirPath).replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isSameOrChildPath(candidatePath: string, parentPath: string): boolean {
  const candidate = normalizeSessionPath(candidatePath)
  const parent = normalizeSessionPath(parentPath)
  return Boolean(candidate && parent && (candidate === parent || candidate.startsWith(parent + '/')))
}

function truncateTitle(text: string, maxLength = 80): string {
  const trimmed = text.trim()
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) + '...' : trimmed
}

// ════════════════════════════════════════════════════════════════
// Claude provider
// ════════════════════════════════════════════════════════════════

/** Convert absolute path to Claude's project hash: "/" → "-" */
function claudeProjectHashCandidates(dirPath: string): string[] {
  const resolved = path.resolve(dirPath).replace(/\\/g, '/').replace(/\/+$/, '')
  const base = resolved.replace(/:/g, '-').replace(/\//g, '-')
  const candidates = new Set<string>([base])

  // Claude Code on Windows has used both upper- and lower-case drive letters.
  if (/^[A-Za-z]--/.test(base)) {
    candidates.add(base.charAt(0).toLowerCase() + base.slice(1))
    candidates.add(base.charAt(0).toUpperCase() + base.slice(1))
  }

  return [...candidates]
}

function resolveClaudeProjectDirs(workingDir: string): string[] {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(projectsDir)) return []

  const candidates = claudeProjectHashCandidates(workingDir)
  const dirs = new Set<string>()
  for (const candidate of candidates) {
    const projectDir = path.join(projectsDir, candidate)
    if (fs.existsSync(projectDir)) dirs.add(projectDir)
  }

  if (process.platform === 'win32') {
    try {
      const lowerCandidates = new Set(candidates.map((c) => c.toLowerCase()))
      for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && lowerCandidates.has(entry.name.toLowerCase())) {
          dirs.add(path.join(projectsDir, entry.name))
        }
      }
    } catch { /* skip */ }
  }

  return [...dirs]
}

/** Extract title and slug from a Claude session JSONL (reads first ~1MB). */
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
      if (bytesRead > 1_000_000 && !foundTitle) {
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
          const contents = typeof data.message.content === 'string'
            ? [{ type: 'text', text: data.message.content }]
            : Array.isArray(data.message.content) ? data.message.content : []
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
  // Tool interruption / error noise
  if (title.startsWith('[Request interrupted')) return false
  if (title.startsWith('[Error')) return false
  return true
}

const claudeProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    const projectDirs = resolveClaudeProjectDirs(workingDir)
    if (projectDirs.length === 0) return []

    // Get stats and sort by mtime (newest first)
    const fileInfos: Array<{ path: string; name: string; mtime: number; size: number }> = []
    for (const projectDir of projectDirs) {
      let files: string[]
      try { files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl')) }
      catch { continue }
      for (const file of files) {
        try {
          const filePath = path.join(projectDir, file)
          const stat = fs.statSync(filePath)
          fileInfos.push({ path: filePath, name: file, mtime: stat.mtimeMs, size: stat.size })
        } catch { /* skip */ }
      }
    }
    fileInfos.sort((a, b) => b.mtime - a.mtime)

    const sessions: NativeSession[] = []
    const seenSessionIds = new Set<string>()
    for (let i = 0; i < fileInfos.length; i += 10) {
      const batch = fileInfos.slice(i, i + 10)
      const results = await Promise.all(batch.map(async (info) => {
        const sessionId = info.name.replace('.jsonl', '')
        if (seenSessionIds.has(sessionId)) return null
        seenSessionIds.add(sessionId)
        const { title, slug } = await parseClaudeSession(info.path)
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
 * - session_index.jsonl: desktop/TUI thread names and updated_at timestamps
 * - sessions/YYYY/MM/DD/rollout-TIMESTAMP-UUID.jsonl: full session data
 * - archived_sessions/*.jsonl: archived desktop/TUI sessions
 * - Session files contain session_meta with {id, cwd, ...} as first line
 *
 * We filter by cwd to match the workspace working directory.
 */
function extractCodexUserText(data: any): string {
  const payload = data?.payload || data
  if (payload?.type === 'message' && payload.role === 'user') {
    const content = Array.isArray(payload.content) ? payload.content : []
    for (const block of content) {
      const text = block?.text || block?.content
      if (block?.type === 'input_text' && text) return truncateTitle(String(text))
    }
  }
  return ''
}

function parseCodexSessionFile(filePath: string): { meta: any | null; fallbackTitle: string } {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(1_000_000)
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0)
    const lines = buf.toString('utf-8', 0, bytesRead).split('\n')
    let meta: any | null = null
    let fallbackTitle = ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const data = JSON.parse(line)
        if (!meta && data.type === 'session_meta') meta = data
        if (!fallbackTitle) fallbackTitle = extractCodexUserText(data)
        if (meta && fallbackTitle) break
      } catch { /* skip */ }
    }
    return { meta, fallbackTitle }
  } finally {
    fs.closeSync(fd)
  }
}

const codexProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    const codexDir = path.join(os.homedir(), '.codex')
    const historyFile = path.join(codexDir, 'history.jsonl')
    const sessionsDir = path.join(codexDir, 'sessions')
    const archivedSessionsDir = path.join(codexDir, 'archived_sessions')

    if (!fs.existsSync(sessionsDir) && !fs.existsSync(archivedSessionsDir)) return []

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
    const indexMap = new Map<string, { threadName?: string; updatedAt?: number }>()
    if (fs.existsSync(indexFile)) {
      try {
        const content = fs.readFileSync(indexFile, 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const entry = JSON.parse(line) as { id: string; thread_name?: string; updated_at?: string }
            indexMap.set(entry.id, {
              threadName: entry.thread_name,
              updatedAt: entry.updated_at ? new Date(entry.updated_at).getTime() : undefined
            })
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
    if (fs.existsSync(sessionsDir)) walkDir(sessionsDir)
    if (fs.existsSync(archivedSessionsDir)) walkDir(archivedSessionsDir)

    // Sort by mtime newest first. UI pagination decides how many are shown.
    const fileInfos = sessionFiles.map((f) => {
      try {
        const stat = fs.statSync(f)
        return { path: f, mtime: stat.mtimeMs, size: stat.size }
      } catch { return null }
    }).filter(Boolean) as Array<{ path: string; mtime: number; size: number }>
    fileInfos.sort((a, b) => b.mtime - a.mtime)

    const sessions: NativeSession[] = []

    for (const info of fileInfos) {
      try {
        const { meta, fallbackTitle } = parseCodexSessionFile(info.path)
        if (!meta) continue

        const sessionCwd = meta.payload?.cwd
        const sessionId = meta.payload?.id
        if (!sessionId) continue

        if (sessionCwd && isSameOrChildPath(sessionCwd, workingDir)) {
          const indexEntry = indexMap.get(sessionId)
          const historyEntry = titleMap.get(sessionId)
          const title = indexEntry?.threadName
            || (historyEntry?.text ? (historyEntry.text.length > 80 ? historyEntry.text.slice(0, 80) + '…' : historyEntry.text) : '')
            || fallbackTitle
            || `Session ${sessionId.slice(0, 8)}`

          sessions.push({
            sessionId,
            title,
            modifiedAt: indexEntry?.updatedAt || info.mtime,
            sizeBytes: info.size
          })
        }
      } catch { /* skip */ }

    }

    sessions.sort((a, b) => b.modifiedAt - a.modifiedAt)
    return sessions
  }
}

// ════════════════════════════════════════════════════════════════
// Gemini provider
// ════════════════════════════════════════════════════════════════

/**
 * Gemini stores sessions per-project in ~/.gemini/tmp/<sha256-or-project-name>/chats/.
 * Session files may be JSON or JSONL.
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

function extractGeminiJsonlUserText(data: any): string {
  if (data?.type !== 'user') return ''
  const content = Array.isArray(data.content) ? data.content : []
  for (const block of content) {
    if (block?.text) return truncateTitle(String(block.text))
  }
  return ''
}

function parseGeminiSessionFile(filePath: string): { sessionId: string; title: string; modifiedAt?: number } | null {
  const content = fs.readFileSync(filePath, 'utf-8')
  if (filePath.endsWith('.json')) {
    const data = JSON.parse(content)
    const sessionId = data.sessionId || path.basename(filePath, '.json')
    return {
      sessionId,
      title: parseGeminiSessionTitle(data) || `Session ${sessionId.slice(0, 8)}`,
      modifiedAt: data.lastUpdated ? new Date(data.lastUpdated).getTime() : undefined
    }
  }

  let sessionId = path.basename(filePath, '.jsonl')
  let title = ''
  let modifiedAt: number | undefined
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      const data = JSON.parse(line)
      if (data.sessionId) sessionId = data.sessionId
      if (data.lastUpdated) modifiedAt = new Date(data.lastUpdated).getTime()
      if (data.$set?.lastUpdated) modifiedAt = new Date(data.$set.lastUpdated).getTime()
      if (!title) title = extractGeminiJsonlUserText(data)
      if (title && modifiedAt) break
    } catch { /* skip */ }
  }

  return { sessionId, title: title || `Session ${sessionId.slice(0, 8)}`, modifiedAt }
}

function resolveGeminiChatsDirs(workingDir: string): string[] {
  const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp')
  if (!fs.existsSync(geminiTmpDir)) return []

  const chatsDirs = new Set<string>()
  const addChatsDir = (dirName: string): void => {
    if (!dirName) return
    const chatsDir = path.join(geminiTmpDir, dirName, 'chats')
    if (fs.existsSync(chatsDir)) chatsDirs.add(chatsDir)
  }

  addChatsDir(geminiProjectHash(workingDir))
  addChatsDir(path.basename(workingDir))

  const projectsFile = path.join(os.homedir(), '.gemini', 'projects.json')
  if (fs.existsSync(projectsFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(projectsFile, 'utf-8'))
      const projects = data.projects || data
      for (const [projectRoot, projectName] of Object.entries(projects)) {
        if (isSameOrChildPath(projectRoot, workingDir)) addChatsDir(projectName as string)
      }
    } catch { /* skip */ }
  }

  try {
    for (const entry of fs.readdirSync(geminiTmpDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const projectRootFile = path.join(geminiTmpDir, entry.name, '.project_root')
      if (!fs.existsSync(projectRootFile)) continue
      try {
        const projectRoot = fs.readFileSync(projectRootFile, 'utf-8').trim()
        if (isSameOrChildPath(projectRoot, workingDir)) addChatsDir(entry.name)
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return [...chatsDirs]
}

const geminiProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    const chatsDirs = resolveGeminiChatsDirs(workingDir)
    if (chatsDirs.length === 0) return []

    // Get stats and sort by mtime (newest first)
    const fileInfos: Array<{ path: string; mtime: number; size: number }> = []
    for (const chatsDir of chatsDirs) {
      let files: string[]
      try { files = fs.readdirSync(chatsDir).filter((f) => f.endsWith('.json') || f.endsWith('.jsonl')) }
      catch { continue }
      for (const file of files) {
        try {
          const filePath = path.join(chatsDir, file)
          const stat = fs.statSync(filePath)
          fileInfos.push({ path: filePath, mtime: stat.mtimeMs, size: stat.size })
        } catch { /* skip */ }
      }
    }
    fileInfos.sort((a, b) => b.mtime - a.mtime)

    const sessions: NativeSession[] = []
    const seenSessionIds = new Set<string>()

    for (const info of fileInfos) {
      try {
        const parsed = parseGeminiSessionFile(info.path)
        if (!parsed || seenSessionIds.has(parsed.sessionId)) continue
        seenSessionIds.add(parsed.sessionId)

        sessions.push({
          sessionId: parsed.sessionId,
          title: parsed.title,
          modifiedAt: parsed.modifiedAt || info.mtime,
          sizeBytes: info.size
        })
      } catch { /* skip */ }
    }

    sessions.sort((a, b) => b.modifiedAt - a.modifiedAt)
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
