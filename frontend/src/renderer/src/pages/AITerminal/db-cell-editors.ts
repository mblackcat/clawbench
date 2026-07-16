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
 *
 * Standalone expand panel (`openDBTextExpandPanel`) is shared by the inline
 * editor's magnifier button and by double-click on cells (read-only enlarge
 * for easy select/copy, or editable with save when the grid is in edit mode).
 */

// ── Shared theme class names (styled in handsontable-theme.ts) ──
const EXPAND_PANEL = 'db-textexpand-panel'
const EXPAND_TEXTAREA = 'db-textexpand-textarea'
const EXPAND_BAR = 'db-textexpand-bar'
const EXPAND_BTN = 'db-textexpand-btn'
const EXPAND_ICON = 'db-textexpand-icon'

/** Cap auto-sized / stretched column width so long cell text doesn't force huge horizontal scroll. */
export const DB_GRID_MAX_COL_WIDTH = 280

export interface DBTextExpandOptions {
  /** Full cell text to show. */
  value: string
  /** Anchor element (usually the TD) used for positioning. */
  anchorEl: HTMLElement
  /** When true, textarea is not editable and only a Close button is shown. */
  readOnly?: boolean
  /** Called with the final textarea value when the user clicks Save (edit mode only). */
  onSave?: (value: string) => void
  /** Called after the panel is closed (any path). */
  onClose?: () => void
}

// Singleton expand panel so only one is open at a time (editor magnifier + dblclick share it).
let standalonePanel: HTMLDivElement | null = null
let standaloneTextarea: HTMLTextAreaElement | null = null
let standaloneOutsideHandler: ((e: MouseEvent) => void) | null = null
let standaloneKeyHandler: ((e: KeyboardEvent) => void) | null = null
let standaloneOnClose: (() => void) | null = null

/** Close the standalone text-expand panel if open. */
export function closeDBTextExpandPanel(): void {
  if (standaloneOutsideHandler) {
    document.removeEventListener('mousedown', standaloneOutsideHandler, true)
    standaloneOutsideHandler = null
  }
  if (standaloneKeyHandler) {
    document.removeEventListener('keydown', standaloneKeyHandler, true)
    standaloneKeyHandler = null
  }
  if (standalonePanel) {
    standalonePanel.remove()
    standalonePanel = null
    standaloneTextarea = null
  }
  const cb = standaloneOnClose
  standaloneOnClose = null
  cb?.()
}

/**
 * Open a floating multi-line text panel anchored under a cell.
 * Reuses the same chrome as the inline editor's magnifier expand dialog.
 * Safe to call repeatedly — previous panel is closed first.
 */
