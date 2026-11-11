import { describe, it, expect } from 'vitest'
import { createClaudeStreamState, processClaudeMessage } from '../coding-adapters/claude-stream'
import { isClaude1MModel, resolveClaudeContextWindow } from '../coding-adapters/claude-context'

const messageStart = (usage: Record<string, number>, model = 'claude-sonnet-4-5-20250929', extra: Record<string, unknown> = {}) => ({
  type: 'stream_event',
  event: { type: 'message_start', message: { model, usage } },
  ...extra,
})

const lastUsage = (events: any[]) => [...events].reverse().find((e) => e.type === 'context_usage')?.usage

describe('claude context window helpers', () => {
  it('detects 1M aliases', () => {
    expect(isClaude1MModel('sonnet[1m]')).toBe(true)
    expect(isClaude1MModel('claude-sonnet-4-5-20250929[1M]')).toBe(true)
    expect(isClaude1MModel('claude-sonnet-4-5-20250929')).toBe(false)
    expect(isClaude1MModel(undefined)).toBe(false)
    expect(isClaude1MModel('')).toBe(false)
  })

  it('resolves window by reported → model → observed usage → default', () => {
    expect(resolveClaudeContextWindow({ reported: 1_000_000 })).toBe(1_000_000)
    expect(resolveClaudeContextWindow({ models: ['opus[1m]'] })).toBe(1_000_000)
    expect(resolveClaudeContextWindow({ usedTokens: 350_000 })).toBe(1_000_000)
    expect(resolveClaudeContextWindow({ models: [undefined], usedTokens: 50_000 })).toBe(200_000)
  })
})

describe('claude stream context usage', () => {
  it('uses the last request usage, not the cumulative result usage', () => {
    const st = createClaudeStreamState()
    processClaudeMessage({ type: 'system', subtype: 'init', session_id: 's', model: 'claude-sonnet-4-5-20250929' }, st)
    // Three tool-loop requests, each re-sending ~60k of context.
    for (let i = 0; i < 3; i++) {
      processClaudeMessage(messageStart({ input_tokens: 10, cache_read_input_tokens: 60_000 + i * 1000, output_tokens: 1 }), st)
      processClaudeMessage({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 500 } } }, st)
    }
    const events = processClaudeMessage({
      type: 'result',
      subtype: 'success',
      session_id: 's',
      total_cost_usd: 0.1,
      // Aggregate across the 3 requests — would read as 92% of 200k.
      usage: { input_tokens: 30, cache_read_input_tokens: 183_000, output_tokens: 1500 },
      modelUsage: { 'claude-sonnet-4-5-20250929': { contextWindow: 200_000 } },
    }, st)
    const result = events.find((e) => e.type === 'result') as any
    expect(result.usage.usedTokens).toBe(10 + 62_000 + 500)
    expect(result.usage.contextWindow).toBe(200_000)
    expect(lastUsage(events).usedTokens).toBe(62_510)
  })

  it('takes the 1M window from init model alias and from modelUsage', () => {
    const st = createClaudeStreamState()
    processClaudeMessage({ type: 'system', subtype: 'init', session_id: 's', model: 'claude-sonnet-4-5-20250929[1m]' }, st)
    const ev = processClaudeMessage(messageStart({ input_tokens: 5, cache_read_input_tokens: 20_000 }), st)
    expect(lastUsage(ev).contextWindow).toBe(1_000_000)

    const st2 = createClaudeStreamState()
    processClaudeMessage(messageStart({ input_tokens: 5 }), st2)
    processClaudeMessage({ type: 'result', subtype: 'success', modelUsage: { m: { contextWindow: 1_000_000 } } }, st2)
    const next = processClaudeMessage(messageStart({ input_tokens: 5 }), st2)
    expect(lastUsage(next).contextWindow).toBe(1_000_000)
  })

  it('ignores sub-agent requests', () => {
    const st = createClaudeStreamState()
    processClaudeMessage(messageStart({ input_tokens: 1000 }), st)
    const ev = processClaudeMessage(messageStart({ input_tokens: 150_000 }, 'claude-haiku', { parent_tool_use_id: 'toolu_1' }), st)
    expect(ev.some((e) => e.type === 'context_usage')).toBe(false)
    const res = processClaudeMessage({ type: 'result', subtype: 'success', usage: { input_tokens: 151_000 } }, st) as any[]
    expect(res.find((e) => e.type === 'result').usage.usedTokens).toBe(1000)
  })

  it('emits no context usage on result when no request usage was seen', () => {
    const st = createClaudeStreamState()
    const res = processClaudeMessage({ type: 'result', subtype: 'success', usage: { input_tokens: 999_999 } }, st) as any[]
    expect(res.find((e) => e.type === 'result').usage).toBeUndefined()
  })
})
