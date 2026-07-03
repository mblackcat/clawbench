import type { ParamDef, ParamType } from '../types/subapp'

const STORAGE_KEY_PREFIX = 'workbench.appParams.'

function getStorageKey(appId: string): string {
  return `${STORAGE_KEY_PREFIX}${appId}`
}

export function coerceParamValue(value: unknown, type: ParamType): unknown {
  if (value === null || value === undefined) return value

  switch (type) {
    case 'boolean':
      if (typeof value === 'boolean') return value
      if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
      return Boolean(value)
    case 'number': {
      if (typeof value === 'number') return value
      const n = Number(value)
      return Number.isNaN(n) ? value : n
    }
    case 'enum':
      return typeof value === 'string' ? value : String(value)
    default:
      return value
  }
}

export function buildManifestDefaultParams(params?: ParamDef[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const param of params ?? []) {
    if (param.default !== undefined) {
      defaults[param.name] = coerceParamValue(param.default, param.type)
    }
  }
  return defaults
}

export function loadSavedAppParams(appId: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(getStorageKey(appId))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export function saveAppParams(appId: string, params: Record<string, unknown>): void {
  try {
    localStorage.setItem(getStorageKey(appId), JSON.stringify(params))
  } catch (error) {
    console.warn('Failed to save app params:', error)
  }
}

export function buildInitialAppParams(appId: string, params?: ParamDef[]): Record<string, unknown> {
  const initial = buildManifestDefaultParams(params)
  const saved = loadSavedAppParams(appId)

  for (const param of params ?? []) {
    if (Object.prototype.hasOwnProperty.call(saved, param.name)) {
      initial[param.name] = coerceParamValue(saved[param.name], param.type)
    }
  }

  return initial
}

