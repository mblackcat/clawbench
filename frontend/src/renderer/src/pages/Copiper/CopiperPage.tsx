import React, { useEffect, useCallback, useState } from 'react'
import { Result, Spin, App, theme } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { useCopiperStore } from '../../stores/useCopiperStore'
import { useWorkspaceStore } from '../../stores/useWorkspaceStore'
import CopiperSidebar from './CopiperSidebar'
import CopiperToolbar from './CopiperToolbar'
import CopiperTable from './CopiperTable'
import CopiperBottomBar from './CopiperBottomBar'
import ColumnEditor from './ColumnEditor'
import ExportModal from './ExportModal'
import RowDetailDrawer from './RowDetailDrawer'
import ValidationPanel from './ValidationPanel'

const CopiperPage: React.FC = () => {
  const { token } = theme.useToken()
  const { message } = App.useApp()

  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)

  const loading = useCopiperStore((s) => s.loading)
  const dirty = useCopiperStore((s) => s.dirty)
  const activeDatabase = useCopiperStore((s) => s.activeDatabase)
  const activeTableName = useCopiperStore((s) => s.activeTableName)
  const validationIssues = useCopiperStore((s) => s.validationIssues)
  const fetchDatabases = useCopiperStore((s) => s.fetchDatabases)
  const saveCurrentDatabase = useCopiperStore((s) => s.saveCurrentDatabase)

  // Modal/drawer state
  const [columnEditorOpen, setColumnEditorOpen] = useState(false)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [rowDetailOpen, setRowDetailOpen] = useState(false)
  const [rowDetailIndex, setRowDetailIndex] = useState<number | null>(null)

  // Fetch databases when workspace changes
  useEffect(() => {
    if (activeWorkspace?.path) {
      fetchDatabases(activeWorkspace.path)
    }
  }, [activeWorkspace?.path])

  // Ctrl+S keyboard shortcut to save
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (dirty) {
          saveCurrentDatabase()
            .then(() => message.success('已保存'))
            .catch(() => message.error('保存失败'))
        }
      }
    },
    [dirty, saveCurrentDatabase, message]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Dirty warning when navigating away
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const handleSave = async () => {
    try {
      await saveCurrentDatabase()
      message.success('已保存')
    } catch {
      message.error('保存失败')
    }
  }

  const handleExport = () => {
    setExportModalOpen(true)
  }

  const handleRowDoubleClick = (rowIndex: number) => {
    setRowDetailIndex(rowIndex)
    setRowDetailOpen(true)
  }

  // No workspace selected
  if (!activeWorkspace) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Result
          icon={<InboxOutlined />}
          title="请先选择工作区"
          subTitle="在左侧菜单中选择或创建一个工作区后即可使用配表工具"
        />
      </div>
    )
  }

  // Get current table data for display
  const currentTable =
    activeDatabase && activeTableName ? activeDatabase[activeTableName] : null

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Sidebar */}
      <CopiperSidebar />

      {/* Main content area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0
        }}
      >
        {/* Toolbar */}
        <CopiperToolbar
          onOpenColumnEditor={() => setColumnEditorOpen(true)}
          onOpenExportModal={() => setExportModalOpen(true)}
        />

        {/* Table content area */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            background: token.colorBgLayout,
            position: 'relative'
          }}
        >
          {loading ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%'
              }}
            >
              <Spin size="large" />
            </div>
          ) : !currentTable ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                color: token.colorTextSecondary
              }}
            >
              <Result
                icon={<InboxOutlined style={{ color: token.colorTextQuaternary }} />}
                title={
                  <span style={{ color: token.colorTextSecondary }}>
                    {activeDatabase ? '请选择一张表' : '请选择一个 JDB 文件'}
                  </span>
                }
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <CopiperTable onRowDoubleClick={handleRowDoubleClick} />
              </div>
              {validationIssues.length > 0 && (
                <div style={{ maxHeight: 200, overflow: 'auto', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                  <ValidationPanel />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <CopiperBottomBar onSave={handleSave} onExport={handleExport} />
      </div>

      {/* Column editor modal */}
      <ColumnEditor
        open={columnEditorOpen}
        onClose={() => setColumnEditorOpen(false)}
      />

      {/* Export modal */}
      <ExportModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
      />

      {/* Row detail drawer */}
      <RowDetailDrawer
        open={rowDetailOpen}
        rowIndex={rowDetailIndex}
        onClose={() => {
          setRowDetailOpen(false)
          setRowDetailIndex(null)
        }}
      />
    </div>
  )
}

export default CopiperPage
