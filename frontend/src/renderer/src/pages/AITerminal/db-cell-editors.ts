import Handsontable from 'handsontable'
import { getT } from '../../i18n'

/**
 * Custom Handsontable cell editors for the AI Terminal DB grid.
 *
 * These follow the same self-contained vanilla-DOM BaseEditor pattern used by
 * Copiper's MultiSelectEditor (see CopiperTable.tsx). They exist because the
 * built-in editors don't cover the interactions the DB browser needs:
 *
 *   • text-expand  — a normal inline text input plus a magnifier button that
 *                    opens a resizable multi-line textarea popup (cancel/save).
 *                    Used for TEXT / long string columns.
 *   • db-datetime  — a native datetime-local input for DATE/DATETIME/TIMESTAMP
 *                    columns, emitting a `YYYY-MM-DD HH:mm:ss` string.
 *
 * Boolean columns reuse Handsontable's built-in `dropdown` editor (source
 * ['true','false']) configured at the column level, so no custom editor is
 * needed for those.
 *
 * Register once (idempotent) via `registerDBCellEditors()`.
 */

// ── Shared theme class names (styled in handsontable-theme.ts) ──
const EXPAND_PANEL = 'db-textexpand-panel'
const EXPAND_TEXTAREA = 'db-textexpand-textarea'
const EXPAND_BAR = 'db-textexpand-bar'
const EXPAND_BTN = 'db-textexpand-btn'
const EXPAND_ICON = 'db-textexpand-icon'

// ── Text editor with an expand-to-textarea magnifier button ──
class TextExpandEditor extends Handsontable.editors.TextEditor {
  private expandIcon!: HTMLDivElement
  private panel!: HTMLDivElement
  private bigTextarea!: HTMLTextAreaElement
  private panelOpen = false

  createElements(): void {
    super.createElements()

    const doc = this.hot.rootDocument

    // Magnifier button — floats over the edited cell's right edge. Appended to
    // body (not the opacity-controlled input holder) and positioned on open().
    this.expandIcon = doc.createElement('div')
    this.expandIcon.className = EXPAND_ICON
    this.expandIcon.style.display = 'none'
    // Inline SVG (avoids font/emoji issues), matches Ant "expand/fullscreen" glyph
    this.expandIcon.innerHTML =
      '<svg viewBox="0 0 1024 1024" width="12" height="12" fill="currentColor">' +
      '<path d="M391 240H160c-8.8 0-16 7.2-16 16v231c0 8.8 7.2 16 16 16h40c8.8 0 16-7.2 16-16V312h175c8.8 0 16-7.2 16-16v-40c0-8.8-7.2-16-16-16zM864 521h-40c-8.8 0-16 7.2-16 16v175H633c-8.8 0-16 7.2-16 16v40c0 8.8 7.2 16 16 16h231c8.8 0 16-7.2 16-16V537c0-8.8-7.2-16-16-16z"/>' +
      '</svg>'
    this.expandIcon.addEventListener('mousedown', (e) => {
      // Keep the inline editor open and focused while we launch the popup
      e.preventDefault()
      e.stopPropagation()
      this.openPanel()
    })
    doc.body.appendChild(this.expandIcon)

    // Expanded multi-line panel (hidden until opened)
    this.panel = doc.createElement('div')
    this.panel.className = EXPAND_PANEL
    this.panel.style.display = 'none'

    this.bigTextarea = doc.createElement('textarea')
    this.bigTextarea.className = EXPAND_TEXTAREA
    this.bigTextarea.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') this.closePanel(false)
    })

    const bar = doc.createElement('div')
    bar.className = EXPAND_BAR

    const cancelBtn = doc.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = EXPAND_BTN
    cancelBtn.textContent = getT()('db.cancel')
    cancelBtn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.closePanel(false)
    })

    const saveBtn = doc.createElement('button')
    saveBtn.type = 'button'
    saveBtn.className = `${EXPAND_BTN} ${EXPAND_BTN}-primary`
    saveBtn.textContent = getT()('db.save')
    saveBtn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.closePanel(true)
    })

    bar.appendChild(cancelBtn)
    bar.appendChild(saveBtn)
    this.panel.appendChild(this.bigTextarea)
    this.panel.appendChild(bar)
    this.panel.addEventListener('mousedown', (e) => e.stopPropagation())

    doc.body.appendChild(this.panel)
  }

  open(...args: unknown[]): void {
    // @ts-expect-error — passthrough to base open(event?)
    super.open(...args)
    // Float the magnifier over the top-right corner of the edited cell
    const rect = this.TD.getBoundingClientRect()
    const win = this.hot.rootWindow
    this.expandIcon.style.display = 'flex'
    this.expandIcon.style.left = `${rect.right + win.scrollX - 20}px`
    this.expandIcon.style.top = `${rect.top + win.scrollY + 2}px`
  }

  private get textareaEl(): HTMLTextAreaElement {
    return this.TEXTAREA as unknown as HTMLTextAreaElement
  }

  private openPanel(): void {
    this.panelOpen = true
    this.bigTextarea.value = this.textareaEl.value ?? ''

    const rect = this.TD.getBoundingClientRect()
    const win = this.hot.rootWindow
    this.panel.style.display = 'flex'
    this.panel.style.left = `${rect.left + win.scrollX}px`
    this.panel.style.top = `${rect.bottom + win.scrollY + 2}px`
    this.panel.style.minWidth = `${Math.max(rect.width, 320)}px`

    // Defer focus so the mousedown-driven refocus of the inline input settles
    setTimeout(() => this.bigTextarea.focus(), 0)
  }

  private closePanel(commit: boolean): void {
    if (!this.panelOpen) return
    this.panelOpen = false
    if (commit) {
      this.textareaEl.value = this.bigTextarea.value
    }
    this.panel.style.display = 'none'
    if (commit) {
      this.finishEditing(false)
    } else {
      this.focus()
    }
  }

  close(): void {
    if (this.panelOpen) {
      this.panelOpen = false
      this.panel.style.display = 'none'
    }
    this.expandIcon.style.display = 'none'
    super.close()
  }
}

