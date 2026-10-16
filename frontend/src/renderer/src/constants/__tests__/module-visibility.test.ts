import { describe, expect, it } from 'vitest'
import { DEFAULT_MODULE_VISIBILITY, normalizeModuleVisibility } from '../module-visibility'

describe('module-visibility', () => {
  it('defaults aiCoding and localEnv to true', () => {
    expect(DEFAULT_MODULE_VISIBILITY.aiCoding).toBe(true)
    expect(DEFAULT_MODULE_VISIBILITY.localEnv).toBe(true)
  })

  it('normalizes undefined or empty value to default visibility', () => {
    expect(normalizeModuleVisibility(null)).toEqual(DEFAULT_MODULE_VISIBILITY)
    expect(normalizeModuleVisibility(undefined)).toEqual(DEFAULT_MODULE_VISIBILITY)
    expect(normalizeModuleVisibility({})).toEqual(DEFAULT_MODULE_VISIBILITY)
  })

  it('keeps every known key, including aiChat and aiAgents', () => {
    const normalized = normalizeModuleVisibility({
      aiChat: false,
      aiAgents: false,
      aiCoding: false,
      aiTerminal: false,
      localEnv: false,
      copiper: true
    })
    expect(normalized).toEqual({
      aiChat: false,
      aiAgents: false,
      aiCoding: false,
      aiTerminal: false,
      localEnv: false,
      copiper: true
    })
  })

  it('ignores non-boolean values and unknown keys', () => {
    const normalized = normalizeModuleVisibility({
      aiChat: 'false',
      aiCoding: null,
      localEnv: 0,
      openClaw: true,
      bogus: true
    })
    expect(normalized).toEqual(DEFAULT_MODULE_VISIBILITY)
    expect(normalized).not.toHaveProperty('openClaw')
    expect(normalized).not.toHaveProperty('bogus')
  })

  it('does not return the shared default object', () => {
    const normalized = normalizeModuleVisibility({})
    normalized.aiCoding = false
    expect(DEFAULT_MODULE_VISIBILITY.aiCoding).toBe(true)
  })
})
