import type { ParamDef } from '../types/subapp'

export interface DynamicOptionsResult {
  options: string[]
  default?: string
}

export type DynamicOptionsErrorCode = 'invalid' | 'empty'

export class DynamicOptionsError extends Error {
  readonly code: DynamicOptionsErrorCode

  constructor(code: DynamicOptionsErrorCode, message: string) {
    super(message)
    this.name = 'DynamicOptionsError'
    this.code = code
  }
}

const dynamicOptionsCache = new Map<string, DynamicOptionsResult>()

function cloneResult(result: DynamicOptionsResult): DynamicOptionsResult {
  return result.default === undefined
    ? { options: [...result.options] }
    : { options: [...result.options], default: result.default }
}

export function parseDynamicOptionsResult(data: unknown): DynamicOptionsResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new DynamicOptionsError('invalid', 'Dynamic options result must be an object')
  }

  const raw = data as Record<string, unknown>
  if (!Array.isArray(raw.options)) {
    throw new DynamicOptionsError('invalid', 'Dynamic options must be an array')
  }
  if (raw.options.length === 0) {
    throw new DynamicOptionsError('empty', 'Dynamic options are empty')
  }
  if (
    raw.options.some(
      (option) => typeof option !== 'string' || option.trim().length === 0
    )
  ) {
    throw new DynamicOptionsError(
      'invalid',
      'Dynamic options must contain non-empty strings'
    )
  }

  const options = Array.from(new Set(raw.options as string[]))
  const defaultValue =
    typeof raw.default === 'string' && options.includes(raw.default)
      ? raw.default
      : undefined

  return defaultValue === undefined
    ? { options }
    : { options, default: defaultValue }
}

export function buildDynamicOptionsCacheKey(
  appId: string,
  version: string,
  param: Pick<ParamDef, 'name' | 'options_slot'>
): string {
  return JSON.stringify([
    appId,
    version,
    param.name,
    param.options_slot?.trim() || ''
  ])
}

export function getDynamicOptionsCache(key: string): DynamicOptionsResult | undefined {
  const cached = dynamicOptionsCache.get(key)
  return cached ? cloneResult(cached) : undefined
}

export function setDynamicOptionsCache(
  key: string,
  result: DynamicOptionsResult
): void {
  dynamicOptionsCache.set(key, cloneResult(result))
}

export function clearDynamicOptionsCache(): void {
  dynamicOptionsCache.clear()
}

export function reconcileDynamicOptionValue(
  currentValue: unknown,
  result: DynamicOptionsResult
): string | undefined {
  if (
    typeof currentValue === 'string' &&
    result.options.includes(currentValue)
  ) {
    return currentValue
  }
  return result.default ?? result.options[0]
}
