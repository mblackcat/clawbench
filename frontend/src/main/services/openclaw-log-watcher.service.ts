import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { WebContents } from 'electron'
import { info as logInfo, warn as logWarn, error as logError } from '../utils/logger'

type ActivityState =
  | 'idle'
  | 'thinking'
  | 'web_search'
  | 'doc_processing'
  | 'sending_message'
  | 'tool_call'
  | 'agent_conversation'

interface ActiveSubagent {
  id: string
  label: string
  model?: string
}

let watcher: fs.FSWatcher | null = null
let runsJsonWatchPath: string | null = null
let identityWatchPath: string | null = null
let currentFd: number | null = null
let currentOffset = 0
let currentFile = ''
let idleTimer: ReturnType<typeof setTimeout> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let targetWebContents: WebContents | null = null
let lastState: ActivityState = 'idle'

const IDLE_TIMEOUT_MS = 5000
const DEBOUNCE_MS = 100

function getSessionsDir(): string {
  return path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions')
}

function getSubagentsDir(): string {
  return path.join(os.homedir(), '.openclaw', 'subagents')
}

function getWorkspaceDir(): string {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
      const config = JSON.parse(raw) as Record<string, unknown>
      const agentCfg = (config?.agent ?? config?.agents) as Record<string, unknown> | undefined
      const workspace = agentCfg?.workspace
      if (typeof workspace === 'string' && workspace) {
        return workspace.replace(/^~/, os.homedir())
      }
    }
  } catch { /* ignore */ }
  const profile = process.env.OPENCLAW_PROFILE
  if (profile && profile !== 'default') {
    return path.join(os.homedir(), '.openclaw', `workspace-${profile}`)
  }
  return path.join(os.homedir(), '.openclaw', 'workspace')
}

/**
 * Parse IDENTITY.md for sub-agent definitions.
 * Looks for lines like: **Subagents Name:** 小龙 (Little Dragon)
 */
function readIdentitySubagents(): ActiveSubagent[] {
  try {
    const identityPath = path.join(getWorkspaceDir(), 'IDENTITY.md')
    if (!fs.existsSync(identityPath)) return []
    const content = fs.readFileSync(identityPath, 'utf-8')
    const match = content.match(/\*\*Subagents?\s+Name:\*\*\s*(.+)/i)
    if (!match) return []
    const label = match[1].trim()
    return [{ id: 'identity-subagent', label }]
  } catch {
    return []
  }
}

function readActiveSubagents(): ActiveSubagent[] {
  // Primary source: runs.json active entries
  const fromRuns: ActiveSubagent[] = (() => {
    try {
      const runsPath = path.join(getSubagentsDir(), 'runs.json')
      if (!fs.existsSync(runsPath)) return []
      const raw = fs.readFileSync(runsPath, 'utf-8')
      const data = JSON.parse(raw) as { runs?: Record<string, Record<string, unknown>> }
      const runs = data?.runs ?? {}
      return Object.values(runs)
        .filter((run) => run.startedAt && !run.endedAt)
        .map((run) => ({
          id: run.runId as string,
          label: (run.label as string) || 'sub-agent',
          model: run.model as string | undefined
        }))
    } catch {
      return []
    }
  })()

  if (fromRuns.length > 0) return fromRuns

  // Fallback: identity-defined sub-agents (catches missed timing events)
  return readIdentitySubagents()
}

function emitActiveSubagents(): void {
  if (!targetWebContents || targetWebContents.isDestroyed()) return
  const subagents = readActiveSubagents()
  targetWebContents.send('openclaw:active-subagents', subagents)
}

function findLatestSession(sessionsDir: string): string | null {
  try {
    if (!fs.existsSync(sessionsDir)) return null
    const entries = fs.readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, t: fs.statSync(path.join(sessionsDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    return entries.length > 0 ? path.join(sessionsDir, entries[0].f) : null
  } catch {
    return null
  }
}

/**
 * Map a tool call name to the matching animation state.
 */
function toolNameToState(name: string): ActivityState {
  const n = name.toLowerCase()
  if (n === 'message' || n === 'send_message' || n === 'reply') return 'sending_message'
  if (n.includes('web_search') || n.includes('browser') || n.includes('browse') || n.includes('search')) return 'web_search'
  if (n.includes('file_read') || n.includes('read_file') || n.includes('document') || n.includes('fetch')) return 'doc_processing'
  if (n === 'sessions_spawn' || n.includes('spawn') || n.includes('agent') || n.includes('subagent') || n.includes('delegate')) return 'agent_conversation'
  return 'tool_call'
}

/**
 * Parse a single JSONL line from the session file.
 * Returns the animation state it maps to, or null if irrelevant.
 */
function parseSessionLine(line: string): ActivityState | null {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }

  if (!obj || typeof obj !== 'object') return null

  switch (obj.type) {
    case 'message': {
      const msg = obj.message as Record<string, unknown> | undefined
      if (!msg) return null

      if (msg.role === 'user') return 'thinking'

      if (msg.role === 'assistant') {
        const content = Array.isArray(msg.content) ? msg.content as Record<string, unknown>[] : []
        // Check content blocks for tool calls — first match wins
        for (const block of content) {
          if (block?.type === 'toolCall') {
            return toolNameToState((block.name as string) || '')
          }
        }
        // Pure text / thinking response
        return 'thinking'
      }
      return null
    }

    // Standalone toolCall event (may appear before the message wraps it)
    case 'toolCall': {
      return toolNameToState((obj.name as string) || '')
    }

    // Raw thinking/text streaming chunks
    case 'thinking':
    case 'text':
      return 'thinking'

    default:
      return null
  }
}

function emitState(state: ActivityState): void {
  if (!targetWebContents || targetWebContents.isDestroyed()) return
  if (state === lastState) return
  lastState = state
  targetWebContents.send('openclaw:activity-state', state)
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => emitState('idle'), IDLE_TIMEOUT_MS)
}

