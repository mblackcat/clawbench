/**
 * Claude Agent SDK → client streaming protocol.
 *
 * Faithful port of Clay's two-stage pipeline
 * (D:\repos\vx-tools\clay\lib\yoke\adapters\claude.js `flattenEvent` +
 * lib\sdk-message-processor.js `processSDKMessage`), collapsed into one
 * function. All vendor-specific accumulation happens here (server-side):
 *
 * - Tool input is accumulated from `input_json_delta` and parsed ONCE on
 *   `content_block_stop` → emits a single `tool_executing` (no per-token JSON
 *   parsing, no fragile client-side block bookkeeping).
 * - Tool results are extracted from `user`-role messages, deduped by tool id.
 * - If assistant text was NOT streamed via deltas, the authoritative
 *   `assistant` message emits a `delta` fallback (guarantees text always shows).
 * - AskUserQuestion / TodoWrite are detected on block_stop and emitted as
 *   dedicated events.
 *
 * The client (renderer) receives only the simple protocol in stream-events.ts.
 */

import type { CodingStreamEvent } from './stream-events'

interface BlockAccum {
  type: 'text' | 'thinking' | 'tool_use'
  id?: string
  name?: string
  inputJson: string
}

/** Per-session accumulation state (mirrors Clay's `session` fields). */
export interface ClaudeStreamState {
  /** Per-turn message counter; namespaces content-block indices so they never collide across the multiple assistant messages of an agentic turn. */
  messageIndex: number
  /** True once any text streamed this turn (gates the assistant-message text fallback). */
  streamedText: boolean
  /** Open content blocks for the current message, keyed by `<msg>:<index>`. */
  blocks: Map<string, BlockAccum>
  /** Tool-result ids already emitted this turn (dedup; results can arrive via stream + user message). */
  sentToolResults: Set<string>
}

export function createClaudeStreamState(): ClaudeStreamState {
  return { messageIndex: -1, streamedText: false, blocks: new Map(), sentToolResults: new Set() }
}

function resetForTurn(st: ClaudeStreamState): void {
  st.messageIndex = -1
  st.streamedText = false
  st.blocks.clear()
  st.sentToolResults.clear()
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

/** Convert one raw SDK message into zero or more client events, mutating `st`. */
export function processClaudeMessage(raw: any, st: ClaudeStreamState): CodingStreamEvent[] {
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
      st.messageIndex += 1
      out.push({ type: 'turn_start' })
      return out
    }

    const mi = st.messageIndex
    const key = `${mi}:${typeof ev.index === 'number' ? ev.index : 0}`

    if (evType === 'content_block_start') {
      const cb = ev.content_block || {}
      if (cb.type === 'tool_use') {
        const id: string = cb.id || `tool-${key}`
        const name: string = cb.name || ''
        st.blocks.set(key, { type: 'tool_use', id, name, inputJson: '' })
        // AskUserQuestion / TodoWrite are emitted as dedicated events on stop.
        if (name !== 'AskUserQuestion' && name !== 'TodoWrite') {
          out.push({ type: 'tool_start', id, name })
        }
      } else if (cb.type === 'thinking') {
        st.blocks.set(key, { type: 'thinking', inputJson: '' })
        out.push({ type: 'thinking_start' })
      } else {
        st.blocks.set(key, { type: 'text', inputJson: '' })
      }
      return out
    }

    if (evType === 'content_block_delta') {
      const d = ev.delta || {}
      if (d.type === 'text_delta' && d.text) {
        st.streamedText = true
        out.push({ type: 'delta', text: d.text })
      } else if (d.type === 'thinking_delta' && d.thinking) {
        out.push({ type: 'thinking_delta', text: d.thinking })
      } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
        const b = st.blocks.get(key)
        if (b) b.inputJson += d.partial_json
      }
      return out
    }

    if (evType === 'content_block_stop') {
      const b = st.blocks.get(key)
      if (b) {
        if (b.type === 'tool_use') {
          let input: Record<string, unknown> = {}
          try {
            const parsed = JSON.parse(b.inputJson || '{}')
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed
          } catch {
            /* keep empty input */
          }
          if (b.name === 'AskUserQuestion') {
            const questions = Array.isArray(input.questions) ? input.questions : []
            if (questions.length > 0) out.push({ type: 'ask_user_question', id: b.id || '', questions })
          } else if (b.name === 'TodoWrite') {
            const todos = Array.isArray(input.todos) ? input.todos : []
            if (todos.length > 0) out.push({ type: 'todo_update', todos })
          } else {
            out.push({ type: 'tool_executing', id: b.id || '', name: b.name || '', input })
          }
        } else if (b.type === 'thinking') {
          out.push({ type: 'thinking_stop' })
        }
        st.blocks.delete(key)
      }
      return out
    }

    // message_delta / message_stop / content_block_* variants: nothing to emit.
    return out
  }

  if (msgType === 'assistant') {
    // Fallback: if no text streamed this turn, emit the authoritative text now.
    const content = Array.isArray(raw.message?.content) ? raw.message.content : []
    if (!st.streamedText) {
      const text = content
        .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
        .map((c: any) => c.text)
        .join('')
      if (text) out.push({ type: 'delta', text })
    }
    // tool_use blocks were already emitted via stream events; nothing more here.
    return out
  }

  if (msgType === 'user') {
    // Tool results live in user-role messages. Dedup by tool id.
    const content = Array.isArray(raw.message?.content) ? raw.message.content : []
    for (const block of content) {
      if (!block || block.type !== 'tool_result') continue
      const id = block.tool_use_id || ''
      if (!id || st.sentToolResults.has(id)) continue
      st.sentToolResults.add(id)
      out.push({
        type: 'tool_result',
        id,
        content: stringifyToolResult(block.content),
        isError: !!block.is_error,
      })
    }
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
    resetForTurn(st)
    return out
  }

  // status / auth_status / rate_limit_event / etc. — not critical for the chat view.
  return out
}
