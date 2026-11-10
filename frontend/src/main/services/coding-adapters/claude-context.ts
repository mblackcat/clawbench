/**
 * Claude context-window helpers shared by the live SDK stream adapter and the
 * on-disk transcript readers.
 *
 * Context occupancy must come from a SINGLE API request's usage (the latest
 * one), never from the `result` message's aggregate usage, which sums every
 * request of an agentic turn and easily exceeds the window.
 */

export const CLAUDE_DEFAULT_CONTEXT_WINDOW = 200_000
export const CLAUDE_1M_CONTEXT_WINDOW = 1_000_000

/** True when a model id / alias explicitly selects the 1M context variant (e.g. `sonnet[1m]`, `claude-sonnet-4-5[1m]`). */
export function isClaude1MModel(model?: string): boolean {
  if (!model) return false
  return /\[1m\]/i.test(model) || /(?:^|[-_ ])1m$/i.test(model.trim())
}

/** Family aliases Claude Code accepts in place of a full model id (`opus`, `sonnet[1m]`, …). */
const CLAUDE_MODEL_FAMILIES = new Set(['opus', 'sonnet', 'haiku', 'fable'])

/** Model id Claude Code writes on locally generated assistant lines (API errors, interrupts). */
export function isSyntheticClaudeModel(model?: string): boolean {
  return model === '<synthetic>'
}

/** Comparable form: lower-case, no `[1m]`, no provider prefix (`anthropic/`, `us.anthropic.`), no date / Bedrock version suffix. */
function normalizeClaudeModelId(model: string): string {
  let m = model.trim().replace(/\[1m\]$/i, '').trim().toLowerCase()
  m = m.slice(m.lastIndexOf('/') + 1)
  const vendor = m.lastIndexOf('anthropic.')
  if (vendor >= 0) m = m.slice(vendor + 'anthropic.'.length)
  return m.replace(/-v\d+(?::\d+)?$/, '').replace(/-\d{8}$/, '')
}

/**
 * True when `configured` (settings / `system/init` model, may carry `[1m]`)
 * describes the model the API reported as `observed`. API responses and
 * on-disk transcripts never carry the `[1m]` suffix, so the configured model is
 * the only 1M signal there — but it must not leak onto a session that actually
 * ran on another model (e.g. after `/model haiku`). No observation → applies.
 */
export function claudeModelMatches(configured?: string, observed?: string): boolean {
  if (!configured) return false
  if (!observed) return true
  const c = normalizeClaudeModelId(configured)
  const o = normalizeClaudeModelId(observed)
  if (!c || !o) return false
  if (c === o) return true
  const family = c === 'opusplan' ? 'opus' : c
  return CLAUDE_MODEL_FAMILIES.has(family) && o.includes(family)
}

/**
 * Picks the context window for a Claude session.
 * Priority: window reported by the SDK (`modelUsage[*].contextWindow`) →
 * explicit 1M model id → observed usage above 200k (must be a 1M session) →
 * 200k default.
 */
export function resolveClaudeContextWindow(opts: {
  models?: Array<string | undefined>
  reported?: number
  usedTokens?: number
}): number {
  const used = opts.usedTokens || 0
  let win = opts.reported && opts.reported > 0 ? opts.reported : 0
  if (!win) {
    win = (opts.models || []).some(isClaude1MModel) ? CLAUDE_1M_CONTEXT_WINDOW : CLAUDE_DEFAULT_CONTEXT_WINDOW
  }
  if (used > win && win < CLAUDE_1M_CONTEXT_WINDOW) win = CLAUDE_1M_CONTEXT_WINDOW
  return win
}

/** Raw Anthropic usage (snake_case) → context occupancy of that single request. */
export function claudeRequestUsage(u: any): {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  usedTokens?: number
} | null {
  if (!u || typeof u !== 'object') return null
  const inputTokens = typeof u.input_tokens === 'number' ? u.input_tokens : undefined
  const outputTokens = typeof u.output_tokens === 'number' ? u.output_tokens : undefined
  const cacheRead = typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0
  const cacheCreate = typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : 0
  const cached = cacheRead + cacheCreate || undefined
  if (inputTokens === undefined && outputTokens === undefined && cached === undefined) return null
  const used = (inputTokens || 0) + (cached || 0) + (outputTokens || 0) || undefined
  return { inputTokens, cachedInputTokens: cached, outputTokens, usedTokens: used }
}

/** Largest `contextWindow` reported in an SDK result's `modelUsage` map (0 if absent). */
export function reportedContextWindow(modelUsage: unknown, model?: string): number {
  if (!modelUsage || typeof modelUsage !== 'object') return 0
  const entries = modelUsage as Record<string, { contextWindow?: unknown }>
  const pick = (v: { contextWindow?: unknown } | undefined): number =>
    v && typeof v.contextWindow === 'number' && v.contextWindow > 0 ? v.contextWindow : 0
  if (model && entries[model]) {
    const w = pick(entries[model])
    if (w) return w
  }
  // Fall back to the main (largest-window) model; sub-agents like Haiku may also appear here.
  return Object.values(entries).reduce((max, v) => Math.max(max, pick(v)), 0)
}
