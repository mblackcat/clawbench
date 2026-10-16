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
  ready?: Promise<void>
  updateCallbackDone?: Promise<void>
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
  // The update must run exactly once: inside the transition when it starts,
  // or directly if starting throws before the callback was invoked.
  let ran = false
  const runUpdate = (): void | Promise<void> => {
    ran = true
    // React 18 otherwise commits AFTER the VT callback returns, so old/new
    // snapshots would be identical. flushSync forces the DOM update inside
    // the callback. Async updates are still returned so VT can wait.
    let result: void | Promise<void> = undefined
    flushSync(() => {
      result = update()
    })
    return result
  }
  try {
    // Must be invoked with `document` as receiver — an unbound call throws
    // "Illegal invocation" and silently disables every transition.
    const transition = start.call(doc, runUpdate)
    const swallow = (): void => {
      /* skipTransition / interrupted / update rejected — avoid unhandled rejections */
    }
    transition.ready?.catch(swallow)
    transition.updateCallbackDone?.catch(swallow)
    void transition.finished.catch(swallow).finally(() => {
      inFlight = false
    })
  } catch {
    inFlight = false
    if (!ran) void Promise.resolve(update())
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
