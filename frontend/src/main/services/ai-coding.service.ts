import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as logger from '../utils/logger'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'

const execFileAsync = promisify(execFile)
import {
  getAICodingConfig,
  setAICodingWorkspaces,
  setAICodingSessions,
  setAICodingGroups,
  setAICodingIMConfig,
  getIMAutoConnect,
  aiCodingStore,
  migrateV1ToV2,
  migrateV2ToV3
} from '../store/ai-coding.store'
import type {
  AIToolType,
  AICodingWorkspace,
  AICodingSession,
  AICodingGroup,
  AICodingIMConfig
} from '../store/ai-coding.store'
import {
  killPtySession, hasPtySession, writeToPty,
  createPtySession, getToolCommand, getResumeArgs, getPtySessionOutput,
  getRawPtyOutput, registerPtyOutputCallback
} from './pty-manager.service'
import {
  launchSDKSession, writeToSDKSession, closeSDKSession, hasSDKSession,
  getSDKSessionOutput, interruptSDKSession, setSDKPermissionMode, setSDKEffort,
  resolveSDKPermission, answerSDKQuestion, detectManagedInteractiveState
} from './sdk-session-manager.service'
import {
  launchCodexSession, writeToCodexSession, closeCodexSession, hasCodexSession,
  getCodexSessionOutput, interruptCodexSession, setCodexSessionMode, setCodexSessionEffort, resolveBundledCodexPath
} from './codex-session-manager.service'
import { detectAvailableCLIs, getAugmentedEnv, loadShellEnv } from './cli-detect.service'
import { settingsStore } from '../store/settings.store'

/**
 * Resolve a binary name to its absolute path using the provided env's PATH.
 * This bypasses posix_spawnp's own PATH lookup — critical in packaged apps
 * where the PATH passed to node-pty may still not match the user's shell PATH.
 * Falls back to the bare binary name if resolution fails.
 */
async function resolveCommandPath(binary: string, env: Record<string, string>): Promise<string> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('where', [binary], { timeout: 3000, env })
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
      if (lines.length > 0) {
        // Prefer native .exe first (better ConPTY for fullscreen TUIs like Grok),
        // then .cmd/.bat shims for npm-global CLIs, then extensionless paths.
        const exe = lines.find((p) => /\.exe$/i.test(p))
        if (exe) return exe
        const shim = lines.find((p) => /\.(cmd|bat)$/i.test(p))
        return shim || lines[0]
      }
    } catch {
      // Fall back to original binary
    }
    return binary
  }

  // Check the native installer location first (~/.local/bin) so it wins over
  // a Homebrew copy of the same binary even if Homebrew appears first in PATH.
  // Mirrors the priority used by detectClaudeCLI().
  const nativePath = path.join(os.homedir(), '.local', 'bin', binary)
  try {
    await fs.promises.access(nativePath, fs.constants.X_OK)
    return nativePath
  } catch { /* not installed there */ }

  try {
    const { stdout } = await execFileAsync('which', [binary], { timeout: 3000, env })
    const resolved = stdout.trim().split('\n')[0].trim()
    if (resolved) return resolved
  } catch {
    // fall through to bare name
  }
  return binary
}

/**
 * Build spawn environment for a given tool type.
 * Augments PATH and injects API keys from app settings when missing from
 * the parent process env (common when Electron is launched from the GUI).
 */
function buildToolEnv(toolType: AIToolType): Record<string, string> {
  const env = getAugmentedEnv() as Record<string, string>

  const aiModelConfigs = (settingsStore.get('aiModelConfigs') ?? []) as Array<{
    provider: string
    apiKey: string
    enabled: boolean
  }>

  if (toolType === 'gemini' && !env.GEMINI_API_KEY) {
    const googleConfig = aiModelConfigs.find((c) => c.provider === 'google' && c.apiKey)
    if (googleConfig?.apiKey) env.GEMINI_API_KEY = googleConfig.apiKey
  }

  if (toolType === 'codex' && !env.OPENAI_API_KEY) {
    const openaiConfig = aiModelConfigs.find((c) => c.provider === 'openai' && c.apiKey)
    if (openaiConfig?.apiKey) env.OPENAI_API_KEY = openaiConfig.apiKey
  }

  // Inject theme to match the app's global appearance
  const appTheme = settingsStore.get('theme') as string || 'light'
  const isDark = appTheme === 'dark'

  if (toolType === 'claude') {
    // Claude Code: CLAUDE_CODE_THEME env var (chat/SDK mode respects app theme)
    env.CLAUDE_CODE_THEME = isDark ? 'dark' : 'light'
  }

  // CodingTerminalView is always a dark xterm surface (#0c0c0c / #1e1e1e).
  // Advertise a dark terminal to every TUI tool so panel/input backgrounds
  // match what the user sees in a local Windows Terminal / iTerm session.
  // (Previously COLORFGBG followed the app light theme, which made Grok paint
  // light-mode panels onto a dark xterm and look "broken".)
  env.COLORFGBG = '15;0'

  return env
}

