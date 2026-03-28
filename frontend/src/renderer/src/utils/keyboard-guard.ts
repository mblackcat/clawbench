/**
 * 拦截非输入控件中的 Web 快捷键，使应用更接近桌面原生体验。
 * 在输入控件（input/textarea/contenteditable）内，快捷键仍正常工作。
 */

const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  if (INPUT_TAGS.has(el.tagName)) return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

function handleKeyDown(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey

  // Cmd/Ctrl+A: 全选 — 仅在非输入控件中拦截
  if (mod && e.key === 'a') {
    if (!isInputFocused()) {
      e.preventDefault()
    }
  }
}

export function initKeyboardGuard(): () => void {
  document.addEventListener('keydown', handleKeyDown, true)
  return () => document.removeEventListener('keydown', handleKeyDown, true)
}
