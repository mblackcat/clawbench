/**
 * Font size mode (avatar menu → 字体).
 *
 *   - 'standard': default size (base 14px in antd)
 *   - 'large':    +20% (base 16.8px); antd tokens come from LARGE_FONT_TOKENS in theme/
 *
 * Persisted in electron-store as `fontSize` (source of truth) and mirrored in
 * localStorage as `cb-font-size` so index.html can apply it before first paint.
 */

export type FontSizeMode = 'standard' | 'large'

export const FONT_SIZE_STORAGE_KEY = 'cb-font-size'
export const FONT_SIZE_CHANGE_EVENT = 'cb-font-size-change'
export const FONT_SCALE_LARGE = 1.2

/** Anything but 'large' is the standard size. */
export function normalizeFontSize(value: unknown): FontSizeMode {
  return value === 'large' ? 'large' : 'standard'
}

export function readStoredFontSize(): FontSizeMode {
  try {
    return normalizeFontSize(localStorage.getItem(FONT_SIZE_STORAGE_KEY))
  } catch {
    return 'standard'
  }
}

export function isLargeFontSize(): boolean {
  if (typeof document !== 'undefined' && document.documentElement) {
    const attr = document.documentElement.getAttribute('data-font-size')
    if (attr === 'large') return true
    if (attr === 'standard') return false
  }
  return readStoredFontSize() === 'large'
}

/** Apply the font-size mode to <html>/<body>, the CSS scale variables and localStorage. */
export function applyFontSizeToDom(size?: string | null): FontSizeMode {
  const mode = normalizeFontSize(size)
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.setAttribute('data-font-size', mode)
    document.body?.setAttribute('data-font-size', mode)
    if (mode === 'large') {
      root.style.setProperty('--cb-font-scale', String(FONT_SCALE_LARGE))
      root.style.setProperty('--cb-font-size-base', '16.8px')
      root.style.setProperty('--cb-font-size-sm', '14.4px')
    } else {
      root.style.setProperty('--cb-font-scale', '1')
      root.style.setProperty('--cb-font-size-base', '14px')
      root.style.setProperty('--cb-font-size-sm', '12px')
    }
  }
  try {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, mode)
  } catch {
    /* ignore quota / private mode */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FONT_SIZE_CHANGE_EVENT, { detail: mode }))
  }
  return mode
}