// ── Push event to renderer ──

const runtimeSessions = new Map<string, AICodingSession>()

function notifyDataChanged(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('ai-coding:data-changed')
  })
}

// ── Session output (delegates to SDK/PTY managers for IM sessions) ──

export function getSessionOutput(sessionId: string): string {
  // Check SDK session first (Claude), then PTY session (other tools)
  const sdkOutput = getSDKSessionOutput(sessionId)
  if (sdkOutput) return sdkOutput
  const codexOutput = getCodexSessionOutput(sessionId)
  if (codexOutput) return codexOutput
  return getPtySessionOutput(sessionId)
}

export function getRawSessionOutput(sessionId: string): string {
  return getRawPtyOutput(sessionId)
}

// ── SDK session event handler (for IM mode) ──

function activityFromToolName(name: string | undefined): AICodingSession['lastActivity'] {
  if (!name) return 'tool_call'
  const writers = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'CreateFolder'])
  const readers = new Set(['Read', 'Glob', 'Grep', 'ListFiles', 'LS'])
  if (writers.has(name)) return 'writing'
  if (readers.has(name)) return 'reading'
  return 'tool_call'
}

function handleSDKEvent(sessionId: string, data: Record<string, unknown>): void {
  const msgType = (data.type as string) ?? ''

  if (msgType === 'system') {
    if (data.subtype === 'init') {
      const sid = (data.session_id as string) ?? ''
      if (sid) {
        updateSession(sessionId, { toolSessionId: sid })
      }
    }
    return
  }

  // High-frequency streaming events must NOT update session status or ping the
  // renderer here. `updateSession` calls `notifyDataChanged()`, and the
  // renderer's data-changed handler re-fetches workspaces + sessions + groups
  // — firing that on every text/thinking delta (hundreds per second) is what
  // froze the UI mid-reply. The turn's status is already 'running' from the
  // turn_start event; the streamed content itself travels over the separate
  // pipe-event channel, which the renderer coalesces.
  if (msgType === 'delta' || msgType === 'thinking_delta') {
    return
  }

  // State transitions only — a handful per turn. updateSession already pings
  // the renderer, so no extra notifyDataChanged() is needed here.
  if (msgType === 'turn_start' || msgType === 'turn_started' || msgType === 'thinking_start') {
    updateSession(sessionId, { status: 'running', lastActivity: 'thinking' })
  } else if (msgType === 'tool_start' || msgType === 'tool_executing') {
    updateSession(sessionId, { status: 'running', lastActivity: activityFromToolName(data.name as string) })
  } else if (msgType === 'tool_result') {
    updateSession(sessionId, { status: 'running', lastActivity: 'tool_call' })
  } else if (msgType === 'result') {
    const sid = (data.session_id as string) ?? ''
    const costUsd = typeof data.cost_usd === 'number' ? data.cost_usd : undefined
    // After a turn finishes, check if it's waiting for interactive input
    const currentOutput = getSDKSessionOutput(sessionId)
    const interactiveState = detectManagedInteractiveState(currentOutput)
    const updates: Partial<AICodingSession> = { status: 'idle', lastActivity: interactiveState || 'none' }
    if (sid) updates.toolSessionId = sid
    if (costUsd !== undefined) updates.costUsd = costUsd
    updateSession(sessionId, updates)
  } else if (msgType === 'error') {
    updateSession(sessionId, { status: 'idle', lastActivity: 'none' })
  }
}

