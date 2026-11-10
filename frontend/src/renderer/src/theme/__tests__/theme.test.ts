import { describe, expect, it } from 'vitest'
import {
  LARGE_FONT_TOKENS,
  PALETTE_CAPSULE,
  PALETTE_PRIMARY,
  THEME_PALETTES,
  applyThemeToDom,
  getBaseTheme,
  getIslandThemeConfig,
  getPalettePrimary,
  getShellThemeConfig,
  hasDarkFrame,
  isDarkTheme,
  isLightTheme,
  resolvePalette
} from '..'

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

describe('palette accents', () => {
  it('defines a full accent set for every palette, matching its capsule', () => {
    for (const { key } of THEME_PALETTES) {
      const accent = PALETTE_PRIMARY[key]
      expect(accent.primary).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(accent.primaryHover).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(accent.primaryActive).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(accent.primaryBg).toContain('rgba(')
      expect(accent.primaryBorder).toContain('rgba(')
      expect(accent.primaryShadow).toContain('rgba(')
      expect(PALETTE_CAPSULE[key].activeBg).toBe(accent.primary)
    }
  })

  it('resolves legacy names to their palette accent', () => {
    expect(getPalettePrimary('light').primary).toBe('#2F8F82')
    expect(getPalettePrimary('light-meadow').primary).toBe('#C8881A')
    expect(getPalettePrimary('dark').primary).toBe('#366E78')
    expect(getPalettePrimary('dark-ocean').primary).toBe('#096B9C')
    expect(getPalettePrimary(undefined).primary).toBe('#2F8F82')
  })

  it('feeds the palette primary into shell and island antd tokens', () => {
    const shell = getShellThemeConfig('light-meadow')
    expect(shell.token?.colorPrimary).toBe('#C8881A')
    expect(shell.token?.colorLink).toBe('#C8881A')

    const island = getIslandThemeConfig('dark-ocean')
    expect(island.token?.colorPrimary).toBe('#096B9C')
    expect(island.token?.colorLink).toBe('#096B9C')
    // fixed link shades are dropped so antd derives them from the accent
    expect(island.token).not.toHaveProperty('colorLinkHover')
    expect(island.token).not.toHaveProperty('colorLinkActive')

    expect(getShellThemeConfig('dark').token?.colorBgLayout).toBe('#18191D')
  })

  it('scales tokens and component sizes in large font mode', () => {
    const std = getShellThemeConfig('light')
    expect(std.token?.fontSize).toBe(14)

    const large = getIslandThemeConfig('dark-gunmetal', { largeFont: true })
    expect(large.token?.fontSize).toBe(LARGE_FONT_TOKENS.fontSize)
    expect(large.token?.fontSizeSM).toBe(14.4)
    expect(large.token?.controlHeight).toBe(36)
    expect((large.components?.Menu as { itemHeight?: number }).itemHeight).toBe(42)
    expect((large.components?.Tabs as { titleFontSize?: number }).titleFontSize).toBe(17)
  })

  it('applyThemeToDom sets attributes and accent CSS variables', () => {
    expect(applyThemeToDom('light')).toBe('light-lagoon')
    const root = document.documentElement
    expect(root.getAttribute('data-theme')).toBe('light')
    expect(root.getAttribute('data-palette')).toBe('light-lagoon')
    expect(document.body.getAttribute('data-palette')).toBe('light-lagoon')
    expect(root.style.getPropertyValue('--cb-primary')).toBe('#2F8F82')
    expect(root.style.getPropertyValue('--cb-focus-ring')).toBe('#2F8F82')

    applyThemeToDom('dark-ocean')
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(document.body.getAttribute('data-theme')).toBe('dark')
    expect(root.style.getPropertyValue('--cb-primary')).toBe('#096B9C')
    expect(root.style.getPropertyValue('--cb-primary-hover')).toBe('#0E85BE')
  })
})
