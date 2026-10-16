/**
 * Motion layer — View Transitions wrapper (Chromium 111+).
 *
 * Never queue overlapping transitions (that hitch). Never throw on
 * transition.finished reject (user navigates away / skipTransition).
 *
 * view-transition-name may be set on at most 3 elements at once. The shared
 * morph name `cb-vt-shared` is the only one this module writes; callers must
 * not stamp it on every list row — only the clicked row, then the detail
 * header after that row unmounts, so the name stays unique.
 */
import { flushSync } from 'react-dom'
import { prefersReducedMotion, supportsViewTransitions } from './pref'

type ViewTransitionLike = {
  finished: Promise<void>
}

type DocumentWithVT = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike
}

/** Matches CSS `::view-transition-*(cb-vt-shared)`. */
export const SHARED_VT_NAME = 'cb-vt-shared'

let inFlight = false

export function isViewTransitionInFlight(): boolean {
  return inFlight
}

/**
 * Run `update` inside a view transition when the runtime allows it.
 * Falls back to a synchronous call when:
 *   - document.startViewTransition is missing
 *   - prefers-reduced-motion or data-motion="off"
 *   - another transition is already running (do not queue)
 */
export function withViewTransition(update: () => void | Promise<void>): void {
  if (!supportsViewTransitions() || prefersReducedMotion() || inFlight) {
    void Promise.resolve(update())
    return
  }

  const doc = document as DocumentWithVT
  const start = doc.startViewTransition
  if (!start) {
    void Promise.resolve(update())
    return
  }

  inFlight = true
  try {
    const transition = start(() => {
      // React 18 otherwise commits AFTER the VT callback returns, so old/new
      // snapshots would be identical. flushSync forces the DOM update inside
      // the callback. Async updates are still returned so VT can wait.
      let result: void | Promise<void> = undefined
      flushSync(() => {
        result = update()
      })
      return result
    })
    void transition.finished
      .catch(() => {
        /* skipTransition / interrupted — swallow to avoid unhandled rejection */
      })
      .finally(() => {
        inFlight = false
      })
  } catch {
    inFlight = false
    void Promise.resolve(update())
  }
}

/**
 * Point the single shared morph name at `el` (or clear it).
 * Always clears any previous bearer first so the name is unique.
 */
export function setSharedTransitionName(el: HTMLElement | null): void {
  document.querySelectorAll('[data-cb-vt-shared]').forEach((node) => {
    if (node instanceof HTMLElement) {
      node.style.removeProperty('view-transition-name')
      node.removeAttribute('data-cb-vt-shared')
    }
  })
  if (!el) return
  el.style.setProperty('view-transition-name', SHARED_VT_NAME)
  el.setAttribute('data-cb-vt-shared', '')
}
