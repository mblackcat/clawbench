/**
 * App theme module: antd design tokens, color palettes and theme-name helpers.
 *
 * Lives outside App.tsx so layout components (e.g. the content-island
 * ConfigProvider in AppLayout) can import tokens without a circular import.
 *
 * Theme names stored in settings (`useSettingsStore.theme`):
 *   - palette names: `light-lagoon` | `light-meadow` | `dark-gunmetal` | `dark-ocean`
 *   - legacy names:  `light` (= light-lagoon) | `dark` (= dark-gunmetal)
 * Always use the helpers below (`isDarkTheme` / `getBaseTheme`) instead of
 * comparing against `'dark'` / `'light'`, so palette variants work everywhere.
 */
import { theme as antTheme, type ThemeConfig } from 'antd'

export type BaseTheme = 'light' | 'dark'
export type ThemePalette = 'light-lagoon' | 'light-meadow' | 'dark-gunmetal' | 'dark-ocean'

/** Palettes in picker order, with their legacy alias (if any) */
export const THEME_PALETTES: ReadonlyArray<{ key: ThemePalette; alias?: BaseTheme }> = [
  { key: 'light-lagoon', alias: 'light' },
  { key: 'light-meadow' },
  { key: 'dark-gunmetal', alias: 'dark' },
  { key: 'dark-ocean' }
]

/** True for `dark` and any `dark-*` palette. Unknown/empty values are light (OSS default). */
export function isDarkTheme(name: string | null | undefined): boolean {
  const n = (name || '').trim().toLowerCase()
  return n === 'dark' || n.startsWith('dark-')
}

/** True for `light`, any `light-*` palette and unknown/empty values. */
export function isLightTheme(name: string | null | undefined): boolean {
  return !isDarkTheme(name)
}

/** Base theme used for `data-theme` (CSS) and the antd algorithm. */
export function getBaseTheme(name: string | null | undefined): BaseTheme {
  return isDarkTheme(name) ? 'dark' : 'light'
}

/** Normalizes legacy names to their palette (`light` → `light-lagoon`, `dark` → `dark-gunmetal`). */
export function resolvePalette(name: string | null | undefined): ThemePalette {
  const n = (name || '').trim().toLowerCase()
  const match = THEME_PALETTES.find((p) => p.key === n)
  if (match) return match.key
  return isDarkTheme(n) ? 'dark-gunmetal' : 'light-lagoon'
}

/** Whether the palette uses the dark outer frame (sidebar / topbar chrome). */
export function hasDarkFrame(name: string | null | undefined): boolean {
  return resolvePalette(name) !== 'light-lagoon'
}

/** Outer frame color per palette (matches `.cb-layout-root` in theme-overhaul.css). */
export const PALETTE_FRAME_BG: Record<ThemePalette, string> = {
  'light-lagoon': '#DFE3E9',
  'light-meadow': '#18191D',
  'dark-gunmetal': '#131417',
  'dark-ocean': '#131417'
}

/** Swatch colors for the palette picker (frame / accent halves). */
export const PALETTE_SWATCH: Record<ThemePalette, { base: string; accent: string; stroke: string }> = {
  'light-lagoon': { base: '#7AC5B9', accent: '#FBE39B', stroke: 'rgba(0,0,0,0.15)' },
  'light-meadow': { base: '#BFDFE2', accent: '#FFD87B', stroke: 'rgba(0,0,0,0.15)' },
  'dark-gunmetal': { base: '#20373B', accent: '#FFC64F', stroke: 'rgba(255,255,255,0.2)' },
  'dark-ocean': { base: '#053F5C', accent: '#F7AD19', stroke: 'rgba(255,255,255,0.2)' }
}

export interface CapsuleStyle {
  activeBg: string
  activeColor: string
  trackBg: string
  inactiveColor: string
}

