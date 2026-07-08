/**
 * SDK Session Manager — Claude Agent SDK communication layer.
 *
 * Drives Claude Code via `@anthropic-ai/claude-agent-sdk`. This is the chat-mode
 * backend (the TUI/CLI mode is handled by pty-manager.service.ts).
 *
 * Design:
 * - ONE long-lived `query()` per session, with `prompt: <MessageQueue>`. Each
 *   user turn is pushed into the queue; the same query keeps consuming turns.
 *   This gives true multi-turn streaming, reliable tool flow, and a live
 *   `interrupt()` (the old per-turn `query({prompt:text}) + resume` design was
 *   fragile and dropped tool inputs/results).
 * - SDK messages are flattened into CodingStreamEvent (coding-adapters/
 *   claude-stream.ts) and forwarded over `ai-coding:pipe-event`.
 * - Ring buffer + interactive-state detection preserved for IM bridge compat.
 */

import { BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as logger from '../utils/logger'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { createMessageQueue, type MessageQueue } from './coding-adapters/message-queue'
import { processClaudeMessage, createClaudeStreamState, type ClaudeStreamState } from './coding-adapters/claude-stream'
import { scanAndMergeInstructions } from './coding-adapters/instructions'
import type { CodingStreamEvent } from './coding-adapters/stream-events'

// Lazy-import the SDK to avoid issues if it's not installed
let sdkQuery: typeof import('@anthropic-ai/claude-agent-sdk').query | null = null
async function ensureSDK(): Promise<typeof import('@anthropic-ai/claude-agent-sdk').query> {
  if (!sdkQuery) {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    sdkQuery = sdk.query
  }
  return sdkQuery
}

// ── Types ──

type SDKPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk'

interface SDKSessionState {
  /** Claude native session ID (for resume after restart). */
  toolSessionId: string | null
  cwd: string
  /** Streaming-input queue — the `prompt` passed to the long-lived query. */
  messageQueue: MessageQueue<SDKUserMessage>
  /** Aborts the entire query (used on close). */
  abortController: AbortController
  /** The long-lived Query async generator. */
  activeQuery: any | null
  /** True while a turn is in flight (between push and result/error). */
  isProcessing: boolean
  permissionMode: SDKPermissionMode
  env?: Record<string, string | undefined>
  /** Server-side streaming accumulation state. */
  streamState: ClaudeStreamState
  /** Callbacks registered by ai-coding.service.ts. */
  onEvent?: (sessionId: string, data: Record<string, unknown>) => void
  onClose?: (sessionId: string) => void
  onError?: (sessionId: string, err: Error) => void
}

const sdkSessions = new Map<string, SDKSessionState>()

/** Output ring-buffer: last 4000 chars of output for each session (for IM). */
const outputBuffers = new Map<string, string>()

const RING_BUFFER_MAX = 4000

const CLAUDE_PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'darwin-x64': '@anthropic-ai/claude-agent-sdk-darwin-x64',
  'darwin-arm64': '@anthropic-ai/claude-agent-sdk-darwin-arm64',
  'linux-x64': '@anthropic-ai/claude-agent-sdk-linux-x64',
  'linux-arm64': '@anthropic-ai/claude-agent-sdk-linux-arm64',
  'linux-x64-musl': '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
  'linux-arm64-musl': '@anthropic-ai/claude-agent-sdk-linux-arm64-musl',
  'win32-x64': '@anthropic-ai/claude-agent-sdk-win32-x64',
  'win32-arm64': '@anthropic-ai/claude-agent-sdk-win32-arm64'
}

function requireResolve(id: string): string | null {
  try {
    return require.resolve(id)
  } catch {
    return null
  }
}

function getClaudePlatformTargets(): string[] {
  if (process.platform === 'linux') {
    const report = typeof process.report?.getReport === 'function'
      ? process.report.getReport() as { header?: { glibcVersionRuntime?: string } }
      : null
    const isMusl = report?.header?.glibcVersionRuntime === undefined
    if (process.arch === 'x64') {
      return isMusl ? ['linux-x64-musl', 'linux-x64'] : ['linux-x64', 'linux-x64-musl']
    }
    if (process.arch === 'arm64') {
      return isMusl ? ['linux-arm64-musl', 'linux-arm64'] : ['linux-arm64', 'linux-arm64-musl']
    }
  }
  if (process.platform === 'darwin') {
    if (process.arch === 'x64') return ['darwin-x64']
    if (process.arch === 'arm64') return ['darwin-arm64']
  }
  if (process.platform === 'win32') {
    if (process.arch === 'x64') return ['win32-x64']
    if (process.arch === 'arm64') return ['win32-arm64']
  }
  return []
}

