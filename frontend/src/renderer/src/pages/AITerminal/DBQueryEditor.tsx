import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Button, Space, Typography, Input, Spin, App, Tooltip, theme } from 'antd'
import { PlayCircleOutlined, ClearOutlined } from '@ant-design/icons'
import { HotTable } from '@handsontable/react'
import { registerAllModules } from 'handsontable/registry'
import 'handsontable/dist/handsontable.full.min.css'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import type { DBQueryResult } from '../../types/ai-terminal'

registerAllModules()

const { TextArea } = Input
const { Text } = Typography

interface Props {
  tabId: string
  connectionId: string
}

const DBQueryEditor: React.FC<Props> = ({ tabId, connectionId }) => {
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const [sql, setSql] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DBQueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hotRef = useRef<any>(null)
  const executeRef = useRef<((sql?: string) => void) | null>(null)
  const pendingHandledRef = useRef<string | null>(null)

  // Pick up pending SQL from bottom panel executor
  const pendingSQL = useAITerminalStore(s => s.pendingSQL[tabId])
  useEffect(() => {
    if (pendingSQL && pendingSQL !== pendingHandledRef.current) {
      const sqlToExec = pendingSQL
      pendingHandledRef.current = pendingSQL
      setSql(sqlToExec)
      // Clear pending
      useAITerminalStore.setState(state => {
        const next = { ...state.pendingSQL }
        delete next[tabId]
        return { pendingSQL: next }
      })
      // Auto-execute with the SQL directly
      setTimeout(() => {
        executeRef.current?.(sqlToExec)
      }, 0)
    }
  }, [pendingSQL, tabId])

  // Inject theme CSS
  useEffect(() => {
    const styleId = 'db-query-hot-theme'
    let style = document.getElementById(styleId) as HTMLStyleElement
    if (!style) {
      style = document.createElement('style')
      style.id = styleId
      document.head.appendChild(style)
    }
    style.textContent = `
      .dbq-hot-container .ht_master table { color: ${token.colorText}; font-size: ${token.fontSize}px; }
      .dbq-hot-container .handsontable th { background: ${token.colorBgLayout}; color: ${token.colorText}; border-color: ${token.colorBorderSecondary} !important; }
      .dbq-hot-container .handsontable td { background: ${token.colorBgContainer}; border-color: ${token.colorBorderSecondary} !important; }
      .dbq-hot-container .handsontable td.current, .dbq-hot-container .handsontable td.area { background: ${token.colorPrimaryBg} !important; }
    `
    return () => { style.textContent = '' }
  }, [token])

  const handleExecute = useCallback(async (overrideSQL?: string) => {
    const sqlToRun = overrideSQL ?? sql
    if (!sqlToRun.trim()) return
    setLoading(true)
    setError(null)

    try {
      const conn = useAITerminalStore.getState().dbConnections.find(c => c.id === connectionId)
      const isMongo = conn?.type === 'mongodb'

      if (isMongo) {
        // For MongoDB, try to parse as JSON filter
        try {
          const parsed = JSON.parse(sqlToRun.trim() || '{}')
          const collectionMatch = sqlToRun.match(/^(\w+)\.find\(/)
          // Simple: treat entire input as collection name or filter
          message.info('MongoDB 请在表浏览模式中操作，或使用 AI 助手查询')
          return
        } catch {
          message.info('MongoDB 查询请使用 AI 助手或表浏览模式')
          return
        }
      }

      // Determine if query or execute
      const trimmed = sqlToRun.trim().toUpperCase()
      const isQuery = trimmed.startsWith('SELECT') || trimmed.startsWith('SHOW') || trimmed.startsWith('DESCRIBE')
        || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH') || trimmed.startsWith('EXPLAIN')

      if (isQuery) {
        const data = await window.api.aiTerminal.queryDB(connectionId, sqlToRun)
        setResult(data)
      } else {
        const data = await window.api.aiTerminal.executeDB(connectionId, sqlToRun)
        setResult({
          columns: ['affected_rows', 'execution_time_ms'],
          rows: [{ affected_rows: data.affectedRows, execution_time_ms: data.executionTimeMs }],
          affectedRows: data.affectedRows,
          executionTimeMs: data.executionTimeMs
        })
        message.success(`执行成功，影响 ${data.affectedRows} 行`)
      }
    } catch (err: any) {
      setError(err.message || String(err))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [sql, connectionId, message])

  // Keep executeRef in sync
  executeRef.current = handleExecute

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleExecute()
    }
  }, [handleExecute])

  const tableData = useMemo(() => {
    if (!result?.rows) return []
    return result.rows.map(row => {
      const displayRow: Record<string, any> = {}
      for (const [k, v] of Object.entries(row)) {
        displayRow[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v
      }
      return displayRow
    })
  }, [result?.rows])

  const columns = useMemo(() => {
    if (!result?.columns) return []
    return result.columns.map(col => ({ data: col, title: col, readOnly: true }))
  }, [result?.columns])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* SQL Editor */}
      <div style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        flexShrink: 0
      }}>
        <TextArea
          value={sql}
          onChange={e => setSql(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入 SQL 查询... (Ctrl+Enter 执行)"
          autoSize={{ minRows: 3, maxRows: 10 }}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <Space size={8}>
            <Button
              type="primary"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={handleExecute}
              loading={loading}
              disabled={!sql.trim()}
            >
              执行
            </Button>
            <Button
              type="text"
              size="small"
              icon={<ClearOutlined />}
              onClick={() => { setSql(''); setResult(null); setError(null) }}
            >
              清空
            </Button>
          </Space>
          {result && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {result.rows.length} 行 · {result.executionTimeMs}ms
              {result.affectedRows !== undefined && ` · 影响 ${result.affectedRows} 行`}
            </Text>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="dbq-hot-container" style={{ flex: 1, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Spin />
          </div>
        ) : error ? (
          <div style={{
            padding: 16, color: token.colorError, fontSize: 13,
            fontFamily: 'monospace', whiteSpace: 'pre-wrap'
          }}>
            {error}
          </div>
        ) : result && tableData.length > 0 ? (
          <HotTable
            ref={hotRef}
            data={tableData}
            columns={columns}
            colHeaders={result.columns}
            rowHeaders={true}
            width="100%"
            height="100%"
            stretchH="all"
            readOnly
            licenseKey="non-commercial-and-evaluation"
            manualColumnResize
            contextMenu={['copy']}
            outsideClickDeselects={false}
          />
        ) : result ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: token.colorTextTertiary, fontSize: 13
          }}>
            查询结果为空
          </div>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: token.colorTextTertiary, fontSize: 13
          }}>
            输入 SQL 并按 Ctrl+Enter 执行
          </div>
        )}
      </div>
    </div>
  )
}

export default DBQueryEditor
