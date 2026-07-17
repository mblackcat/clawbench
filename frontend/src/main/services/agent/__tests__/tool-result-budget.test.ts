import { describe, it, expect } from 'vitest'
import {
  applyToolResultBudget,
  applyToolResultBatchBudget,
  DEFAULT_MAX_TOOL_RESULT_CHARS,
  DEFAULT_MAX_TOOL_RESULTS_BATCH_CHARS,
} from '../tool-result-budget'

describe('applyToolResultBudget (shipped helper)', () => {
  it('passes through short content unchanged', () => {
    const r = applyToolResultBudget('hello world', 100)
    expect(r.truncated).toBe(false)
    expect(r.content).toBe('hello world')
    expect(r.originalLength).toBe(11)
  })

  it('truncates oversized single result below maxChars', () => {
    const huge = 'A'.repeat(DEFAULT_MAX_TOOL_RESULT_CHARS + 5_000)
    const r = applyToolResultBudget(huge)
    expect(r.truncated).toBe(true)
    expect(r.content.length).toBeLessThanOrEqual(DEFAULT_MAX_TOOL_RESULT_CHARS)
    expect(r.content).toContain('truncated')
    expect(r.originalLength).toBe(huge.length)
  })

  it('uses custom maxChars when provided', () => {
    const r = applyToolResultBudget('x'.repeat(500), 200)
    expect(r.truncated).toBe(true)
    expect(r.content.length).toBeLessThanOrEqual(200)
  })
})

describe('applyToolResultBatchBudget (shipped helper)', () => {
  it('shrinks batch when aggregate exceeds budget', () => {
    const results = [
      { id: '1', name: 'a', content: 'X'.repeat(120_000) },
      { id: '2', name: 'b', content: 'Y'.repeat(120_000) },
    ]
    const out = applyToolResultBatchBudget(
      results,
      DEFAULT_MAX_TOOL_RESULT_CHARS,
      DEFAULT_MAX_TOOL_RESULTS_BATCH_CHARS
    )
    const total = out.reduce((s, r) => s + r.content.length, 0)
    expect(total).toBeLessThanOrEqual(DEFAULT_MAX_TOOL_RESULTS_BATCH_CHARS)
    expect(out.some((r) => r.truncated)).toBe(true)
  })
})