export function openDBTextExpandPanel(opts: DBTextExpandOptions): void {
  closeDBTextExpandPanel()

  const doc = opts.anchorEl.ownerDocument || document
  const win = doc.defaultView || window
  const readOnly = !!opts.readOnly
  const t = getT()

  const panel = doc.createElement('div')
  panel.className = EXPAND_PANEL
  panel.style.display = 'flex'

  const textarea = doc.createElement('textarea')
  textarea.className = EXPAND_TEXTAREA
  textarea.value = opts.value ?? ''
  textarea.readOnly = readOnly
  // Keep Handsontable from eating keys while the panel is focused
  textarea.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      closeDBTextExpandPanel()
    }
  })

  const bar = doc.createElement('div')
  bar.className = EXPAND_BAR

  if (readOnly) {
    const closeBtn = doc.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = EXPAND_BTN
    closeBtn.textContent = t('db.close')
    closeBtn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      closeDBTextExpandPanel()
    })
    bar.appendChild(closeBtn)
  } else {
    const cancelBtn = doc.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = EXPAND_BTN
    cancelBtn.textContent = t('db.cancel')
    cancelBtn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      closeDBTextExpandPanel()
    })

    const saveBtn = doc.createElement('button')
    saveBtn.type = 'button'
    saveBtn.className = `${EXPAND_BTN} ${EXPAND_BTN}-primary`
    saveBtn.textContent = t('db.save')
    saveBtn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      opts.onSave?.(textarea.value)
      closeDBTextExpandPanel()
    })

    bar.appendChild(cancelBtn)
    bar.appendChild(saveBtn)
  }

  panel.appendChild(textarea)
  panel.appendChild(bar)
  panel.addEventListener('mousedown', (e) => e.stopPropagation())

  const rect = opts.anchorEl.getBoundingClientRect()
  panel.style.left = `${rect.left + win.scrollX}px`
  panel.style.top = `${rect.bottom + win.scrollY + 2}px`
  panel.style.minWidth = `${Math.max(rect.width, 320)}px`

  // Keep panel on-screen vertically when near the bottom
  doc.body.appendChild(panel)
  const panelRect = panel.getBoundingClientRect()
  if (panelRect.bottom > win.innerHeight - 8) {
    const above = rect.top + win.scrollY - panelRect.height - 2
    if (above > win.scrollY + 8) {
      panel.style.top = `${above}px`
    }
  }
  if (panelRect.right > win.innerWidth - 8) {
    panel.style.left = `${Math.max(8, win.innerWidth - panelRect.width - 8 + win.scrollX)}px`
  }

  standalonePanel = panel
  standaloneTextarea = textarea
  standaloneOnClose = opts.onClose ?? null

  // Outside click closes (capture so Handsontable grid clicks also dismiss)
  standaloneOutsideHandler = (e: MouseEvent) => {
    const target = e.target as Node | null
    if (standalonePanel && target && !standalonePanel.contains(target)) {
      closeDBTextExpandPanel()
    }
  }
  // Defer so the opening click doesn't immediately close
  setTimeout(() => {
    if (standalonePanel) {
      doc.addEventListener('mousedown', standaloneOutsideHandler!, true)
    }
  }, 0)

  standaloneKeyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeDBTextExpandPanel()
    }
  }
  doc.addEventListener('keydown', standaloneKeyHandler, true)

  setTimeout(() => textarea.focus(), 0)
}

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
    // Close any standalone expand panel so the two don't stack
    closeDBTextExpandPanel()
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

/**
 * Coerce an arbitrary stored datetime value into the "YYYY-MM-DDTHH:mm:ss"
 * shape a native `datetime-local` input expects.
 *
 * Handles the common shapes a DB driver hands back:
 *   • "2026-07-07 00:00:07"            (MySQL DATETIME string)
 *   • "2026-07-07T00:00:07.583Z"       (ISO, e.g. mysql2 Date→JSON)
 *   • a real Date object
 *   • JSON-quoted variants of the above ('"...Z"')
 *
 * The literal wall-clock digits are preserved (no timezone shifting): a stored
 * "00:00:07" shows as "00:00:07". When the value is empty/unparseable we
 * default to the current local time so the user isn't handed a blank picker.
 */
function toDateTimeLocal(value: unknown): string {
  let str = String(value ?? '').trim()
  // Strip surrounding JSON quotes if present
  if (str.length >= 2 && str.startsWith('"') && str.endsWith('"')) {
    str = str.slice(1, -1).trim()
  }

  if (str) {
    // Pull the first "YYYY-MM-DD[ T]HH:mm[:ss]" run of digits, ignoring the
    // trailing ".sssZ"/timezone — we want the literal wall-clock, un-shifted.
    const m = str.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
    if (m) {
      const [, y, mo, d, h, mi, s] = m
      return `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}`
    }
    // Date-only value → midnight
    const dOnly = str.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (dOnly) {
      const [, y, mo, d] = dOnly
      return `${y}-${mo}-${d}T00:00:00`
    }
  }

  // Empty or unrecognized → default to current local time
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
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
    this.input.value = toDateTimeLocal(value)
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