/** TopBar capsule (mode / language / motion switches) colors per palette. */
export const PALETTE_CAPSULE: Record<ThemePalette, CapsuleStyle> = {
  'light-lagoon': {
    activeBg: '#2F8F82',
    activeColor: '#FFFFFF',
    trackBg: 'rgba(0, 0, 0, 0.08)',
    inactiveColor: '#4B5262'
  },
  'light-meadow': {
    activeBg: '#C8881A',
    activeColor: '#FFFFFF',
    trackBg: 'rgba(255, 255, 255, 0.10)',
    inactiveColor: 'rgba(255, 255, 255, 0.70)'
  },
  'dark-gunmetal': {
    activeBg: '#366E78',
    activeColor: '#FFFFFF',
    trackBg: 'rgba(255, 255, 255, 0.10)',
    inactiveColor: 'rgba(255, 255, 255, 0.70)'
  },
  'dark-ocean': {
    activeBg: '#096B9C',
    activeColor: '#FFFFFF',
    trackBg: 'rgba(255, 255, 255, 0.10)',
    inactiveColor: 'rgba(255, 255, 255, 0.70)'
  }
}

/** Accent (antd colorPrimary + CSS --cb-primary*) per palette. */
export interface PalettePrimary {
  /** Main brand / primary color */
  primary: string
  /** Hover state for primary buttons and interactive items */
  primaryHover: string
  /** Active / pressed state for primary buttons */
  primaryActive: string
  /** Low-opacity background tint */
  primaryBg: string
  /** Subtle border using the primary hue */
  primaryBorder: string
  /** Focus ring / glow shadow */
  primaryShadow: string
}

export const PALETTE_PRIMARY: Record<ThemePalette, PalettePrimary> = {
  'light-lagoon': {
    primary: '#2F8F82',
    primaryHover: '#38A697',
    primaryActive: '#26776C',
    primaryBg: 'rgba(47, 143, 130, 0.10)',
    primaryBorder: 'rgba(47, 143, 130, 0.28)',
    primaryShadow: 'rgba(47, 143, 130, 0.20)'
  },
  'light-meadow': {
    primary: '#C8881A',
    primaryHover: '#DCA02C',
    primaryActive: '#B27713',
    primaryBg: 'rgba(200, 136, 26, 0.10)',
    primaryBorder: 'rgba(200, 136, 26, 0.28)',
    primaryShadow: 'rgba(200, 136, 26, 0.20)'
  },
  'dark-gunmetal': {
    primary: '#366E78',
    primaryHover: '#458793',
    primaryActive: '#2C5A62',
    primaryBg: 'rgba(54, 110, 120, 0.18)',
    primaryBorder: 'rgba(54, 110, 120, 0.35)',
    primaryShadow: 'rgba(54, 110, 120, 0.30)'
  },
  'dark-ocean': {
    primary: '#096B9C',
    primaryHover: '#0E85BE',
    primaryActive: '#07557C',
    primaryBg: 'rgba(9, 107, 156, 0.20)',
    primaryBorder: 'rgba(9, 107, 156, 0.40)',
    primaryShadow: 'rgba(9, 107, 156, 0.35)'
  }
}

/** Accent colors for a stored theme name (legacy names resolve to their palette). */
export function getPalettePrimary(name: string | null | undefined): PalettePrimary {
  return PALETTE_PRIMARY[resolvePalette(name)]
}

/**
 * App UI face: Inter for Latin, then system UI / CJK stacks.
 * Inter is loaded via @fontsource in main.tsx (weights 300/400/500).
 * Light UI uses Regular (400) for readability; dark keeps Light (300) so
 * bright-on-dark text does not look optically heavy. Strong text is one step up.
 */
export const FONT_FAMILY =
  "'Inter', 'Segoe UI Variable Text', 'Segoe UI Variable', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif"

/** Default accent (light-lagoon); every palette overrides it via PALETTE_PRIMARY. */
export const BRAND_PRIMARY = '#2F8F82'

