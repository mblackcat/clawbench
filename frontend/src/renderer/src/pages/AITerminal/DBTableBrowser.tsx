import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Button, Space, Typography, App, Tooltip, theme, Pagination } from 'antd'
import { ReloadOutlined, PlusOutlined, EditOutlined } from '@ant-design/icons'
import { HotTable } from '@handsontable/react'
import { registerAllModules } from 'handsontable/registry'
import { registerLanguageDictionary, zhCN, enUS } from 'handsontable/i18n'
import Handsontable from 'handsontable'
import 'handsontable/dist/handsontable.full.min.css'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useT, getT } from '../../i18n'
import { useHandsontableTheme, HOT_MAIN_ATTR } from '../../utils/handsontable-theme'
import type { DBTableColumn, DBQueryResult } from '../../types/ai-terminal'
import DBRowDetailModal from './DBRowDetailModal'
import DBColumnEditModal, { type ColumnDraft } from './DBColumnEditModal'
import { registerDBCellEditors } from './db-cell-editors'

registerAllModules()
registerLanguageDictionary(zhCN)
registerLanguageDictionary(enUS)
registerDBCellEditors()

/** Classify a column's SQL type into an editor category for the data grid. */
type CellKind = 'bool' | 'datetime' | 'number' | 'text' | 'string'
function classifyColumn(sqlType?: string): CellKind {
  const tp = (sqlType || '').toLowerCase()
  if (tp.includes('tinyint(1)') || tp === 'bool' || tp === 'boolean' || tp === 'bit') return 'bool'
  if (tp.includes('date') || tp.includes('time') || tp.includes('timestamp')) return 'datetime'
  if (tp.includes('text') || tp.includes('json') || tp.includes('blob') || tp.includes('clob')) return 'text'
  if (tp.includes('int') || tp.includes('float') || tp.includes('double') ||
      tp.includes('decimal') || tp.includes('numeric') || tp.includes('real')) return 'number'
  return 'string'
}

const { Text } = Typography

const DEFAULT_PAGE_SIZE = 50

interface Props {
  tabId: string
  connectionId: string
  tableName: string
}

