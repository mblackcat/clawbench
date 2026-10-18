/**
 * Generic service for listing native CLI tool session history.
 *
 * Each AI coding tool stores sessions differently:
 * - Claude:  ~/.claude/projects/<hash>/*.jsonl  (project-scoped)
 * - Codex:   ~/.codex/sessions/ + archived_sessions/ (global, cwd in session_meta)
 * - Gemini:  ~/.gemini/tmp/<hash-or-project-name>/chats/
 * - Grok:    ~/.grok/sessions/<url-encoded-cwd>/<session-id>/
 * - OpenCode: `opencode session list` CLI (or SQLite under XDG data)
 * - Qoder:   ~/.qoderworkcn/projects/<hash>/*.jsonl  (Claude-like)
 * - ZCode:   ~/.zclaude/projects/<hash>/*.jsonl  (Claude-like)
 * - Kimi:    ~/.kimi/sessions/<workdir-hash>/<session-id>/
 * - Antigravity: ~/.gemini/antigravity-cli/conversation_summaries.db + history.jsonl
 * - omp:     ~/.omp/agent/sessions/<cwd-slug>/<timestamp>_<session-id>.jsonl
 * - Trae/MiMo: best-effort (empty when no known local store)
 *
 * This service provides a unified interface for listing sessions per tool type.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import * as readline from 'readline'
import { execFile } from 'child_process'
import type { AIToolType } from '../store/ai-coding.store'

// ── Public types ──

export interface NativeSession {
  sessionId: string
  title: string
  modifiedAt: number   // ms timestamp
  sizeBytes?: number
}

export type NativeTranscriptBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'todo_update'; todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }> }
  | { type: 'context_usage'; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; usedTokens?: number; contextWindow?: number }

export interface NativeTranscriptMessage {
  role: 'user' | 'assistant' | 'system'
  blocks: NativeTranscriptBlock[]
  timestamp: number
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

function extractTextFromContent(content: any): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block) return ''
      if (typeof block === 'string') return block
      return block.text || block.content || ''
    })
    .filter(Boolean)
    .join('')
}

function parseTimestamp(value: unknown, fallback = Date.now()): number {
  if (typeof value !== 'string') return fallback
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : fallback
}

function pushTranscriptMessage(
  messages: NativeTranscriptMessage[],
  role: NativeTranscriptMessage['role'],
  blocks: NativeTranscriptBlock[],
  timestamp?: number
): void {
  const cleanBlocks = blocks.filter((block) => {
    if (block.type === 'text' || block.type === 'thinking') return !!block.text.trim()
    if (block.type === 'tool_result') return !!block.content || !!block.toolUseId
    if (block.type === 'context_usage') {
      return !!block.usedTokens || !!block.inputTokens || !!block.cachedInputTokens || !!block.outputTokens || !!block.contextWindow
    }
    return true
  })
  if (cleanBlocks.length === 0) return
  messages.push({ role, blocks: cleanBlocks, timestamp: timestamp || Date.now() })
}

function safeJsonParseObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
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

/** Resolve Claude-style project dirs under one or more roots (e.g. ~/.claude/projects). */
function resolveClaudeStyleProjectDirs(workingDir: string, projectsRoots: string[]): string[] {
  const candidates = claudeProjectHashCandidates(workingDir)
  const dirs = new Set<string>()

  for (const projectsDir of projectsRoots) {
    if (!fs.existsSync(projectsDir)) continue

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
  }

  return [...dirs]
}

function resolveClaudeProjectDirs(workingDir: string): string[] {
  return resolveClaudeStyleProjectDirs(workingDir, [
    path.join(os.homedir(), '.claude', 'projects')
  ])
}

interface ClaudeFileCacheEntry {
  mtime: number
  title: string
  slug?: string
}
/**
 * Per-file parse cache. The title is the first real user prompt, which never
 * changes once written, so a file with a title is not re-read even though the
 * live session keeps bumping its mtime; untitled files are re-read on change.
 */
const claudeFileCache = new Map<string, ClaudeFileCacheEntry>()

async function parseClaudeSessionCached(
  filePath: string,
  mtime: number
): Promise<{ title: string; slug?: string }> {
  const cached = claudeFileCache.get(filePath)
  if (cached && (cached.mtime === mtime || cached.title)) {
    return { title: cached.title, slug: cached.slug }
  }
  const result = await parseClaudeSession(filePath)
  claudeFileCache.set(filePath, { mtime, title: result.title, slug: result.slug })
  return result
}