export const lightTokens = {
  colorPrimary: BRAND_PRIMARY,
  borderRadius: 8,
  borderRadiusLG: 12,
  borderRadiusSM: 6,
  colorBgLayout: '#FFFFFF',
  colorBgContainer: '#FFFFFF',
  colorBgElevated: '#FFFFFF',
  // Near-black slate — high contrast on light surfaces (also drives caret-color)
  colorText: '#181A20',
  colorTextSecondary: '#6B717E',
  colorTextTertiary: '#9BA1AE',
  colorTextQuaternary: '#C2C6CF',
  colorBorder: 'rgba(0, 0, 0, 0.06)',
  colorBorderSecondary: 'rgba(0, 0, 0, 0.03)',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
  boxShadowSecondary: '0 1px 4px rgba(0, 0, 0, 0.02)',
  fontFamily: FONT_FAMILY,
  fontWeightStrong: 600,
}

export const darkTokens = {
  colorPrimary: '#366E78',
  borderRadius: 8,
  borderRadiusLG: 12,
  borderRadiusSM: 6,
  colorBgLayout: '#202127',
  colorBgContainer: '#202127',
  colorBgElevated: '#282932',
  // Slightly softer than pure near-white — reduces optical "bold" on dark surfaces
  colorText: '#DDDEE3',
  colorTextSecondary: '#A0A3AD',
  colorTextTertiary: '#787B86',
  colorTextQuaternary: '#5C5E68',
  colorLink: '#6BA8FF',
  colorLinkHover: '#8FBEFF',
  colorLinkActive: '#5A9AEE',
  colorBorder: 'rgba(255, 255, 255, 0.08)',
  colorBorderSecondary: 'rgba(255, 255, 255, 0.05)',
  boxShadow: '0 2px 12px rgba(0, 0, 0, 0.30)',
  boxShadowSecondary: '0 1px 6px rgba(0, 0, 0, 0.25)',
  fontFamily: FONT_FAMILY,
  fontWeightStrong: 400,
}

/** Dark shell chrome (topbar / sidebar / drawers / dropdowns outside the content island) */
export const shellDarkTokens = {
  ...darkTokens,
  colorPrimary: '#366E78',
  colorBgLayout: '#18191D',
  colorBgContainer: '#222328',
  colorBgElevated: '#2A2B32',
  colorBorder: 'rgba(255, 255, 255, 0.08)',
  colorBorderSecondary: 'rgba(255, 255, 255, 0.05)',
  colorText: '#F0F1F5',
  colorTextSecondary: '#8E929E',
  fontWeightStrong: 500,
}

/** antd tokens for the enlarged (+20%) font-size mode (see constants/font-size.ts). */
export const LARGE_FONT_TOKENS = {
  fontSize: 16.8,
  fontSizeSM: 14.4,
  fontSizeLG: 19.2,
  fontSizeXL: 24,
  fontSizeHeading1: 45.6,
  fontSizeHeading2: 36,
  fontSizeHeading3: 28.8,
  fontSizeHeading4: 24,
  fontSizeHeading5: 19.2,
  controlHeight: 36,
}

export interface ThemeOptions {
  /** Enlarged (+20%) font-size mode */
  largeFont?: boolean
}

export function getComponentOverrides(largeFont = false) {
  return {
    Button: {
      borderRadius: 8,
      borderRadiusLG: 10,
      borderRadiusSM: 6,
      paddingInline: largeFont ? 18 : 16,
      fontWeight: 500,
    },
    Menu: {
      itemBorderRadius: 8,
      itemMarginInline: 6,
      itemHeight: largeFont ? 42 : 38,
    },
    Input: {
      borderRadius: 8,
    },
    Select: {
      borderRadius: 8,
    },
    Modal: {
      borderRadiusLG: 12,
    },
    Drawer: {
      borderRadiusLG: 12,
    },
    Card: {
      borderRadiusLG: 12,
    },
    Table: {
      borderRadius: 8,
    },
    Tabs: {
      titleFontSize: largeFont ? 17 : 14,
    },
    Tag: {
      // Capsule tags
      borderRadiusSM: 100,
    },
  }
}

