/**
 * Motion layer — overlay display fallback when @starting-style /
 * transition-behavior: allow-discrete is missing (Chromium < 117).
 *
 * Electron 28 / Chromium 120 has the CSS path, so this is unused there.
 * Kept so a future downgrade / embedded webview does not snap display.
 *
 * Opacity is driven by .is-open (CSS). We only toggle display after the
 * exit transition. duration is 1ms when motion is off, so we never hang.
 */
import { prefersReducedMotion } from './pref'

function exitMs(): number {
  if (prefersReducedMotion()) return 1
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-3').trim()
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : 200
}

/**
 * Open/close a .cb-layer that is NOT a native popover/dialog.
 * Native popover uses :popover-open and does not need this on Cr 117+.
 */
export function setLayerOpen(el: HTMLElement, open: boolean): void {
  if (open) {
    el.style.display = ''
    el.removeAttribute('hidden')
    // Yield so the closed style is the from-state when @starting-style is
    // missing. setTimeout(0) — not an rAF loop.
    window.setTimeout(() => {
      el.classList.add('is-open')
    }, 0)
    return
  }

  el.classList.remove('is-open')
  window.setTimeout(() => {
    if (!el.classList.contains('is-open')) {
      el.style.display = 'none'
    }
  }, exitMs())
}
