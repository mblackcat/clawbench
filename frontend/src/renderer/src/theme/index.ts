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

/**
 * App UI face: Inter for Latin, then system UI / CJK stacks.
 * Inter is loaded via @fontsource in main.tsx (weights 300/400/500).
 * Light UI uses Regular (400) for readability; dark keeps Light (300) so
 * bright-on-dark text does not look optically heavy. Strong text is one step up.
 */
export const FONT_FAMILY =
  "'Inter', 'Segoe UI Variable Text', 'Segoe UI Variable', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif"

export const BRAND_PRIMARY = '#546DF5'

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
  colorPrimary: '#6B7DFF',
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
  colorPrimary: BRAND_PRIMARY,
  colorBgLayout: '#18191D',
  colorBgContainer: '#222328',
  colorBgElevated: '#2A2B32',
  colorBorder: 'rgba(255, 255, 255, 0.08)',
  colorBorderSecondary: 'rgba(255, 255, 255, 0.05)',
  colorText: '#F0F1F5',
  colorTextSecondary: '#8E929E',
  fontWeightStrong: 500,
}

export const componentOverrides = {
  Button: {
    borderRadius: 8,
    borderRadiusLG: 10,
    borderRadiusSM: 6,
    paddingInline: 16,
    fontWeight: 500,
  },
  Menu: {
    itemBorderRadius: 8,
    itemMarginInline: 6,
    itemHeight: 38,
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
    titleFontSize: 14,
  },
  Tag: {
    // Capsule tags
    borderRadiusSM: 100,
  },
}

function tagOverrides(dark: boolean): Record<string, unknown> {
  return {
    ...componentOverrides.Tag,
    ...(dark
      ? { defaultBg: 'rgba(255, 255, 255, 0.08)', defaultColor: '#C9CCD4' }
      : { defaultBg: 'rgba(0, 0, 0, 0.04)', defaultColor: '#5C6370' }),
  }
}

/** Outer (shell) ConfigProvider theme. */
export function getShellThemeConfig(name: string | null | undefined): ThemeConfig {
  const dark = isDarkTheme(name)
  return {
    algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: dark ? shellDarkTokens : lightTokens,
    components: { ...componentOverrides, Tag: tagOverrides(dark) },
  }
}

/** Content-island ConfigProvider theme (page surface inside the frame). */
export function getIslandThemeConfig(name: string | null | undefined): ThemeConfig {
  const dark = isDarkTheme(name)
  return {
    algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: dark ? darkTokens : lightTokens,
    components: { ...componentOverrides, Tag: tagOverrides(dark) },
  }
}