// ── Native datetime-local editor emitting "YYYY-MM-DD HH:mm:ss" ──
class DateTimeEditor extends Handsontable.editors.BaseEditor {
  private input!: HTMLInputElement

  init(): void {
    const doc = this.hot.rootDocument
    this.input = doc.createElement('input')
    this.input.type = 'datetime-local'
    this.input.step = '1'
    this.input.className = 'db-datetime-input'
    this.input.style.display = 'none'
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') this.finishEditing(false)
      else if (e.key === 'Escape') this.finishEditing(true)
    })
    this.input.addEventListener('mousedown', (e) => e.stopPropagation())
    doc.body.appendChild(this.input)
  }

  getValue(): string {
    const v = this.input.value
    if (!v) return ''
    // datetime-local yields "YYYY-MM-DDTHH:mm" or "...:ss" → normalize to space + seconds
    const normalized = v.replace('T', ' ')
    return normalized.length === 16 ? `${normalized}:00` : normalized
  }

  setValue(value: unknown): void {
    const str = String(value ?? '').trim()
    if (!str) {
      this.input.value = ''
      return
    }
    // Accept "YYYY-MM-DD HH:mm:ss" or ISO; feed datetime-local a "T"-joined value
    const iso = str.replace(' ', 'T')
    this.input.value = iso.length >= 16 ? iso.slice(0, 19) : iso
  }

  open(): void {
    const rect = this.TD.getBoundingClientRect()
    const win = this.hot.rootWindow
    this.input.style.display = 'block'
    this.input.style.position = 'absolute'
    this.input.style.left = `${rect.left + win.scrollX}px`
    this.input.style.top = `${rect.top + win.scrollY}px`
    this.input.style.minWidth = `${Math.max(rect.width, 200)}px`
    this.input.style.zIndex = '10000'
    setTimeout(() => this.input.focus(), 0)
  }

  close(): void {
    this.input.style.display = 'none'
  }

  focus(): void {
    this.input.focus()
  }
}

let registered = false

/** Register the DB grid's custom editors once. Safe to call repeatedly. */
export function registerDBCellEditors(): void {
  if (registered) return
  Handsontable.editors.registerEditor('db-text-expand', TextExpandEditor)
  Handsontable.editors.registerEditor('db-datetime', DateTimeEditor)
  registered = true
}