export const componentOverrides = getComponentOverrides(false)

/**
 * Applies a palette accent (primary + link colors) and the font-size mode to a
 * token set. Dark tokens drop their fixed link hover/active shades so antd
 * derives them from the palette primary.
 */
function withPalette<T extends Record<string, unknown>>(
  base: T,
  name: string | null | undefined,
  opts: ThemeOptions = {}
): Record<string, unknown> {
  const { colorLinkHover: _hover, colorLinkActive: _active, ...rest } = base as Record<string, unknown>
  const { primary } = getPalettePrimary(name)
  return {
    ...rest,
    colorPrimary: primary,
    colorLink: primary,
    ...(opts.largeFont ? LARGE_FONT_TOKENS : { fontSize: 14 }),
  }
}

function tagOverrides(dark: boolean, largeFont = false): Record<string, unknown> {
  return {
    ...getComponentOverrides(largeFont).Tag,
    ...(dark
      ? { defaultBg: 'rgba(255, 255, 255, 0.08)', defaultColor: '#C9CCD4' }
      : { defaultBg: 'rgba(0, 0, 0, 0.04)', defaultColor: '#5C6370' }),
  }
}

/** Outer (shell) ConfigProvider theme. */
export function getShellThemeConfig(name: string | null | undefined, opts: ThemeOptions = {}): ThemeConfig {
  const dark = isDarkTheme(name)
  const largeFont = !!opts.largeFont
  return {
    algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: withPalette(dark ? shellDarkTokens : lightTokens, name, opts),
    components: { ...getComponentOverrides(largeFont), Tag: tagOverrides(dark, largeFont) },
  }
}

/** Content-island ConfigProvider theme (page surface inside the frame). */
export function getIslandThemeConfig(name: string | null | undefined, opts: ThemeOptions = {}): ThemeConfig {
  const dark = isDarkTheme(name)
  const largeFont = !!opts.largeFont
  return {
    algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: withPalette(dark ? darkTokens : lightTokens, name, opts),
    components: { ...getComponentOverrides(largeFont), Tag: tagOverrides(dark, largeFont) },
  }
}

/**
 * Applies the theme to the document: `data-theme` (base) / `data-palette` on
 * <html> and <body>, the outer frame background, caret color and the palette
 * accent CSS variables (`--cb-primary*`, `--cb-focus-ring`) used by
 * theme-overhaul.css / motion.css.
 */
export function applyThemeToDom(name: string | null | undefined): ThemePalette {
  const palette = resolvePalette(name)
  if (typeof document === 'undefined') return palette
  const base = getBaseTheme(name)
  const accent = PALETTE_PRIMARY[palette]
  const root = document.documentElement
  const body = document.body

  root.setAttribute('data-theme', base)
  root.setAttribute('data-palette', palette)
  if (body) {
    body.setAttribute('data-theme', base)
    body.setAttribute('data-palette', palette)
    // Match the outer frame so route switches never flash a different color
    body.style.background = PALETTE_FRAME_BG[palette]
    // Keep caret aligned with primary text color — light-mode inputs otherwise
    // inherit a washed-out caret that vanishes.
    body.style.caretColor = base === 'dark' ? darkTokens.colorText : lightTokens.colorText
  }

  root.style.setProperty('--cb-primary', accent.primary)
  root.style.setProperty('--cb-primary-hover', accent.primaryHover)
  root.style.setProperty('--cb-primary-active', accent.primaryActive)
  root.style.setProperty('--cb-primary-bg', accent.primaryBg)
  root.style.setProperty('--cb-primary-border', accent.primaryBorder)
  root.style.setProperty('--cb-primary-shadow', accent.primaryShadow)
  root.style.setProperty('--cb-focus-ring', accent.primary)
  return palette
}
