/**
 * Normalized CLIENT streaming protocol for AI Coding chat mode.
 *
 * This is Clay's client protocol (see D:\repos\vx-tools\clay\lib\
 * sdk-message-processor.js `processSDKMessage` → `sendAndRecord`). The
 * vendor-specific accumulation (parsing tool input on block_stop, deduping
 * tool results, falling back to the authoritative assistant message for text)
 * all happens SERVER-SIDE. The renderer only has to:
 *   - append `delta` text to the current text segment,
 *   - create/fill tool cards by `id` (`tool_start` → `tool_executing` → `tool_result`),
 *   - manage a thinking block (`thinking_start`/`thinking_delta`/`thinking_stop`),
 *   - finalize on `result`.
 * No block-id maps or lifecycle bookkeeping on the client — that was the source
 * of the earlier fragility.
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
  // Streaming text / thinking (renderer appends to the current segment)
  | { type: 'delta'; text: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_stop' }
  // Tool card lifecycle, keyed by tool id
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_executing'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; content: string; isError?: boolean }
  // Side-channel structured blocks
  | { type: 'context_usage'; usage: StreamContextUsage }
  | { type: 'ask_user_question'; id: string; questions: unknown[] }
  | { type: 'todo_update'; todos: unknown[] }
