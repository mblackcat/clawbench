import { describe, expect, it } from 'vitest'
import { getBaseTheme, hasDarkFrame, isDarkTheme, isLightTheme, resolvePalette } from '..'

describe('theme helpers', () => {
  it('detects dark themes including palettes', () => {
    expect(isDarkTheme('dark')).toBe(true)
    expect(isDarkTheme('dark-gunmetal')).toBe(true)
    expect(isDarkTheme('dark-ocean')).toBe(true)
    expect(isDarkTheme('light')).toBe(false)
    expect(isDarkTheme('light-meadow')).toBe(false)
    expect(isDarkTheme('')).toBe(false)
    expect(isDarkTheme(undefined)).toBe(false)
    expect(isLightTheme('light-lagoon')).toBe(true)
  })

  it('maps to base theme', () => {
    expect(getBaseTheme('dark-ocean')).toBe('dark')
    expect(getBaseTheme('light-meadow')).toBe('light')
    expect(getBaseTheme('weird')).toBe('light')
  })

  it('resolves legacy names to palettes', () => {
    expect(resolvePalette('light')).toBe('light-lagoon')
    expect(resolvePalette('dark')).toBe('dark-gunmetal')
    expect(resolvePalette('dark-ocean')).toBe('dark-ocean')
    expect(resolvePalette('dark-unknown')).toBe('dark-gunmetal')
    expect(resolvePalette(null)).toBe('light-lagoon')
  })

  it('only light-lagoon uses the light frame', () => {
    expect(hasDarkFrame('light')).toBe(false)
    expect(hasDarkFrame('light-meadow')).toBe(true)
    expect(hasDarkFrame('dark')).toBe(true)
  })
})
