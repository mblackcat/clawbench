/**
 * SDK Session Manager — Claude Agent SDK communication layer.
 *
 * Replaces pipe-manager.service.ts for Claude sessions. Uses the official
 * `@anthropic-ai/claude-agent-sdk` package to manage sessions via `query()`.
 *
 * Key design:
 * - `query()` is per-turn: each user message starts a new `query()` call
 *   with `resume: sessionId` to continue the conversation.
 * - SDK messages are translated into the same event format that
 *   `parseClaudeEvent()` in the renderer store expects, so no renderer
 *   changes are needed.
 * - Ring buffer for IM bridge compatibility is preserved.
 */

import { BrowserWindow } from 'electron'
import * as logger from '../utils/logger'
import type { AIToolType } from '../store/ai-workbench.store'

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
  /** Claude native session ID (for resume) */
  toolSessionId: string | null
  cwd: string
  /** Current active Query async generator */
  activeQuery: any | null  // Query type from SDK
  /** Last completed query — kept alive so control methods (setModel, etc.) remain callable */
  lastQuery: any | null
  isProcessing: boolean
  permissionMode: SDKPermissionMode
  env?: Record<string, string | undefined>
  /** Callbacks registered by ai-workbench.service.ts */
  onEvent?: (sessionId: string, data: Record<string, unknown>) => void
  onClose?: (sessionId: string) => void
  onError?: (sessionId: string, err: Error) => void
}

const sdkSessions = new Map<string, SDKSessionState>()

/** Output ring-buffer: last 4000 chars of output for each session (for IM). */
const outputBuffers = new Map<string, string>()

const RING_BUFFER_MAX = 4000

function appendOutput(sessionId: string, text: string): void {
  const existing = outputBuffers.get(sessionId) ?? ''
  const combined = existing + text
  outputBuffers.set(
    sessionId,
    combined.length > RING_BUFFER_MAX ? combined.slice(-RING_BUFFER_MAX) : combined
  )
}

// ── Interactive state detection (copied from pipe-manager) ──

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

// ── Forward events to renderer ──

function forwardToRenderer(sessionId: string, event: Record<string, unknown>): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('ai-workbench:pipe-event', { sessionId, event })
  })
}

// ── SDK Message → Pipe Event translation ──

/**
 * Translate an SDK message into the pipe-event format that the renderer's
 * `parseClaudeEvent()` / `onPipeEvent` handler already understands.
 *
 * SDK message types and their translations:
 * - SDKSystemMessage (type='system', subtype='init') → { type: 'system', subtype: 'init', session_id }
 * - SDKAssistantMessage (type='assistant') → { type: 'assistant', message: { content: [...] } }
 * - SDKPartialAssistantMessage (type='stream_event') → incremental assistant events
 * - SDKResultMessage (type='result') → { type: 'result', session_id, cost_usd, result }
 * - Other messages → logged but not forwarded
 */
