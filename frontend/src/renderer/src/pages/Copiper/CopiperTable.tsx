import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react'
import { Typography, theme } from 'antd'
import { HotTable } from '@handsontable/react'
import { registerAllModules } from 'handsontable/registry'
import { registerLanguageDictionary, zhCN } from 'handsontable/i18n'
import type Handsontable from 'handsontable'
import 'handsontable/dist/handsontable.full.min.css'
import { useCopiperStore } from '../../stores/useCopiperStore'
import type { ColDef } from '../../types/copiper'

registerAllModules()
registerLanguageDictionary(zhCN)

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
      const baseType = type.split('/')[0].split(':')[0]

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
        case 'index':
        case 'indices': {
          // Dropdown populated from source table's idx_name/id values
          const srcTable = col.src || type.split('/')[1]
          if (srcTable) {
            let options: string[] = []
            if (activeDatabase?.[srcTable]) {
              // Source table is in the current JDB file
              const srcRows = activeDatabase[srcTable].rows
              options = srcRows
                .map((r) => (r.idx_name != null ? String(r.idx_name) : String(r.id)))
                .filter(Boolean)
            } else if (referenceData[srcTable]) {
              // Source table is in another JDB file (cross-file reference)
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
  if (type.startsWith('list:')) return 120
  if (type.startsWith('index/') || type.startsWith('indices/')) return 130
  return 120
}

export default CopiperTable
