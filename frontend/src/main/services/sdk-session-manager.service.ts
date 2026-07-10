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
import { randomUUID } from 'crypto'
import * as logger from '../utils/logger'
import type {
  SDKUserMessage,
  PermissionResult,
  CanUseTool
} from '@anthropic-ai/claude-agent-sdk'
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

// Abstract reasoning-effort choice (mirrors the renderer's CodingEffort). Claude's
// SDK surfaces it two ways: Options.effort at spawn (low..max) and a live
// applyFlagSettings({effortLevel, ultracode}) control request (no respawn).
type SDKEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultracode'

/** Per-spawn EffortLevel (Options.effort). ultracode → xhigh (the flag itself is live-only). */
function spawnEffortLevel(e: SDKEffort): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  return e === 'ultracode' ? 'xhigh' : e
}

/** Live applyFlagSettings payload. The live Settings layer caps at xhigh, so 'max'
 *  degrades to xhigh when toggled mid-session (full 'max' applies on (re)spawn). */
function effortToFlagSettings(e: SDKEffort): Record<string, unknown> {
  if (e === 'ultracode') return { ultracode: true }
  if (e === 'max') return { ultracode: false, effortLevel: 'xhigh' }
  return { ultracode: false, effortLevel: e }
}

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
  /** Current reasoning-effort choice; seeded at spawn and live-toggled via applyFlagSettings. */
  effort: SDKEffort
  /**
   * In-flight tool-permission prompts, keyed by requestId. The SDK's canUseTool
   * callback blocks on these promises until the renderer answers via
   * resolveSDKPermission(). Cleared (denied) on interrupt/close.
   */
  pendingPermissions: Map<string, {
    resolve: (result: PermissionResult) => void
    input: Record<string, unknown>
    signal: AbortSignal
    onAbort: () => void
  }>
  /**
   * In-flight AskUserQuestion tool calls, keyed by the tool_use id (== canUseTool's
   * `toolUseID`, which matches claude-stream.ts's emitted `ask_user_question.id`).
   * The SDK's canUseTool callback ALWAYS blocks here for this tool — regardless of
   * permissionMode — until the renderer answers via answerSDKQuestion(). Cleared
   * (resolved with empty answers, not denied — AskUserQuestion has no deny concept)
   * on interrupt/close.
   */
  pendingQuestions: Map<string, {
    resolve: (result: PermissionResult) => void
    input: Record<string, unknown>
    signal: AbortSignal
    onAbort: () => void
  }>
  /**
   * Answers that arrive (via answerSDKQuestion) before canUseTool has registered
   * the corresponding pendingQuestions entry — a benign race between the stream
   * emitting `ask_user_question` (so the UI can render it) and the SDK actually
   * invoking canUseTool for that tool call. Consumed immediately once the pending
   * entry is created.
   */
  earlyQuestionAnswers: Map<string, Record<string, string>>
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
  env?: Record<string, string | undefined>,
  effort?: string
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
    effort: (effort as SDKEffort) || 'high',
    pendingPermissions: new Map(),
    pendingQuestions: new Map(),
    earlyQuestionAnswers: new Map(),
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

/**
 * Handle a canUseTool invocation for the AskUserQuestion tool specifically.
 *
 * Unlike other tools, AskUserQuestion ALWAYS blocks — regardless of
 * permissionMode — because the SDK needs a real answer (delivered via
 * `updatedInput.answers`, keyed by each question's text) to produce a
 * meaningful tool_result. Auto-allowing with the original input (as the
 * bypassPermissions/acceptEdits fast path does for other tools) leaves the
 * CLI to self-resolve the dangling tool call to its default option instead
 * of actually waiting for the user — which was the root cause of this bug.
 *
 * The stream (claude-stream.ts) emits `ask_user_question` to the renderer as
 * soon as the tool_use content block finishes streaming, using the block id
 * as `id`. Per the SDK's CanUseTool contract, `toolUseID` here is that same
 * tool_use id, so we key pendingQuestions/earlyQuestionAnswers by it — no
 * extra id needs to flow to the renderer.
 */