/** List sessions from Claude-style project dirs (*.jsonl next to optional subdirs). */
async function listClaudeStyleSessions(projectDirs: string[]): Promise<NativeSession[]> {
  if (projectDirs.length === 0) return []

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
      const { title, slug } = await parseClaudeSessionCached(info.path, info.mtime)
      const displayTitle = title || slug || `Session ${sessionId.slice(0, 8)}`
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

/** Claude Code local-command caveat boilerplate (often first "user" message). */
function isClaudeCaveatBoilerplate(text: string): boolean {
  return /caveat:\s*the messages below were generated/i.test(text.trim())
}

/**
 * Whether a Claude user row is synthetic noise (slash commands, IDE context,
 * local-command caveats) and should not become a session title.
 */
function isClaudeSyntheticUserText(text: string, data?: { isMeta?: boolean }): boolean {
  if (data?.isMeta) return true
  const trimmed = text.trim()
  if (!trimmed) return true
  // IDE-injected context blocks
  if (trimmed.startsWith('<ide_')) return true
  // Slash-command / bash payload wrappers (not real prompts)
  if (/^<(?:command-name|command-message|command-args|bash-input|bash-stdout|bash-stderr)\b/i.test(trimmed)) {
    return true
  }
  // Hook output, system reminders and local-command output are tool-injected too
  if (/^<(?:system-reminder|user-prompt-submit-hook|session-start-hook|local-command-stdout|local-command-stderr)\b/i.test(trimmed)) {
    return true
  }
  // Pure local-command caveat (with or without tags after sanitize)
  if (isClaudeCaveatBoilerplate(trimmed)) return true
  if (/^<local-command/i.test(trimmed) && isClaudeCaveatBoilerplate(sanitizeClaudeTitleText(trimmed))) {
    return true
  }
  return false
}

/** Strip Claude Code XML-like tags from title text; keep human-readable content. */
function sanitizeClaudeTitleText(text: string): string {
  let result = text.trim()
  // Remove complete open/close tags like <local-command-caveat>…</local-command-caveat>
  result = result.replace(/<\/?[a-zA-Z][\w-]*(?:\s[^>]*)?>/g, ' ')
  // Drop leftover partial open tags truncated by length limit
  result = result.replace(/<[a-zA-Z][\w-]*[^>]*$/g, '')
  return result.replace(/\s+/g, ' ').trim()
}

/** Extract a clean display title from raw Claude user message text. */
function extractClaudeSessionTitle(rawText: string, data?: { isMeta?: boolean }): string {
  const raw = rawText.trim()
  if (!raw || isClaudeSyntheticUserText(raw, data)) return ''
  const cleaned = sanitizeClaudeTitleText(raw)
  if (!cleaned || isClaudeCaveatBoilerplate(cleaned)) return ''
  // Still looks like an unstripped XML tag after sanitize — not a real title
  if (cleaned.startsWith('<') && cleaned.includes('>')) return ''
  return cleaned.length > 80 ? cleaned.slice(0, 80) + '…' : cleaned
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

    stream.on('data', (chunk: string | Buffer) => {
      bytesRead += Buffer.byteLength(String(chunk))
      if (bytesRead > 1_000_000 && !foundTitle) {
        rl.close()
        stream.destroy()
      }
    })

    rl.on('line', (line) => {
      // The title wins over the slug (see displayTitle), so stop as soon as we
      // have one. Waiting for a slug as well read whole transcripts — tens of
      // MB — on every poll, because current Claude Code files carry no slug.
      if (foundTitle) { rl.close(); stream.destroy(); return }
      try {
        const data = JSON.parse(line)
        if (!slug && data.slug) slug = data.slug
        if (!foundTitle && data.type === 'user' && data.message?.content) {
          // isMeta user rows are Claude-injected caveats / local-command noise
          if (data.isMeta) return
          const contents = typeof data.message.content === 'string'
            ? [{ type: 'text', text: data.message.content }]
            : Array.isArray(data.message.content) ? data.message.content : []
          for (const block of contents) {
            if (block.type === 'text' && block.text) {
              const extracted = extractClaudeSessionTitle(String(block.text), data)
              if (!extracted) continue
              title = extracted
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
  // Claude Code synthetic XML / caveat leftovers
  if (isClaudeSyntheticUserText(title)) return false
  if (title.startsWith('<') && /<\/?[a-zA-Z]/.test(title)) return false
  return true
}

const claudeProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    return listClaudeStyleSessions(resolveClaudeProjectDirs(workingDir))
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
// Transcript readers used to hydrate chat view when opening an existing native session.
function findClaudeSessionFile(workingDir: string, sessionId: string): string | null {
  for (const projectDir of resolveClaudeProjectDirs(workingDir)) {
    const filePath = path.join(projectDir, `${sessionId}.jsonl`)
    if (fs.existsSync(filePath)) return filePath
  }
  return null
}

function parseClaudeToolResultBlock(block: any): NativeTranscriptBlock | null {
  if (!block || block.type !== 'tool_result') return null
  const content = typeof block.content === 'string'
    ? block.content
    : Array.isArray(block.content)
      ? block.content.map((c: any) => c?.text || c?.content || '').filter(Boolean).join('\n')
      : block.content ? JSON.stringify(block.content) : ''
  return {
    type: 'tool_result',
    toolUseId: block.tool_use_id || block.toolUseId || '',
    content,
    isError: !!block.is_error
  }
}

function readClaudeTranscript(workingDir: string, sessionId: string): NativeTranscriptMessage[] {
  const filePath = findClaudeSessionFile(workingDir, sessionId)
  if (!filePath) return []

  let raw = ''
  try { raw = fs.readFileSync(filePath, 'utf-8') } catch { return [] }

  const messages: NativeTranscriptMessage[] = []
  // Ordered task list folded from incremental TaskCreate/TaskUpdate ops (the
  // successor to single-snapshot TodoWrite). Persists across the whole
  // transcript; Nth TaskCreate is 1-based taskId N. Deleted tasks are
  // tombstoned (kept in place) so later taskId references stay aligned.
  const taskAcc: Array<{ content: string; activeForm: string; status: 'pending' | 'in_progress' | 'completed' | 'deleted' }> = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let data: any
    try { data = JSON.parse(line) } catch { continue }
    const ts = parseTimestamp(data.timestamp)

    if (data.type === 'user' && data.message?.role === 'user') {
      const content = data.message.content
      if (Array.isArray(content) && content.some((block: any) => block?.type === 'tool_result')) {
        const blocks = content
          .map((block: any) => parseClaudeToolResultBlock(block))
          .filter(Boolean) as NativeTranscriptBlock[]
        pushTranscriptMessage(messages, 'assistant', blocks, ts)
        continue
      }
      const text = extractTextFromContent(content)
      // IDE context, slash-command bookkeeping, hook output, isMeta caveats
      if (isClaudeSyntheticUserText(text, data)) continue
      pushTranscriptMessage(messages, 'user', [{ type: 'text', text }], ts)
      continue
    }

    if (data.message?.role === 'assistant' && Array.isArray(data.message.content)) {
      const blocks: NativeTranscriptBlock[] = []
      for (const block of data.message.content) {
        if (block?.type === 'text' && block.text) {
          blocks.push({ type: 'text', text: String(block.text) })
        } else if (block?.type === 'thinking' && block.thinking) {
          blocks.push({ type: 'thinking', text: String(block.thinking) })
        } else if (block?.type === 'tool_use') {
          const toolName = String(block.name || '')
          const toolInput = block.input && typeof block.input === 'object' ? block.input as Record<string, unknown> : {}
          // TodoWrite carries the full todo list — render it as a dedicated
          // todo_update block (matching the live stream) so the checklist
          // survives session reload instead of degrading to a raw JSON card.
          if (toolName === 'TodoWrite' && Array.isArray(toolInput.todos) && toolInput.todos.length > 0) {
            const todos = (toolInput.todos as any[])
              .map((td: any) => ({
                content: String(td?.content ?? ''),
                status: td?.status === 'in_progress' || td?.status === 'completed' ? td.status : 'pending',
                activeForm: String(td?.activeForm ?? td?.content ?? ''),
              }))
            blocks.push({ type: 'todo_update', todos })
          } else if (toolName === 'TaskCreate' || toolName === 'TaskUpdate') {
            // Fold the incremental op into the running list and render the
            // resulting snapshot as a todo_update, matching the live stream.
            if (toolName === 'TaskCreate') {
              const subject = typeof toolInput.subject === 'string' ? toolInput.subject : ''
              if (subject) {
                const activeForm = typeof toolInput.activeForm === 'string' && toolInput.activeForm ? toolInput.activeForm : subject
                taskAcc.push({ content: subject, activeForm, status: 'pending' })
              }
            } else {
              const idRaw = (toolInput as any).taskId ?? (toolInput as any).id ?? (toolInput as any).task_id
              const idx = Number(idRaw) - 1
              const status = typeof toolInput.status === 'string' ? toolInput.status : ''
              if (Number.isInteger(idx) && idx >= 0 && idx < taskAcc.length &&
                  (status === 'pending' || status === 'in_progress' || status === 'completed' || status === 'deleted')) {
                taskAcc[idx].status = status
              }
            }
            const todos = taskAcc
              .filter(t => t.status !== 'deleted')
              .map(t => ({ content: t.content, status: t.status as 'pending' | 'in_progress' | 'completed', activeForm: t.activeForm }))
            if (todos.length > 0) blocks.push({ type: 'todo_update', todos })
          } else if (toolName === 'TaskList' || toolName === 'TaskGet') {
            // No state change; skip these bookkeeping calls entirely rather
            // than degrading them to raw JSON tool cards.
          } else {
            blocks.push({
              type: 'tool_use',
              id: String(block.id || `claude-tool-${messages.length}-${blocks.length}`),
              name: toolName || 'Tool',
              input: toolInput,
            })
          }
        }
      }
      pushTranscriptMessage(messages, 'assistant', blocks, ts)
    }
  }

  return messages
}

function extractCodexUserText(data: any): string {
  const payload = data?.payload || data
  if (payload?.type === 'message' && payload.role === 'user') {
    const content = Array.isArray(payload.content) ? payload.content : []
    for (const block of content) {
      const text = block?.text || block?.content
      if (block?.type === 'input_text' && text && !isSyntheticCodexText(String(text))) {
        return truncateTitle(String(text))
      }
    }
  }
  return ''
}

function isSyntheticCodexText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('<environment_context') || lower.startsWith('<enviroment_context')) return true
  if (lower.startsWith('# agents.md instructions')) return true
  if (lower.startsWith('<instructions>') || lower.startsWith('<developer_context')) return true
  // Claude-style wrappers also show up in Codex user turns (hooks, IDE context)
  return isClaudeSyntheticUserText(trimmed)
}

function titleFromCodexText(text: string): string {
  return isSyntheticCodexText(text) ? '' : truncateTitle(text)
}

interface CodexFileCacheEntry {
  mtime: number
  meta: any | null
  fallbackTitle: string
}
/** Per-file parse cache keyed by path; reused while mtime is unchanged. */
const codexFileCache = new Map<string, CodexFileCacheEntry>()

function parseCodexSessionFile(filePath: string, mtime?: number): { meta: any | null; fallbackTitle: string } {
  if (mtime !== undefined) {
    const cached = codexFileCache.get(filePath)
    // session_meta and the first prompt sit at the head of the file and never
    // change, so a complete entry survives the live session's mtime bumps.
    if (cached && (cached.mtime === mtime || (cached.meta && cached.fallbackTitle))) {
      return { meta: cached.meta, fallbackTitle: cached.fallbackTitle }
    }
  }
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
    if (mtime !== undefined) {
      codexFileCache.set(filePath, { mtime, meta, fallbackTitle })
    }
    return { meta, fallbackTitle }
  } finally {
    fs.closeSync(fd)
  }
}

function collectCodexSessionFiles(): string[] {
  const codexDir = path.join(os.homedir(), '.codex')
  const roots = [
    path.join(codexDir, 'sessions'),
    path.join(codexDir, 'archived_sessions')
  ]
  const files: string[] = []
  const walkDir = (dir: string): void => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walkDir(path.join(dir, entry.name))
        else if (entry.name.endsWith('.jsonl')) files.push(path.join(dir, entry.name))
      }
    } catch { /* skip */ }
  }
  for (const root of roots) {
    if (fs.existsSync(root)) walkDir(root)
  }
  return files
}