function handleSDKClose(sessionId: string): void {
  logger.info(`[AICoding] SDK session closed: ${sessionId}`)
  const session = getSessionById(sessionId)
  if (session && session.status !== 'closed') {
    updateSession(sessionId, { status: 'completed', lastActivity: 'none' })
    notifyDataChanged()
  }
}

function handleSDKError(sessionId: string, _err: Error): void {
  logger.error(`[AICoding] SDK session error: ${sessionId}`)
  const session = getSessionById(sessionId)
  if (session && session.status !== 'closed') {
    updateSession(sessionId, { status: 'error', lastActivity: 'none' })
    notifyDataChanged()
  }
}

/**
 * PTY exit handler — mirrors handlePipeClose for non-Claude sessions.
 * Updates session status so IM bridge can detect completion.
 */
function handlePtyExit(sessionId: string, exitCode: number): void {
  if (exitCode === 0) {
    logger.info(`[AICoding] PTY session exited: ${sessionId} code=${exitCode}`)
  } else {
    logger.warn(`[AICoding] PTY session exited: ${sessionId} code=${exitCode}`)
  }
  const session = getSessionById(sessionId)
  if (session && session.status !== 'closed') {
    const status = exitCode === 0 ? 'completed' : 'error'
    updateSession(sessionId, { status, lastActivity: 'none' })
    notifyDataChanged()
  }
}

/**
 * PTY output stabilized handler — called when no new output has arrived for 2 seconds.
 * Transitions the session from 'running' back to 'idle' so the card reflects readiness.
 */
function handlePtyOutputStabilized(sessionId: string): void {
  const session = getSessionById(sessionId)
  if (session && session.status === 'running') {
    updateSession(sessionId, { status: 'idle', lastActivity: 'none' })
    notifyDataChanged()
  }
}

// ════════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════════

/** Called on app startup to reset any stale active sessions to 'closed'. */
export function resetActiveSessionsOnStart(): void {
  migrateV1ToV2()
  migrateV2ToV3()

  const { sessions } = getAICodingConfig()
  const updated = sessions.map((s): AICodingSession => {
    if (s.status !== 'idle' && s.status !== 'running') return s
    // PTY / pipe sessions cannot be re-attached after restart — close them
    return { ...s, status: 'closed', lastActivity: 'none', updatedAt: Date.now() }
  })
  const count = updated.filter((s, i) => s !== sessions[i]).length
  logger.info(`[AICoding] Reset ${count} stale sessions on start`)
  setAICodingSessions(updated)
}

const IMAGE_MEDIA_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
}

/** Read an image file as base64 (for multimodal chat attachments). Returns null on failure. */
export function readImageBase64(filePath: string): { data: string; mediaType: string } | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const mediaType = IMAGE_MEDIA_BY_EXT[ext] || 'application/octet-stream'
    const buf = fs.readFileSync(filePath)
    return { data: buf.toString('base64'), mediaType }
  } catch (err) {
    logger.warn(`[AICoding] readImageBase64 failed: ${filePath}: ${err}`)
    return null
  }
}

/**
 * Write text (and optional images) to a running session.
 * - Claude SDK: pushes a user turn into the long-lived message queue (images
 *   become real image content blocks).
 * - Codex / PTY sessions: text only (no multimodal support); images ignored.
 */
export async function writeToSession(
  sessionId: string,
  text: string,
  images?: { data: string; mediaType: string }[]
): Promise<{ success: boolean; error?: string }> {
  if (hasSDKSession(sessionId)) {
    return writeToSDKSession(sessionId, text, images)
  }

  if (hasCodexSession(sessionId)) {
    updateSession(sessionId, { status: 'running', lastActivity: 'thinking' })
    notifyDataChanged()
    const result = await writeToCodexSession(sessionId, text)
    if (!result.success) {
      updateSession(sessionId, { status: 'idle', lastActivity: 'none' })
      notifyDataChanged()
    }
    return result
  }

  if (hasPtySession(sessionId)) {
    writeToPty(sessionId, text + '\r')
    updateSession(sessionId, { status: 'running', lastActivity: 'thinking' })
    notifyDataChanged()
    return { success: true }
  }

  logger.warn(`[AICoding] Write to session failed: ${sessionId} — session not running`)
  return { success: false, error: '会话未运行' }
}

