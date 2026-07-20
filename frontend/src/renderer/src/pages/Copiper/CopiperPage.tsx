import React, { useEffect, useCallback, useState } from 'react'
import { Result, Spin, App, theme } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { useCopiperStore } from '../../stores/useCopiperStore'
import { useWorkspaceStore } from '../../stores/useWorkspaceStore'
import { useT } from '../../i18n'
import CopiperSidebar from './CopiperSidebar'
import CopiperToolbar from './CopiperToolbar'
import CopiperTable from './CopiperTable'
import CopiperBottomBar from './CopiperBottomBar'
import ColumnEditor from './ColumnEditor'
import ExportModal from './ExportModal'
import RowDetailDrawer from './RowDetailDrawer'
import ValidationPanel from './ValidationPanel'
import FeishuLinkModal from './FeishuLinkModal'
import SyncConflictModal, { type SyncConflictItem } from './SyncConflictModal'
import { getTableData } from '../../types/copiper'

const CopiperPage: React.FC = () => {
  const t = useT()
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
  const [feishuLinkOpen, setFeishuLinkOpen] = useState(false)
  const [feishuLinkPath, setFeishuLinkPath] = useState<string | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [conflictPath, setConflictPath] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<SyncConflictItem[]>([])

  // Fetch databases when workspace changes + start Feishu watchers
  useEffect(() => {
    if (activeWorkspace?.path) {
      fetchDatabases(activeWorkspace.path)
      void window.api.copiper.feishuRefreshWatchers(activeWorkspace.path)
    }
  }, [activeWorkspace?.path])

  // Feishu conflict push events
  useEffect(() => {
    const off = window.api.copiper.onFeishuConflict((payload) => {
      setConflictPath(payload.filePath)
      setConflicts(payload.conflicts as SyncConflictItem[])
      setConflictOpen(true)
      message.warning(t('copiper.feishu.conflictDetected'))
    })
    return off
  }, [message, t])

  // Ctrl+S keyboard shortcut to save
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (dirty) {
          saveCurrentDatabase()
            .then(() => message.success(t('common.saved')))
            .catch(() => message.error(t('common.saveFailed')))
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

  const handleOpenFeishuLink = (filePath: string) => {
    setFeishuLinkPath(filePath)
    setFeishuLinkOpen(true)
  }

  const handleSyncNow = async (filePath: string) => {
    try {
      message.loading({ content: t('copiper.feishu.syncing'), key: 'feishu-sync' })
      const result = await window.api.copiper.feishuSyncNow(filePath)
      if (result.conflicts?.length) {
        message.warning({ content: t('copiper.feishu.conflictDetected'), key: 'feishu-sync' })
        setConflictPath(filePath)
        setConflicts(result.conflicts as SyncConflictItem[])
        setConflictOpen(true)
      } else if (result.ok) {
        message.success({ content: t('copiper.feishu.syncDone'), key: 'feishu-sync' })
        // reload if this file is active
        const { activeFilePath, loadDatabase } = useCopiperStore.getState()
        if (activeFilePath === filePath) {
          await loadDatabase(filePath)
        }
      } else {
        const errMsg =
          result.error === 'feishu_login_required'
            ? t('copiper.feishu.needLogin')
            : result.error || t('copiper.feishu.syncFailed')
        message.error({ content: errMsg, key: 'feishu-sync' })
      }
    } catch {
      message.error({ content: t('copiper.feishu.syncFailed'), key: 'feishu-sync' })
    }
  }

  const handleSave = async () => {
    try {
      await saveCurrentDatabase()
      message.success(t('common.saved'))
    } catch {
      message.error(t('common.saveFailed'))
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
          title={t('copiper.selectWorkspaceFirst')}
          subTitle={t('copiper.selectWorkspaceHint')}
        />
      </div>
    )
  }

  // Get current table data for empty-state checks
  const currentTable =
    activeDatabase && activeTableName
      ? getTableData(activeDatabase, activeTableName)
      : null

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Sidebar */}
      <CopiperSidebar
        onOpenFeishuLink={handleOpenFeishuLink}
        onSyncNow={handleSyncNow}
      />

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
          onOpenFeishuLink={() => {
            const fp = useCopiperStore.getState().activeFilePath
            if (fp) handleOpenFeishuLink(fp)
          }}
          onSyncNow={() => {
            const fp = useCopiperStore.getState().activeFilePath
            if (fp) void handleSyncNow(fp)
          }}
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
                    {activeDatabase ? t('copiper.selectTable') : t('copiper.selectJdbFile')}
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

      <FeishuLinkModal
        open={feishuLinkOpen}
        filePath={feishuLinkPath}
        onClose={() => setFeishuLinkOpen(false)}
        onSaved={() => {
          if (activeWorkspace?.path) {
            void fetchDatabases(activeWorkspace.path)
            void window.api.copiper.feishuRefreshWatchers(activeWorkspace.path)
          }
        }}
      />

      <SyncConflictModal
        open={conflictOpen}
        filePath={conflictPath}
        conflicts={conflicts}
        onClose={() => setConflictOpen(false)}
        onResolved={async () => {
          if (conflictPath) {
            const { activeFilePath, loadDatabase } = useCopiperStore.getState()
            if (activeFilePath === conflictPath) {
              await loadDatabase(conflictPath)
            }
          }
        }}
      />
    </div>
  )
}

export default CopiperPage
