/**
 * Flatten raw Claude Agent SDK messages into the normalized CodingStreamEvent
 * alphabet. Adapted from Clay's flattenEvent / processSDKMessage
 * (D:\repos\vx-tools\clay\lib\yoke\adapters\claude.js).
 *
 * Robustness model:
 * - Text & thinking are DELTA-DRIVEN. Each delta's blockId includes the
 *   per-message index (`t<msg>-<block>`), so it is unique across the multiple
 *   assistant messages of an agentic turn and never depends on a prior
 *   content_block_start having been seen. The renderer auto-creates the block
 *   on the first delta. (Old behavior streamed text regardless of block
 *   lifecycle events — this preserves that.)
 * - Tool calls come from the AUTHORITATIVE finalized `assistant` message
 *   (block_start with the name + block_stop with the full parsed input), not
 *   from streaming input_json_delta chunks — so tool inputs always render
 *   correctly without fragile index bookkeeping or O(n²) JSON parsing.
 * - Tool RESULTS come from `user`-role messages.
 * - The whole turn accumulates in the renderer until `result` finalizes it
 *   (turn_start does NOT clear — that would wipe intermediate steps).
 */

import type { CodingStreamEvent } from './stream-events'

/** Per-session flatten state: a message counter, unique within a turn. */
export interface FlattenCtx {
  messageIndex: number
}

export function createFlattenCtx(): FlattenCtx {
  return { messageIndex: -1 }
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: any) => {
        if (!c) return ''
        if (typeof c === 'string') return c
        if (typeof c.text === 'string') return c.text
        return ''
      })
      .filter((s) => s.length > 0)
      .join('\n')
  }
  if (content == null) return ''
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

/**
 * Convert one raw SDK message into zero or more normalized events.
 * `ctx` carries a per-turn message counter (reset on `result`).
 */
export function flattenClaudeEvent(raw: any, ctx: FlattenCtx): CodingStreamEvent[] {
  if (!raw || typeof raw !== 'object') return []
  const msgType = raw.type as string
  const out: CodingStreamEvent[] = []

  if (msgType === 'system') {
    if (raw.subtype === 'init') {
      out.push({ type: 'system', subtype: 'init', session_id: raw.session_id || '' })
    }
    return out
  }

  if (msgType === 'stream_event') {
    const ev = raw.event
    if (!ev || typeof ev !== 'object') return out
    const evType = ev.type as string

    if (evType === 'message_start') {
      ctx.messageIndex += 1
      out.push({ type: 'turn_start' })
      return out
    }

    const mi = ctx.messageIndex

    if (evType === 'content_block_start') {
      const index = typeof ev.index === 'number' ? ev.index : 0
      const cb = ev.content_block || {}
      // Open a thinking block early so its spinner shows before deltas arrive.
      if (cb.type === 'thinking') {
        out.push({ type: 'block_start', blockId: `th${mi}-${index}`, blockType: 'thinking' })
      }
      // text/tool_use blocks are created from deltas / the assistant message.
      return out
    }

    if (evType === 'content_block_delta') {
      const index = typeof ev.index === 'number' ? ev.index : 0
      const d = ev.delta || {}
      if (d.type === 'text_delta' && d.text) {
        out.push({ type: 'text_delta', blockId: `t${mi}-${index}`, text: d.text })
      } else if (d.type === 'thinking_delta' && d.thinking) {
        out.push({ type: 'thinking_delta', blockId: `th${mi}-${index}`, text: d.thinking })
      }
      // input_json_delta intentionally ignored — tool input comes from the
      // finalized assistant message (see below).
      return out
    }

    // content_block_stop / message_delta / message_stop: no event needed.
    return out
  }

  if (msgType === 'assistant') {
    // Authoritative finalized message. Use it for tool_use blocks (full input).
    // Text/thinking were already streamed via deltas, so skip them here.
    const content = Array.isArray(raw.message?.content) ? raw.message.content : []
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue
      const id: string = block.id || `tool-${out.length}`
      const name: string = block.name || ''
      const input: Record<string, unknown> =
        block.input && typeof block.input === 'object' && !Array.isArray(block.input)
          ? block.input
          : {}

      if (name === 'AskUserQuestion') {
        const questions = Array.isArray(input.questions) ? input.questions : []
        if (questions.length > 0) out.push({ type: 'ask_user_question', id, questions })
      } else if (name === 'TodoWrite') {
        const todos = Array.isArray(input.todos) ? input.todos : []
        if (todos.length > 0) out.push({ type: 'todo_update', todos })
      } else {
        out.push({ type: 'block_start', blockId: id, blockType: 'tool_use', toolName: name })
        out.push({ type: 'block_stop', blockId: id, input })
      }
    }
    return out
  }

  if (msgType === 'user') {
    // Tool results arrive as user-role messages containing tool_result blocks.
    const content = Array.isArray(raw.message?.content) ? raw.message.content : []
    for (const block of content) {
      if (block && block.type === 'tool_result') {
        out.push({
          type: 'tool_result',
          toolUseId: block.tool_use_id || '',
          content: stringifyToolResult(block.content),
          isError: !!block.is_error,
        })
      }
    }
    return out
  }

  if (msgType === 'result') {
    ctx.messageIndex = -1  // reset the per-turn message counter
    const costUsd = typeof raw.total_cost_usd === 'number' ? raw.total_cost_usd : undefined
    const resultText = raw.subtype === 'success' ? (raw.result ?? '') : ''
    out.push({
      type: 'result',
      session_id: raw.session_id || '',
      cost_usd: costUsd,
      subtype: raw.subtype,
      result: resultText,
    })
    const u = raw.usage
    if (u && typeof u === 'object') {
      const inputTokens = typeof u.input_tokens === 'number' ? u.input_tokens : undefined
      const outputTokens = typeof u.output_tokens === 'number' ? u.output_tokens : undefined
      const cached = typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : undefined
      if (inputTokens !== undefined || outputTokens !== undefined || cached !== undefined) {
        out.push({
          type: 'context_usage',
          usage: {
            inputTokens,
            cachedInputTokens: cached,
            outputTokens,
            usedTokens: (inputTokens || 0) + (cached || 0) || undefined,
          },
        })
      }
    }
    return out
  }

  // status / auth_status / rate_limit_event / etc. — not critical for the chat view.
  return out
}