// ── Workspaces ──

export function getWorkspaces(): AICodingWorkspace[] {
  return getAICodingConfig().workspaces
}

export function createWorkspace(
  workingDir: string,
  groupId: string
): AICodingWorkspace {
  const lastDir = path.basename(workingDir) || workingDir
  const now = Date.now()
  const workspace: AICodingWorkspace = {
    id: randomUUID(),
    title: lastDir,
    workingDir,
    groupId,
    createdAt: now,
    updatedAt: now
  }
  const { workspaces } = getAICodingConfig()
  workspaces.push(workspace)
  setAICodingWorkspaces(workspaces)
  logger.info(`[AICoding] Workspace created: ${workspace.id} dir=${workingDir}`)
  return workspace
}

/**
 * Normalize a directory path for comparison: forward slashes, no trailing slash.
 * Matches the normalization used by the AI Code bridges (AICodeButton /
 * EmbeddedCodingPanel) so find-or-create behaves consistently across every
 * entry point that links a directory to an AI Coding workspace.
 */
function normalizeWorkingDir(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '')
}

/**
 * Find an existing AI Coding workspace whose workingDir matches `workingDir`
 * (compared after normalization). Returns undefined when none matches.
 */
export function findWorkspaceByWorkingDir(
  workingDir: string
): AICodingWorkspace | undefined {
  const normalized = normalizeWorkingDir(workingDir)
  return getAICodingConfig().workspaces.find(
    (w) => normalizeWorkingDir(w.workingDir) === normalized
  )
}

/**
 * Ensure an AI Coding workspace exists for `workingDir`, creating one in the
 * default group if none matches. If a workspace for that directory already
 * exists (e.g. the user created it manually from the AI Coding page or via the
 * workbench "AI Code" button), the existing entry is returned as-is — this
 * never duplicates and never throws on an existing entry.
 */
export function ensureWorkspaceForWorkingDir(workingDir: string): AICodingWorkspace {
  const existing = findWorkspaceByWorkingDir(workingDir)
  if (existing) {
    logger.info(`[AICoding] Workspace for dir already exists, skipping: ${workingDir}`)
    return existing
  }
  const groupId = getAICodingConfig().groups.find((g) => g.isDefault)?.id || 'default'
  return createWorkspace(workingDir, groupId)
}

export function updateWorkspace(
  id: string,
  updates: Partial<Omit<AICodingWorkspace, 'id' | 'createdAt'>>
): AICodingWorkspace | null {
  const { workspaces } = getAICodingConfig()
  const idx = workspaces.findIndex((w) => w.id === id)
  if (idx === -1) return null
  workspaces[idx] = { ...workspaces[idx], ...updates, updatedAt: Date.now() }
  setAICodingWorkspaces(workspaces)
  return workspaces[idx]
}

export async function deleteWorkspace(id: string): Promise<void> {
  const { sessions } = getAICodingConfig()
  const childSessions = sessions.filter((s) => s.workspaceId === id)
  const runtimeChildSessions = Array.from(runtimeSessions.values()).filter((s) => s.workspaceId === id)
  for (const session of [...childSessions, ...runtimeChildSessions]) {
    killPtySession(session.id)
    closeSDKSession(session.id)
  }
  for (const session of runtimeChildSessions) runtimeSessions.delete(session.id)
  setAICodingSessions(sessions.filter((s) => s.workspaceId !== id))

  const { workspaces } = getAICodingConfig()
  setAICodingWorkspaces(workspaces.filter((w) => w.id !== id))
  logger.info(`[AICoding] Workspace deleted: ${id}, closed ${childSessions.length + runtimeChildSessions.length} sessions`)
}

export function getSessionsForWorkspace(workspaceId: string): AICodingSession[] {
  return getSessions().filter((s) => s.workspaceId === workspaceId)
}

// ── Sessions ──

export function getSessions(): AICodingSession[] {
  const persistedSessions = getAICodingConfig().sessions.filter((s) => s.source !== 'local')
  return [...persistedSessions, ...runtimeSessions.values()]
}

