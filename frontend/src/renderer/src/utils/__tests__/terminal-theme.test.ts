import {
  getCodingTerminalTheme,
  getShellTerminalTheme,
  isLightThemeName,
  TERMINAL_THEME_CODING,
  TERMINAL_THEME_CODING_LIGHT,
  TERMINAL_THEME_SHELL,
  TERMINAL_THEME_SHELL_LIGHT
} from '../terminal-theme'

describe('terminal-theme', () => {
  it('recognizes plain and palette-qualified light themes', () => {
    expect(isLightThemeName('light')).toBe(true)
    expect(isLightThemeName('light-lagoon')).toBe(true)
    expect(isLightThemeName('Light-Anything')).toBe(true)
    expect(isLightThemeName('dark')).toBe(false)
    expect(isLightThemeName('dark-ember')).toBe(false)
    expect(isLightThemeName('')).toBe(false)
    expect(isLightThemeName(undefined)).toBe(false)
  })

  it('picks the matching palettes', () => {
    expect(getCodingTerminalTheme('light')).toBe(TERMINAL_THEME_CODING_LIGHT)
    expect(getCodingTerminalTheme('dark-foo')).toBe(TERMINAL_THEME_CODING)
    expect(getShellTerminalTheme('light-foo')).toBe(TERMINAL_THEME_SHELL_LIGHT)
    expect(getShellTerminalTheme('dark')).toBe(TERMINAL_THEME_SHELL)
  })
})
