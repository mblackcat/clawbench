import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react'
import { Typography, theme } from 'antd'
import { HotTable } from '@handsontable/react'
import { registerAllModules } from 'handsontable/registry'
import { registerLanguageDictionary, zhCN } from 'handsontable/i18n'
import Handsontable from 'handsontable'
import 'handsontable/dist/handsontable.full.min.css'
import { useCopiperStore } from '../../stores/useCopiperStore'
import type { ColDef } from '../../types/copiper'

registerAllModules()
registerLanguageDictionary(zhCN)

// ── Custom multi-select dropdown editor for indices columns ──
// Handsontable's built-in DropdownEditor only supports single selection, but
// indices columns store pipe-delimited lists (e.g. "id_1|id_2|id_3"). Rather
// than fighting the built-in editor's internals, this is a self-contained
// BaseEditor that renders its own popup panel with a search filter and a
// checkbox list. Selection follows native multi-select listbox semantics:
//   • plain click       → select only this item (replace)
//   • Ctrl / Cmd+click   → toggle this item
//   • Shift+click        → select the range from the anchor item
class MultiSelectEditor extends Handsontable.editors.BaseEditor {
  private panel!: HTMLDivElement
  private searchInput!: HTMLInputElement
  private listEl!: HTMLDivElement
  // Full option set (canonical order) for this cell
  private options: string[] = []
  // Currently selected option names
  private selected = new Set<string>()
  // Lower-cased filter text driving the visible list
  private filterText = ''
  // Anchor index (into the *visible* list) for Shift+click ranges
  private anchorIndex = -1

  init() {
    const doc = this.hot.rootDocument

    this.panel = doc.createElement('div')
    this.panel.className = 'copiper-multiselect-panel'
    this.panel.style.display = 'none'

    this.searchInput = doc.createElement('input')
    this.searchInput.type = 'text'
    this.searchInput.className = 'copiper-multiselect-search'
    this.searchInput.setAttribute('placeholder', '输入以筛选…')
    this.searchInput.addEventListener('input', () => {
      this.filterText = this.searchInput.value.trim().toLowerCase()
      this.renderList()
    })
    this.searchInput.addEventListener('keydown', (e) => {
      // Keep typing away from Handsontable's grid key handler
      e.stopPropagation()
      if (e.key === 'Escape') {
        this.finishEditing(true)
      } else if (e.key === 'Enter') {
        this.finishEditing(false)
      }
    })

    this.listEl = doc.createElement('div')
    this.listEl.className = 'copiper-multiselect-list'

    this.panel.appendChild(this.searchInput)
    this.panel.appendChild(this.listEl)

    // Stop panel interactions from bubbling to the document, where
    // Handsontable's outside-click handler would otherwise close the editor.
    this.panel.addEventListener('mousedown', (e) => e.stopPropagation())

    doc.body.appendChild(this.panel)
  }

  prepare(
    row: number,
    col: number,
    prop: string | number,
    td: HTMLTableCellElement,
    value: unknown,
    cellProperties: Handsontable.CellProperties
  ) {
    super.prepare(row, col, prop, td, value, cellProperties)
    const src = (cellProperties as any).source
    this.options = Array.isArray(src) ? [...src] : []
  }

  getValue(): string {
    // Emit in canonical option order for stable pipe strings
    return this.options.filter((o) => this.selected.has(o)).join('|')
  }

  setValue(value: unknown): void {
    this.selected = new Set(
      String(value ?? '')
        .split('|')
        .filter(Boolean)
    )
  }

  open(): void {
    this.filterText = ''
    this.searchInput.value = ''
    this.anchorIndex = -1
    this.renderList()

    // Position the panel just below the edited cell
    const rect = this.TD.getBoundingClientRect()
    const win = this.hot.rootWindow
    this.panel.style.display = 'block'
    this.panel.style.left = `${rect.left + win.scrollX}px`
    this.panel.style.top = `${rect.bottom + win.scrollY}px`
    this.panel.style.minWidth = `${rect.width}px`

    this.searchInput.focus()
  }