function getSessionById(id: string): AICodingSession | undefined {
  return runtimeSessions.get(id) || getAICodingConfig().sessions.find((s) => s.id === id)
}

export function createSession(
  workspaceId: string,
  toolType: AIToolType,
  source: 'local' | 'im' = 'local'
): AICodingSession {
  const now = Date.now()
  const session: AICodingSession = {
    id: randomUUID(),
    workspaceId,
    toolType,
    source,
    status: 'closed',
    lastActivity: 'none',
    createdAt: now,
    updatedAt: now
  }
  const { sessions } = getAICodingConfig()
  sessions.push(session)
  setAICodingSessions(sessions)
  logger.info(`[AICoding] Session created: ${session.id} tool=${toolType} workspace=${workspaceId}`)
  notifyDataChanged()
  return session
}

export function createRuntimeSession(
  workspaceId: string,
  toolType: AIToolType,
  updates: Partial<Pick<AICodingSession, 'toolSessionId' | 'title'>> = {}
): AICodingSession {
  const now = Date.now()
  const session: AICodingSession = {
    id: randomUUID(),
    workspaceId,
    toolType,
    source: 'local',
    status: 'closed',
    lastActivity: 'none',
    createdAt: now,
    updatedAt: now,
    ...updates
  }
  runtimeSessions.set(session.id, session)
  logger.info(`[AICoding] Runtime session created: ${session.id} tool=${toolType} workspace=${workspaceId}`)
  notifyDataChanged()
  return session
}

export function updateSession(
  id: string,
  updates: Partial<Omit<AICodingSession, 'id' | 'createdAt'>>
): AICodingSession | null {
  const runtimeSession = runtimeSessions.get(id)
  if (runtimeSession) {
    const updated = { ...runtimeSession, ...updates, updatedAt: Date.now() }
    runtimeSessions.set(id, updated)
    notifyDataChanged()
    return updated
  }

  const { sessions } = getAICodingConfig()
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx === -1) return null
  sessions[idx] = { ...sessions[idx], ...updates, updatedAt: Date.now() }
  setAICodingSessions(sessions)
  notifyDataChanged()
  return sessions[idx]
}

export function deleteSession(id: string): void {
  killPtySession(id)
  closeSDKSession(id)
  closeCodexSession(id)
  if (runtimeSessions.delete(id)) {
    logger.info(`[AICoding] Runtime session deleted: ${id}`)
    notifyDataChanged()
    return
  }

  const { sessions } = getAICodingConfig()
  setAICodingSessions(sessions.filter((s) => s.id !== id))
  logger.info(`[AICoding] Session deleted: ${id}`)
  notifyDataChanged()
}

/**
 * Launch the session.
 *
 * - Claude: SDK session for the chat panel (Agent SDK query-per-turn).
 * - Other tools (Gemini, Codex, etc.): PTY mode so TUI-based CLIs get a real
 *   TTY. Output is sent as raw pty:data events and rendered via xterm.js.
 */
