/**
 * Motion layer — preference helpers.
 *
 * User options:
 *   - 'elegant' (优雅): full rich motion, smooth view transitions, hover/press physics.
 *   - 'agile'   (敏捷): reduced motion, instantaneous responses, zero-duration transitions.
 *
 * Persisted in localStorage as 'cb-motion'.
 * CSS sets --dur-* to 1ms (not 0) when agile so transitionend/animationend still fire.
 */

export const MOTION_STORAGE_KEY = 'cb-motion'

export type MotionMode = 'elegant' | 'agile'

export function readStoredMotionPref(): MotionMode {
  try {
    const stored = localStorage.getItem(MOTION_STORAGE_KEY)
    if (stored === 'agile' || stored === 'off') return 'agile'
    return 'elegant'
  } catch {
    return 'elegant'
  }
}

/** Apply the motion setting to document root and localStorage. */
export function setMotionMode(mode: MotionMode): void {
  const root = document.documentElement
  root.setAttribute('data-motion', mode)
  try {
    localStorage.setItem(MOTION_STORAGE_KEY, mode)
  } catch {
    /* ignore quota / private mode */
  }
}

export function isAgileMotion(): boolean {
  return readStoredMotionPref() === 'agile'
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  const mode = readStoredMotionPref()
  if (mode === 'agile') return true
  if (mode === 'elegant') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Hydrate <html data-motion> from storage before first paint. */
export function initMotionPreference(): void {
  const mode = readStoredMotionPref()
  document.documentElement.setAttribute('data-motion', mode)
}

/** Chromium 117+ @starting-style / allow-discrete. Electron 28 / Cr 120: yes. */
export function supportsDiscreteTransition(): boolean {
  return typeof CSS !== 'undefined' && CSS.supports('transition-behavior', 'allow-discrete')
}

/** Chromium 114+ Popover API. Electron 28 / Cr 120: yes. */
export function supportsPopover(): boolean {
  return typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype
}

/** Chromium 111+ View Transitions. Electron 28 / Cr 120: yes. */
export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
}

/** Chromium 125+ CSS anchor positioning. Electron 28 / Cr 120: no. */
export function supportsAnchorPositioning(): boolean {
  return typeof CSS !== 'undefined' && CSS.supports('position-anchor', 'auto')
}
