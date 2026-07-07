/**
 * Flatten raw Claude Agent SDK messages into the normalized CodingStreamEvent
 * alphabet. Ported from Clay's `flattenEvent`
 * (D:\repos\vx-tools\clay\lib\yoke\adapters\claude.js:80) and `processSDKMessage`
 * (lib\sdk-message-processor.js:176), adapted to clawbench's CodingStreamEvent.
 *
 * Design notes:
 * - Live text/thinking/tool-input are driven ONLY by `stream_event` deltas
 *   (content_block_start → *_delta → content_block_stop). The finalized
 *   `assistant` message is NOT re-emitted for text/tool_use (would duplicate the
 *   deltas). This is the dedup guard Clay uses (`streamedText`).
 * - Tool RESULTS come from `user`-role messages — this is the piece the old
 *   implementation dropped entirely, so tools rendered with empty inputs.
 * - Block ids: text/thinking use `idx<index>`; tool_use uses the real tool id
 *   (so tool_result pairing works). The `index → blockId` map is per-turn.
 */

import type { CodingStreamEvent } from './stream-events'

/** Per-turn accumulator state (reset on each message_start). */
export interface FlattenCtx {
  indexToBlockId: Map<number, string>
  toolInputs: Map<string, string>
  toolNames: Map<string, string>
}

export function createFlattenCtx(): FlattenCtx {
  return { indexToBlockId: new Map(), toolInputs: new Map(), toolNames: new Map() }
}

function resetCtx(ctx: FlattenCtx): void {
  ctx.indexToBlockId.clear()
  ctx.toolInputs.clear()
  ctx.toolNames.clear()
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

/** Best-effort parse of accumulated tool-input JSON. */
function parseToolInput(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { value: parsed }
  } catch {
    return { _raw: raw }
  }
}

/**
 * Convert one raw SDK message into zero or more normalized events.
 * `ctx` is mutated (and reset per turn); callers must keep one ctx per session.
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
      resetCtx(ctx)
      out.push({ type: 'turn_start' })
      return out
    }

    if (evType === 'content_block_start') {
      const index: number = typeof ev.index === 'number' ? ev.index : out.length
      const cb = ev.content_block || {}
      const cbType = cb.type as string
      if (cbType === 'tool_use') {
        const id: string = cb.id || `tool-${index}`
        ctx.indexToBlockId.set(index, id)
        ctx.toolNames.set(id, cb.name || '')
        out.push({ type: 'block_start', blockId: id, blockType: 'tool_use', toolName: cb.name || '' })
      } else {
        const bid = `idx${index}`
        ctx.indexToBlockId.set(index, bid)
        const blockType: 'text' | 'thinking' = cbType === 'thinking' ? 'thinking' : 'text'
        out.push({ type: 'block_start', blockId: bid, blockType })
      }
      return out
    }

    if (evType === 'content_block_delta') {
      const index: number = typeof ev.index === 'number' ? ev.index : -1
      const bid = ctx.indexToBlockId.get(index)
      const d = ev.delta || {}
      if (bid && d.type === 'text_delta' && d.text) {
        out.push({ type: 'text_delta', blockId: bid, text: d.text })
      } else if (bid && d.type === 'thinking_delta' && d.thinking) {
        out.push({ type: 'thinking_delta', blockId: bid, text: d.thinking })
      } else if (bid && d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
        ctx.toolInputs.set(bid, (ctx.toolInputs.get(bid) || '') + d.partial_json)
        out.push({ type: 'tool_input_delta', blockId: bid, partialJson: d.partial_json })
      }
      return out
    }

    if (evType === 'content_block_stop') {
      const index: number = typeof ev.index === 'number' ? ev.index : -1
      const bid = ctx.indexToBlockId.get(index)
      if (bid) {
        const name = ctx.toolNames.get(bid)
        if (name) {
          const input = parseToolInput(ctx.toolInputs.get(bid) || '')
          if (name === 'AskUserQuestion') {
            const questions = Array.isArray(input.questions) ? input.questions : []
            if (questions.length > 0) out.push({ type: 'ask_user_question', id: bid, questions })
          } else if (name === 'TodoWrite') {
            const todos = Array.isArray(input.todos) ? input.todos : []
            if (todos.length > 0) out.push({ type: 'todo_update', todos })
          } else {
            out.push({ type: 'block_stop', blockId: bid, input })
          }
        } else {
          out.push({ type: 'block_stop', blockId: bid })
        }
        ctx.indexToBlockId.delete(index)
        ctx.toolInputs.delete(bid)
        ctx.toolNames.delete(bid)
      }
      return out
    }

    // message_delta / message_stop / others: no event needed.
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

  if (msgType === 'assistant') {
    // Text/thinking/tool_use were already streamed via deltas. Do not re-emit
    // (avoids duplicate display). No fallback needed while includePartialMessages
    // is on.
    return out
  }

  if (msgType === 'result') {
    const costUsd = typeof raw.total_cost_usd === 'number' ? raw.total_cost_usd : undefined
    const resultText = raw.subtype === 'success' ? (raw.result ?? '') : ''
    out.push({
      type: 'result',
      session_id: raw.session_id || '',
      cost_usd: costUsd,
      subtype: raw.subtype,
      result: resultText,
    })
    // Best-effort token accounting from the result message.
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