export async function launchSession(
  id: string,
  opts?: { forcePty?: boolean; cols?: number; rows?: number; effort?: string }
): Promise<{ success: boolean; error?: string }> {
  const config = getAICodingConfig()
  const session = getSessionById(id)
  if (!session) return { success: false, error: '会话不存在' }

  const workspace = config.workspaces.find((w) => w.id === session.workspaceId)
  if (!workspace) return { success: false, error: '工作区不存在' }

  try {
    // Ensure the full login-shell env (PATH etc.) is loaded before spawning.
    // Critical for apps launched from the Dock/Finder where process.env is minimal.
    await loadShellEnv().catch(() => { /* fallback to process.env */ })
    const toolEnv = buildToolEnv(session.toolType)
    if (session.toolType === 'claude' && !opts?.forcePty) {
      const result = launchSDKSession(
        id,
        workspace.workingDir,
        session.toolSessionId,
        handleSDKEvent,
        handleSDKClose,
        handleSDKError,
        toolEnv,
        opts?.effort
      )
      if (!result.success) return result
    } else if (session.toolType === 'codex' && !opts?.forcePty) {
      const { command } = getToolCommand(session.toolType)
      const resolvedCommand = resolveBundledCodexPath() || await resolveCommandPath(command, toolEnv)
      const result = await launchCodexSession(
        id,
        resolvedCommand,
        workspace.workingDir,
        session.toolSessionId,
        handleSDKEvent,
        handleSDKClose,
        handleSDKError,
        toolEnv,
        opts?.effort
      )
      if (!result.success) return result
    } else {
      // Non-Claude TUI tools (or Claude in CLI/PTY mode): use pty-manager
      const { command, args: baseArgs } = getToolCommand(session.toolType)
      // Resolve to absolute path so node-pty doesn't need to do a PATH lookup.
      // This is critical for packaged apps where PATH at spawn time may differ
      // from the user's shell PATH.
      const resolvedCommand = await resolveCommandPath(command, toolEnv)
      const resumeArgs = session.toolSessionId
        ? getResumeArgs(session.toolType, session.toolSessionId)
        : []
      createPtySession(
        id,
        resolvedCommand,
        [...baseArgs, ...resumeArgs],
        workspace.workingDir,
        toolEnv,
        handlePtyExit,
        opts?.cols && opts?.rows ? { cols: opts.cols, rows: opts.rows } : undefined
      )
      registerPtyOutputCallback(id, handlePtyOutputStabilized)
    }
    updateSession(id, { status: 'idle', startedAt: Date.now() })
    const mode = (session.toolType === 'claude' && !opts?.forcePty)
      ? 'sdk'
      : (session.toolType === 'codex' && !opts?.forcePty) ? 'codex-app-server' : 'pty'
    logger.info(`[AICoding] Session launched: ${id} tool=${session.toolType} mode=${mode}`)
    return { success: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`[AICoding] Failed to launch session ${id}: ${msg}`)
    return { success: false, error: msg }
  }
}

/**
 * Interrupt the session (CTRL+C): pause current task without stopping the process.
 */
export function interruptSession(id: string): void {
  if (hasSDKSession(id)) {
    interruptSDKSession(id)
  } else if (hasCodexSession(id)) {
    interruptCodexSession(id)
  } else if (hasPtySession(id)) {
    writeToPty(id, '\x03')
  }
}

/**
 * Execute a Claude slash command.
 * With the Agent SDK, slash commands are sent as regular prompts and handled natively.
 */
export async function executeSessionSlashCommand(
  id: string,
  command: string
): Promise<{ success: boolean; error?: string }> {
  return writeToSession(id, command)
}

/**
 * Stop the session: kill PTY/pipe process, set status -> closed.
 * Session record is kept for potential resume via toolSessionId.
 */
export async function stopSession(id: string): Promise<AICodingSession | null> {
  killPtySession(id)
  closeSDKSession(id)
  closeCodexSession(id)
  logger.info(`[AICoding] Session stopped: ${id}`)

  const session = getSessionById(id)
  let durationMs: number | undefined
  if (session?.startedAt) {
    durationMs = Date.now() - session.startedAt
  }

  return updateSession(id, { status: 'closed', lastActivity: 'none', durationMs })
}

// ── Groups ──

export function getGroups(): AICodingGroup[] {
  return getAICodingConfig().groups
}

export function createGroup(name: string): AICodingGroup {
  const { groups } = getAICodingConfig()
  const maxOrder = groups.reduce((max, g) => Math.max(max, g.order), 0)
  const group: AICodingGroup = {
    id: randomUUID(),
    name,
    isDefault: false,
    order: maxOrder + 1
  }
  groups.push(group)
  setAICodingGroups(groups)
  return group
}

export function renameGroup(id: string, name: string): AICodingGroup | null {
  const { groups } = getAICodingConfig()
  const group = groups.find((g) => g.id === id)
  if (!group || group.isDefault) return null
  group.name = name
  setAICodingGroups(groups)
  return group
}

export function deleteGroup(id: string): { success: boolean; error?: string } {
  const config = getAICodingConfig()
  const group = config.groups.find((g) => g.id === id)
  if (!group) return { success: false, error: '分组不存在' }
  if (group.isDefault) return { success: false, error: '默认分组不可删除' }

  const defaultGroup = config.groups.find((g) => g.isDefault)
  if (!defaultGroup) return { success: false, error: '默认分组丢失' }

  const workspaces = config.workspaces.map((w) =>
    w.groupId === id ? { ...w, groupId: defaultGroup.id, updatedAt: Date.now() } : w
  )
  setAICodingWorkspaces(workspaces)
  setAICodingGroups(config.groups.filter((g) => g.id !== id))
  return { success: true }
}