function findCodexSessionFile(workingDir: string, sessionId: string): string | null {
  for (const filePath of collectCodexSessionFiles()) {
    try {
      const { meta } = parseCodexSessionFile(filePath)
      const payload = meta?.payload || {}
      if (payload.id !== sessionId) continue
      if (!payload.cwd || isSameOrChildPath(payload.cwd, workingDir)) return filePath
    } catch { /* skip */ }
  }
  return null
}

function extractCodexMessageText(content: any): string {
  if (typeof content === 'string') return isSyntheticCodexText(content) ? '' : content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block) return ''
      if (block.type === 'input_text' || block.type === 'output_text' || block.type === 'text') {
        return block.text || block.content || ''
      }
      return ''
    })
    .filter((text) => !isSyntheticCodexText(String(text)))
    .filter(Boolean)
    .join('')
}

function codexUsageBlock(info: any): NativeTranscriptBlock | null {
  const total = info?.total_token_usage || info?.last_token_usage || info
  if (!total) return null
  const inputTokens = total.input_tokens ?? total.inputTokens ?? 0
  const cachedInputTokens = total.cached_input_tokens ?? total.cachedInputTokens ?? 0
  const outputTokens = total.output_tokens ?? total.outputTokens ?? 0
  const contextWindow = info?.model_context_window ?? total.context_window ?? total.contextWindow
  const usedTokens = Number(inputTokens || 0) + Number(cachedInputTokens || 0)
  if (!usedTokens && !outputTokens && !contextWindow) return null
  return { type: 'context_usage', inputTokens, cachedInputTokens, outputTokens, usedTokens, contextWindow }
}

function readCodexTranscript(workingDir: string, sessionId: string): NativeTranscriptMessage[] {
  const filePath = findCodexSessionFile(workingDir, sessionId)
  if (!filePath) return []

  let raw = ''
  try { raw = fs.readFileSync(filePath, 'utf-8') } catch { return [] }

  const messages: NativeTranscriptMessage[] = []
  let latestUsage: NativeTranscriptBlock | null = null
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let data: any
    try { data = JSON.parse(line) } catch { continue }
    const ts = parseTimestamp(data.timestamp)
    const payload = data.payload || {}

    if (data.type === 'response_item' && payload.type === 'message') {
      const role = payload.role === 'user' ? 'user' : 'assistant'
      const text = extractCodexMessageText(payload.content)
      pushTranscriptMessage(messages, role, [{ type: 'text', text }], ts)
      continue
    }

    if (data.type === 'response_item' && payload.type === 'reasoning') {
      const summary = Array.isArray(payload.summary)
        ? payload.summary.map((s: any) => s?.text || '').filter(Boolean).join('\n')
        : ''
      pushTranscriptMessage(messages, 'assistant', [{ type: 'thinking', text: summary }], ts)
      continue
    }

    if (data.type === 'response_item' && payload.type === 'function_call') {
      const toolId = String(payload.call_id || payload.id || `codex-tool-${messages.length}`)
      const input = typeof payload.arguments === 'string'
        ? safeJsonParseObject(payload.arguments)
        : payload.arguments && typeof payload.arguments === 'object' ? payload.arguments : {}
      pushTranscriptMessage(messages, 'assistant', [{
        type: 'tool_use',
        id: toolId,
        name: String(payload.name || 'Tool'),
        input
      }], ts)
      continue
    }

    if (data.type === 'response_item' && payload.type === 'function_call_output') {
      pushTranscriptMessage(messages, 'assistant', [{
        type: 'tool_result',
        toolUseId: String(payload.call_id || payload.id || ''),
        content: typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output || ''),
        isError: !!payload.is_error
      }], ts)
      continue
    }

    if (data.type === 'event_msg' && payload.type === 'token_count') {
      const usage = codexUsageBlock(payload.info)
      if (usage) latestUsage = usage
    }
  }

  if (latestUsage) {
    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
    if (lastAssistant) lastAssistant.blocks.push(latestUsage)
    else pushTranscriptMessage(messages, 'assistant', [latestUsage])
  }

  return messages
}

