/**
 * Model picker option values used by AI Chat selectors:
 *   - `builtin:<modelId>`            server models (env builtin, or admin system models
 *                                     whose id is `<configId>::<upstreamModelId>`)
 *   - `local:<configId>:<modelId>`   personal model configs
 *
 * Model ids may themselves contain `:` (system model option ids, `qwen2:7b`, …), so only
 * the leading prefix (and, for local, the config id) are split off; the rest is the id.
 */
export type ParsedModelSelectValue =
  | { source: 'builtin'; modelId: string }
  | { source: 'local'; configId: string; modelId: string }

export function parseModelSelectValue(value: string | undefined | null): ParsedModelSelectValue | null {
  if (!value) return null
  if (value.startsWith('builtin:')) {
    const modelId = value.slice('builtin:'.length)
    return modelId ? { source: 'builtin', modelId } : null
  }
  if (value.startsWith('local:')) {
    const rest = value.slice('local:'.length)
    const sep = rest.indexOf(':')
    if (sep <= 0) return null
    const modelId = rest.slice(sep + 1)
    return modelId ? { source: 'local', configId: rest.slice(0, sep), modelId } : null
  }
  return null
}
