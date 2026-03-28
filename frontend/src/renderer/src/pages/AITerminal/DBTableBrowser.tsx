import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Button, Space, Typography, Spin, App, Tooltip, theme, Table, Popconfirm, Input } from 'antd'
import {
  ReloadOutlined, PlusOutlined, CopyOutlined, DeleteOutlined, EyeOutlined,
  SearchOutlined, FilterOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { FilterDropdownProps } from 'antd/es/table/interface'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import type { DBTableColumn, DBQueryResult } from '../../types/ai-terminal'
import DBRowDetailModal from './DBRowDetailModal'

const { Text } = Typography

const MAX_CELL_LENGTH = 100
const DEFAULT_PAGE_SIZE = 50

interface Props {
  tabId: string
  connectionId: string
  tableName: string
}

const DBTableBrowser: React.FC<Props> = ({ tabId, connectionId, tableName }) => {
  const { token } = theme.useToken()
  const { message, modal } = App.useApp()

  // Remove table header border-radius globally for DB browser
  useEffect(() => {
    const styleId = 'db-table-no-radius'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `.db-table-flat .ant-table-container,
        .db-table-flat .ant-table-header { border-radius: 0 !important; }
        .db-table-flat .ant-table-container table > thead > tr:first-child > *:first-child { border-start-start-radius: 0 !important; }
        .db-table-flat .ant-table-container table > thead > tr:first-child > *:last-child { border-start-end-radius: 0 !important; }`
      document.head.appendChild(style)
    }
  }, [])

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
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})

  // Dynamic table height
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableScrollY, setTableScrollY] = useState(300)

  useEffect(() => {
    const el = tableContainerRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        // Reserve space for table header (~39px) and pagination (~46px)
        const available = entry.contentRect.height - 85
        setTableScrollY(Math.max(100, available))
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Row detail modal
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailRow, setDetailRow] = useState<Record<string, any> | null>(null)
  const [detailMode, setDetailMode] = useState<'view' | 'edit' | 'new'>('view')

  const conn = useMemo(() =>
    useAITerminalStore.getState().dbConnections.find(c => c.id === connectionId),
    [connectionId]
  )

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
      message.error(`加载数据失败: ${err.message || String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [connectionId, tableName, currentPage, pageSize, queryDBPage, getDBTableCount, message])

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

  // Row click -> open detail
  const handleRowClick = useCallback((row: Record<string, any>) => {
    setDetailRow(row)
    setDetailMode('view')
    setDetailOpen(true)
  }, [])

  // New row
  const handleNewRow = useCallback(() => {
    setDetailRow(null)
    setDetailMode('new')
    setDetailOpen(true)
  }, [])

  // Copy row -> open modal with pre-filled data (new mode)
  const handleCopyRow = useCallback((row: Record<string, any>) => {
    // Remove PK fields so it inserts as new
    const copied = { ...row }
    for (const pk of pkColumns) {
      if (schema.find(s => s.name === pk)?.extra?.toLowerCase()?.includes('auto_increment')) {
        delete copied[pk]
      }
    }
    setDetailRow(copied)
    setDetailMode('new')
    setDetailOpen(true)
  }, [pkColumns, schema])

  // Delete row
  const handleDeleteRow = useCallback(async (row: Record<string, any>) => {
    if (pkColumns.length === 0) {
      message.warning('该表没有主键，无法删除行')
      return
    }
    try {
      await deleteDBRow(connectionId, tableName, getRowPKs(row))
      message.success('删除成功')
      loadData()
    } catch (err: any) {
      message.error(`删除失败: ${err.message || String(err)}`)
    }
  }, [connectionId, tableName, pkColumns, deleteDBRow, getRowPKs, loadData, message])

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
        throw new Error('该表没有主键，无法编辑')
      }
      await updateDBRow(connectionId, tableName, primaryKeys, rowDataOrChanges)
      loadData()
    }
  }, [detailMode, connectionId, tableName, insertDBRow, updateDBRow, loadData])

  // Modal delete handler
  const handleModalDelete = useCallback(async (primaryKeys: Record<string, any>) => {
    await deleteDBRow(connectionId, tableName, primaryKeys)
    loadData()
  }, [connectionId, tableName, deleteDBRow, loadData])

  const truncateValue = (val: any): string => {
    if (val === null || val === undefined) return ''
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
    if (str.length > MAX_CELL_LENGTH) {
      return str.slice(0, MAX_CELL_LENGTH) + '...'
    }
    return str
  }

  // ── Column filter dropdown ──
  const getColumnFilterDropdown = useCallback((colName: string) => {
    return ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
      <div style={{ padding: 8, minWidth: 180 }} onKeyDown={e => e.stopPropagation()}>
        <Input
          placeholder={`搜索 ${colName}`}
          value={selectedKeys[0] as string}
          onChange={e => setSelectedKeys(e.target.value ? [e.target.value] : [])}
          onPressEnter={() => {
            confirm()
            setColumnFilters(prev => ({ ...prev, [colName]: selectedKeys[0] as string || '' }))
          }}
          style={{ marginBottom: 8, display: 'block', fontSize: 12 }}
          size="small"
          allowClear
        />
        <Space size={4}>
          <Button
            type="primary"
            onClick={() => {
              confirm()
              setColumnFilters(prev => ({ ...prev, [colName]: selectedKeys[0] as string || '' }))
            }}
            icon={<SearchOutlined />}
            size="small"
            style={{ width: 72 }}
          >
            筛选
          </Button>
          <Button
            onClick={() => {
              clearFilters?.()
              setColumnFilters(prev => {
                const next = { ...prev }
                delete next[colName]
                return next
              })
              confirm()
            }}
            size="small"
            style={{ width: 72 }}
          >
            重置
          </Button>
        </Space>
      </div>
    )
  }, [])

  // ── Data table columns ──
  const dataColumns: ColumnsType<Record<string, any>> = useMemo(() => {
    if (!data?.columns) return []
    const cols: ColumnsType<Record<string, any>> = data.columns.map(col => ({
      title: col,
      dataIndex: col,
      key: col,
      ellipsis: true,
      width: 160,
      filterDropdown: getColumnFilterDropdown(col),
      filterIcon: (filtered: boolean) => (
        <FilterOutlined style={{ color: filtered ? token.colorPrimary : undefined, fontSize: 10 }} />
      ),
      filteredValue: columnFilters[col] ? [columnFilters[col]] : null,
      onFilter: (value, record) => {
        const cellVal = record[col]
        const str = cellVal !== null && cellVal !== undefined
          ? (typeof cellVal === 'object' ? JSON.stringify(cellVal) : String(cellVal))
          : ''
        return str.toLowerCase().includes(String(value).toLowerCase())
      },
      render: (val: any) => {
        const str = truncateValue(val)
        const fullStr = val !== null && typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')
        if (fullStr.length > MAX_CELL_LENGTH) {
          return <Tooltip title={<span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, display: 'block', overflow: 'auto' }}>{fullStr}</span>}>
            <span>{str}</span>
          </Tooltip>
        }
        return <span>{str}</span>
      }
    }))

    // Action column
    if (pkColumns.length > 0) {
      cols.push({
        title: '操作',
        key: '_actions',
        width: 120,
        fixed: 'right',
        render: (_: any, record: Record<string, any>) => (
          <Space size={4} onClick={e => e.stopPropagation()}>
            <Tooltip title="查看详情">
              <Button type="text" size="small" icon={<EyeOutlined />}
                onClick={() => handleRowClick(record)} />
            </Tooltip>
            <Tooltip title="复制行">
              <Button type="text" size="small" icon={<CopyOutlined />}
                onClick={() => handleCopyRow(record)} />
            </Tooltip>
            <Popconfirm title="确定删除此行？" onConfirm={() => handleDeleteRow(record)} okType="danger">
              <Tooltip title="删除行">
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          </Space>
        )
      })
    }
    return cols
  }, [data?.columns, pkColumns, handleRowClick, handleCopyRow, handleDeleteRow, columnFilters, getColumnFilterDropdown, token.colorPrimary])

  // ── Schema table columns ──
  const schemaColumns: ColumnsType<DBTableColumn> = [
    { title: '列名', dataIndex: 'name', key: 'name', width: 180,
      render: (val: string, record: DBTableColumn) => (
        <Text strong={record.primaryKey}>{val}</Text>
      )
    },
    { title: '类型', dataIndex: 'type', key: 'type', width: 160,
      render: (val: string) => <Text type="secondary">{val}</Text>
    },
    { title: '主键', dataIndex: 'primaryKey', key: 'primaryKey', width: 70, align: 'center',
      render: (val: boolean) => val ? '✓' : ''
    },
    { title: '可空', dataIndex: 'nullable', key: 'nullable', width: 70, align: 'center',
      render: (val: boolean) => val ? '✓' : ''
    },
    { title: '默认值', dataIndex: 'defaultValue', key: 'defaultValue', width: 140,
      render: (val: string) => <Text type="secondary">{val || ''}</Text>
    },
    { title: '备注', dataIndex: 'extra', key: 'extra',
      render: (val: string) => <Text type="secondary">{val || ''}</Text>
    }
  ]

  // Row data with index key
  const tableData = useMemo(() => {
    if (!data?.rows) return []
    return data.rows.map((row, idx) => ({
      ...row,
      _rowKey: pkColumns.length > 0
        ? pkColumns.map(pk => String(row[pk] ?? '')).join('__')
        : String(idx)
    }))
  }, [data?.rows, pkColumns])

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
              (共 {totalCount} 行, {data.executionTimeMs}ms)
            </Text>
          )}
        </Space>
        <Space size={4}>
          <Tooltip title="新增行">
            <Button type="text" size="small" icon={<PlusOutlined />} onClick={handleNewRow} />
          </Tooltip>
          <Tooltip title="刷新数据">
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
            {tab === 'data' ? '表数据' : '表结构'}
          </div>
        ))}
      </div>

      {/* Tab content */}
      <div ref={tableContainerRef} className="db-table-flat" style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {activeTab === 'data' ? (
          <Table
            columns={dataColumns}
            dataSource={tableData}
            rowKey="_rowKey"
            size="small"
            loading={loading}
            scroll={{ x: 'max-content', y: tableScrollY }}
            onRow={(record) => ({
              onClick: () => handleRowClick(record),
              style: { cursor: 'pointer' }
            })}
            pagination={{
              current: currentPage,
              pageSize,
              total: totalCount,
              showSizeChanger: true,
              showQuickJumper: true,
              pageSizeOptions: ['20', '50', '100', '200'],
              showTotal: (total, range) => `${range[0]}-${range[1]} / ${total} 行`,
              size: 'small',
              onChange: handlePageChange
            }}
            style={{ fontSize: 12 }}
          />
        ) : (
          <div style={{ overflow: 'auto', padding: 12, height: '100%' }}>
            <Table
              columns={schemaColumns}
              dataSource={schema}
              rowKey="name"
              size="small"
              loading={schemaLoading}
              pagination={false}
              style={{ fontSize: 12 }}
            />
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