export function resolveBundledClaudePath(): string | null {
  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const packageNames = getClaudePlatformTargets()
    .map((target) => CLAUDE_PLATFORM_PACKAGE_BY_TARGET[target])
    .filter(Boolean)

  const candidates: string[] = []
  for (const platformPackage of packageNames) {
    if (process.resourcesPath) {
      candidates.push(path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        ...platformPackage.split('/'),
        binaryName
      ))
    }

    const packageJsonPath = requireResolve(`${platformPackage}/package.json`)
    if (packageJsonPath) {
      const packageDir = path.dirname(packageJsonPath)
      candidates.push(path.join(
        packageDir.replace(
          `${path.sep}app.asar${path.sep}`,
          `${path.sep}app.asar.unpacked${path.sep}`
        ),
        binaryName
      ))
      candidates.push(path.join(packageDir, binaryName))
    }
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function appendOutput(sessionId: string, text: string): void {
  const existing = outputBuffers.get(sessionId) ?? ''
  const combined = existing + text
  outputBuffers.set(
    sessionId,
    combined.length > RING_BUFFER_MAX ? combined.slice(-RING_BUFFER_MAX) : combined
  )
}

// ── Interactive state detection (for IM bridge) ──

export function detectManagedInteractiveState(
  bufferedOutput: string
): 'auth_request' | 'waiting_input' | null {
  if (!bufferedOutput) return null
  const lines = bufferedOutput.split('\n').filter((l) => l.trim())
  const last12 = lines.slice(-12).join('\n')
  const last5 = lines.slice(-5).join('\n')

  if (
    /⚙\s*\[ExitPlanMode\]/i.test(last12) ||
    /\[🔧\s*ExitPlanMode\]/.test(last12) ||
    /等待你确认|等待确认|等待.*批准|等待.*同意/i.test(last5) ||
    /waiting for.*confirm|please confirm|confirm.*to proceed/i.test(last5)
  )
    return 'waiting_input'

  if (
    /\b(allow|approve|permission|proceed)\b.*[?]/i.test(last5) ||
    /\[y\/n\]|\[yes\/no\]/i.test(last5) ||
    /\(Y\/n\)|\(y\/N\)/i.test(last5) ||
    /请.*允许|请.*授权|点击.*允许|点击.*[Aa]ccept/i.test(last5) ||
    /grant.*permission|need.*permission|require.*permission/i.test(last5) ||
    /please\s+(approve|allow|accept)/i.test(last5) ||
    /click.*allow|click.*accept/i.test(last5)
  )
    return 'auth_request'

  return null
}

// ── Forward events to renderer + service layer ──

function emit(sessionId: string, state: SDKSessionState, event: CodingStreamEvent): void {
  // Keep the IM ring buffer roughly in sync with streamed content.
  switch (event.type) {
    case 'delta':
      appendOutput(sessionId, event.text)
      break
    case 'tool_start':
      appendOutput(sessionId, `\n⚙ [${event.name || 'tool'}]\n`)
      break
    case 'tool_result':
      appendOutput(sessionId, `\n${event.content}\n`)
      break
    case 'result':
      if (event.result) appendOutput(sessionId, `\n${event.result}\n`)
      break
    default:
      break
  }

  // Notify the service layer (status / persistence) with a plain-object view.
  if (state.onEvent) state.onEvent(sessionId, event as unknown as Record<string, unknown>)

  // Forward to the renderer over the shared pipe-event channel.
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('ai-coding:pipe-event', { sessionId, event })
  })
}

// ── Local slash command interception (uses Query control methods) ──

/**
 * Handle REPL-only slash commands locally via Query control methods.
 * Returns a result object if handled, or null to pass through as a prompt.
 */