function translateAndForward(
  sessionId: string,
  msg: any,
  state: SDKSessionState
): void {
  const msgType = msg.type as string

  if (msgType === 'system') {
    if (msg.subtype === 'init') {
      // Capture the native session ID
      if (msg.session_id) {
        state.toolSessionId = msg.session_id
      }
      const event: Record<string, unknown> = {
        type: 'system',
        subtype: 'init',
        session_id: msg.session_id || ''
      }
      if (state.onEvent) state.onEvent(sessionId, event)
      forwardToRenderer(sessionId, event)
    }
    // Ignore other system subtypes (compact_boundary, task_*, etc.) for now
    return
  }

  if (msgType === 'assistant') {
    // SDKAssistantMessage: full message with BetaMessage content.
    // The renderer already received incremental content via stream_event deltas,
    // so we only update the ring buffer (for IM) and do NOT forward to renderer
    // to avoid duplicate display.
    const betaMessage = msg.message  // BetaMessage
    const content = betaMessage?.content ?? []
    const translatedContent = translateBetaContent(content)

    for (const block of translatedContent) {
      if (block.type === 'text' && block.text) {
        appendOutput(sessionId, block.text)
      } else if (block.type === 'tool_use' && block.name) {
        appendOutput(sessionId, `\n⚙ [${block.name}]\n`)
      }
    }

    // Detect AskUserQuestion and TodoWrite tool_use blocks and forward as dedicated events
    for (const rawBlock of content) {
      if (rawBlock?.type !== 'tool_use') continue
      const input = rawBlock.input || {}

      if (rawBlock.name === 'AskUserQuestion') {
        const questions = Array.isArray(input.questions) ? input.questions : []
        if (questions.length > 0) {
          forwardToRenderer(sessionId, {
            type: 'ask_user_question',
            id: rawBlock.id || '',
            questions
          })
        }
      } else if (rawBlock.name === 'TodoWrite') {
        const todos = Array.isArray(input.todos) ? input.todos : []
        if (todos.length > 0) {
          forwardToRenderer(sessionId, {
            type: 'todo_update',
            todos
          })
        }
      }
    }

    // Notify service layer (for status updates) but NOT the renderer
    if (state.onEvent) state.onEvent(sessionId, {
      type: 'assistant',
      message: { role: 'assistant', content: translatedContent }
    })
    return
  }

  if (msgType === 'stream_event') {
    // SDKPartialAssistantMessage: streaming delta
    const betaEvent = msg.event  // BetaRawMessageStreamEvent
    handleStreamEvent(sessionId, betaEvent, state)
    return
  }

  if (msgType === 'result') {
    // SDKResultMessage
    const costUsd = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined
    const resultText = msg.subtype === 'success' ? (msg.result ?? '') : ''

    if (resultText) {
      appendOutput(sessionId, `\n${resultText}\n`)
    }

    const event: Record<string, unknown> = {
      type: 'result',
      session_id: msg.session_id || state.toolSessionId || '',
      cost_usd: costUsd,
      result: resultText,
      subtype: msg.subtype
    }
    if (state.onEvent) state.onEvent(sessionId, event)
    forwardToRenderer(sessionId, event)
    return
  }

  // Other message types (status, auth_status, rate_limit_event, etc.)
  // Not critical for renderer — silently ignore
}

/**
 * Translate Anthropic BetaMessage content blocks to the format
 * parseClaudeEvent() expects.
 */
function translateBetaContent(content: any[]): any[] {
  const result: any[] = []
  for (const block of content) {
    if (!block) continue
    if (block.type === 'text') {
      result.push({ type: 'text', text: block.text || '' })
    } else if (block.type === 'thinking') {
      result.push({ type: 'thinking', thinking: block.thinking || '' })
    } else if (block.type === 'tool_use') {
      result.push({
        type: 'tool_use',
        id: block.id || '',
        name: block.name || '',
        input: block.input || {}
      })
    } else if (block.type === 'tool_result') {
      const contentStr = typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map((c: any) => c.text || '').join('\n')
          : JSON.stringify(block.content)
      result.push({
        type: 'tool_result',
        tool_use_id: block.tool_use_id || '',
        content: contentStr,
        is_error: block.is_error || false
      })
    }
  }
  return result
}

/**
 * Handle BetaRawMessageStreamEvent (streaming deltas).
 *
 * These are the incremental events from the Anthropic API. We accumulate
 * content blocks and forward them as assistant events so the renderer
 * can show real-time streaming.
 */
function handleStreamEvent(
  sessionId: string,
  betaEvent: any,
  state: SDKSessionState
): void {
  if (!betaEvent) return

  const eventType = betaEvent.type as string

  // content_block_delta — incremental text/thinking/input_json
  if (eventType === 'content_block_delta') {
    const delta = betaEvent.delta
    if (!delta) return

    if (delta.type === 'text_delta' && delta.text) {
      appendOutput(sessionId, delta.text)
      const event: Record<string, unknown> = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: delta.text }]
        }
      }
      if (state.onEvent) state.onEvent(sessionId, event)
      forwardToRenderer(sessionId, event)
    } else if (delta.type === 'thinking_delta' && delta.thinking) {
      const event: Record<string, unknown> = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: delta.thinking }]
        }
      }
      if (state.onEvent) state.onEvent(sessionId, event)
      forwardToRenderer(sessionId, event)
    } else if (delta.type === 'input_json_delta') {
      // Partial tool input — ignore for now (full tool_use comes in assistant message)
    }
    return
  }

  // content_block_start — new content block starting
  if (eventType === 'content_block_start') {
    const block = betaEvent.content_block
    if (!block) return

    if (block.type === 'tool_use') {
      // Skip AskUserQuestion and TodoWrite — dedicated events are sent
      // from the assistant message handler with the full data
      if (block.name === 'AskUserQuestion' || block.name === 'TodoWrite') return

      appendOutput(sessionId, `\n⚙ [${block.name}]\n`)
      const event: Record<string, unknown> = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: block.id || '',
            name: block.name || '',
            input: {}
          }]
        }
      }
      if (state.onEvent) state.onEvent(sessionId, event)
      forwardToRenderer(sessionId, event)
    } else if (block.type === 'thinking') {
      // Start of thinking block — forward empty thinking to show indicator
      const event: Record<string, unknown> = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: '' }]
        }
      }
      if (state.onEvent) state.onEvent(sessionId, event)
      forwardToRenderer(sessionId, event)
    }
    return
  }

  // content_block_stop — content block finished
  if (eventType === 'content_block_stop') {
    // No action needed — the full block comes in the assistant message
    return
  }

  // message_start, message_delta, message_stop — message lifecycle
  // No special handling needed; the SDKAssistantMessage will follow
}

