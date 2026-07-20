import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { Tree, Dropdown, Input, App, Modal, theme, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  DatabaseOutlined,
  TableOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  SearchOutlined,
  LinkOutlined,
  CloudSyncOutlined,
  DisconnectOutlined
} from '@ant-design/icons'
import { useCopiperStore } from '../../stores/useCopiperStore'
import { useWorkspaceStore } from '../../stores/useWorkspaceStore'
import { useT } from '../../i18n'
import type { FeishuFileSyncStatus, FeishuSyncStatusLight } from '../../types/copiper'

function statusLightColor(light: FeishuSyncStatusLight, token: ReturnType<typeof theme.useToken>['token']): string | null {
  switch (light) {
    case 'ok':
    case 'syncing':
      return token.colorSuccess
    case 'error':
    case 'disconnected':
      return token.colorError
    case 'conflict':
      return token.colorWarning
    default:
      return null
  }
}

interface CopiperSidebarProps {
  onOpenFeishuLink?: (filePath: string) => void
  onSyncNow?: (filePath: string) => void
}

const CopiperSidebar: React.FC<CopiperSidebarProps> = ({
  onOpenFeishuLink,
  onSyncNow
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const { message, modal } = App.useApp()

  const databases = useCopiperStore((s) => s.databases)
  const activeFilePath = useCopiperStore((s) => s.activeFilePath)
  const activeTableName = useCopiperStore((s) => s.activeTableName)
  const loadDatabase = useCopiperStore((s) => s.loadDatabase)
  const selectTable = useCopiperStore((s) => s.selectTable)
  const createDatabase = useCopiperStore((s) => s.createDatabase)
  const deleteDatabase = useCopiperStore((s) => s.deleteDatabase)
  const addTable = useCopiperStore((s) => s.addTable)
  const removeTable = useCopiperStore((s) => s.removeTable)
  const renameTable = useCopiperStore((s) => s.renameTable)
  const fetchDatabases = useCopiperStore((s) => s.fetchDatabases)
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)

  const [feishuStatus, setFeishuStatus] = useState<Record<string, FeishuFileSyncStatus>>({})
  const [feishuAvailable, setFeishuAvailable] = useState(false)

  useEffect(() => {
    void window.api.copiper.feishuAvailability().then((a) => setFeishuAvailable(a.available))
    const off = window.api.copiper.onFeishuStatus((status) => {
      setFeishuStatus((prev) => ({ ...prev, [status.filePath]: status }))
    })
    return off
  }, [])

  // Seed status for linked files from list meta
  useEffect(() => {
    for (const db of databases) {
      if (db.feishuLinked && !feishuStatus[db.filePath]) {
        void window.api.copiper.feishuGetStatus(db.filePath).then((s) => {
          setFeishuStatus((prev) => ({ ...prev, [db.filePath]: s }))
        })
      }
    }
  }, [databases])

  const [sidebarWidth, setSidebarWidth] = useState(240)
  const isResizing = useRef(false)

  // Search/filter state (supports regex)
  const [filterText, setFilterText] = useState('')
  const [filterError, setFilterError] = useState(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isResizing.current = true
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth

    const onMouseMove = (me: MouseEvent) => {
      const newWidth = Math.min(480, Math.max(160, startWidth + me.clientX - startX))
      setSidebarWidth(newWidth)
    }
    const onMouseUp = () => {
      isResizing.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [sidebarWidth])

  const [contextMenuTarget, setContextMenuTarget] = useState<{
    type: 'file' | 'table'
    filePath: string
    tableName?: string
  } | null>(null)

  // New JDB dialog state
  const [newDbOpen, setNewDbOpen] = useState(false)
  const [newDbName, setNewDbName] = useState('')
  const [newTableInDbName, setNewTableInDbName] = useState('')

  // New table dialog state
  const [newTableOpen, setNewTableOpen] = useState(false)
  const [newTableName, setNewTableName] = useState('')

  // Rename table dialog state
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  // Filter databases by regex
  const filteredDatabases = useMemo(() => {
    if (!filterText.trim()) return databases
    try {
      const regex = new RegExp(filterText, 'i')
      setFilterError(false)
      return databases.filter((db) => regex.test(db.fileName))
    } catch {
      setFilterError(true)
      return databases
    }
  }, [databases, filterText])

  const treeData = useMemo(() => {
    return filteredDatabases.map((db) => {
      const st = feishuStatus[db.filePath]
      const light = st?.light || (db.feishuLinked ? 'ok' : 'none')
      const color = statusLightColor(light, token)
      return {
        key: db.filePath,
        title: (
          <span
            title={db.fileName + (st?.message ? ` — ${st.message}` : '')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              maxWidth: sidebarWidth - 56,
              verticalAlign: 'middle'
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0
              }}
            >
              {db.fileName}
            </span>
            {color && (
              <Tooltip
                title={
                  light === 'syncing'
                    ? t('copiper.feishu.statusSyncing')
                    : light === 'ok'
                      ? t('copiper.feishu.statusOk')
                      : light === 'conflict'
                        ? t('copiper.feishu.statusConflict')
                        : t('copiper.feishu.statusError')
                }
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: color,
                    flexShrink: 0,
                    boxShadow:
                      light === 'syncing'
                        ? `0 0 0 2px ${token.colorSuccessBg}`
                        : undefined
                  }}
                />
              </Tooltip>
            )}
          </span>
        ),
        icon: <DatabaseOutlined style={{ fontSize: 12 }} />,
        children: db.tableNames.map((tn) => ({
          key: `${db.filePath}::${tn}`,
          title: (
            <span
              title={tn}
              style={{
                display: 'inline-block',
                maxWidth: sidebarWidth - 72,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                verticalAlign: 'middle'
              }}
            >
              {tn}
            </span>
          ),
          icon: <TableOutlined style={{ fontSize: 12 }} />,
          isLeaf: true
        }))
      }
    })
  }, [filteredDatabases, sidebarWidth, feishuStatus, token, t])

  const selectedKeys = useMemo(() => {
    if (activeFilePath && activeTableName) {
      return [`${activeFilePath}::${activeTableName}`]
    }
    if (activeFilePath) {
      return [activeFilePath]
    }
    return []
  }, [activeFilePath, activeTableName])

  const handleSelect = async (keys: React.Key[]) => {
    if (keys.length === 0) return
    const key = String(keys[0])

    if (key.includes('::')) {
      const [filePath, tableName] = key.split('::')
      if (filePath !== activeFilePath) {
        await loadDatabase(filePath)
      }
      selectTable(tableName)
    } else {
      await loadDatabase(key)
    }
  }

  const handleCreateDb = async () => {
    if (!activeWorkspace || !newDbName.trim() || !newTableInDbName.trim()) return
    const filePath = `${activeWorkspace.path}/${newDbName.trim()}.jdb`
    try {
      await createDatabase(filePath, newTableInDbName.trim())
      await fetchDatabases(activeWorkspace.path)
      message.success(t('copiper.dbCreated'))
    } catch {
      message.error(t('copiper.dbCreateFailed'))
    }
    setNewDbOpen(false)
    setNewDbName('')
    setNewTableInDbName('')
  }

  const handleDeleteDb = (filePath: string) => {
    const db = databases.find((d) => d.filePath === filePath)
    modal.confirm({
      title: t('common.delete'),
      content: t('copiper.confirmDeleteDb', db?.fileName || filePath),
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await deleteDatabase(filePath)
          if (activeWorkspace) {
            await fetchDatabases(activeWorkspace.path)
          }
          message.success(t('copiper.dbDeleted'))
        } catch {
          message.error(t('copiper.dbDeleteFailed'))
        }
      }
    })
  }

  const handleAddTable = async () => {
    if (!newTableName.trim()) return
    try {
      await addTable(newTableName.trim())
      if (activeWorkspace) {
        await fetchDatabases(activeWorkspace.path)
      }
      message.success(t('copiper.tableAdded'))
    } catch {
      message.error(t('copiper.tableAddFailed'))
    }
    setNewTableOpen(false)
    setNewTableName('')
  }

  const handleRemoveTable = (filePath: string, tableName: string) => {
    modal.confirm({
      title: t('copiper.confirmDeleteTableTitle'),
      content: t('copiper.confirmDeleteTable', tableName),
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          if (filePath !== activeFilePath) {
            await loadDatabase(filePath)
          }
          await removeTable(tableName)
          if (activeWorkspace) {
            await fetchDatabases(activeWorkspace.path)
          }
          message.success(t('copiper.tableDeleted'))
        } catch {
          message.error(t('copiper.tableDeleteFailed'))
        }
      }
    })
  }

  const handleRenameTable = async () => {
    if (!renameValue.trim() || !contextMenuTarget?.tableName) return
    try {
      await renameTable(contextMenuTarget.tableName, renameValue.trim())
      if (activeWorkspace) {
        await fetchDatabases(activeWorkspace.path)
      }
      message.success(t('copiper.tableRenamed'))
    } catch {
      message.error(t('copiper.tableRenameFailed'))
    }
    setRenameOpen(false)
    setRenameValue('')
  }

  const fileMenuItems: MenuProps['items'] = [
    {
      key: 'new-db',
      icon: <PlusOutlined />,
      label: t('copiper.newDb'),
      onClick: () => {
        setNewDbName('')
        setNewTableInDbName('')
        setNewDbOpen(true)
      }
    },
    {
      key: 'new-table',
      icon: <PlusOutlined />,
      label: t('copiper.newTable'),
      disabled: !contextMenuTarget,
      onClick: () => {
        if (!contextMenuTarget) return
        // Ensure the file is loaded
        if (contextMenuTarget.filePath !== activeFilePath) {
          loadDatabase(contextMenuTarget.filePath)
        }
        setNewTableName('')
        setNewTableOpen(true)
      }
    },
    ...(feishuAvailable
      ? ([
          { type: 'divider' as const },
          {
            key: 'feishu-link',
            icon: <LinkOutlined />,
            label: t('copiper.feishu.connectMenu'),
            disabled: !contextMenuTarget,
            onClick: () => {
              if (contextMenuTarget && onOpenFeishuLink) {
                if (contextMenuTarget.filePath !== activeFilePath) {
                  void loadDatabase(contextMenuTarget.filePath)
                }
                onOpenFeishuLink(contextMenuTarget.filePath)
              }
            }
          },
          {
            key: 'feishu-sync',
            icon: <CloudSyncOutlined />,
            label: t('copiper.feishu.syncNow'),
            disabled:
              !contextMenuTarget ||
              !(
                feishuStatus[contextMenuTarget?.filePath || '']?.linked ||
                databases.find((d) => d.filePath === contextMenuTarget?.filePath)?.feishuLinked
              ),
            onClick: () => {
              if (contextMenuTarget && onSyncNow) {
                onSyncNow(contextMenuTarget.filePath)
              }
            }
          },
          {
            key: 'feishu-disconnect',
            icon: <DisconnectOutlined />,
            label: t('copiper.feishu.disconnect'),
            disabled:
              !contextMenuTarget ||
              !(
                feishuStatus[contextMenuTarget?.filePath || '']?.linked ||
                databases.find((d) => d.filePath === contextMenuTarget?.filePath)?.feishuLinked
              ),
            onClick: () => {
              if (!contextMenuTarget) return
              const fp = contextMenuTarget.filePath
              modal.confirm({
                title: t('copiper.feishu.disconnect'),
                content: t('copiper.feishu.disconnectConfirm'),
                onOk: async () => {
                  const res = await window.api.copiper.feishuDisconnect(fp, false)
                  if (res.ok) {
                    message.success(t('copiper.feishu.disconnected'))
                    setFeishuStatus((prev) => ({
                      ...prev,
                      [fp]: { filePath: fp, linked: false, light: 'none' }
                    }))
                    if (activeWorkspace) await fetchDatabases(activeWorkspace.path)
                  } else {
                    message.error(res.error || t('copiper.feishu.disconnectFailed'))
                  }
                }
              })
            }
          }
        ] as NonNullable<MenuProps['items']>)
      : []),
    { type: 'divider' },
    {
      key: 'delete-db',
      icon: <DeleteOutlined />,
      label: t('copiper.deleteDb'),
      danger: true,
      disabled: !contextMenuTarget,
      onClick: () => {
        if (contextMenuTarget) {
          handleDeleteDb(contextMenuTarget.filePath)
        }
      }
    }
  ]

  const tableMenuItems: MenuProps['items'] = [
    {
      key: 'rename-table',
      icon: <EditOutlined />,
      label: t('copiper.renameTable'),
      onClick: () => {
        if (contextMenuTarget?.tableName) {
          setRenameValue(contextMenuTarget.tableName)
          setRenameOpen(true)
        }
      }
    },
    { type: 'divider' },
    {
      key: 'delete-table',
      icon: <DeleteOutlined />,
      label: t('copiper.deleteTable'),
      danger: true,
      onClick: () => {
        if (contextMenuTarget?.tableName) {
          handleRemoveTable(contextMenuTarget.filePath, contextMenuTarget.tableName)
        }
      }
    }
  ]

  return (
    <div
      style={{
        width: sidebarWidth,
        minWidth: 160,
        height: '100%',
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      <div
        style={{
          padding: '12px 12px 8px',
          fontWeight: 600,
          fontSize: 14,
          color: token.colorText,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span>{t('copiper.jdbFiles')}</span>
        <PlusOutlined
          style={{ cursor: 'pointer', color: token.colorPrimary }}
          onClick={() => {
            setNewDbName('')
            setNewTableInDbName('')
            setNewDbOpen(true)
          }}
        />
      </div>

      {/* Search/filter input */}
      <div style={{ padding: '6px 8px 4px' }}>
        <Input
          size="small"
          placeholder={t('copiper.searchFilterPlaceholder')}
          prefix={<SearchOutlined style={{ color: token.colorTextQuaternary, fontSize: 12 }} />}
          allowClear
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          status={filterError ? 'error' : undefined}
        />
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '2px 0' }}>
        <Dropdown
          menu={{
            items:
              contextMenuTarget?.type === 'table' ? tableMenuItems : fileMenuItems
          }}
          trigger={['contextMenu']}
        >
          <div
            className="copiper-sidebar-tree"
            style={{ fontSize: 13 }}
          >
            <style>{`
              .copiper-sidebar-tree .ant-tree {
                font-size: 13px;
              }
              .copiper-sidebar-tree .ant-tree-indent-unit {
                width: 12px;
              }
              .copiper-sidebar-tree .ant-tree-switcher {
                width: 16px;
                line-height: 24px;
              }
              .copiper-sidebar-tree .ant-tree-node-content-wrapper {
                padding: 0 2px;
                line-height: 24px;
                min-height: 24px;
              }
              .copiper-sidebar-tree .ant-tree-iconEle {
                width: 16px;
                line-height: 24px;
              }
              .copiper-sidebar-tree .ant-tree-treenode {
                padding: 0;
              }
            `}</style>
            <Tree
              showIcon
              treeData={treeData}
              selectedKeys={selectedKeys}
              onSelect={handleSelect}
              onRightClick={({ node }) => {
                const key = String(node.key)
                if (key.includes('::')) {
                  const [filePath, tableName] = key.split('::')
                  setContextMenuTarget({ type: 'table', filePath, tableName })
                } else {
                  setContextMenuTarget({ type: 'file', filePath: key })
                }
              }}
              defaultExpandAll
            />
          </div>
        </Dropdown>
      </div>

      {/* New JDB Dialog */}
      <Modal
        title={t('copiper.newDb')}
        open={newDbOpen}
        onCancel={() => setNewDbOpen(false)}
        onOk={handleCreateDb}
        okText={t('common.create')}
        cancelText={t('common.cancel')}
        okButtonProps={{ disabled: !newDbName.trim() || !newTableInDbName.trim() }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ marginBottom: 4, color: token.colorText }}>{t('copiper.fileName')}</div>
            <Input
              placeholder={t('copiper.fileNamePlaceholder')}
              value={newDbName}
              onChange={(e) => setNewDbName(e.target.value)}
              suffix=".jdb"
            />
          </div>
          <div>
            <div style={{ marginBottom: 4, color: token.colorText }}>{t('copiper.initialTableName')}</div>
            <Input
              placeholder={t('copiper.fileNamePlaceholder')}
              value={newTableInDbName}
              onChange={(e) => setNewTableInDbName(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* New Table Dialog */}
      <Modal
        title={t('copiper.newTable')}
        open={newTableOpen}
        onCancel={() => setNewTableOpen(false)}
        onOk={handleAddTable}
        okText={t('common.create')}
        cancelText={t('common.cancel')}
        okButtonProps={{ disabled: !newTableName.trim() }}
      >
        <div>
          <div style={{ marginBottom: 4, color: token.colorText }}>{t('copiper.tableName')}</div>
          <Input
            placeholder={t('copiper.tableNamePlaceholder')}
            value={newTableName}
            onChange={(e) => setNewTableName(e.target.value)}
          />
        </div>
      </Modal>

      {/* Rename Table Dialog */}
      <Modal
        title={t('copiper.renameTable')}
        open={renameOpen}
        onCancel={() => setRenameOpen(false)}
        onOk={handleRenameTable}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        okButtonProps={{ disabled: !renameValue.trim() }}
      >
        <div>
          <div style={{ marginBottom: 4, color: token.colorText }}>{t('copiper.newTableName')}</div>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
          />
        </div>
      </Modal>

      {/* Resize drag handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          width: 4,
          cursor: 'col-resize',
          background: 'transparent',
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          zIndex: 10,
        }}
        onMouseEnter={(e) => { (e.target as HTMLElement).style.background = token.colorPrimaryBg }}
        onMouseLeave={(e) => { if (!isResizing.current) (e.target as HTMLElement).style.background = 'transparent' }}
      />
    </div>
  )
}

export default CopiperSidebar
