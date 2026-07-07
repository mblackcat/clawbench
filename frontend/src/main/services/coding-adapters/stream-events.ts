/**
 * Normalized streaming events for AI Coding chat mode.
 *
 * Both the Claude Agent SDK manager and the Codex app-server manager flatten
 * their vendor-specific messages into this single event alphabet, then forward
 * each event over the `ai-coding:pipe-event` IPC channel. The renderer store's
 * `onPipeEvent` handler accumulates block-id-keyed deltas into one growing
 * assistant message per turn (ported from Clay's `yokeType` / `processSDKMessage`
 * design — see D:\repos\vx-tools\clay\lib\sdk-message-processor.js).
 *
 * The payloads for `ask_user_question` / `todo_update` are kept loose (unknown[])
 * on purpose: they are forwarded opaquely and typed canonically on the renderer
 * side (types/ai-coding.ts), so the main process is not coupled to renderer types.
 */

export interface StreamContextUsage {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  usedTokens?: number
  contextWindow?: number
}

export type CodingStreamEvent =
  // Lifecycle
  | { type: 'system'; subtype: 'init' | 'local'; session_id?: string; message?: string }
  | { type: 'turn_start' }
  | { type: 'result'; session_id?: string; cost_usd?: number; usage?: StreamContextUsage; subtype?: string; result?: string }
  | { type: 'error'; error: { message: string } }
  // Block-level streaming (keyed by blockId so deltas accumulate into one block)
  | { type: 'block_start'; blockId: string; blockType: 'text' | 'thinking' | 'tool_use'; toolName?: string }
  | { type: 'text_delta'; blockId: string; text: string }
  | { type: 'thinking_delta'; blockId: string; text: string }
  | { type: 'tool_input_delta'; blockId: string; partialJson: string }
  | { type: 'block_stop'; blockId: string; input?: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  // Side-channel structured blocks
  | { type: 'context_usage'; usage: StreamContextUsage }
  | { type: 'ask_user_question'; id: string; questions: unknown[] }
  | { type: 'todo_update'; todos: unknown[] }

/** A string discriminator helper for the IPC boundary (events arrive as plain objects). */
export type CodingStreamEventType = CodingStreamEvent['type']