// ── IM Config ──

export function getIMConfig(): AICodingIMConfig {
  const raw = getAICodingConfig().imConfig || {
    feishu: { appId: '', appSecret: '' },
  }
  // Soft migration: existing users with credentials + auto-connect keep remote entry
  if (!aiCodingStore.get('imRemoteMigrated')) {
    const hasCreds = !!(raw.feishu?.appId?.trim() && raw.feishu?.appSecret?.trim())
    const auto = getIMAutoConnect()
    if (raw.remoteEnabled === undefined) {
      raw.remoteEnabled = hasCreds && auto
      setAICodingIMConfig({ ...raw, remoteEnabled: raw.remoteEnabled })
    }
    aiCodingStore.set('imRemoteMigrated', true)
  }
  return {
    feishu: {
      appId: raw.feishu?.appId || '',
      appSecret: raw.feishu?.appSecret || '',
    },
    remoteEnabled: raw.remoteEnabled === true,
    modelConfigId: raw.modelConfigId || '',
    modelId: raw.modelId || '',
    maxTurnsPerSession: raw.maxTurnsPerSession ?? 40,
    idleTimeoutMs: raw.idleTimeoutMs ?? 3_600_000,
  }
}

export function saveIMConfig(imConfig: AICodingIMConfig): void {
  setAICodingIMConfig({
    ...imConfig,
    feishu: {
      appId: imConfig.feishu?.appId || '',
      appSecret: imConfig.feishu?.appSecret || '',
    },
    remoteEnabled: imConfig.remoteEnabled === true,
  })
}

// ── Re-exports ──

export { detectAvailableCLIs }

/**
 * Set the SDK permission mode for a Claude session.
 */
export async function setSessionPermissionMode(
  id: string,
  mode: string
): Promise<{ success: boolean; error?: string }> {
  if (hasCodexSession(id)) {
    setCodexSessionMode(id, mode)
    return { success: true }
  }
  if (!hasSDKSession(id)) return { success: false, error: '会话未运行或非 Claude 会话' }
  await setSDKPermissionMode(id, mode as any)
  return { success: true }
}

/**
 * Resolve a pending tool-permission prompt raised by the Claude SDK's
 * canUseTool callback. `decision.behavior` is 'allow' or 'deny'.
 */
export function resolveSessionPermission(
  id: string,
  requestId: string,
  decision: { behavior: 'allow' | 'deny'; message?: string; updatedInput?: Record<string, unknown> }
): { success: boolean; error?: string } {
  if (!hasSDKSession(id)) return { success: false, error: '会话未运行或非 Claude 会话' }
  const ok = resolveSDKPermission(id, requestId, decision)
  return ok ? { success: true } : { success: false, error: '权限请求不存在或已失效' }
}

/**
 * Resolve a pending AskUserQuestion tool call raised by the Claude SDK's
 * canUseTool callback. `answers` is keyed by each question's exact text.
 */
export function answerSessionQuestion(
  id: string,
  questionId: string,
  answers: Record<string, string>
): { success: boolean; error?: string } {
  if (!hasSDKSession(id)) return { success: false, error: '会话未运行或非 Claude 会话' }
  const ok = answerSDKQuestion(id, questionId, answers)
  return ok ? { success: true } : { success: false, error: '问题请求不存在或已失效' }
}

/**
 * Set the reasoning effort for a running session. Claude applies it live via
 * applyFlagSettings; Codex stores it for the next turn/start. No restart.
 */
export async function setSessionEffort(
  id: string,
  effort: string
): Promise<{ success: boolean; error?: string }> {
  if (hasCodexSession(id)) {
    setCodexSessionEffort(id, effort)
    return { success: true }
  }
  if (!hasSDKSession(id)) return { success: false, error: '会话未运行' }
  await setSDKEffort(id, effort)
  return { success: true }
}