async function handleLocalSlashCommand(
  sessionId: string,
  text: string,
  state: SDKSessionState
): Promise<{ success: boolean; error?: string } | null> {
  const trimmed = text.trim()
  const q = state.activeQuery

  // /model [name] — switch or display current model
  const modelMatch = trimmed.match(/^\/model(?:\s+(.+))?$/)
  if (modelMatch) {
    const modelName = modelMatch[1]?.trim()
    if (!modelName) {
      if (q) {
        try {
          const models = await q.supportedModels()
          const modelList = models.map((m: any) => `  - ${m.value}  (${m.displayName || ''})`).join('\n')
          emitLocalSystem(sessionId, state, `可用模型:\n${modelList}`)
        } catch {
          emitLocalSystem(sessionId, state, '无法获取模型信息。')
        }
      } else {
        emitLocalSystem(sessionId, state, '会话尚未初始化，请先发送一条消息。')
      }
      return { success: true }
    }
    if (q) {
      try {
        await q.setModel(modelName)
        emitLocalSystem(sessionId, state, `模型已切换为: ${modelName}`)
      } catch (err: any) {
        emitLocalSystem(sessionId, state, `切换模型失败: ${err?.message || String(err)}`)
      }
    } else {
      emitLocalSystem(sessionId, state, '会话尚未初始化。')
    }
    return { success: true }
  }

  // /permissions [mode] — switch permission mode
  const permMatch = trimmed.match(/^\/permissions(?:\s+(.+))?$/)
  if (permMatch) {
    const modeName = permMatch[1]?.trim()
    if (!modeName) {
      emitLocalSystem(sessionId, state, `当前权限模式: ${state.permissionMode}\n\n可用模式:\n  - default (默认，需要确认)\n  - acceptEdits (自动接受编辑)\n  - bypassPermissions (跳过所有权限)\n  - plan (计划模式)`)
      return { success: true }
    }
    const validModes: SDKPermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']
    if (!validModes.includes(modeName as SDKPermissionMode)) {
      emitLocalSystem(sessionId, state, `无效的权限模式: ${modeName}\n可用: ${validModes.join(', ')}`)
      return { success: true }
    }
    await setSDKPermissionMode(sessionId, modeName as SDKPermissionMode)
    emitLocalSystem(sessionId, state, `权限模式已切换为: ${modeName}`)
    return { success: true }
  }

  // /doctor, /memory, /mcp — still unsupported (no SDK control method)
  if (/^\/(doctor|memory|mcp)$/.test(trimmed)) {
    emitLocalSystem(sessionId, state, `${trimmed} 命令需要终端交互，请切换到 CLI 模式使用。`)
    return { success: true }
  }

  return null
}

/** Emit a local system message + a result event to flush it into a finalized message. */
function emitLocalSystem(sessionId: string, state: SDKSessionState, text: string): void {
  emit(sessionId, state, { type: 'system', subtype: 'local', message: text })
  emit(sessionId, state, { type: 'result', session_id: state.toolSessionId || '', subtype: 'success', result: '' })
}

// ── Public API ──

/**
 * Launch a Claude SDK session: create the long-lived message-queue query and
 * start consuming its event stream in the background. The first user message is
 * pushed via `writeToSDKSession()`; until then the query blocks on the queue.
 */
export function launchSDKSession(
  sessionId: string,
  cwd: string,
  resumeId?: string,
  onEvent?: (sessionId: string, data: Record<string, unknown>) => void,
  onClose?: (sessionId: string) => void,
  onError?: (sessionId: string, err: Error) => void,
  env?: Record<string, string | undefined>
): { success: boolean; error?: string } {
  closeSDKSession(sessionId)

  const state: SDKSessionState = {
    toolSessionId: resumeId || null,
    cwd,
    messageQueue: createMessageQueue(),
    abortController: new AbortController(),
    activeQuery: null,
    isProcessing: false,
    permissionMode: 'bypassPermissions',  // default — matches old pipe mode behavior
    env,
    streamState: createClaudeStreamState(),
    onEvent,
    onClose,
    onError,
  }
  sdkSessions.set(sessionId, state)
  outputBuffers.delete(sessionId)

  // Build options once and start the long-lived query.
  void startQuery(sessionId, state).catch((err) => {
    logger.error(`[SDK:${sessionId.slice(0, 8)}] launch error:`, err)
    if (state.onError) state.onError(sessionId, err instanceof Error ? err : new Error(String(err)))
    emit(sessionId, state, { type: 'error', error: { message: err?.message || String(err) } })
  })

  logger.info(`[sdk] Session launched: ${sessionId}`)
  return { success: true }
}

