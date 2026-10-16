/** Window background colours matching the renderer's dark / light shells. */
export const DARK_WINDOW_BG = '#17171A'
export const LIGHT_WINDOW_BG = '#F5F6F8'

/**
 * Initial BrowserWindow background for a saved theme (avoids a white flash
 * before the renderer paints): `system` follows the OS appearance, `dark` and
 * any `dark-*` palette are dark, everything else is light.
 */
export function resolveWindowBackground(theme: string | undefined | null, systemPrefersDark: boolean): string {
  const value = (theme || '').trim()
  if (value === 'system') return systemPrefersDark ? DARK_WINDOW_BG : LIGHT_WINDOW_BG
  if (value === 'dark' || value.startsWith('dark-')) return DARK_WINDOW_BG
  return LIGHT_WINDOW_BG
}
