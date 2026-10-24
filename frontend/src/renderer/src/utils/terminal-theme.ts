import type { ITheme } from '@xterm/xterm'

/**
 * Shared geometry for every xterm surface in the app.
 *
 * `LINE_HEIGHT` used to differ per host (AI Coding ran 1.2, AI Terminal 1.4).
 * The 1.2 value is what made TUI output — omp's status line especially — read
 * as cramped once Nerd Font chrome landed. One value keeps the two surfaces
 * visually consistent and gives the glyphs room to breathe.
 */
const IS_MAC = typeof window !== 'undefined' && window.api?.platform === 'darwin'

/**
 * macOS mirrors a Ghostty setup (JetBrainsMono Nerd Font 12, adjust-cell-height
 * 2): the face's 1.32em box is ~16px at 12px, +2px → 1.15. Windows keeps the
 * Consolas-era geometry.
 */
export const TERMINAL_FONT_SIZE = IS_MAC ? 12 : 13
export const TERMINAL_LINE_HEIGHT = IS_MAC ? 1.15 : 1.35

/**
 * Dark palette aligned with Windows Terminal / VS Code Dark+.
 *
 * `black` matches `background` on purpose: TUI tools that paint "default bg"
 * in some regions and "ANSI black" in others (Grok panels, omp input chrome)
 * would otherwise leave mismatched bands.
 */
export const TERMINAL_THEME_CODING: ITheme = {
  background: '#0c0c0c',
  foreground: '#cccccc',
  cursor: '#ffffff',
  cursorAccent: '#0c0c0c',
  selectionBackground: '#264f78',
  black: '#0c0c0c',
  red: '#f44747',
  green: '#23d18b',
  yellow: '#e5c07b',
  blue: '#4daafc',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#e74856',
  brightGreen: '#16c60c',
  brightYellow: '#f9f1a5',
  brightBlue: '#79c0ff',
  brightMagenta: '#b4009e',
  brightCyan: '#61d6d6',
  brightWhite: '#f2f2f2'
}

/** VS Code Dark+ palette used by the AI Terminal shell surfaces. */
export const TERMINAL_THEME_SHELL: ITheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#1e1e1e',
  red: '#f44747',
  green: '#6a9955',
  yellow: '#dcdcaa',
  blue: '#4daafc',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d4d4d4',
  brightBlack: '#808080',
  brightRed: '#f44747',
  brightGreen: '#6a9955',
  brightYellow: '#dcdcaa',
  brightBlue: '#79c0ff',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff'
}

/**
 * Light palette for terminal surfaces (VS Code / GitHub Light).
 * Light background, high-contrast dark text.
 */
export const TERMINAL_THEME_CODING_LIGHT: ITheme = {
  background: '#f6f8fa',
  foreground: '#1f2328',
  cursor: '#1f2328',
  cursorAccent: '#f6f8fa',
  selectionBackground: '#b4d5fe',
  selectionForeground: '#1f2328',
  black: '#1f2328',
  red: '#b31d28',
  green: '#0e5f27',
  yellow: '#7a4a00',
  blue: '#0550ae',
  magenta: '#6e35b7',
  cyan: '#0a5963',
  white: '#424a53',
  brightBlack: '#484f58',
  brightRed: '#91161f',
  brightGreen: '#0b5220',
  brightYellow: '#633c01',
  brightBlue: '#034496',
  brightMagenta: '#572894',
  brightCyan: '#074850',
  brightWhite: '#24292f'
}

export const TERMINAL_THEME_SHELL_LIGHT: ITheme = {
  background: '#f6f8fa',
  foreground: '#1f2328',
  cursor: '#1f2328',
  cursorAccent: '#f6f8fa',
  selectionBackground: '#b4d5fe',
  selectionForeground: '#1f2328',
  black: '#1f2328',
  red: '#b31d28',
  green: '#0e5f27',
  yellow: '#7a4a00',
  blue: '#0550ae',
  magenta: '#6e35b7',
  cyan: '#0a5963',
  white: '#424a53',
  brightBlack: '#484f58',
  brightRed: '#91161f',
  brightGreen: '#0b5220',
  brightYellow: '#633c01',
  brightBlue: '#034496',
  brightMagenta: '#572894',
  brightCyan: '#074850',
  brightWhite: '#24292f'
}

/**
 * Whether an app theme name denotes a light palette.
 *
 * Accepts today's values (`light` / `dark`) as well as palette-qualified
 * names (`light-<palette>` / `dark-<palette>`). Anything else (including
 * unknown / empty values) maps to the dark terminal palette, which is the
 * terminal default.
 */
export function isLightThemeName(currentTheme: string | null | undefined): boolean {
  const name = (currentTheme || '').trim().toLowerCase()
  return name === 'light' || name.startsWith('light-')
}

/** Coding terminal (AI Coding) palette for the active app theme. */
export function getCodingTerminalTheme(currentTheme: string | null | undefined): ITheme {
  return isLightThemeName(currentTheme) ? TERMINAL_THEME_CODING_LIGHT : TERMINAL_THEME_CODING
}

/** Shell terminal (AI Terminal) palette for the active app theme. */
export function getShellTerminalTheme(currentTheme: string | null | undefined): ITheme {
  return isLightThemeName(currentTheme) ? TERMINAL_THEME_SHELL_LIGHT : TERMINAL_THEME_SHELL
}