  close(): void {
    this.panel.style.display = 'none'
  }

  focus(): void {
    this.searchInput.focus()
  }

  // Options currently visible under the active filter
  private visibleOptions(): string[] {
    if (!this.filterText) return this.options
    return this.options.filter((o) => o.toLowerCase().includes(this.filterText))
  }

  private handleItemClick(opt: string, e: MouseEvent): void {
    const visible = this.visibleOptions()
    const idx = visible.indexOf(opt)
    const additive = e.ctrlKey || e.metaKey

    if (e.shiftKey && this.anchorIndex >= 0 && this.anchorIndex < visible.length) {
      if (!additive) this.selected.clear()
      const start = Math.min(this.anchorIndex, idx)
      const end = Math.max(this.anchorIndex, idx)
      for (let i = start; i <= end; i++) this.selected.add(visible[i])
    } else if (additive) {
      if (this.selected.has(opt)) this.selected.delete(opt)
      else this.selected.add(opt)
      this.anchorIndex = idx
    } else {
      this.selected.clear()
      this.selected.add(opt)
      this.anchorIndex = idx
    }
    this.renderList()
  }

  private renderList(): void {
    const doc = this.hot.rootDocument
    this.listEl.innerHTML = ''
    const visible = this.visibleOptions()

    if (visible.length === 0) {
      const empty = doc.createElement('div')
      empty.className = 'copiper-multiselect-empty'
      empty.textContent = '无匹配项'
      this.listEl.appendChild(empty)
      return
    }

    for (const opt of visible) {
      const item = doc.createElement('div')
      item.className = 'copiper-multiselect-item'
      if (this.selected.has(opt)) item.classList.add('is-selected')
      item.textContent = opt
      item.addEventListener('mousedown', (e) => {
        e.preventDefault() // keep focus in the search input
        e.stopPropagation() // don't let Handsontable close the editor
        this.handleItemClick(opt, e)
      })
      this.listEl.appendChild(item)
    }
  }
}

Handsontable.editors.registerEditor('multi-select', MultiSelectEditor)
// ─────────────────────────────────────────────────────────────────

// `afterOnCellDoubleClick` is passed through to Handsontable settings but is not part of
// the published HotTableProps typings — declare it via module augmentation (type-only).
declare module '@handsontable/react' {
  interface HotTableProps {
    afterOnCellDoubleClick?: (
      event: MouseEvent,
      coords: { row: number; col: number },
      TD?: HTMLTableCellElement
    ) => void
  }
}

const { Text } = Typography

interface CopiperTableProps {
  onRowDoubleClick?: (rowIndex: number) => void
}

