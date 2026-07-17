/**
 * Tool-result size budget (Claude Code–inspired).
 * Oversized individual results are truncated with a clear marker so one tool
 * cannot blow the conversation context.
 */

/** Default max characters for a single tool_result content block. */
export const DEFAULT_MAX_TOOL_RESULT_CHARS = 50_000

/** Soft aggregate budget for one parallel batch of tool results. */
export const DEFAULT_MAX_TOOL_RESULTS_BATCH_CHARS = 200_000

export interface BudgetedToolResult {
  id: string
  name?: string
  content: string
  isError?: boolean
  truncated: boolean
  originalLength: number
}

/**
 * Truncate a single tool result string to maxChars.
 * Pure helper — unit-tested; used by executeAgentTool path.
 */
export function applyToolResultBudget(
  content: string,
  maxChars: number = DEFAULT_MAX_TOOL_RESULT_CHARS
): { content: string; truncated: boolean; originalLength: number } {
  const originalLength = content?.length ?? 0
  if (!content || originalLength <= maxChars) {
    return { content: content || '', truncated: false, originalLength }
  }
  const keep = Math.max(0, maxChars - 120)
  const head = content.slice(0, keep)
  const marker =
    `\n\n…[tool result truncated: ${originalLength} → ${keep} chars; ` +
    `full output omitted to protect context budget]`
  return {
    content: head + marker,
    truncated: true,
    originalLength,
  }
}

/**
 * Apply per-item budget, then shrink largest items if the batch exceeds aggregate budget.
 */
export function applyToolResultBatchBudget(
  results: Array<{ id: string; name?: string; content: string; isError?: boolean }>,
  perItemMax: number = DEFAULT_MAX_TOOL_RESULT_CHARS,
  batchMax: number = DEFAULT_MAX_TOOL_RESULTS_BATCH_CHARS
): BudgetedToolResult[] {
  const budgeted: BudgetedToolResult[] = results.map((r) => {
    const applied = applyToolResultBudget(r.content, perItemMax)
    return {
      id: r.id,
      name: r.name,
      content: applied.content,
      isError: r.isError,
      truncated: applied.truncated,
      originalLength: applied.originalLength,
    }
  })

  let total = budgeted.reduce((s, r) => s + r.content.length, 0)
  if (total <= batchMax) return budgeted

  // Shrink largest first until under batch budget
  const order = budgeted
    .map((r, i) => ({ i, len: r.content.length }))
    .sort((a, b) => b.len - a.len)

  for (const { i } of order) {
    if (total <= batchMax) break
    const r = budgeted[i]
    const excess = total - batchMax
    const target = Math.max(2_000, r.content.length - excess)
    if (r.content.length <= target) continue
    const applied = applyToolResultBudget(r.content, target)
    total -= r.content.length - applied.content.length
    budgeted[i] = {
      ...r,
      content: applied.content,
      truncated: true,
      originalLength: r.originalLength || r.content.length,
    }
  }

  return budgeted
}