function handleAskUserQuestion(
  state: SDKSessionState,
  input: Record<string, unknown>,
  toolUseID: string,
  signal: AbortSignal
): Promise<PermissionResult> {
  const key = toolUseID || randomUUID()

  // The renderer may have already answered before canUseTool got here (the
  // question is rendered from the stream event, which can precede the SDK's
  // internal tool-execution gating). Consume the buffered answer immediately.
  const early = state.earlyQuestionAnswers.get(key)
  if (early) {
    state.earlyQuestionAnswers.delete(key)
    return Promise.resolve({ behavior: 'allow', updatedInput: { ...input, answers: early } } as PermissionResult)
  }

  return new Promise<PermissionResult>((resolve) => {
    // If the turn is aborted while the question is pending, resolve with no
    // answers so the SDK can unwind cleanly instead of hanging. AskUserQuestion
    // has no "deny" concept, so we don't use the deny behavior here.
    const onAbort = (): void => {
      if (state.pendingQuestions.delete(key)) {
        resolve({ behavior: 'allow', updatedInput: { ...input, answers: {} } } as PermissionResult)
      }
    }
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })

    state.pendingQuestions.set(key, { resolve, input, signal, onAbort })
  })
}

/**
 * Build the `canUseTool` permission callback for a session.
 *
 * The SDK invokes this before every tool call. Behavior depends on the tool
 * and the session's permission mode:
 * - `AskUserQuestion`: ALWAYS blocks (see handleAskUserQuestion) — the user's
 *   answer must reach the SDK regardless of permission mode.
 * - `bypassPermissions` / `acceptEdits` (other tools): auto-allow (the SDK's
 *   own gating in these modes matches the old pipe-mode behavior; we don't
 *   second-guess it).
 * - `default` / `plan` (other tools): surface a `permission_request` event to
 *   the renderer and BLOCK on a resolver until the user answers via
 *   `resolveSDKPermission`. The promise resolves to the SDK `PermissionResult`
 *   (allow/deny).
 */
function makeCanUseTool(sessionId: string, state: SDKSessionState): CanUseTool {
  return (toolName, input, { signal, suggestions, toolUseID }) => {
    if (toolName === 'AskUserQuestion') {
      return handleAskUserQuestion(state, input, toolUseID, signal)
    }

    // Modes that don't require interactive confirmation resolve immediately.
    if (state.permissionMode === 'bypassPermissions' || state.permissionMode === 'acceptEdits') {
      return Promise.resolve({ behavior: 'allow', updatedInput: input } as PermissionResult)
    }

    const requestId = randomUUID()
    return new Promise<PermissionResult>((resolve) => {
      // If the turn is aborted while the prompt is pending, deny so the SDK
      // can unwind cleanly instead of hanging.
      const onAbort = (): void => {
        if (state.pendingPermissions.delete(requestId)) {
          resolve({ behavior: 'deny', message: 'Interrupted', interrupt: true } as PermissionResult)
        }
      }
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })

      state.pendingPermissions.set(requestId, { resolve, input, signal, onAbort })
      emit(sessionId, state, {
        type: 'permission_request',
        id: requestId,
        toolName,
        input,
        suggestions: (suggestions || []) as unknown as Record<string, unknown>[],
      })
    })
  }
}

/**
 * Resolve a pending permission request (called from the IPC layer when the user
 * answers). `allow` lets the tool run (optionally with edited input); `deny`
 * blocks it with a message. No-op if the request is unknown/already resolved.
 */
export function resolveSDKPermission(
  sessionId: string,
  requestId: string,
  decision: { behavior: 'allow' | 'deny'; updatedInput?: Record<string, unknown>; message?: string },
): boolean {
  const state = sdkSessions.get(sessionId)
  const pending = state?.pendingPermissions.get(requestId)
  if (!state || !pending) return false
  state.pendingPermissions.delete(requestId)
  pending.signal.removeEventListener('abort', pending.onAbort)
  if (decision.behavior === 'allow') {
    pending.resolve({
      behavior: 'allow',
      updatedInput: decision.updatedInput ?? pending.input,
    } as PermissionResult)
  } else {
    pending.resolve({
      behavior: 'deny',
      message: decision.message || 'Denied by user',
    } as PermissionResult)
  }
  return true
}

