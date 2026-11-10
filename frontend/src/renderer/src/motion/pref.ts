import { useSyncExternalStore } from 'react'

/**
 * Motion layer — preference helpers.
 *
 * User options:
 *   - 'elegant' (优雅): full rich motion, smooth view transitions, hover/press physics.
 *   - 'agile'   (敏捷): reduced motion, instantaneous responses, zero-duration transitions.
 *
 * Persisted in localStorage as 'cb-motion'.
 * CSS sets --dur-* to 1ms (not 0) when agile so transitionend/animationend still fire.
 *
 * The motion switch is the single on/off for every animated affordance:
 * agile turns off view transitions, hover/press physics and icon morphs alike
 * (`useMotionEnabled()` lets components react to runtime changes).
 */

export const MOTION_STORAGE_KEY = 'cb-motion'

/** Window event fired by `setMotionMode` so subscribers update in the same tick. */
export const MOTION_CHANGE_EVENT = 'cb-motion-change'

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

/** Whether rich animations (view transitions, hover physics, icon morphs) are on. */
export function isMotionEnabled(): boolean {
  if (typeof document !== 'undefined' && document.documentElement) {
    const attr = document.documentElement.getAttribute('data-motion')
    if (attr === 'agile' || attr === 'off') return false
    if (attr === 'elegant') return true
  }
  return readStoredMotionPref() === 'elegant'
}

/** Apply the motion setting to document root and localStorage, and notify subscribers. */
export function setMotionMode(mode: MotionMode): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-motion', mode)
  }
  try {
    localStorage.setItem(MOTION_STORAGE_KEY, mode)
  } catch {
    /* ignore quota / private mode */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MOTION_CHANGE_EVENT, { detail: mode }))
  }
}

export function isAgileMotion(): boolean {
  return !isMotionEnabled()
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  const mode = readStoredMotionPref()
  if (mode === 'agile') return true
  if (mode === 'elegant') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function subscribeMotion(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const onStorage = (e: StorageEvent): void => {
    if (e.key === MOTION_STORAGE_KEY) callback()
  }
  window.addEventListener(MOTION_CHANGE_EVENT, callback)
  window.addEventListener('storage', onStorage)

  let observer: MutationObserver | null = null
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    observer = new MutationObserver(callback)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] })
  }

  return () => {
    window.removeEventListener(MOTION_CHANGE_EVENT, callback)
    window.removeEventListener('storage', onStorage)
    observer?.disconnect()
  }
}

/** Reactive motion switch: re-renders when the user toggles 敏捷 / 优雅 at runtime. */
export function useMotionEnabled(): boolean {
  return useSyncExternalStore(subscribeMotion, isMotionEnabled, () => true)
}

/** Reactive `MotionMode` ('elegant' | 'agile'). */
export function useMotionMode(): MotionMode {
  return useMotionEnabled() ? 'elegant' : 'agile'
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