const CopiperTable: React.FC<CopiperTableProps> = ({ onRowDoubleClick }) => {
  const { token } = theme.useToken()
  const hotRef = useRef<{ hotInstance: Handsontable | null } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  const activeDatabase = useCopiperStore((s) => s.activeDatabase)
  const activeTableName = useCopiperStore((s) => s.activeTableName)
  const searchText = useCopiperStore((s) => s.searchText)
  const referenceData = useCopiperStore((s) => s.referenceData)
  const setSelectedRowIndices = useCopiperStore((s) => s.setSelectedRowIndices)
  const markDirty = useCopiperStore((s) => s.markDirty)

  // Inject Handsontable theme CSS that adapts to light/dark mode
  useEffect(() => {
    const styleId = 'copiper-hot-theme'
    let el = document.getElementById(styleId) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = styleId
      document.head.appendChild(el)
    }
    el.textContent = `
      .handsontable { color: ${token.colorText}; font-size: ${token.fontSize}px; }
      .handsontable th {
        background-color: ${token.colorBgLayout} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .handsontable td {
        background-color: ${token.colorBgContainer} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .handsontable td.htDimmed {
        color: ${token.colorTextSecondary} !important;
        background-color: ${token.colorBgLayout} !important;
      }
      .handsontable tr:hover td { background-color: ${token.colorPrimaryBg}; }
      .handsontable .currentRow td { background-color: ${token.colorPrimaryBg}; }
      .handsontable .area td { background-color: ${token.colorPrimaryBgHover}; }
      .handsontable .htCheckboxRendererInput { accent-color: ${token.colorPrimary}; }
      .handsontableInput, .handsontableInputHolder textarea {
        background-color: ${token.colorBgContainer} !important;
        color: ${token.colorText} !important;
      }
      /* Context menu & dropdown menu — outer wrapper */
      .htContextMenu,
      .htDropdownMenu {
        border: 1px solid ${token.colorBorderSecondary} !important;
        border-radius: 8px !important;
        overflow: hidden !important;
        box-shadow: ${token.boxShadow} !important;
        background-color: ${token.colorBgElevated} !important;
      }
      .htContextMenu .ht_master table,
      .htDropdownMenu .ht_master table {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .htContextMenu .ht_master td,
      .htDropdownMenu .ht_master td {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .htContextMenu .ht_master td.current,
      .htContextMenu .ht_master td:hover,
      .htDropdownMenu .ht_master td.current,
      .htDropdownMenu .ht_master td:hover {
        background-color: ${token.colorPrimaryBg} !important;
      }
      .htContextMenu .htSeparator td,
      .htDropdownMenu .htSeparator td {
        border-color: ${token.colorBorderSecondary} !important;
      }

      /* Filter sections background */
      .htFiltersMenuCondition,
      .htFiltersMenuValue,
      .htFiltersMenuOperators,
      .htDropdownMenu .htFiltersMenuCondition,
      .htDropdownMenu .htFiltersMenuValue,
      .htDropdownMenu .htFiltersMenuOperators {
        background-color: ${token.colorBgElevated} !important;
      }

      /* Filter labels */
      .htFiltersMenuLabel,
      .htDropdownMenu .htFiltersMenuLabel {
        color: ${token.colorText} !important;
      }

      /* Condition filter select */
      .htUISelect,
      .htDropdownMenu .htUISelect,
      .htFiltersMenuCondition .htUISelect {
        background-color: ${token.colorBgContainer} !important;
        border-color: ${token.colorBorder} !important;
        color: ${token.colorText} !important;
        border-radius: 6px !important;
      }
      .htUISelectCaption,
      .htDropdownMenu .htUISelectCaption,
      .htFiltersMenuCondition .htUISelectCaption {
        color: ${token.colorText} !important;
        background-color: transparent !important;
      }
      /* Native <select> inside htUISelect */
      .htUISelect select,
      .htFiltersMenuCondition select {
        background-color: ${token.colorBgContainer} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorder} !important;
      }
      /* htUISelect expanded dropdown — a child Handsontable listbox */
      .htUISelect .htCore,
      .htUISelect .ht_master .htCore,
      .htUISelect .ht_master table {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
      }
      .htUISelect .ht_master td {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .htUISelect .ht_master td.current,
      .htUISelect .ht_master td:hover {
        background-color: ${token.colorPrimaryBg} !important;
      }

      /* Filter text inputs */
      .htFiltersMenuCondition .htUIInput input,
      .htFiltersMenuValue .htUIMultipleSelectSearch input {
        background-color: ${token.colorBgContainer} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorder} !important;
        border-radius: 6px !important;
      }

      /* Multi-select checkbox list */
      .htUIMultipleSelectHot,
      .htFiltersMenuValue .htUIMultipleSelectHot {
        background-color: ${token.colorBgElevated} !important;
      }
      .htUIMultipleSelectHot td,
      .htFiltersMenuValue .htUIMultipleSelectHot td,
      .htDropdownMenu .htFiltersMenuValue .htUIMultipleSelectHot td {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .htUIMultipleSelectHot td.current,
      .htUIMultipleSelectHot td:hover,
      .htFiltersMenuValue .htUIMultipleSelectHot td.current,
      .htFiltersMenuValue .htUIMultipleSelectHot td:hover {
        background-color: ${token.colorPrimaryBg} !important;
      }

      /* Checkbox accent */
      .htFiltersMenuValue input[type="checkbox"],
      .htDropdownMenu input[type="checkbox"] {
        accent-color: ${token.colorPrimary} !important;
      }

      /* Selection controls (全选 / 清除) */
      .htUISelectionControls a,
      .htDropdownMenu .htUISelectionControls a {
        color: ${token.colorPrimary} !important;
      }

      /* Action bar (确认 / 取消 buttons) */
      .htFiltersMenuActionBar,
      .htDropdownMenu .htFiltersMenuActionBar {
        padding: 8px !important;
        background-color: ${token.colorBgElevated} !important;
      }
      .htUIButton,
      .htFiltersMenuActionBar .htUIButton {
        background-color: ${token.colorBgContainer} !important;
        color: ${token.colorText} !important;
        border: 1px solid ${token.colorBorder} !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        overflow: hidden !important;
      }
      /* Inner <input type="button"> inside htUIButton — strip its own bg */
      .htUIButton input,
      .htUIButton input[type="button"],
      .htFiltersMenuActionBar .htUIButton input {
        background-color: transparent !important;
        color: inherit !important;
        border: none !important;
        cursor: pointer !important;
      }
      .htUIButton:hover,
      .htFiltersMenuActionBar .htUIButton:hover {
        background-color: ${token.colorPrimaryBg} !important;
        border-color: ${token.colorPrimary} !important;
      }
      /* OK button — must override Handsontable green */
      .htUIButtonOK,
      .htUIButton.htUIButtonOK,
      .htFiltersMenuActionBar .htUIButton.htUIButtonOK {
        background-color: ${token.colorPrimary} !important;
        color: #fff !important;
        border-color: ${token.colorPrimary} !important;
      }
      .htUIButtonOK input,
      .htUIButton.htUIButtonOK input,
      .htUIButton.htUIButtonOK input[type="button"] {
        color: #fff !important;
        background-color: transparent !important;
      }
      .htUIButtonOK:hover,
      .htUIButton.htUIButtonOK:hover {
        opacity: 0.85;
      }
      /* Cell autocomplete / dropdown list / select editor popups */
      .handsontable.listbox .ht_master table,
      .htSelectEditor .ht_master table,
      .ht_editor_visible .ht_master table {
        background-color: ${token.colorBgElevated} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .handsontable.listbox td,
      .handsontable.listbox th,
      .htSelectEditor td,
      .htSelectEditor th {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .handsontable.listbox tr td.current,
      .handsontable.listbox tr:hover td,
      .htSelectEditor tr td.current,
      .htSelectEditor tr:hover td {
        background-color: ${token.colorPrimaryBg} !important;
        color: ${token.colorText} !important;
      }
      /* Catch-all: any Handsontable instance used as a popup/editor for filter selects */
      .htFiltersMenuCondition .handsontable td,
      .htFiltersMenuCondition .htCore td,
      .htFiltersMenuCondition table.htCore {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .htFiltersMenuCondition .handsontable td.current,
      .htFiltersMenuCondition .handsontable td:hover {
        background-color: ${token.colorPrimaryBg} !important;
      }
      /* Column header: ensure dropdown button is always accessible */
      .handsontable thead th .relative {
        padding-right: 20px;
      }
      .handsontable thead th .colHeader {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
      }
      .handsontable thead th .changeType {
        position: absolute;
        right: 2px;
        top: 50%;
        transform: translateY(-50%);
      }

      /*
       * Global fallback — popup Handsontable instances (condition select list,
       * autocomplete, etc.) may be appended outside any known parent container.
       * Use the generated ht_ id prefix to target ALL instances.
       */
      div[id^="ht_"] .ht_master td {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      div[id^="ht_"] .ht_master td.current,
      div[id^="ht_"] .ht_master td:hover {
        background-color: ${token.colorPrimaryBg} !important;
      }

      /* Re-pin main data table cells (container has data-copiper-main) */
      [data-copiper-main] .ht_master td {
        background-color: ${token.colorBgContainer} !important;
      }
      [data-copiper-main] .ht_master td.htDimmed {
        background-color: ${token.colorBgLayout} !important;
        color: ${token.colorTextSecondary} !important;
      }
      [data-copiper-main] .ht_master tr:hover td,
      [data-copiper-main] .ht_master .currentRow td {
        background-color: ${token.colorPrimaryBg} !important;
      }
      [data-copiper-main] .ht_master .area td {
        background-color: ${token.colorPrimaryBgHover} !important;
      }
    `
    return () => { el?.remove() }
  }, [
    token.colorBgContainer, token.colorBgLayout, token.colorBgElevated,
    token.colorText, token.colorTextSecondary, token.colorBorderSecondary,
    token.colorBorder, token.colorPrimary, token.colorPrimaryBg,
    token.colorPrimaryBgHover, token.colorPrimaryHover, token.fontSize
  ])

  // Observe container size to give HotTable exact pixel dimensions
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setContainerSize({ width: Math.floor(width), height: Math.floor(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const tableData = useMemo(() => {
    if (!activeDatabase || !activeTableName) return null
    return activeDatabase[activeTableName] ?? null
  }, [activeDatabase, activeTableName])

  const columns = useMemo(() => {
    if (!tableData) return []
    return [...tableData.columns]
      .sort((a, b) => a.c_index - b.c_index)
      .filter((col) => col.c_type !== 'rdesc')
  }, [tableData])

  // Handsontable data: direct reference to store rows.
  // HotTable mutates these in place during editing — no re-render needed.
  // On structural changes (table switch, add/delete row, search) the memo
  // returns a new reference, which triggers HotTable.loadData automatically.
  const filteredRows = useMemo(() => {
    if (!tableData) return []
    const rows = tableData.rows
    if (!searchText) return rows
    const lowerSearch = searchText.toLowerCase()
    return rows.filter((row) =>
      Object.values(row).some((val) => {
        if (val == null) return false
        return String(val).toLowerCase().includes(lowerSearch)
      })
    )
  }, [tableData, searchText])

  // Column configs for Handsontable
  const hotColumns = useMemo((): Handsontable.ColumnSettings[] => {
    return columns.map((col) => {
      const config: Handsontable.ColumnSettings = {
        data: col.name,
        readOnly: col.c_type === 'sup',
        width: getColumnWidth(col)
      }

      const type = col.type || col.j_type || 'str'
      const rawBase = type.split('/')[0].split(':')[0]
      // list:index is equivalent to indices (multi-reference index dropdown)
      const isListIndex = type.startsWith('list:index') || (col.j_type || '').startsWith('list:index')
      const baseType = isListIndex ? 'indices' : rawBase

      // Enum or has options → dropdown
      if (col.options) {
        config.type = 'dropdown'
        config.source = Array.isArray(col.options)
          ? ['', ...col.options]
          : ['', ...String(col.options).split('|')]
        config.strict = false
        return config
      }

      switch (baseType) {
        case 'bool':
          config.type = 'checkbox'
          break
        case 'int':
          config.type = 'numeric'
          break
        case 'float':
          config.type = 'numeric'
          break
        case 'index': {
          // Single-reference dropdown (Handsontable built-in)
          const srcTable = col.src || type.split('/')[1]
          if (srcTable) {
            let options: string[] = []
            if (activeDatabase?.[srcTable]) {
              const srcRows = activeDatabase[srcTable].rows
              options = srcRows
                .map((r) => (r.idx_name != null ? String(r.idx_name) : String(r.id)))
                .filter(Boolean)
            } else if (referenceData[srcTable]) {
              options = referenceData[srcTable]
                .map((r) => (r.idx_name != null ? String(r.idx_name) : String(r.id)))
                .filter(Boolean)
            }
            if (options.length > 0) {
              config.type = 'dropdown'
              config.source = ['', ...options]
              config.strict = false
            }
          }
          break
        }
        case 'indices': {
          // Multi-reference: use custom multi-select checkbox editor because
          // Handsontable's built-in dropdown only supports single selection
          const srcTable = col.src || type.split('/')[1]
          if (srcTable) {
            let options: string[] = []
            if (activeDatabase?.[srcTable]) {
              const srcRows = activeDatabase[srcTable].rows
              options = srcRows
                .map((r) => (r.idx_name != null ? String(r.idx_name) : String(r.id)))
                .filter(Boolean)
            } else if (referenceData[srcTable]) {
              options = referenceData[srcTable]
                .map((r) => (r.idx_name != null ? String(r.idx_name) : String(r.id)))
                .filter(Boolean)
            }
            if (options.length > 0) {
              config.editor = 'multi-select' as any
              (config as any).source = options
            }
          }
          break
        }
        default:
          config.type = 'text'
          break
      }

      return config
    })
  }, [columns, activeDatabase, referenceData])

  // Column headers with rname + name
  const colHeaders = useMemo(() => {
    return columns.map((col) => {
      if (col.rname && col.rname !== col.name) {
        return `${col.rname} <span style="opacity:0.5;font-size:11px">(${col.name})</span>`
      }
      return col.name
    })
  }, [columns])

  // afterChange: HotTable already mutated data in place, just mark dirty
  const handleAfterChange = useCallback(
    (changes: Handsontable.CellChange[] | null, source: string) => {
      if (!changes || source === 'loadData' || source === 'updateData') return
      for (const change of changes) {
        if (change[2] !== change[3]) {
          markDirty()
          return
        }
      }
    },
    [markDirty]
  )

  // Double click on a cell opens the row detail drawer
  const handleDblClick = useCallback(
    (_event: MouseEvent, coords: { row: number; col: number }) => {
      if (coords.row >= 0 && onRowDoubleClick) {
        onRowDoubleClick(coords.row)
      }
    },
    [onRowDoubleClick]
  )

  // Track row selection for toolbar "Delete Selected"
  const handleAfterSelection = useCallback(
    (row: number, _col: number, row2: number) => {
      if (row < 0) return
      const minRow = Math.min(row, row2)
      const maxRow = Math.max(row, row2)
      const indices: number[] = []
      for (let r = minRow; r <= maxRow; r++) {
        indices.push(r)
      }
      setSelectedRowIndices(indices)
    },
    [setSelectedRowIndices]
  )

  const handleAfterDeselect = useCallback(() => {
    setSelectedRowIndices([])
  }, [setSelectedRowIndices])

  if (!tableData) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          color: token.colorTextSecondary
        }}
      >
        <Text type="secondary">请选择一张表</Text>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      data-copiper-main=""
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {containerSize.width > 0 && containerSize.height > 0 && (
        <HotTable
          ref={hotRef as any}
          data={filteredRows}
          columns={hotColumns}
          colHeaders={colHeaders}
          rowHeaders={true}
          width={containerSize.width}
          height={containerSize.height}
          stretchH="all"
          autoColumnSize={true}
          manualColumnResize={true}
          manualColumnFreeze={true}
          contextMenu={true}
          filters={true}
          dropdownMenu={true}
          autoWrapRow={true}
          autoWrapCol={true}
          outsideClickDeselects={false}
          search={true}
          language={zhCN.languageCode}
          licenseKey="non-commercial-and-evaluation"
          afterChange={handleAfterChange}
          afterOnCellDoubleClick={handleDblClick as any}
          afterSelection={handleAfterSelection as any}
          afterDeselect={handleAfterDeselect}
        />
      )}
    </div>
  )
}

/** Heuristic column width based on type */
function getColumnWidth(col: ColDef): number {
  const type = col.type || col.j_type || 'str'
  if (type === 'bool') return 60
  if (type === 'int' || type === 'float') return 80
  if (type === 'utc_time') return 160
  if (type.startsWith('kv:') || type.startsWith('ckv:') || type === 'dict') return 150
  if (type.startsWith('list:index')) return 130
  if (type.startsWith('list:')) return 120
  if (type.startsWith('index/') || type.startsWith('indices/')) return 130
  return 120
}

export default CopiperTable
