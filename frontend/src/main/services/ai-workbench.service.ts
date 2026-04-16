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
  getAIWorkbenchConfig,
  setAIWorkbenchWorkspaces,
  setAIWorkbenchSessions,
  setAIWorkbenchGroups,
  setAIWorkbenchIMConfig,
  migrateV1ToV2,
  migrateV2ToV3
} from '../store/ai-workbench.store'
import type {
  AIToolType,
  AIWorkbenchWorkspace,
  AIWorkbenchSession,
  AIWorkbenchGroup,
  AIWorkbenchIMConfig
} from '../store/ai-workbench.store'
import {
  killPtySession, hasPtySession, writeToPty,
  createPtySession, getToolCommand, getResumeArgs, getPtySessionOutput,
  registerPtyOutputCallback
} from './pty-manager.service'
import {
  launchSDKSession, writeToSDKSession, closeSDKSession, hasSDKSession,
  getSDKSessionOutput, interruptSDKSession, setSDKPermissionMode,
  detectManagedInteractiveState
} from './sdk-session-manager.service'
import { detectAvailableCLIs, getAugmentedEnv, loadShellEnv } from './cli-detect.service'
import { settingsStore } from '../store/settings.store'

/**
 * Resolve a binary name to its absolute path using the provided env's PATH.
 * This bypasses posix_spawnp's own PATH lookup — critical in packaged apps
 * where the PATH passed to node-pty may still not match the user's shell PATH.
 * Falls back to the bare binary name if resolution fails.
 */
async function resolveCommandPath(binary: string, env: Record<string, string>): Promise<string> {
  if (process.platform === 'win32') return binary

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
    // Claude Code: CLAUDE_CODE_THEME env var
    env.CLAUDE_CODE_THEME = isDark ? 'dark' : 'light'
  }
  // Gemini / Codex: COLORFGBG hint for terminal dark/light detection
  env.COLORFGBG = isDark ? '15;0' : '0;15'

  return env
}

// ── Push event to renderer ──

function notifyDataChanged(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('ai-workbench:data-changed')
  })
}

// ── Session output (delegates to SDK/PTY managers for IM sessions) ──

export function getSessionOutput(sessionId: string): string {
  // Check SDK session first (Claude), then PTY session (other tools)
  const sdkOutput = getSDKSessionOutput(sessionId)
  if (sdkOutput) return sdkOutput
  return getPtySessionOutput(sessionId)
}

// ── SDK session event handler (for IM mode) ──

function handleSDKEvent(sessionId: string, data: Record<string, unknown>): void {
  const msgType = (data.type as string) ?? ''

  if (msgType === 'system') {
    if (data.subtype === 'init') {
      const sid = (data.session_id as string) ?? ''
      if (sid) {
        updateSession(sessionId, { toolSessionId: sid })
      }
    }
  } else if (msgType === 'assistant') {
    updateSession(sessionId, { status: 'running', lastActivity: 'thinking' })
    notifyDataChanged()
  } else if (msgType === 'result') {
    const sid = (data.session_id as string) ?? ''
    const costUsd = typeof data.cost_usd === 'number' ? data.cost_usd : undefined
    // After Claude finishes a turn, check if it's waiting for interactive input
    const currentOutput = getSDKSessionOutput(sessionId)
    const interactiveState = detectManagedInteractiveState(currentOutput)
    const updates: Partial<AIWorkbenchSession> = { status: 'idle', lastActivity: interactiveState || 'none' }
    if (sid) updates.toolSessionId = sid
    if (costUsd !== undefined) updates.costUsd = costUsd
    updateSession(sessionId, updates)
    notifyDataChanged()
  } else if (msgType === 'error') {
    updateSession(sessionId, { status: 'idle', lastActivity: 'none' })
    notifyDataChanged()
  }
}

function handleSDKClose(sessionId: string): void {
  logger.info(`[workbench] SDK session closed: ${sessionId}`)
  const session = getSessions().find((s) => s.id === sessionId)
  if (session && session.status !== 'closed') {
    updateSession(sessionId, { status: 'completed', lastActivity: 'none' })
    notifyDataChanged()
  }
}

function handleSDKError(sessionId: string, _err: Error): void {
  logger.error(`[workbench] SDK session error: ${sessionId}`)
  const session = getSessions().find((s) => s.id === sessionId)
  if (session && session.status !== 'closed') {
    updateSession(sessionId, { status: 'error' as any, lastActivity: 'none' })
    notifyDataChanged()
  }
}

/**
 * PTY exit handler — mirrors handlePipeClose for non-Claude sessions.
 * Updates session status so IM bridge can detect completion.
 */