const DBTableBrowser: React.FC<Props> = ({ tabId, connectionId, tableName }) => {
  const { token } = theme.useToken()
  const { message, modal } = App.useApp()
  const t = useT()

  // Handsontable UI language follows the app's locale
  const language = useSettingsStore(s => s.language)
  const hotLang = language === 'en' ? enUS.languageCode : zhCN.languageCode

  // Shared Handsontable theming (unified with Copiper's handsome table scheme)
  useHandsontableTheme()

  const {
    fetchDBTableSchema, queryDBPage, getDBTableCount,
    insertDBRow, deleteDBRow, updateDBRow,
    addDBColumn, deleteDBColumn
  } = useAITerminalStore()

  const [loading, setLoading] = useState(false)
  const [schema, setSchema] = useState<DBTableColumn[]>([])
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [data, setData] = useState<DBQueryResult | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [activeTab, setActiveTab] = useState<'data' | 'structure'>('data')
  // Read-only vs. inline-edit mode for the data grid (toggled from the toolbar)
  const [editMode, setEditMode] = useState(false)
  const hotRef = useRef<{ hotInstance: Handsontable | null } | null>(null)

  // Dynamic grid height
  const gridContainerRef = useRef<HTMLDivElement>(null)
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = gridContainerRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setGridSize({ width: Math.floor(width), height: Math.floor(height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Row detail modal (used only for new-row / copy-row inserts now — the
  // read-only "view" flow was replaced by the hover/click cell popup below)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailRow, setDetailRow] = useState<Record<string, any> | null>(null)
  const [detailMode, setDetailMode] = useState<'view' | 'edit' | 'new'>('new')

  // Read-only cell content popup (shown on hover / single click)
  const [cellPopup, setCellPopup] = useState<{ x: number; y: number; text: string } | null>(null)

  // Column add / copy modal (Structure page)
  const [colModalOpen, setColModalOpen] = useState(false)
  const [colModalMode, setColModalMode] = useState<'add' | 'copy'>('add')
  const [colModalInitial, setColModalInitial] = useState<ColumnDraft | null>(null)

  const pkColumns = useMemo(() => {
    const pks = schema.filter(c => c.primaryKey).map(c => c.name)
    if (pks.length > 0) return pks
    // Fallback for MongoDB
    if (data?.columns?.includes('_id')) return ['_id']
    return []
  }, [schema, data?.columns])

  // Column name → schema, for per-column editor typing in the data grid
  const schemaByName = useMemo(() => {
    const m: Record<string, DBTableColumn> = {}
    for (const c of schema) m[c.name] = c
    return m
  }, [schema])

  const loadSchema = useCallback(async () => {
    setSchemaLoading(true)
    try {
      await fetchDBTableSchema(connectionId, tableName)
      const key = `${connectionId}:${tableName}`
      const s = useAITerminalStore.getState().dbTableSchemas[key]
      if (s) setSchema(s)
    } catch {
      // ignore
    } finally {
      setSchemaLoading(false)
    }
  }, [connectionId, tableName, fetchDBTableSchema])

  const loadData = useCallback(async (page?: number, size?: number) => {
    const p = page ?? currentPage
    const s = size ?? pageSize
    setLoading(true)
    try {
      const [result, count] = await Promise.all([
        queryDBPage(connectionId, tableName, p, s),
        getDBTableCount(connectionId, tableName)
      ])
      setData(result)
      setTotalCount(count)
    } catch (err: any) {
      message.error(t('db.loadFailed', err.message || String(err)))
    } finally {
      setLoading(false)
    }
  }, [connectionId, tableName, currentPage, pageSize, queryDBPage, getDBTableCount, message, t])

  useEffect(() => {
    loadSchema()
    loadData(1, DEFAULT_PAGE_SIZE)
  }, [])

  const handlePageChange = useCallback((page: number, size: number) => {
    setCurrentPage(page)
    setPageSize(size)
    loadData(page, size)
  }, [loadData])

  const handleRefresh = useCallback(() => {
    loadData()
  }, [loadData])

  // Get primary keys for a row
  const getRowPKs = useCallback((row: Record<string, any>): Record<string, any> => {
    const keys: Record<string, any> = {}
    for (const pk of pkColumns) {
      keys[pk] = row[pk]
    }
    return keys
  }, [pkColumns])

  // New row
  const handleNewRow = useCallback(() => {
    setDetailRow(null)
    setDetailMode('new')
    setDetailOpen(true)
  }, [])

  // Copy row -> open modal with pre-filled data (new mode)
  const copyRowByIndex = useCallback((rowIndex: number) => {
    const row = data?.rows?.[rowIndex]
    if (!row) return
    const copied = { ...row }
    for (const pk of pkColumns) {
      if (schema.find(s => s.name === pk)?.extra?.toLowerCase()?.includes('auto_increment')) {
        delete copied[pk]
      }
    }
    setDetailRow(copied)
    setDetailMode('new')
    setDetailOpen(true)
  }, [data?.rows, pkColumns, schema])

  // Delete row
  const deleteRowByIndex = useCallback(async (rowIndex: number) => {
    const row = data?.rows?.[rowIndex]
    if (!row) return
    if (pkColumns.length === 0) {
      message.warning(t('db.noPkDelete'))
      return
    }
    try {
      await deleteDBRow(connectionId, tableName, getRowPKs(row))
      message.success(t('db.deleteSuccess'))
      loadData()
    } catch (err: any) {
      message.error(t('db.deleteFailed', err.message || String(err)))
    }
  }, [data?.rows, connectionId, tableName, pkColumns, deleteDBRow, getRowPKs, loadData, message, t])

  // Modal save handler
  const handleModalSave = useCallback(async (
    rowDataOrChanges: Record<string, any>,
    primaryKeys?: Record<string, any>
  ) => {
    if (detailMode === 'new') {
      await insertDBRow(connectionId, tableName, rowDataOrChanges)
      loadData()
    } else {
      // Edit mode
      if (!primaryKeys || Object.keys(primaryKeys).length === 0) {
        throw new Error(t('db.noPkEdit'))
      }
      await updateDBRow(connectionId, tableName, primaryKeys, rowDataOrChanges)
      loadData()
    }
  }, [detailMode, connectionId, tableName, insertDBRow, updateDBRow, loadData, t])

  // Modal delete handler
  const handleModalDelete = useCallback(async (primaryKeys: Record<string, any>) => {
    await deleteDBRow(connectionId, tableName, primaryKeys)
    loadData()
  }, [connectionId, tableName, deleteDBRow, loadData])

  // ── Data grid: display rows with object cells stringified ──
  const gridData = useMemo(() => {
    if (!data?.rows) return []
    return data.rows.map(row => {
      const displayRow: Record<string, any> = {}
      for (const [k, v] of Object.entries(row)) {
        displayRow[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v
      }
      return displayRow
    })
  }, [data?.rows])

  const gridColumns = useMemo((): Handsontable.ColumnSettings[] => {
    if (!data?.columns) return []
    return data.columns.map(col => {
      const colSchema = schemaByName[col]
      const isPk = pkColumns.includes(col)
      // PKs stay read-only even in edit mode (they're the WHERE key)
      const cellReadOnly = !editMode || isPk
      const config: Handsontable.ColumnSettings = {
        data: col,
        title: col,
        readOnly: cellReadOnly
      }
      if (!editMode) return config

      switch (classifyColumn(colSchema?.type)) {
        case 'bool':
          config.type = 'dropdown'
          config.source = ['true', 'false']
          config.allowInvalid = false
          break
        case 'datetime':
          config.editor = 'db-datetime' as any
          break
        case 'text':
          config.editor = 'db-text-expand' as any
          break
        case 'number':
          config.type = 'numeric'
          break
        default:
          config.editor = 'db-text-expand' as any
          break
      }
      return config
    })
  }, [data?.columns, editMode, schemaByName, pkColumns])

  // Persist a single inline cell edit back to the DB
  const handleAfterChange = useCallback(
    async (changes: Handsontable.CellChange[] | null, source: string) => {
      if (!changes || source === 'loadData' || source === 'updateData') return
      if (pkColumns.length === 0) {
        message.warning(t('db.noPkEdit'))
        return
      }
      for (const [rowIdx, prop, oldVal, newVal] of changes) {
        if (String(oldVal ?? '') === String(newVal ?? '')) continue
        const row = data?.rows?.[rowIdx as number]
        if (!row) continue
        const col = String(prop)
        // Coerce the raw grid value to what the column's SQL type expects.
        // Booleans (incl. MySQL tinyint(1)) must go in as numeric 1/0 — the
        // dropdown yields the strings 'true'/'false', which would otherwise be
        // quoted and rejected by an integer column.
        let coerced: any = newVal === '' ? null : newVal
        if (coerced !== null && classifyColumn(schemaByName[col]?.type) === 'bool') {
          coerced = (coerced === true || coerced === 'true' || coerced === 1 || coerced === '1') ? 1 : 0
        }
        try {
          await updateDBRow(connectionId, tableName, getRowPKs(row), {
            [col]: coerced
          })
          // Keep local copy in sync so re-opening the detail view is correct
          row[col] = coerced
          message.success(t('db.saveSuccess'))
        } catch (err: any) {
          message.error(t('db.operateFailed', err.message || String(err)))
          loadData()
        }
      }
    },
    [pkColumns, data?.rows, connectionId, tableName, getRowPKs, updateDBRow, loadData, message, t, schemaByName]
  )

  // ── Structure grid: schema rows ──
  const structureData = useMemo(() => {
    return schema.map(c => ({
      name: c.name,
      type: c.type,
      primaryKey: c.primaryKey ? '✓' : '',
      nullable: c.nullable ? '✓' : '',
      defaultValue: c.defaultValue ?? '',
      extra: c.extra ?? ''
    }))
  }, [schema])

  const structureColumns = useMemo((): Handsontable.ColumnSettings[] => [
    { data: 'name', readOnly: true, width: 200 },
    { data: 'type', readOnly: true, width: 180 },
    { data: 'primaryKey', readOnly: true, width: 80, className: 'htCenter' },
    { data: 'nullable', readOnly: true, width: 80, className: 'htCenter' },
    { data: 'defaultValue', readOnly: true, width: 160 },
    { data: 'extra', readOnly: true, width: 160 }
  ], [])

  const structureHeaders = useMemo(() => [
    t('db.colName'), t('db.colType'), t('db.colPk'),
    t('db.colNullable'), t('db.colDefault'), t('db.colExtra')
  ], [t])

  // ── Read-only cell content popup (hover / single click) ──
  // Shows the full, untruncated cell value in a floating box anchored to the
  // cell. Only active in read-only mode; edit mode uses inline cell editors.
  const showCellPopup = useCallback((td: HTMLElement, row: number, col: number) => {
    if (editMode || row < 0 || col < 0) return
    const colName = data?.columns?.[col]
    if (!colName) return
    const raw = data?.rows?.[row]?.[colName]
    const text = raw === null || raw === undefined
      ? 'NULL'
      : (typeof raw === 'object' ? JSON.stringify(raw, null, 2) : String(raw))
    const rect = td.getBoundingClientRect()
    setCellPopup({ x: rect.left, y: rect.bottom + 2, text })
  }, [editMode, data?.columns, data?.rows])

  const handleCellMouseOver = useCallback(
    (_event: MouseEvent, coords: { row: number; col: number }, td: HTMLElement) => {
      showCellPopup(td, coords.row, coords.col)
    },
    [showCellPopup]
  )

  const handleCellMouseDown = useCallback(
    (_event: MouseEvent, coords: { row: number; col: number }, td: HTMLElement) => {
      showCellPopup(td, coords.row, coords.col)
    },
    [showCellPopup]
  )

  const hideCellPopup = useCallback(() => {
    setCellPopup(null)
  }, [])

  // ── Structure page: column operations ──
  const isMongo = useMemo(
    () => useAITerminalStore.getState().dbConnections.find(c => c.id === connectionId)?.type === 'mongodb',
    [connectionId]
  )

  const openAddColumn = useCallback(() => {
    setColModalMode('add')
    setColModalInitial(null)
    setColModalOpen(true)
  }, [])

  const copyColumnByIndex = useCallback((rowIndex: number) => {
    const c = schema[rowIndex]
    if (!c) return
    setColModalMode('copy')
    setColModalInitial({
      name: `${c.name}_copy`,
      type: c.type,
      nullable: c.nullable,
      defaultValue: c.defaultValue ?? ''
    })
    setColModalOpen(true)
  }, [schema])

  const deleteColumnByIndex = useCallback((rowIndex: number) => {
    const c = schema[rowIndex]
    if (!c) return
    if (isMongo) {
      message.warning(t('db.columnOpUnsupported'))
      return
    }
    modal.confirm({
      title: t('db.deleteColumn'),
      content: t('db.confirmDeleteColumn', c.name),
      okType: 'danger',
      okText: t('db.deleteColumn'),
      cancelText: t('db.cancel'),
      onOk: async () => {
        try {
          await deleteDBColumn(connectionId, tableName, c.name)
          message.success(t('db.deleteColumnSuccess'))
          await loadSchema()
          loadData()
        } catch (err: any) {
          message.error(t('db.operateFailed', err.message || String(err)))
        }
      }
    })
  }, [schema, isMongo, modal, connectionId, tableName, deleteDBColumn, loadSchema, loadData, message, t])

  const handleColumnSubmit = useCallback(async (col: ColumnDraft) => {
    if (isMongo) throw new Error(t('db.columnOpUnsupported'))
    await addDBColumn(connectionId, tableName, col)
    await loadSchema()
    loadData()
  }, [isMongo, addDBColumn, connectionId, tableName, loadSchema, loadData, t])

  // Structure grid context menu: copy / copy column / add column / delete column
  const structureContextMenu = useMemo(() => {
    const tt = getT()
    return {
      items: {
        copy: {},
        sep1: { name: '---------' },
        copy_column: {
          name: () => tt('db.copyColumn'),
          callback: (_key: string, selection: any[]) => {
            const r = selection?.[0]?.start?.row
            if (typeof r === 'number' && r >= 0) copyColumnByIndex(r)
          }
        },
        add_column: {
          name: () => tt('db.addColumn'),
          callback: () => openAddColumn()
        },
        delete_column: {
          name: () => tt('db.deleteColumn'),
          disabled: () => isMongo,
          callback: (_key: string, selection: any[]) => {
            const r = selection?.[0]?.start?.row
            if (typeof r === 'number' && r >= 0) deleteColumnByIndex(r)
          }
        }
      }
    }
  }, [copyColumnByIndex, openAddColumn, deleteColumnByIndex, isMongo])

  // Row operations exposed through the context menu (replaces the old action column).
  // The detail "view" option is gone — the edit/read-only toggle takes its place.
  const contextMenuItems = useMemo(() => {
    const tt = getT()
    const items: Record<string, any> = {
      toggle_edit: {
        name: () => (editMode ? tt('db.toggleReadonly') : tt('db.toggleEdit')),
        callback: () => setEditMode(v => !v)
      },
      copy_row: {
        name: () => tt('db.copyRow'),
        disabled: () => pkColumns.length === 0,
        callback: (_key: string, selection: any[]) => {
          const r = selection?.[0]?.start?.row
          if (typeof r === 'number' && r >= 0) copyRowByIndex(r)
        }
      },
      delete_row: {
        name: () => tt('db.deleteRow'),
        disabled: () => pkColumns.length === 0,
        callback: (_key: string, selection: any[]) => {
          const r = selection?.[0]?.start?.row
          if (typeof r === 'number' && r >= 0) deleteRowByIndex(r)
        }
      },
      sep1: { name: '---------' },
      copy: { name: () => tt('db.copyCell') }
    }
    return { items }
  }, [editMode, pkColumns, copyRowByIndex, deleteRowByIndex])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgLayout, flexShrink: 0
      }}>
        <Space size={8}>
          <Text strong style={{ fontSize: 13 }}>{tableName}</Text>
          {data && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('db.totalCountInfo', totalCount, data.executionTimeMs)}
            </Text>
          )}
        </Space>
        <Space size={4}>
          {activeTab === 'data' ? (
            <>
              <Tooltip title={editMode ? t('db.editModeOn') : t('db.editModeOff')}>
                <Button
                  type={editMode ? 'primary' : 'text'}
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => setEditMode(v => !v)}
                />
              </Tooltip>
              <Tooltip title={t('db.addRow')}>
                <Button type="text" size="small" icon={<PlusOutlined />} onClick={handleNewRow} />
              </Tooltip>
            </>
          ) : (
            <Tooltip title={t('db.addColumn')}>
              <Button type="text" size="small" icon={<PlusOutlined />} onClick={openAddColumn} disabled={isMongo} />
            </Tooltip>
          )}
          <Tooltip title={t('db.refreshData')}>
            <Button type="text" size="small" icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
          </Tooltip>
        </Space>
      </div>

      {/* Manual tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        paddingLeft: 12,
        background: token.colorBgLayout,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        flexShrink: 0
      }}>
        {(['data', 'structure'] as const).map(tab => (
          <div
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '6px 16px',
              fontSize: 12,
              cursor: 'pointer',
              borderBottom: activeTab === tab ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
              color: activeTab === tab ? token.colorText : token.colorTextSecondary,
              fontWeight: activeTab === tab ? 500 : 400,
              transition: 'color 0.2s',
              userSelect: 'none',
            }}
          >
            {tab === 'data' ? t('db.tableData') : t('db.tableStructure')}
          </div>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeTab === 'data' ? (
          <>
            <div
              ref={gridContainerRef}
              {...{ [HOT_MAIN_ATTR]: '' }}
              onMouseLeave={hideCellPopup}
              style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
            >
              {gridSize.width > 0 && gridSize.height > 0 && data && gridData.length > 0 ? (
                <HotTable
                  ref={hotRef as any}
                  data={gridData}
                  columns={gridColumns}
                  colHeaders={data.columns}
                  rowHeaders={true}
                  width={gridSize.width}
                  height={gridSize.height}
                  stretchH="all"
                  readOnly={!editMode}
                  rowHeights={22}
                  manualColumnResize={true}
                  manualColumnFreeze={true}
                  contextMenu={contextMenuItems as any}
                  filters={true}
                  dropdownMenu={true}
                  search={true}
                  outsideClickDeselects={false}
                  wordWrap={false}
                  className="db-grid-compact"
                  language={hotLang}
                  licenseKey="non-commercial-and-evaluation"
                  afterChange={handleAfterChange as any}
                  afterOnCellMouseOver={handleCellMouseOver as any}
                  afterOnCellMouseDown={handleCellMouseDown as any}
                />
              ) : (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '100%', color: token.colorTextTertiary, fontSize: 13
                }}>
                  {loading ? '' : t('db.queryEmpty')}
                </div>
              )}
            </div>
            {/* Pagination */}
            <div style={{
              display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
              padding: '4px 12px', flexShrink: 0,
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgLayout
            }}>
              <Pagination
                current={currentPage}
                pageSize={pageSize}
                total={totalCount}
                showSizeChanger
                showQuickJumper
                pageSizeOptions={['20', '50', '100', '200']}
                showTotal={(total, range) => t('db.paginationTotal', range[0], range[1], total)}
                size="small"
                onChange={handlePageChange}
              />
            </div>
          </>
        ) : (
          <div
            {...{ [HOT_MAIN_ATTR]: '' }}
            style={{ flex: 1, position: 'relative', overflow: 'hidden', padding: 12 }}
          >
            {schema.length > 0 ? (
              <HotTable
                data={structureData}
                columns={structureColumns}
                colHeaders={structureHeaders}
                rowHeaders={true}
                width="100%"
                height="100%"
                stretchH="all"
                readOnly
                manualColumnResize={true}
                contextMenu={structureContextMenu as any}
                outsideClickDeselects={false}
                language={hotLang}
                licenseKey="non-commercial-and-evaluation"
              />
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '100%', color: token.colorTextTertiary, fontSize: 13
              }}>
                {schemaLoading ? '' : t('db.queryEmpty')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row detail modal */}
      <DBRowDetailModal
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setDetailRow(null) }}
        rowData={detailMode === 'new' && !detailRow ? null : detailRow}
        columns={data?.columns || schema.map(s => s.name)}
        schema={schema}
        connectionId={connectionId}
        tableName={tableName}
        mode={detailMode}
        onSave={handleModalSave}
        onDelete={handleModalDelete}
      />

      {/* Read-only cell content popup (hover / single click) */}
      {cellPopup && (
        <div
          style={{
            position: 'fixed',
            left: cellPopup.x,
            top: cellPopup.y,
            zIndex: 10050,
            maxWidth: 480,
            maxHeight: 320,
            overflow: 'auto',
            padding: '6px 10px',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: token.colorText,
            background: token.colorBgElevated,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 6,
            boxShadow: token.boxShadow,
            pointerEvents: 'none'
          }}
        >
          {cellPopup.text}
        </div>
      )}

      {/* Add / copy column modal (Structure page) */}
      <DBColumnEditModal
        open={colModalOpen}
        onClose={() => setColModalOpen(false)}
        initial={colModalInitial}
        mode={colModalMode}
        onSubmit={handleColumnSubmit}
      />
    </div>
  )
}

export default DBTableBrowser