function readNewLines(): void {
  if (currentFd === null) return
  try {
    const stat = fs.fstatSync(currentFd)
    if (stat.size <= currentOffset) return

    const buf = Buffer.alloc(stat.size - currentOffset)
    fs.readSync(currentFd, buf, 0, buf.length, currentOffset)
    currentOffset = stat.size

    const lines = buf.toString('utf-8').split('\n').filter(Boolean)
    let detectedState: ActivityState | null = null

    for (const line of lines) {
      const s = parseSessionLine(line)
      if (s) detectedState = s
    }

    if (detectedState) {
      emitState(detectedState)
      resetIdleTimer()
    }
  } catch (err) {
    logWarn('[openclaw-log-watcher] Error reading session file:', err)
  }
}

function openSessionFile(filePath: string): void {
  if (currentFd !== null) {
    try { fs.closeSync(currentFd) } catch { /* ignore */ }
  }
  try {
    currentFd = fs.openSync(filePath, 'r')
    const stat = fs.fstatSync(currentFd)
    // Start from end of file — only watch new events
    currentOffset = stat.size
    currentFile = filePath
  } catch (err) {
    logWarn('[openclaw-log-watcher] Failed to open session file:', err)
    currentFd = null
  }
}

export function startLogWatcher(webContents: WebContents): void {
  stopLogWatcher()

  targetWebContents = webContents
  const sessionsDir = getSessionsDir()

  // Open the most recently active session file
  const latestSession = findLatestSession(sessionsDir)
  if (latestSession) {
    openSessionFile(latestSession)
  }

  // Watch the sessions directory for new session files and appended events
  try {
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true })
    }

    watcher = fs.watch(sessionsDir, (eventType, filename) => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        if (!filename) return

        const fullPath = path.join(sessionsDir, filename)

        // New session file created — switch to it
        if (eventType === 'rename' && fs.existsSync(fullPath) && filename.endsWith('.jsonl')) {
          const latest = findLatestSession(sessionsDir)
          if (latest && latest !== currentFile) {
            openSessionFile(latest)
          }
        }

        // Read any new lines appended to the current session
        readNewLines()
      }, DEBOUNCE_MS)
    })

    emitState('idle')
    logInfo('[openclaw-log-watcher] Started watching sessions at', sessionsDir)
  } catch (err) {
    logError('[openclaw-log-watcher] Failed to start watcher:', err)
  }

  // Watch runs.json directly with polling (fs.watchFile) — reliable for in-place writeFileSync
  const subagentsDir = getSubagentsDir()
  const runsPath = path.join(subagentsDir, 'runs.json')
  try {
    if (!fs.existsSync(subagentsDir)) {
      fs.mkdirSync(subagentsDir, { recursive: true })
    }
    emitActiveSubagents()
    runsJsonWatchPath = runsPath
    fs.watchFile(runsPath, { interval: 1000, persistent: false }, () => {
      emitActiveSubagents()
    })
  } catch (err) {
    logWarn('[openclaw-log-watcher] Failed to watch subagents runs.json:', err)
  }

  // Watch IDENTITY.md for sub-agent definition changes
  const identityPath = path.join(getWorkspaceDir(), 'IDENTITY.md')
  try {
    identityWatchPath = identityPath
    fs.watchFile(identityPath, { interval: 2000, persistent: false }, () => {
      emitActiveSubagents()
    })
  } catch (err) {
    logWarn('[openclaw-log-watcher] Failed to watch IDENTITY.md:', err)
  }
}

export function stopLogWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
  }
  if (runsJsonWatchPath) {
    fs.unwatchFile(runsJsonWatchPath)
    runsJsonWatchPath = null
  }
  if (identityWatchPath) {
    fs.unwatchFile(identityWatchPath)
    identityWatchPath = null
  }
  if (currentFd !== null) {
    try { fs.closeSync(currentFd) } catch { /* ignore */ }
    currentFd = null
  }
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  targetWebContents = null
  lastState = 'idle'
  currentOffset = 0
  currentFile = ''
}