function handlePtyExit(sessionId: string, exitCode: number): void {
  if (exitCode === 0) {
    logger.info(`[workbench] PTY session exited: ${sessionId} code=${exitCode}`)
  } else {
    logger.warn(`[workbench] PTY session exited: ${sessionId} code=${exitCode}`)
  }
  const session = getSessions().find((s) => s.id === sessionId)
  if (session && session.status !== 'closed') {
    const status = exitCode === 0 ? 'completed' : ('error' as any)
    updateSession(sessionId, { status, lastActivity: 'none' })
    notifyDataChanged()
  }
}

/**
 * PTY output stabilized handler — called when no new output has arrived for 2 seconds.
 * Transitions the session from 'running' back to 'idle' so the card reflects readiness.
 */
function handlePtyOutputStabilized(sessionId: string): void {
  const session = getSessions().find((s) => s.id === sessionId)
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

  const { sessions } = getAIWorkbenchConfig()
  const updated = sessions.map((s): AIWorkbenchSession => {
    if (s.status !== 'idle' && s.status !== 'running') return s
    // PTY / pipe sessions cannot be re-attached after restart — close them
    return { ...s, status: 'closed', lastActivity: 'none', updatedAt: Date.now() }
  })
  const count = updated.filter((s, i) => s !== sessions[i]).length
  logger.info(`[workbench] Reset ${count} stale sessions on start`)
  setAIWorkbenchSessions(updated)
}

/**
 * Write text to a running session.
 * - Claude SDK: starts a new query() call with the prompt.
 * - PTY sessions: writes raw text + carriage-return (Enter key equivalent).
 */
export async function writeToSession(sessionId: string, text: string): Promise<{ success: boolean; error?: string }> {
  if (hasSDKSession(sessionId)) {
    return writeToSDKSession(sessionId, text)
  }

  if (hasPtySession(sessionId)) {
    writeToPty(sessionId, text + '\r')
    updateSession(sessionId, { status: 'running', lastActivity: 'thinking' })
    notifyDataChanged()
    return { success: true }
  }

  logger.warn(`[workbench] Write to session failed: ${sessionId} — session not running`)
  return { success: false, error: '会话未运行' }
}

// ── Workspaces ──

export function getWorkspaces(): AIWorkbenchWorkspace[] {
  return getAIWorkbenchConfig().workspaces
}

export function createWorkspace(
  workingDir: string,
  groupId: string
): AIWorkbenchWorkspace {
  const lastDir = path.basename(workingDir) || workingDir
  const now = Date.now()
  const workspace: AIWorkbenchWorkspace = {
    id: randomUUID(),
    title: lastDir,
    workingDir,
    groupId,
    createdAt: now,
    updatedAt: now
  }
  const { workspaces } = getAIWorkbenchConfig()
  workspaces.push(workspace)
  setAIWorkbenchWorkspaces(workspaces)
  logger.info(`[workbench] Workspace created: ${workspace.id} dir=${workingDir}`)
  return workspace
}

export function updateWorkspace(
  id: string,
  updates: Partial<Omit<AIWorkbenchWorkspace, 'id' | 'createdAt'>>
): AIWorkbenchWorkspace | null {
  const { workspaces } = getAIWorkbenchConfig()
  const idx = workspaces.findIndex((w) => w.id === id)
  if (idx === -1) return null
  workspaces[idx] = { ...workspaces[idx], ...updates, updatedAt: Date.now() }
  setAIWorkbenchWorkspaces(workspaces)
  return workspaces[idx]
}

export async function deleteWorkspace(id: string): Promise<void> {
  const { sessions } = getAIWorkbenchConfig()
  const childSessions = sessions.filter((s) => s.workspaceId === id)
  for (const session of childSessions) {
    killPtySession(session.id)
    closeSDKSession(session.id)
  }
  setAIWorkbenchSessions(sessions.filter((s) => s.workspaceId !== id))

  const { workspaces } = getAIWorkbenchConfig()
  setAIWorkbenchWorkspaces(workspaces.filter((w) => w.id !== id))
  logger.info(`[workbench] Workspace deleted: ${id}, closed ${childSessions.length} sessions`)
}

export function getSessionsForWorkspace(workspaceId: string): AIWorkbenchSession[] {
  return getAIWorkbenchConfig().sessions.filter((s) => s.workspaceId === workspaceId)
}

// ── Sessions ──

export function getSessions(): AIWorkbenchSession[] {
  return getAIWorkbenchConfig().sessions
}

export function createSession(
  workspaceId: string,
  toolType: AIToolType,
  source: 'local' | 'im' = 'local'
): AIWorkbenchSession {
  const now = Date.now()
  const session: AIWorkbenchSession = {
    id: randomUUID(),
    workspaceId,
    toolType,
    source,
    status: 'closed',
    lastActivity: 'none',
    createdAt: now,
    updatedAt: now
  }
  const { sessions } = getAIWorkbenchConfig()
  sessions.push(session)
  setAIWorkbenchSessions(sessions)
  logger.info(`[workbench] Session created: ${session.id} tool=${toolType} workspace=${workspaceId}`)
  return session
}

