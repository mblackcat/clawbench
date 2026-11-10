/**
 * Codex token-usage normalization shared by the live app-server session
 * manager and the on-disk rollout reader.
 *
 * Codex semantics (verified against ~/.codex/sessions rollouts):
 *  - `total_token_usage` / `total` is CUMULATIVE over the whole thread — fine
 *    for cost, wrong for context occupancy (it grows past the window fast).
 *  - `last_token_usage` / `last` is the latest request — the real occupancy.
 *  - `cached_input_tokens` is a SUBSET of `input_tokens` (OpenAI semantics),
 *    and `total_tokens = input_tokens + output_tokens`.
 *  - The window is `model_context_window` / `modelContextWindow`.
 *
 * Output follows the app-wide convention where `inputTokens` is the UNCACHED
 * part, so `inputTokens + cachedInputTokens + outputTokens === usedTokens`.
 */

export const CODEX_DEFAULT_CONTEXT_WINDOW = 200_000

export interface NormalizedUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  usedTokens: number
  contextWindow?: number
}

function num(...vals: unknown[]): number | undefined {
  for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return v
  return undefined
}

/** One Codex usage breakdown (snake_case or camelCase) → normalized usage, or null if empty. */
export function normalizeCodexBreakdown(b: any): NormalizedUsage | null {
  if (!b || typeof b !== 'object') return null
  const input = num(b.input_tokens, b.inputTokens) ?? 0
  const cachedRaw = num(b.cached_input_tokens, b.cachedInputTokens, b.cache_read_input_tokens) ?? 0
  const output = num(b.output_tokens, b.outputTokens) ?? 0
  const total = num(b.total_tokens, b.totalTokens)
  if (!input && !cachedRaw && !output && !total) return null
  const cached = Math.min(cachedRaw, input)
  return {
    inputTokens: input - cached,
    cachedInputTokens: cached,
    outputTokens: output,
    usedTokens: total && total > 0 ? total : input + output,
  }
}

/**
 * Codex token info → { context, cost }.
 * Accepts the rollout `token_count.info` shape ({ total_token_usage, last_token_usage, model_context_window })
 * and the app-server `ThreadTokenUsage` shape ({ total, last, modelContextWindow }).
 */
export function parseCodexTokenInfo(info: any): { context: NormalizedUsage | null; cost: NormalizedUsage | null } {
  if (!info || typeof info !== 'object') return { context: null, cost: null }
  const last = info.last_token_usage ?? info.last
  const total = info.total_token_usage ?? info.total
  const window = num(info.model_context_window, info.modelContextWindow, total?.contextWindow, total?.context_window)
  const cost = normalizeCodexBreakdown(total) ?? normalizeCodexBreakdown(last)
  // Without a per-request breakdown, a cumulative total is NOT occupancy — only
  // accept it when it is the sole source and still fits the window.
  let context = normalizeCodexBreakdown(last)
  if (!context && cost && (!window || cost.usedTokens <= window)) context = { ...cost }
  if (context) context.contextWindow = window && window > 0 ? window : CODEX_DEFAULT_CONTEXT_WINDOW
  return { context, cost }
}

/** USD estimate from a normalized (uncached-input) cumulative usage. */
export function computeCodexCost(model: string, usage: Partial<NormalizedUsage> | null | undefined): number {
  const m = (model || '').toLowerCase()
  const inRate = m.includes('o3-mini') ? 1.10 : m.includes('o1') ? 15.00 : 2.50
  const cacheRate = inRate / 2
  const outRate = m.includes('o3-mini') ? 4.40 : m.includes('o1') ? 60.00 : 10.00
  const inTok = Number(usage?.inputTokens || 0)
  const cachedTok = Number(usage?.cachedInputTokens || 0)
  const outTok = Number(usage?.outputTokens || 0)
  return (inTok * inRate + cachedTok * cacheRate + outTok * outRate) / 1_000_000
}
