import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Button, Space, Typography, App, Tooltip, theme, Pagination } from 'antd'
import { ReloadOutlined, PlusOutlined } from '@ant-design/icons'
import { HotTable } from '@handsontable/react'
import { registerAllModules } from 'handsontable/registry'
import { registerLanguageDictionary, zhCN } from 'handsontable/i18n'
import Handsontable from 'handsontable'
import 'handsontable/dist/handsontable.full.min.css'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import { useT, getT } from '../../i18n'
import { useHandsontableTheme, HOT_MAIN_ATTR } from '../../utils/handsontable-theme'
import type { DBTableColumn, DBQueryResult } from '../../types/ai-terminal'
import DBRowDetailModal from './DBRowDetailModal'

registerAllModules()
registerLanguageDictionary(zhCN)

const { Text } = Typography

const DEFAULT_PAGE_SIZE = 50

interface Props {
  tabId: string
  connectionId: string
  tableName: string
}

const DBTableBrowser: React.FC<Props> = ({ tabId, connectionId, tableName }) => {
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const t = useT()

  // Shared Handsontable theming (unified with Copiper's handsome table scheme)
  useHandsontableTheme()

  const {
    fetchDBTableSchema, queryDBPage, getDBTableCount,
    insertDBRow, deleteDBRow, updateDBRow
  } = useAITerminalStore()

  const [loading, setLoading] = useState(false)
  const [schema, setSchema] = useState<DBTableColumn[]>([])
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [data, setData] = useState<DBQueryResult | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [activeTab, setActiveTab] = useState<'data' | 'structure'>('data')

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

  // Row detail modal
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailRow, setDetailRow] = useState<Record<string, any> | null>(null)
  const [detailMode, setDetailMode] = useState<'view' | 'edit' | 'new'>('view')

  const pkColumns = useMemo(() => {
    const pks = schema.filter(c => c.primaryKey).map(c => c.name)
    if (pks.length > 0) return pks
    // Fallback for MongoDB
    if (data?.columns?.includes('_id')) return ['_id']
    return []
  }, [schema, data?.columns])

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

  // Open detail (view) for a given row index into the current page
  const openRowDetail = useCallback((rowIndex: number) => {
    const row = data?.rows?.[rowIndex]
    if (!row) return
    setDetailRow(row)
    setDetailMode('view')
    setDetailOpen(true)
  }, [data?.rows])

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
    return data.columns.map(col => ({ data: col, title: col, readOnly: true }))
  }, [data?.columns])

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

  // Double click on a data cell opens the row detail drawer (Copiper pattern)
  const handleDblClick = useCallback(
    (_event: MouseEvent, coords: { row: number; col: number }) => {
      if (coords.row >= 0) openRowDetail(coords.row)
    },
    [openRowDetail]
  )

  // Row operations exposed through the context menu (replaces the old action column)
  const contextMenuItems = useMemo(() => {
    const tt = getT()
    const items: Record<string, any> = {
      view_detail: {
        name: () => tt('db.viewDetail'),
        callback: (_key: string, selection: any[]) => {
          const r = selection?.[0]?.start?.row
          if (typeof r === 'number' && r >= 0) openRowDetail(r)
        }
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
      copy: {}
    }
    return { items }
  }, [pkColumns, openRowDetail, copyRowByIndex, deleteRowByIndex])

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
          <Tooltip title={t('db.addRow')}>
            <Button type="text" size="small" icon={<PlusOutlined />} onClick={handleNewRow} />
          </Tooltip>
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
              style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
            >
              {gridSize.width > 0 && gridSize.height > 0 && data && gridData.length > 0 ? (
                <HotTable
                  data={gridData}
                  columns={gridColumns}
                  colHeaders={data.columns}
                  rowHeaders={true}
                  width={gridSize.width}
                  height={gridSize.height}
                  stretchH="all"
                  readOnly
                  manualColumnResize={true}
                  manualColumnFreeze={true}
                  contextMenu={contextMenuItems as any}
                  filters={true}
                  dropdownMenu={true}
                  search={true}
                  outsideClickDeselects={false}
                  language={zhCN.languageCode}
                  licenseKey="non-commercial-and-evaluation"
                  afterOnCellDoubleClick={handleDblClick as any}
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
                contextMenu={['copy']}
                outsideClickDeselects={false}
                language={zhCN.languageCode}
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
    </div>
  )
}

export default DBTableBrowser