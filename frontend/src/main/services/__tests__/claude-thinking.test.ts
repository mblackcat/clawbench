import { describe, it, expect } from 'vitest'
import { applyClaudeThinkingParams, shouldUseAdaptiveThinking } from '../claude-thinking'

describe('shouldUseAdaptiveThinking', () => {
  it('uses adaptive for modern Claude 4.x / 4.6 ids', () => {
    expect(shouldUseAdaptiveThinking('claude-opus-4-6')).toBe(true)
    expect(shouldUseAdaptiveThinking('claude-sonnet-4-5-20250929')).toBe(true)
    expect(shouldUseAdaptiveThinking('claude-sonnet-4-20250514')).toBe(true)
  })

  it('keeps enabled for classic Claude 3 family', () => {
    expect(shouldUseAdaptiveThinking('claude-3-5-sonnet-20241022')).toBe(false)
    expect(shouldUseAdaptiveThinking('claude-3-opus-20240229')).toBe(false)
  })
})

describe('applyClaudeThinkingParams (shipped)', () => {
  it('sets adaptive + effort for modern models', () => {
    const params: Record<string, any> = { model: 'claude-opus-4-6' }
    const mode = applyClaudeThinkingParams(params, 'claude-opus-4-6', true)
    expect(mode).toBe('adaptive')
    expect(params.thinking).toEqual({ type: 'adaptive' })
    expect(params.output_config?.effort).toBe('high')
  })

  it('sets enabled+budget for Claude 3.5', () => {
    const params: Record<string, any> = {}
    const mode = applyClaudeThinkingParams(params, 'claude-3-5-sonnet-20241022', true)
    expect(mode).toBe('enabled')
    expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: 10000 })
  })

  it('forceAlternate flips adaptive to enabled', () => {
    const params: Record<string, any> = {}
    applyClaudeThinkingParams(params, 'claude-opus-4-6', true)
    expect(params.thinking.type).toBe('adaptive')
    applyClaudeThinkingParams(params, 'claude-opus-4-6', true, true)
    expect(params.thinking.type).toBe('enabled')
  })
})
