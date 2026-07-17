/**
 * Claude thinking parameter selection (manual enabled vs adaptive + effort).
 * Pure helpers — unit-tested without Anthropic SDK.
 */

export type ClaudeThinkingMode = 'adaptive' | 'enabled' | 'off'

/**
 * Newer Claude models reject thinking.type=enabled and require adaptive + output_config.effort.
 */
export function shouldUseAdaptiveThinking(modelId: string): boolean {
  const m = (modelId || '').toLowerCase()
  if (/4[.-]?[5-9]|opus-4|sonnet-4|haiku-4|mythos|fable|sonnet-5|opus-5/.test(m)) {
    return true
  }
  // Default adaptive for unknown modern Claude ids (safer than 400 on type.enabled)
  if (m.includes('claude') && !/3[.-]?[05]|3-opus|3-sonnet|3-haiku|2[.-]/.test(m)) {
    return true
  }
  return false
}

/**
 * Apply thinking fields onto a Claude Messages request params object.
 * @param forceAlternate flip adaptive ↔ enabled (retry after 400)
 */
export function applyClaudeThinkingParams(
  params: Record<string, any>,
  modelId: string,
  enableThinking: boolean,
  forceAlternate = false
): ClaudeThinkingMode {
  if (!enableThinking) {
    delete params.thinking
    if (params.output_config) {
      const { effort: _e, ...rest } = params.output_config
      void _e
      if (Object.keys(rest).length === 0) delete params.output_config
      else params.output_config = rest
    }
    return 'off'
  }
  const preferAdaptive = forceAlternate
    ? !shouldUseAdaptiveThinking(modelId)
    : shouldUseAdaptiveThinking(modelId)
  if (preferAdaptive) {
    params.thinking = { type: 'adaptive' }
    params.output_config = { ...(params.output_config || {}), effort: 'high' }
    return 'adaptive'
  }
  params.thinking = { type: 'enabled', budget_tokens: 10000 }
  if (params.output_config?.effort) {
    const { effort: _e, ...rest } = params.output_config
    void _e
    if (Object.keys(rest).length === 0) delete params.output_config
    else params.output_config = rest
  }
  return 'enabled'
}