// ── Local slash command interception ──

/**
 * Handle REPL-only slash commands locally via Query control methods.
 * Returns a result object if the command was handled, or null to pass through.
 */
async function handleLocalSlashCommand(
  sessionId: string,
  text: string,
  state: SDKSessionState
): Promise<{ success: boolean; error?: string } | null> {
  const trimmed = text.trim()

  // /model [name] — switch or display current model
  const modelMatch = trimmed.match(/^\/model(?:\s+(.+))?$/)
  if (modelMatch) {
    const modelName = modelMatch[1]?.trim()
    const q = state.activeQuery || state.lastQuery

    if (!modelName) {
      // No argument: show supported models
      if (q) {
        try {
          const models = await q.supportedModels()
          const modelList = models.map((m: any) => `  - ${m.value}  (${m.displayName || ''})`).join('\n')
          emitLocalSystem(sessionId, state, `可用模型:\n${modelList}`)
        } catch {
          emitLocalSystem(sessionId, state, '无法获取模型信息，请先发送一条消息以初始化会话。')
        }
      } else {
        emitLocalSystem(sessionId, state, '会话尚未初始化，请先发送一条消息。')
      }
      return { success: true }
    }

    // Has argument: set model
    if (q) {
      try {
        await q.setModel(modelName)
        emitLocalSystem(sessionId, state, `模型已切换为: ${modelName}`)
      } catch (err: any) {
        emitLocalSystem(sessionId, state, `切换模型失败: ${err?.message || String(err)}`)
      }
    } else {
      emitLocalSystem(sessionId, state, '会话尚未初始化，请先发送一条消息后再切换模型。')
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

    state.permissionMode = modeName as SDKPermissionMode
    const q = state.activeQuery || state.lastQuery
    if (q) {
      try {
        await q.setPermissionMode(modeName as SDKPermissionMode)
      } catch { /* will take effect on next query */ }
    }
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

/**
 * Emit a local system message to the renderer (for command feedback).
 * Also emits a result event to flush the streaming block into a message.
 */
function emitLocalSystem(sessionId: string, state: SDKSessionState, text: string): void {
  // Send system event with message text
  const sysEvent: Record<string, unknown> = {
    type: 'system',
    subtype: 'local',
    message: text
  }
  if (state.onEvent) state.onEvent(sessionId, sysEvent)
  forwardToRenderer(sessionId, sysEvent)

  // Send a result event to flush the streaming block into a finalized message
  const resultEvent: Record<string, unknown> = {
    type: 'result',
    session_id: state.toolSessionId || '',
    subtype: 'success',
    result: ''
  }
  if (state.onEvent) state.onEvent(sessionId, resultEvent)
  forwardToRenderer(sessionId, resultEvent)
}

// ── Public API ──

/**
 * Create an SDK session state. Does NOT start a query — that happens on
 * the first `writeToSDKSession()` call.
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
  // Clean up any existing session
  closeSDKSession(sessionId)

  const state: SDKSessionState = {
    toolSessionId: resumeId || null,
    cwd,
    activeQuery: null,
    lastQuery: null,
    isProcessing: false,
    permissionMode: 'bypassPermissions',  // default — matches old pipe mode behavior
    env,
    onEvent,
    onClose,
    onError
  }

  sdkSessions.set(sessionId, state)
  outputBuffers.delete(sessionId)

  logger.info(`[sdk] Session launched: ${sessionId}`)
  return { success: true }
}

/**
 * Send a user message (or slash command) to the SDK session.
 * Starts a new `query()` call with the prompt, consuming the async generator.
 *
 * Some REPL-only slash commands (/model, /permissions, etc.) are intercepted
 * here and handled via Query control methods since they can't be sent as
 * prompts to query().
 */
export async function writeToSDKSession(
  sessionId: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  const state = sdkSessions.get(sessionId)
  if (!state) return { success: false, error: 'Session not running' }

  // ── Handle REPL-only slash commands locally ──
  const localResult = await handleLocalSlashCommand(sessionId, text, state)
  if (localResult) return localResult

  // If there's an active query still processing, interrupt it first
  if (state.activeQuery && state.isProcessing) {
    try {
      await state.activeQuery.interrupt()
    } catch {
      // Ignore interrupt errors
    }
  }

  state.isProcessing = true

  try {
    const queryFn = await ensureSDK()

    const options: Record<string, any> = {
      cwd: state.cwd,
      includePartialMessages: true,
      permissionMode: state.permissionMode,
      allowDangerouslySkipPermissions: state.permissionMode === 'bypassPermissions',
    }

    if (state.env) {
      options.env = state.env
    }

    if (state.toolSessionId) {
      options.resume = state.toolSessionId
    }

    const q = queryFn({ prompt: text, options })
    state.activeQuery = q

    // Consume the async generator in the background
    consumeQuery(sessionId, q, state).catch((err) => {
      logger.error(`[SDK:${sessionId.slice(0, 8)}] query error:`, err)
      const event: Record<string, unknown> = {
        type: 'error',
        error: { message: err?.message || String(err) }
      }
      if (state.onEvent) state.onEvent(sessionId, event)
      forwardToRenderer(sessionId, event)
      if (state.onError) state.onError(sessionId, err instanceof Error ? err : new Error(String(err)))
    }).finally(() => {
      state.isProcessing = false
      state.lastQuery = state.activeQuery  // preserve for /model, /permissions etc.
      state.activeQuery = null
    })

    return { success: true }
  } catch (err: any) {
    state.isProcessing = false
    return { success: false, error: err?.message || String(err) }
  }
}

/**
 * Consume all messages from a Query async generator.
 */
async function consumeQuery(
  sessionId: string,
  query: AsyncGenerator<any, void>,
  state: SDKSessionState
): Promise<void> {
  for await (const msg of query) {
    // Check if session was closed while processing
    if (!sdkSessions.has(sessionId)) break
    translateAndForward(sessionId, msg, state)
  }
}

/**
 * Interrupt the current query (like Ctrl+C).
 */
export async function interruptSDKSession(sessionId: string): Promise<void> {
  const state = sdkSessions.get(sessionId)
  if (!state?.activeQuery) return
  try {
    await state.activeQuery.interrupt()
  } catch {
    // Ignore errors
  }
}

/**
 * Close the SDK session entirely.
 */
export function closeSDKSession(sessionId: string): void {
  const state = sdkSessions.get(sessionId)
  if (!state) return

  if (state.activeQuery) {
    try {
      state.activeQuery.return(undefined)
    } catch {
      // Ignore
    }
  }

  const onClose = state.onClose
  sdkSessions.delete(sessionId)
  outputBuffers.delete(sessionId)

  logger.info(`[sdk] Session closed: ${sessionId}`)
  forwardToRenderer(sessionId, { type: 'pipe_exit' })
  if (onClose) onClose(sessionId)
}

/**
 * Get the ring buffer content (for IM cards).
 */
export function getSDKSessionOutput(sessionId: string): string {
  return outputBuffers.get(sessionId) ?? ''
}

/**
 * Check whether an SDK session exists.
 */
export function hasSDKSession(sessionId: string): boolean {
  return sdkSessions.has(sessionId)
}

/**
 * Set the permission mode for an SDK session.
 * Also updates the active query if one is running.
 */
export async function setSDKPermissionMode(
  sessionId: string,
  mode: SDKPermissionMode
): Promise<void> {
  const state = sdkSessions.get(sessionId)
  if (!state) return

  state.permissionMode = mode

  // If there's an active or last query, update it
  const q = state.activeQuery || state.lastQuery
  if (q) {
    try {
      await q.setPermissionMode(mode)
    } catch {
      // Ignore — will take effect on next query
    }
  }
}
