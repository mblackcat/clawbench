/**
 * Motion layer — window focus sync.
 *
 * Writes <html data-window-focus="true|false">. CSS then desaturates chrome
 * only (.cb-topbar / .cb-sidebar / .cb-statusbar). Never the body or the
 * content ancestor — `filter` creates a containing block and would flatten
 * overlays.
 *
 * Renderer window focus/blur only. No IPC, no network, no rAF.
 */

const ATTR = 'data-window-focus'

function sync(): void {
  document.documentElement.setAttribute(ATTR, document.hasFocus() ? 'true' : 'false')
}

/** Call once at renderer boot. Returns an unsubscribe. */
export function initWindowFocusSync(): () => void {
  sync()
  window.addEventListener('focus', sync)
  window.addEventListener('blur', sync)
  return () => {
    window.removeEventListener('focus', sync)
    window.removeEventListener('blur', sync)
  }
}