/**
 * Resolve a pending AskUserQuestion tool call (called from the IPC layer when
 * the user submits an answer in the UI). `answers` is keyed by each question's
 * exact text, per the SDK's `AskUserQuestionInput.answers` shape (multi-select
 * answers are comma-separated). Always resolves the tool call with
 * `behavior: 'allow'` — AskUserQuestion has no deny concept.
 *
 * If canUseTool hasn't registered the pending entry yet (a benign race between
 * the stream rendering the question and the SDK actually invoking canUseTool),
 * the answer is buffered in earlyQuestionAnswers and consumed as soon as the
 * pending entry is created.
 */
export function answerSDKQuestion(
  sessionId: string,
  questionId: string,
  answers: Record<string, string>,
): boolean {
  const state = sdkSessions.get(sessionId)
  if (!state) return false
  const pending = state.pendingQuestions.get(questionId)
  if (!pending) {
    state.earlyQuestionAnswers.set(questionId, answers)
    return true
  }
  state.pendingQuestions.delete(questionId)
  pending.signal.removeEventListener('abort', pending.onAbort)
  pending.resolve({
    behavior: 'allow',
    updatedInput: { ...pending.input, answers },
  } as PermissionResult)
  return true
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
    effort: spawnEffortLevel(state.effort),
    settingSources: ['user', 'project', 'local'],
    canUseTool: makeCanUseTool(sessionId, state),
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
  if (!state) return
  // Deny any in-flight permission prompts so the SDK unwinds instead of hanging
  // on a resolver that will never be answered.
  denyAllPendingPermissions(state, 'Interrupted')
  if (!state.activeQuery) return
  try {
    await state.activeQuery.interrupt()
  } catch {
    // Ignore — best-effort interrupt.
  }
}

/** Deny and clear every pending permission prompt for a session. */
function denyAllPendingPermissions(state: SDKSessionState, message: string): void {
  for (const [, pending] of state.pendingPermissions) {
    try { pending.signal.removeEventListener('abort', pending.onAbort) } catch { /* ignore */ }
    try {
      pending.resolve({ behavior: 'deny', message, interrupt: true } as PermissionResult)
    } catch { /* ignore */ }
  }
  state.pendingPermissions.clear()

  // AskUserQuestion has no deny concept — resolve pending questions with empty
  // answers so the SDK unwinds instead of hanging on a resolver that will
  // never be answered.
  for (const [, pending] of state.pendingQuestions) {
    try { pending.signal.removeEventListener('abort', pending.onAbort) } catch { /* ignore */ }
    try {
      pending.resolve({ behavior: 'allow', updatedInput: { ...pending.input, answers: {} } } as PermissionResult)
    } catch { /* ignore */ }
  }
  state.pendingQuestions.clear()
  state.earlyQuestionAnswers.clear()
}

/** Close the SDK session entirely (ends the queue + aborts the query). */
export function closeSDKSession(sessionId: string): void {
  const state = sdkSessions.get(sessionId)
  if (!state) return

  denyAllPendingPermissions(state, 'Session closed')
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

/**
 * Set the reasoning effort for an SDK session. Stored for (re)spawn and applied
 * live via applyFlagSettings (no respawn) when a query is already running.
 */
export async function setSDKEffort(sessionId: string, effort: string): Promise<void> {
  const state = sdkSessions.get(sessionId)
  if (!state) return
  state.effort = effort as SDKEffort
  if (state.activeQuery) {
    try {
      await state.activeQuery.applyFlagSettings(effortToFlagSettings(effort as SDKEffort))
    } catch {
      // Ignore — control request may be unsupported; effort still applies on next (re)spawn.
    }
  }
}