export function updateSession(
  id: string,
  updates: Partial<Omit<AIWorkbenchSession, 'id' | 'createdAt'>>
): AIWorkbenchSession | null {
  const { sessions } = getAIWorkbenchConfig()
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx === -1) return null
  sessions[idx] = { ...sessions[idx], ...updates, updatedAt: Date.now() }
  setAIWorkbenchSessions(sessions)
  return sessions[idx]
}

export function deleteSession(id: string): void {
  killPtySession(id)
  closeSDKSession(id)
  const { sessions } = getAIWorkbenchConfig()
  setAIWorkbenchSessions(sessions.filter((s) => s.id !== id))
  logger.info(`[workbench] Session deleted: ${id}`)
}

/**
 * Launch the session.
 *
 * - Claude: SDK session for the chat panel (Agent SDK query-per-turn).
 * - Other tools (Gemini, Codex, etc.): PTY mode so TUI-based CLIs get a real
 *   TTY. Output is sent as raw pty:data events and rendered via xterm.js.
 */
export async function launchSession(id: string, opts?: { forcePty?: boolean }): Promise<{ success: boolean; error?: string }> {
  const config = getAIWorkbenchConfig()
  const session = config.sessions.find((s) => s.id === id)
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
        toolEnv
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
      createPtySession(id, resolvedCommand, [...baseArgs, ...resumeArgs], workspace.workingDir, toolEnv, handlePtyExit)
      registerPtyOutputCallback(id, handlePtyOutputStabilized)
    }
    updateSession(id, { status: 'idle', startedAt: Date.now() })
    const mode = (session.toolType === 'claude' && !opts?.forcePty) ? 'sdk' : 'pty'
    logger.info(`[workbench] Session launched: ${id} tool=${session.toolType} mode=${mode}`)
    return { success: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`[workbench] Failed to launch session ${id}: ${msg}`)
    return { success: false, error: msg }
  }
}

/**
 * Interrupt the session (CTRL+C): pause current task without stopping the process.
 */
export function interruptSession(id: string): void {
  if (hasSDKSession(id)) {
    interruptSDKSession(id)
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
export async function stopSession(id: string): Promise<AIWorkbenchSession | null> {
  killPtySession(id)
  closeSDKSession(id)
  logger.info(`[workbench] Session stopped: ${id}`)

  const session = getSessions().find((s) => s.id === id)
  let durationMs: number | undefined
  if (session?.startedAt) {
    durationMs = Date.now() - session.startedAt
  }

  return updateSession(id, { status: 'closed', lastActivity: 'none', durationMs })
}

// ── Groups ──

export function getGroups(): AIWorkbenchGroup[] {
  return getAIWorkbenchConfig().groups
}

export function createGroup(name: string): AIWorkbenchGroup {
  const { groups } = getAIWorkbenchConfig()
  const maxOrder = groups.reduce((max, g) => Math.max(max, g.order), 0)
  const group: AIWorkbenchGroup = {
    id: randomUUID(),
    name,
    isDefault: false,
    order: maxOrder + 1
  }
  groups.push(group)
  setAIWorkbenchGroups(groups)
  return group
}

export function renameGroup(id: string, name: string): AIWorkbenchGroup | null {
  const { groups } = getAIWorkbenchConfig()
  const group = groups.find((g) => g.id === id)
  if (!group || group.isDefault) return null
  group.name = name
  setAIWorkbenchGroups(groups)
  return group
}

export function deleteGroup(id: string): { success: boolean; error?: string } {
  const config = getAIWorkbenchConfig()
  const group = config.groups.find((g) => g.id === id)
  if (!group) return { success: false, error: '分组不存在' }
  if (group.isDefault) return { success: false, error: '默认分组不可删除' }

  const defaultGroup = config.groups.find((g) => g.isDefault)
  if (!defaultGroup) return { success: false, error: '默认分组丢失' }

  const workspaces = config.workspaces.map((w) =>
    w.groupId === id ? { ...w, groupId: defaultGroup.id, updatedAt: Date.now() } : w
  )
  setAIWorkbenchWorkspaces(workspaces)
  setAIWorkbenchGroups(config.groups.filter((g) => g.id !== id))
  return { success: true }
}

// ── IM Config ──

export function getIMConfig(): AIWorkbenchIMConfig {
  return getAIWorkbenchConfig().imConfig
}

export function saveIMConfig(imConfig: AIWorkbenchIMConfig): void {
  setAIWorkbenchIMConfig(imConfig)
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
  if (!hasSDKSession(id)) return { success: false, error: '会话未运行或非 Claude 会话' }
  await setSDKPermissionMode(id, mode as any)
  return { success: true }
}
