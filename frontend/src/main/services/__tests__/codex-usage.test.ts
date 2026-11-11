import { describe, it, expect } from 'vitest'
import { computeCodexCost, parseCodexTokenInfo } from '../coding-adapters/codex-usage'

describe('codex token usage', () => {
  // Shape copied from a real ~/.codex/sessions rollout token_count event (2nd request).
  const rollout = {
    total_token_usage: { input_tokens: 55154, cached_input_tokens: 27008, output_tokens: 566, total_tokens: 55720 },
    last_token_usage: { input_tokens: 27952, cached_input_tokens: 27008, output_tokens: 234, total_tokens: 28186 },
    model_context_window: 258400,
  }

  it('uses last request for occupancy and model_context_window for the window', () => {
    const { context } = parseCodexTokenInfo(rollout)
    expect(context).toEqual({
      inputTokens: 944, // uncached part — cached is a subset of input
      cachedInputTokens: 27008,
      outputTokens: 234,
      usedTokens: 28186,
      contextWindow: 258400,
    })
    expect(context!.inputTokens + context!.cachedInputTokens + context!.outputTokens).toBe(context!.usedTokens)
  })

  it('uses cumulative totals for cost', () => {
    const { cost } = parseCodexTokenInfo(rollout)
    expect(cost).toMatchObject({ inputTokens: 55154 - 27008, cachedInputTokens: 27008, outputTokens: 566 })
    expect(computeCodexCost('gpt-4o', cost)).toBeCloseTo((28146 * 2.5 + 27008 * 1.25 + 566 * 10) / 1e6, 8)
  })

  it('handles the app-server ThreadTokenUsage shape', () => {
    const { context } = parseCodexTokenInfo({
      total: { inputTokens: 900_000, cachedInputTokens: 800_000, outputTokens: 9000, totalTokens: 909_000 },
      last: { inputTokens: 120_000, cachedInputTokens: 110_000, outputTokens: 800, totalTokens: 120_800 },
      modelContextWindow: 272_000,
    })
    expect(context?.usedTokens).toBe(120_800)
    expect(context?.contextWindow).toBe(272_000)
  })

  it('never reports a cumulative total that exceeds the window as occupancy', () => {
    const { context, cost } = parseCodexTokenInfo({ total: { inputTokens: 900_000, outputTokens: 1 }, modelContextWindow: 272_000 })
    expect(context).toBeNull()
    expect(cost?.inputTokens).toBe(900_000)
  })

  it('returns nulls for empty input', () => {
    expect(parseCodexTokenInfo(null)).toEqual({ context: null, cost: null })
    expect(parseCodexTokenInfo({ last_token_usage: { input_tokens: 0 } })).toEqual({ context: null, cost: null })
  })
})