let cachedCodexHistory: { mtime: number; size: number; titleMap: Map<string, { ts: number; text: string }> } | null = null
let cachedCodexIndex: { mtime: number; size: number; indexMap: Map<string, { threadName?: string; updatedAt?: number }> } | null = null

const codexProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    const codexDir = path.join(os.homedir(), '.codex')
    const historyFile = path.join(codexDir, 'history.jsonl')
    const sessionsDir = path.join(codexDir, 'sessions')
    const archivedSessionsDir = path.join(codexDir, 'archived_sessions')

    if (!fs.existsSync(sessionsDir) && !fs.existsSync(archivedSessionsDir)) return []

    // Build title lookup from history.jsonl (first message per session; cached by mtime+size)
    let titleMap = new Map<string, { ts: number; text: string }>()
    if (fs.existsSync(historyFile)) {
      try {
        const stat = fs.statSync(historyFile)
        if (cachedCodexHistory && cachedCodexHistory.mtime === stat.mtimeMs && cachedCodexHistory.size === stat.size) {
          titleMap = cachedCodexHistory.titleMap
        } else {
          const content = fs.readFileSync(historyFile, 'utf-8')
          for (const line of content.split('\n')) {
            if (!line.trim()) continue
            try {
              const entry = JSON.parse(line) as { session_id: string; ts: number; text: string }
              const title = titleFromCodexText(entry.text || '')
              if (!title) continue
              // Keep only the first entry per session (earliest message = title)
              if (!titleMap.has(entry.session_id)) {
                titleMap.set(entry.session_id, { ts: entry.ts * 1000, text: title })
              }
            } catch { /* skip */ }
          }
          cachedCodexHistory = { mtime: stat.mtimeMs, size: stat.size, titleMap }
        }
      } catch { /* skip */ }
    }

    // Also check session_index.jsonl for thread_name (better title; cached by mtime+size)
    const indexFile = path.join(codexDir, 'session_index.jsonl')
    let indexMap = new Map<string, { threadName?: string; updatedAt?: number }>()
    if (fs.existsSync(indexFile)) {
      try {
        const stat = fs.statSync(indexFile)
        if (cachedCodexIndex && cachedCodexIndex.mtime === stat.mtimeMs && cachedCodexIndex.size === stat.size) {
          indexMap = cachedCodexIndex.indexMap
        } else {
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
          cachedCodexIndex = { mtime: stat.mtimeMs, size: stat.size, indexMap }
        }
      } catch { /* skip */ }
    }

    // Find all session files and filter by cwd. Codex keeps every project's
    // sessions in one tree that only grows, and the sidebar polls this every
    // few seconds — walk and stat it asynchronously so the main process (PTY
    // input/output, IPC) is not blocked for the length of the scan.
    const sessionFiles: string[] = []
    const walkDir = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[]
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) }
      catch { return }
      const subdirs: Promise<void>[] = []
      for (const entry of entries) {
        if (entry.isDirectory()) subdirs.push(walkDir(path.join(dir, entry.name)))
        else if (entry.name.endsWith('.jsonl')) sessionFiles.push(path.join(dir, entry.name))
      }
      await Promise.all(subdirs)
    }
    await Promise.all([walkDir(sessionsDir), walkDir(archivedSessionsDir)])

    // Sort by mtime newest first. UI pagination decides how many are shown.
    const fileInfos = (await Promise.all(sessionFiles.map(async (f) => {
      try {
        const stat = await fs.promises.stat(f)
        return { path: f, mtime: stat.mtimeMs, size: stat.size }
      } catch { return null }
    }))).filter(Boolean) as Array<{ path: string; mtime: number; size: number }>
    fileInfos.sort((a, b) => b.mtime - a.mtime)

    const sessions: NativeSession[] = []

    for (const info of fileInfos) {
      try {
        const { meta, fallbackTitle } = parseCodexSessionFile(info.path, info.mtime)
        if (!meta) continue

        const sessionCwd = meta.payload?.cwd
        const sessionId = meta.payload?.id
        if (!sessionId) continue

        if (sessionCwd && isSameOrChildPath(sessionCwd, workingDir)) {
          const indexEntry = indexMap.get(sessionId)
          const historyEntry = titleMap.get(sessionId)
          const indexTitle = titleFromCodexText(indexEntry?.threadName || '')
          const title = indexTitle
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
  // Antigravity CLI (Gemini-based) may keep the same layout under ~/.antigravity/tmp
  const tmpDirs = [
    path.join(os.homedir(), '.gemini', 'tmp'),
    path.join(os.homedir(), '.antigravity', 'tmp')
  ].filter((d) => fs.existsSync(d))
  if (tmpDirs.length === 0) return []

  const chatsDirs = new Set<string>()
  const addChatsDir = (dirName: string): void => {
    if (!dirName) return
    for (const tmpDir of tmpDirs) {
      const chatsDir = path.join(tmpDir, dirName, 'chats')
      if (fs.existsSync(chatsDir)) chatsDirs.add(chatsDir)
    }
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

  for (const tmpDir of tmpDirs) {
    try {
      for (const entry of fs.readdirSync(tmpDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const projectRootFile = path.join(tmpDir, entry.name, '.project_root')
        if (!fs.existsSync(projectRootFile)) continue
        try {
          const projectRoot = fs.readFileSync(projectRootFile, 'utf-8').trim()
          if (isSameOrChildPath(projectRoot, workingDir)) addChatsDir(entry.name)
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

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
// Antigravity (agy) provider
// ~/.gemini/antigravity-cli/conversation_summaries.db
// ~/.gemini/antigravity-cli/conversations/<id>.db
// ~/.gemini/antigravity-cli/history.jsonl
// ════════════════════════════════════════════════════════════════

function fileUriToPath(uri: string): string {
  try {
    const url = new URL(uri)
    let p = decodeURIComponent(url.pathname)
    if (process.platform === 'win32' && /^\/[a-zA-Z]:/i.test(p)) {
      p = p.slice(1)
    }
    return p
  } catch {
    return uri.replace(/^file:\/\/\/?([a-zA-Z]:)/i, '$1').replace(/^file:\/\//, '')
  }
}

function resolveAntigravityBaseDirs(): string[] {
  const candidates = [
    path.join(os.homedir(), '.gemini', 'antigravity-cli'),
    path.join(os.homedir(), '.antigravity', 'antigravity-cli'),
    path.join(os.homedir(), '.antigravity'),
    path.join(os.homedir(), '.agy')
  ]
  return candidates.filter((d) => fs.existsSync(d))
}

interface SqliteStatement {
  all: () => unknown[]
}

interface SqliteDatabase {
  prepare: (sql: string) => SqliteStatement
  close: () => void
}

type BetterSqliteConstructor = new (path: string, options?: { readonly?: boolean; fileMustExist?: boolean }) => SqliteDatabase

interface AntigravitySummaryRow {
  conversation_id: string
  title?: string
  preview?: string
  last_modified_time?: string
  workspace_uris?: string
  last_user_input_time?: string
}

interface AntigravityHistoryEntry {
  display?: unknown
  timestamp?: unknown
  workspace?: unknown
  cwd?: unknown
  conversationId?: unknown
  conversation_id?: unknown
}

const antigravityProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    const baseDirs = resolveAntigravityBaseDirs()
    const sessions: NativeSession[] = []
    const seenSessionIds = new Set<string>()

    let DatabaseConstructor: BetterSqliteConstructor | null = null
    try {
      DatabaseConstructor = require('better-sqlite3') as unknown as BetterSqliteConstructor
    } catch {
      // outside Electron or native binding unavailable
    }

    for (const baseDir of baseDirs) {
      const dbPath = path.join(baseDir, 'conversation_summaries.db')
      const convDir = path.join(baseDir, 'conversations')
      const historyFile = path.join(baseDir, 'history.jsonl')

      // 1. Try reading SQLite conversation_summaries.db
      if (DatabaseConstructor && fs.existsSync(dbPath)) {
        let db: SqliteDatabase | null = null
        try {
          db = new DatabaseConstructor(dbPath, { readonly: true, fileMustExist: true })
          const rows = db.prepare(
            'SELECT conversation_id, title, preview, last_modified_time, workspace_uris, last_user_input_time FROM conversation_summaries'
          ).all() as AntigravitySummaryRow[]
          for (const row of rows) {
            let uris: string[] = []
            if (row.workspace_uris) {
              try {
                const parsed = JSON.parse(row.workspace_uris)
                if (Array.isArray(parsed)) uris = parsed.filter((u): u is string => typeof u === 'string')
              } catch {
                if (typeof row.workspace_uris === 'string') uris = [row.workspace_uris]
              }
            }

            const matches = uris.length === 0 || uris.some((u) => {
              const p = fileUriToPath(u)
              return isSameOrChildPath(p, workingDir) || isSameOrChildPath(workingDir, p)
            })
            if (!matches) continue

            seenSessionIds.add(row.conversation_id)
            const rawTitle = (row.title || '').trim() || (row.preview || '').trim()
            const title = rawTitle ? truncateTitle(rawTitle) : `Session ${row.conversation_id.slice(0, 8)}`

            let modifiedAt = 0
            if (row.last_modified_time && !row.last_modified_time.startsWith('0001-')) {
              const parsed = new Date(row.last_modified_time).getTime()
              if (Number.isFinite(parsed) && parsed > 0) modifiedAt = parsed
            }
            if (!modifiedAt && row.last_user_input_time && !row.last_user_input_time.startsWith('0001-')) {
              const parsed = new Date(row.last_user_input_time).getTime()
              if (Number.isFinite(parsed) && parsed > 0) modifiedAt = parsed
            }

            let sizeBytes: number | undefined
            if (fs.existsSync(convDir)) {
              try {
                const stat = fs.statSync(path.join(convDir, `${row.conversation_id}.db`))
                if (!modifiedAt) modifiedAt = stat.mtimeMs
                sizeBytes = stat.size
              } catch { /* skip */ }
            }

            sessions.push({
              sessionId: row.conversation_id,
              title,
              modifiedAt: modifiedAt || Date.now(),
              sizeBytes
            })
          }
        } catch {
          // ignore db read errors
        } finally {
          try { db?.close() } catch { /* ignore */ }
        }
      }

      // 2. Also check history.jsonl (captures prompts or works when DB is locked/unavailable)
      if (fs.existsSync(historyFile)) {
        try {
          const content = fs.readFileSync(historyFile, 'utf-8')
          for (const line of content.split('\n')) {
            if (!line.trim()) continue
            try {
              const entry = JSON.parse(line) as AntigravityHistoryEntry
              const ws = typeof entry.workspace === 'string' ? entry.workspace : typeof entry.cwd === 'string' ? entry.cwd : ''
              if (!ws || (!isSameOrChildPath(ws, workingDir) && !isSameOrChildPath(workingDir, ws))) continue

              const rawConvId = entry.conversationId || entry.conversation_id
              const convId = typeof rawConvId === 'string' ? rawConvId : ''
              if (!convId) continue

              if (seenSessionIds.has(convId)) {
                // If existing session from DB has generic title, enrich it with history display prompt
                const existing = sessions.find((s) => s.sessionId === convId)
                if (existing && (/^Session\s+[0-9a-f]{8}/i.test(existing.title) || !existing.title)) {
                  if (typeof entry.display === 'string' && !entry.display.startsWith('/')) {
                    existing.title = truncateTitle(entry.display)
                  }
                }
                continue
              }

              seenSessionIds.add(convId)
              const title = typeof entry.display === 'string' && entry.display
                ? truncateTitle(entry.display)
                : `Session ${convId.slice(0, 8)}`
              const timestamp = typeof entry.timestamp === 'number' ? entry.timestamp : Date.now()
              sessions.push({
                sessionId: convId,
                title,
                modifiedAt: timestamp
              })
            } catch { /* skip line */ }
          }
        } catch { /* skip history */ }
      }
    }

    // 3. Fallback to Gemini tmp directory if no sessions found (legacy compatibility)
    if (sessions.length === 0) {
      return geminiProvider.listSessions(workingDir)
    }

    sessions.sort((a, b) => b.modifiedAt - a.modifiedAt)
    return sessions
  }
}

// ════════════════════════════════════════════════════════════════
// Grok provider
// ════════════════════════════════════════════════════════════════

/**
 * Grok stores sessions under ~/.grok/sessions/<url-encoded-cwd>/<session-id>/.
 * Each session dir has summary.json (title/cwd/mtime) and chat_history.jsonl.
 * Project-level prompt_history.jsonl maps session_id → first prompt for titles.
 */
function grokProjectDirCandidates(workingDir: string): string[] {
  const resolved = path.resolve(workingDir)
  const candidates = new Set<string>()
  // encodeURIComponent keeps drive letter + backslashes on Windows (matches Grok)
  candidates.add(encodeURIComponent(resolved))
  candidates.add(encodeURIComponent(resolved.replace(/\\/g, '/')))
  if (process.platform === 'win32') {
    // Alternate drive letter casing
    if (/^[A-Za-z]:/.test(resolved)) {
      const flipped = resolved.charAt(0) === resolved.charAt(0).toUpperCase()
        ? resolved.charAt(0).toLowerCase() + resolved.slice(1)
        : resolved.charAt(0).toUpperCase() + resolved.slice(1)
      candidates.add(encodeURIComponent(flipped))
      candidates.add(encodeURIComponent(flipped.replace(/\\/g, '/')))
    }
  }
  return [...candidates]
}

function resolveGrokProjectDirs(workingDir: string): string[] {
  const sessionsRoot = path.join(os.homedir(), '.grok', 'sessions')
  if (!fs.existsSync(sessionsRoot)) return []

  const dirs = new Set<string>()
  for (const name of grokProjectDirCandidates(workingDir)) {
    const dir = path.join(sessionsRoot, name)
    if (fs.existsSync(dir)) dirs.add(dir)
  }

  // Fallback: scan for summary.json whose cwd matches the workspace
  if (dirs.size === 0) {
    try {
      for (const entry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === 'session_search.sqlite') continue
        const projectDir = path.join(sessionsRoot, entry.name)
        // Sample one session's summary for cwd match
        try {
          const children = fs.readdirSync(projectDir, { withFileTypes: true })
          for (const child of children) {
            if (!child.isDirectory()) continue
            const summaryPath = path.join(projectDir, child.name, 'summary.json')
            if (!fs.existsSync(summaryPath)) continue
            const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))
            const cwd = summary?.info?.cwd || summary?.cwd
            if (cwd && isSameOrChildPath(cwd, workingDir)) {
              dirs.add(projectDir)
            }
            break
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return [...dirs]
}

function readGrokPromptTitleMap(projectDir: string): Map<string, string> {
  const map = new Map<string, string>()
  const historyFile = path.join(projectDir, 'prompt_history.jsonl')
  if (!fs.existsSync(historyFile)) return map
  try {
    const content = fs.readFileSync(historyFile, 'utf-8')
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as { session_id?: string; prompt?: string; is_bash?: boolean }
        if (!entry.session_id || !entry.prompt || entry.is_bash) continue
        if (map.has(entry.session_id)) continue
        const title = truncateTitle(entry.prompt)
        if (title) map.set(entry.session_id, title)
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return map
}

const grokProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    const projectDirs = resolveGrokProjectDirs(workingDir)
    if (projectDirs.length === 0) return []

    const sessions: NativeSession[] = []
    const seen = new Set<string>()

    for (const projectDir of projectDirs) {
      const titleMap = readGrokPromptTitleMap(projectDir)
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(projectDir, { withFileTypes: true }) }
      catch { continue }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const sessionId = entry.name
        if (seen.has(sessionId)) continue
        const sessionDir = path.join(projectDir, sessionId)
        const summaryPath = path.join(sessionDir, 'summary.json')

        try {
          let title = titleMap.get(sessionId) || ''
          let modifiedAt = 0
          let sizeBytes = 0

          if (fs.existsSync(summaryPath)) {
            const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))
            const cwd = summary?.info?.cwd || summary?.cwd
            if (cwd && !isSameOrChildPath(cwd, workingDir)) continue
            title = summary.generated_title || summary.session_summary || title
            const updated = summary.last_active_at || summary.updated_at || summary.created_at
            if (updated) modifiedAt = new Date(updated).getTime()
          }

          try {
            const stat = fs.statSync(sessionDir)
            if (!modifiedAt) modifiedAt = stat.mtimeMs
            // Prefer chat_history size when available
            const chatPath = path.join(sessionDir, 'chat_history.jsonl')
            if (fs.existsSync(chatPath)) sizeBytes = fs.statSync(chatPath).size
          } catch { /* skip */ }

          if (!title) title = `Session ${sessionId.slice(0, 8)}`
          seen.add(sessionId)
          sessions.push({
            sessionId,
            title: truncateTitle(title),
            modifiedAt: modifiedAt || Date.now(),
            sizeBytes: sizeBytes || undefined
          })
        } catch { /* skip */ }
      }
    }

    sessions.sort((a, b) => b.modifiedAt - a.modifiedAt)
    return sessions
  }
}

// ════════════════════════════════════════════════════════════════
// OpenCode provider
// ════════════════════════════════════════════════════════════════

/**
 * OpenCode uses SQLite for session storage (~/.local/share/opencode/).
 * We use the `opencode session list` CLI command for portability.
 */
const opencodeProvider: NativeSessionProvider = {
  async listSessions(_workingDir: string): Promise<NativeSession[]> {
    return new Promise((resolve) => {
      try {
        execFile('opencode', ['session', 'list'], {
          timeout: 5000,
          env: { ...process.env },
          windowsHide: true
        }, (err, stdout) => {
          if (err || !stdout.trim()) { resolve([]); return }

          const sessions: NativeSession[] = []
          const lines = stdout.trim().split('\n')
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            // Skip header-like lines
            if (/^id\b/i.test(trimmed) || /^session/i.test(trimmed)) continue
            const parts = trimmed.split(/\s{2,}/)
            if (parts.length >= 1) {
              const sessionId = parts[0].trim()
              if (!sessionId || sessionId.length < 4) continue
              const title = parts[1]?.trim() || `Session ${sessionId.slice(0, 8)}`
              sessions.push({
                sessionId,
                title,
                modifiedAt: Date.now()
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
// Qoder provider (Claude-like JSONL under ~/.qoderworkcn or ~/.qoder)
// ════════════════════════════════════════════════════════════════

const qoderProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    const home = os.homedir()
    const roots = [
      path.join(home, '.qoderworkcn', 'projects'),
      path.join(home, '.qoder', 'projects'),
      path.join(home, '.qoder-cn', 'projects')
    ]
    return listClaudeStyleSessions(resolveClaudeStyleProjectDirs(workingDir, roots))
  }
}

// ════════════════════════════════════════════════════════════════
// ZCode provider (Claude-compatible under ~/.zclaude/projects)
// ════════════════════════════════════════════════════════════════

const zcodeProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    return listClaudeStyleSessions(resolveClaudeStyleProjectDirs(workingDir, [
      path.join(os.homedir(), '.zclaude', 'projects')
    ]))
  }
}

// ════════════════════════════════════════════════════════════════
// Kimi provider (~/.kimi/sessions/<workdir-hash>/<session-id>/)
// ════════════════════════════════════════════════════════════════

function kimiWorkDirHash(dirPath: string): string {
  return crypto.createHash('md5').update(path.resolve(dirPath), 'utf8').digest('hex')
}

function resolveKimiSessionDirs(workingDir: string): string[] {
  const sessionsRoot = path.join(os.homedir(), '.kimi', 'sessions')
  if (!fs.existsSync(sessionsRoot)) return []

  const dirs: string[] = []
  const hash = kimiWorkDirHash(workingDir)
  const direct = path.join(sessionsRoot, hash)
  if (fs.existsSync(direct)) dirs.push(direct)

  // Also match KAOS-prefixed hashes and resolve via kimi.json work_dirs when present
  try {
    const configPath = path.join(os.homedir(), '.kimi', 'kimi.json')
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      const workDirs = Array.isArray(raw.work_dirs) ? raw.work_dirs : []
      for (const item of workDirs) {
        const wdPath = typeof item === 'string' ? item : item?.path
        if (!wdPath || !isSameOrChildPath(wdPath, workingDir)) continue
        const md5 = kimiWorkDirHash(wdPath)
        const candidates = [md5]
        const kaos = typeof item === 'object' ? item?.kaos : undefined
        if (kaos && String(kaos).toLowerCase() !== 'local') {
          candidates.push(`${kaos}_${md5}`)
        }
        for (const name of candidates) {
          const d = path.join(sessionsRoot, name)
          if (fs.existsSync(d) && !dirs.includes(d)) dirs.push(d)
        }
      }
    }
  } catch { /* skip */ }

  // Fallback scan: any workdir hash folder that has sessions with matching cwd in state
  if (dirs.length === 0) {
    try {
      for (const entry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const workDirPath = path.join(sessionsRoot, entry.name)
        // Check first session state for cwd
        try {
          const children = fs.readdirSync(workDirPath, { withFileTypes: true })
          for (const child of children) {
            if (!child.isDirectory()) continue
            const statePath = path.join(workDirPath, child.name, 'state.json')
            const metaPath = path.join(workDirPath, child.name, 'metadata.json')
            for (const p of [statePath, metaPath]) {
              if (!fs.existsSync(p)) continue
              const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
              const cwd = data.cwd || data.work_dir || data.workdir
              if (cwd && isSameOrChildPath(cwd, workingDir)) {
                dirs.push(workDirPath)
              }
              break
            }
            break
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return dirs
}

const kimiProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    const workDirFolders = resolveKimiSessionDirs(workingDir)
    if (workDirFolders.length === 0) return []

    const sessions: NativeSession[] = []
    const seen = new Set<string>()

    for (const workDirFolder of workDirFolders) {
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(workDirFolder, { withFileTypes: true }) }
      catch { continue }

      for (const entry of entries) {
        try {
          if (entry.isDirectory()) {
            const sessionDir = path.join(workDirFolder, entry.name)
            const contextPath = path.join(sessionDir, 'context.jsonl')
            if (!fs.existsSync(contextPath)) continue

            let sessionId = entry.name
            let title = ''
            let modifiedAt = fs.statSync(contextPath).mtimeMs
            let sizeBytes = fs.statSync(contextPath).size

            for (const metaName of ['state.json', 'metadata.json']) {
              const metaPath = path.join(sessionDir, metaName)
              if (!fs.existsSync(metaPath)) continue
              try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
                if (meta.archived === true) { sessionId = ''; break }
                if (meta.session_id) sessionId = meta.session_id
                title = meta.custom_title || meta.title || title
                if (meta.wire_mtime && typeof meta.wire_mtime === 'number') {
                  modifiedAt = meta.wire_mtime * 1000
                }
              } catch { /* skip */ }
            }
            if (!sessionId || seen.has(sessionId)) continue

            if (!title || title === 'Untitled') {
              // First user message from context.jsonl (first ~64KB)
              try {
                const fd = fs.openSync(contextPath, 'r')
                const buf = Buffer.alloc(Math.min(65536, sizeBytes))
                fs.readSync(fd, buf, 0, buf.length, 0)
                fs.closeSync(fd)
                for (const line of buf.toString('utf-8').split('\n')) {
                  if (!line.trim()) continue
                  try {
                    const data = JSON.parse(line)
                    if (data.role === 'user') {
                      const text = extractTextFromContent(data.content)
                      if (text) { title = truncateTitle(text); break }
                    }
                  } catch { /* skip */ }
                }
              } catch { /* skip */ }
            }

            seen.add(sessionId)
            sessions.push({
              sessionId,
              title: title || `Session ${sessionId.slice(0, 8)}`,
              modifiedAt,
              sizeBytes
            })
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            // Legacy flat layout
            const sessionId = entry.name.replace(/\.jsonl$/, '')
            if (seen.has(sessionId)) continue
            const filePath = path.join(workDirFolder, entry.name)
            const stat = fs.statSync(filePath)
            seen.add(sessionId)
            sessions.push({
              sessionId,
              title: `Session ${sessionId.slice(0, 8)}`,
              modifiedAt: stat.mtimeMs,
              sizeBytes: stat.size
            })
          }
        } catch { /* skip */ }
      }
    }

    sessions.sort((a, b) => b.modifiedAt - a.modifiedAt)
    return sessions
  }
}

// ════════════════════════════════════════════════════════════════
// Oh My Pi provider (~/.omp/agent/sessions/<cwd-slug>/<ts>_<id>.jsonl)
// ════════════════════════════════════════════════════════════════

/**
 * Leading records of an omp session file. omp keeps a rewritable `title` record
 * (padded with spaces) as line 1 and the `session` header as line 2, so the auto
 * generated title is available without walking the whole transcript.
 */
interface OmpSessionHead {
  sessionId?: string
  cwd?: string
  title?: string
  firstUserText?: string
}

function readOmpSessionHead(filePath: string, maxBytes = 65536): OmpSessionHead {
  const head: OmpSessionHead = {}
  let raw = ''
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const size = fs.fstatSync(fd).size
      const buf = Buffer.alloc(Math.min(maxBytes, size))
      fs.readSync(fd, buf, 0, buf.length, 0)
      raw = buf.toString('utf-8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return head
  }

  // The final line of a truncated read may be partial — safeJsonParseObject drops it.
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const data = safeJsonParseObject(line)
    if (data.type === 'title') {
      const title = typeof data.title === 'string' ? data.title.trim() : ''
      if (title) head.title = truncateTitle(title)
    } else if (data.type === 'session') {
      if (typeof data.id === 'string') head.sessionId = data.id
      if (typeof data.cwd === 'string') head.cwd = data.cwd
    } else if (data.type === 'message' && !head.firstUserText) {
      const message = data.message as { role?: string; content?: unknown } | undefined
      if (message?.role !== 'user') continue
      const text = extractTextFromContent(message.content)
      if (text && !isClaudeSyntheticUserText(text)) head.firstUserText = truncateTitle(text)
    }
  }
  return head
}

/**
 * omp slugifies the cwd one character at a time (every non-alphanumeric becomes
 * "-") and wraps the result in separator dashes:
 * `D:\repos\my-app` → `--D--repos-my-app--`.
 */
function ompSlugCandidates(dirPath: string): string[] {
  const slug = path.resolve(dirPath).replace(/[^a-zA-Z0-9]/g, '-')
  return [`--${slug}--`, `-${slug}-`, slug]
}

export function resolveOmpSessionDirs(workingDir: string): string[] {
  const sessionsRoot = path.join(os.homedir(), '.omp', 'agent', 'sessions')
  if (!fs.existsSync(sessionsRoot)) return []

  const dirs: string[] = []
  for (const name of ompSlugCandidates(workingDir)) {
    const candidate = path.join(sessionsRoot, name)
    if (fs.existsSync(candidate) && !dirs.includes(candidate)) dirs.push(candidate)
  }
  if (dirs.length > 0) return dirs

  // Unknown slug scheme (or sessions started in a subdirectory): match on the
  // `cwd` recorded inside the first session file of each folder.
  try {
    for (const entry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = path.join(sessionsRoot, entry.name)
      let firstFile: string | undefined
      try {
        firstFile = fs
          .readdirSync(dir, { withFileTypes: true })
          .find((child) => child.isFile() && child.name.endsWith('.jsonl'))?.name
      } catch { /* skip */ }
      if (!firstFile) continue
      const { cwd } = readOmpSessionHead(path.join(dir, firstFile), 8192)
      if (cwd && isSameOrChildPath(cwd, workingDir)) dirs.push(dir)
    }
  } catch { /* skip */ }

  return dirs
}

const ompProvider: NativeSessionProvider = {
  async listSessions(workingDir: string): Promise<NativeSession[]> {
    const sessionDirs = resolveOmpSessionDirs(workingDir)
    if (sessionDirs.length === 0) return []

    const sessions: NativeSession[] = []
    const seen = new Set<string>()

    for (const dir of sessionDirs) {
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
      catch { continue }

      for (const entry of entries) {
        // Sibling folders named after a session hold its scratch data, not history.
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
        try {
          const filePath = path.join(dir, entry.name)
          const stat = fs.statSync(filePath)
          const head = readOmpSessionHead(filePath)
          // Filenames are `<iso-timestamp>_<session-id>.jsonl`.
          const sessionId = head.sessionId || entry.name.replace(/\.jsonl$/, '').replace(/^[^_]*_/, '')
          if (!sessionId || seen.has(sessionId)) continue
          seen.add(sessionId)
          sessions.push({
            sessionId,
            title: head.title || head.firstUserText || `Session ${sessionId.slice(0, 8)}`,
            modifiedAt: stat.mtimeMs,
            sizeBytes: stat.size
          })
        } catch { /* skip */ }
      }
    }

    sessions.sort((a, b) => b.modifiedAt - a.modifiedAt)
    return sessions
  }
}

// ════════════════════════════════════════════════════════════════
// Trae / MiMo — no stable public local session layout yet
// ════════════════════════════════════════════════════════════════

const emptyProvider: NativeSessionProvider = {
  async listSessions(): Promise<NativeSession[]> {
    return []
  }
}

// ════════════════════════════════════════════════════════════════
// Provider registry
// ════════════════════════════════════════════════════════════════

const providers: Partial<Record<AIToolType, NativeSessionProvider>> = {
  claude: claudeProvider,
  codex: codexProvider,
  gemini: geminiProvider,
  grok: grokProvider,
  opencode: opencodeProvider,
  qoder: qoderProvider,
  zcode: zcodeProvider,
  kimi: kimiProvider,
  trae: emptyProvider,
  mimo: emptyProvider,
  antigravity: antigravityProvider,
  omp: ompProvider
}

/** Tool types that have a native session list provider (used by sidebar / tab history). */
export const NATIVE_SESSION_TOOL_TYPES: AIToolType[] = (
  Object.keys(providers) as AIToolType[]
).filter((t) => t !== 'terminal' && t !== 'qwen')

const sessionListCache = new Map<string, { timestamp: number; data: NativeSession[] }>()
const inFlightListRequests = new Map<string, Promise<NativeSession[]>>()
const LIST_CACHE_TTL_MS = 3_000

/**
 * List native CLI tool sessions for a given workspace and tool type.
 * Returns sessions sorted by modification time (newest first).
 * Cached with a 3-second TTL and in-flight de-duplication so overlapping
 * sidebar polls don't re-scan the same directories and stall the main process.
 */
export async function listNativeSessions(
  workingDir: string,
  toolType: AIToolType
): Promise<NativeSession[]> {
  const provider = providers[toolType]
  if (!provider) return []

  const cacheKey = `${normalizeSessionPath(workingDir)}:${toolType}`
  const cached = sessionListCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < LIST_CACHE_TTL_MS) {
    return cached.data
  }

  const existingInFlight = inFlightListRequests.get(cacheKey)
  if (existingInFlight) return existingInFlight

  const task = (async (): Promise<NativeSession[]> => {
    try {
      const result = await provider.listSessions(workingDir)
      sessionListCache.set(cacheKey, { timestamp: Date.now(), data: result })
      return result
    } catch (err) {
      console.error(`[NativeSessions] Failed to list ${toolType} sessions:`, err)
      return []
    } finally {
      inFlightListRequests.delete(cacheKey)
    }
  })()

  inFlightListRequests.set(cacheKey, task)
  return task
}

/**
 * Drop cached native session listings — all of them, every tool for one
 * workspace dir, or a single (dir, tool) pair.
 */
export function invalidateNativeSessionCache(workingDir?: string, toolType?: AIToolType): void {
  if (!workingDir) {
    sessionListCache.clear()
    return
  }
  const norm = normalizeSessionPath(workingDir)
  for (const key of [...sessionListCache.keys()]) {
    if (toolType ? key === `${norm}:${toolType}` : key.startsWith(`${norm}:`)) {
      sessionListCache.delete(key)
    }
  }
}

export async function loadNativeSessionTranscript(
  workingDir: string,
  toolType: AIToolType,
  sessionId: string
): Promise<NativeTranscriptMessage[]> {
  try {
    if (toolType === 'claude') return readClaudeTranscript(workingDir, sessionId)
    if (toolType === 'codex') return readCodexTranscript(workingDir, sessionId)
    return []
  } catch (err) {
    console.error(`[NativeSessions] Failed to load ${toolType} transcript:`, err)
    return []
  }
}
