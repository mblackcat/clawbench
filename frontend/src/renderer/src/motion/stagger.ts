/**
 * Motion layer — first-paint stagger.
 *
 * Adds .cb-stagger + .cb-will-change for one play, then removes both so a
 * later data refresh does not replay and will-change does not stay pinned.
 * Delay math lives in CSS (first 8 items only).
 */
import { useEffect, type RefObject } from 'react'
import { prefersReducedMotion } from './pref'

/** --dur-5 + 7 * --stagger-step, plus a frame of slack. */
const STAGGER_MS = 360 + 7 * 22 + 16

export function playStaggerOnce(el: HTMLElement | null): () => void {
  if (!el) return () => {}
  el.classList.add('cb-stagger', 'cb-will-change')
  const ms = prefersReducedMotion() ? 32 : STAGGER_MS
  const timer = window.setTimeout(() => {
    el.classList.remove('cb-stagger', 'cb-will-change')
  }, ms)
  return () => {
    window.clearTimeout(timer)
    el.classList.remove('cb-stagger', 'cb-will-change')
  }
}

/** React helper: play once on mount. Empty deps on purpose. */
export function useStaggerOnce(ref: RefObject<HTMLElement>): void {
  // Mount-only: a later data refresh must NOT replay. will-change is removed with the class.
  useEffect(() => playStaggerOnce(ref.current), []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-only by design
}