/** Build SDK options and start the long-lived query, consuming its stream. */
async function startQuery(sessionId: string, state: SDKSessionState): Promise<void> {
  const queryFn = await ensureSDK()
  const claudePath = resolveBundledClaudePath()

  const options: Record<string, any> = {
    cwd: state.cwd,
    abortController: state.abortController,
    includePartialMessages: true,
    permissionMode: state.permissionMode,
    allowDangerouslySkipPermissions: state.permissionMode === 'bypassPermissions',
    settingSources: ['user', 'project', 'local'],
  }
  if (claudePath) options.pathToClaudeCodeExecutable = claudePath
  if (state.env) options.env = state.env
  if (state.toolSessionId) options.resume = state.toolSessionId

  // Inject non-native project instructions (AGENTS.md, .cursorrules, ...) as
  // extra system context. CLAUDE.md is read natively via settingSources.
  const mergedInstructions = scanAndMergeInstructions(state.cwd, 'claude')
  if (mergedInstructions) options.systemPrompt = mergedInstructions

  const q = queryFn({ prompt: state.messageQueue, options })
  state.activeQuery = q

  // Consume the event stream for the lifetime of the session.
  consumeQuery(sessionId, q, state).catch((err) => {
    logger.error(`[SDK:${sessionId.slice(0, 8)}] stream error:`, err)
    state.isProcessing = false
    if (state.onError) state.onError(sessionId, err instanceof Error ? err : new Error(String(err)))
    emit(sessionId, state, { type: 'error', error: { message: err?.message || String(err) } })
  })
}

/**
 * Push a user message (or slash command) into the session.
 * Slash commands are intercepted; everything else is pushed to the message queue
 * and the long-lived query streams the resulting turn.
 */
export async function writeToSDKSession(
  sessionId: string,
  text: string,
  images?: { data: string; mediaType: string }[]
): Promise<{ success: boolean; error?: string }> {
  const state = sdkSessions.get(sessionId)
  if (!state) return { success: false, error: 'Session not running' }

  // REPL-only slash commands handled via Query control methods.
  const localResult = await handleLocalSlashCommand(sessionId, text, state)
  if (localResult) return localResult

  state.isProcessing = true
  // Build content blocks: images first (real multimodal input), then text.
  const content: any[] = []
  if (images && images.length > 0) {
    for (const img of images) {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
    }
  }
  if (text) content.push({ type: 'text', text })
  state.messageQueue.push({
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  })
  return { success: true }
}

/** Consume the query's async generator for the session's lifetime. */
async function consumeQuery(
  sessionId: string,
  query: AsyncGenerator<any, void>,
  state: SDKSessionState
): Promise<void> {
  for await (const msg of query) {
    if (!sdkSessions.has(sessionId)) break  // closed mid-stream
    const events = processClaudeMessage(msg, state.streamState)
    for (const ev of events) {
      emit(sessionId, state, ev)
      if (ev.type === 'result' || ev.type === 'error') {
        state.isProcessing = false
      }
    }
  }
  // Generator completed normally (queue ended on close). isProcessing no longer relevant.
  state.isProcessing = false
}

/** Interrupt the current turn (like pressing ESC in the CLI). The session stays alive. */
export async function interruptSDKSession(sessionId: string): Promise<void> {
  const state = sdkSessions.get(sessionId)
  if (!state?.activeQuery) return
  try {
    await state.activeQuery.interrupt()
  } catch {
    // Ignore — best-effort interrupt.
  }
}

/** Close the SDK session entirely (ends the queue + aborts the query). */
export function closeSDKSession(sessionId: string): void {
  const state = sdkSessions.get(sessionId)
  if (!state) return

  try { state.messageQueue.end() } catch { /* ignore */ }
  try { state.abortController.abort() } catch { /* ignore */ }
  if (state.activeQuery) {
    try { state.activeQuery.return(undefined) } catch { /* ignore */ }
  }

  const onClose = state.onClose
  sdkSessions.delete(sessionId)
  outputBuffers.delete(sessionId)

  logger.info(`[sdk] Session closed: ${sessionId}`)
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('ai-coding:pipe-event', { sessionId, event: { type: 'pipe_exit' } })
  })
  if (onClose) onClose(sessionId)
}

/** Get the ring buffer content (for IM cards). */
export function getSDKSessionOutput(sessionId: string): string {
  return outputBuffers.get(sessionId) ?? ''
}

/** Check whether an SDK session exists. */
export function hasSDKSession(sessionId: string): boolean {
  return sdkSessions.has(sessionId)
}

/** Set the permission mode for an SDK session (live on the long-lived query). */
export async function setSDKPermissionMode(
  sessionId: string,
  mode: SDKPermissionMode
): Promise<void> {
  const state = sdkSessions.get(sessionId)
  if (!state) return
  state.permissionMode = mode
  if (state.activeQuery) {
    try {
      await state.activeQuery.setPermissionMode(mode)
    } catch {
      // Ignore — will be applied on the next turn.
    }
  }
}
