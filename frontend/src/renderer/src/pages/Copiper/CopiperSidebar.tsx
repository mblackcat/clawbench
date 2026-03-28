import React, { useMemo, useState, useRef, useCallback } from 'react'
import { Tree, Dropdown, Input, App, Modal, theme } from 'antd'
import type { MenuProps } from 'antd'
import {
  DatabaseOutlined,
  TableOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { useCopiperStore } from '../../stores/useCopiperStore'
import { useWorkspaceStore } from '../../stores/useWorkspaceStore'

const CopiperSidebar: React.FC = () => {
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
    return filteredDatabases.map((db) => ({
      key: db.filePath,
      title: (
        <span
          title={db.fileName}
          style={{
            display: 'inline-block',
            maxWidth: sidebarWidth - 56,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            verticalAlign: 'middle',
          }}
        >
          {db.fileName}
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
              verticalAlign: 'middle',
            }}
          >
            {tn}
          </span>
        ),
        icon: <TableOutlined style={{ fontSize: 12 }} />,
        isLeaf: true
      }))
    }))
  }, [filteredDatabases, sidebarWidth])

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
      message.success('JDB 文件已创建')
    } catch {
      message.error('创建 JDB 文件失败')
    }
    setNewDbOpen(false)
    setNewDbName('')
    setNewTableInDbName('')
  }

  const handleDeleteDb = (filePath: string) => {
    const db = databases.find((d) => d.filePath === filePath)
    modal.confirm({
      title: '确认删除',
      content: `确定要删除 ${db?.fileName || filePath} 吗？此操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteDatabase(filePath)
          if (activeWorkspace) {
            await fetchDatabases(activeWorkspace.path)
          }
          message.success('JDB 文件已删除')
        } catch {
          message.error('删除 JDB 文件失败')
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
      message.success('表已添加')
    } catch {
      message.error('添加表失败')
    }
    setNewTableOpen(false)
    setNewTableName('')
  }

  const handleRemoveTable = (filePath: string, tableName: string) => {
    modal.confirm({
      title: '确认删除表',
      content: `确定要删除表 "${tableName}" 吗？此操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          if (filePath !== activeFilePath) {
            await loadDatabase(filePath)
          }
          await removeTable(tableName)
          if (activeWorkspace) {
            await fetchDatabases(activeWorkspace.path)
          }
          message.success('表已删除')
        } catch {
          message.error('删除表失败')
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
      message.success('表已重命名')
    } catch {
      message.error('重命名表失败')
    }
    setRenameOpen(false)
    setRenameValue('')
  }

  const fileMenuItems: MenuProps['items'] = [
    {
      key: 'new-db',
      icon: <PlusOutlined />,
      label: '新建 JDB 文件',
      onClick: () => {
        setNewDbName('')
        setNewTableInDbName('')
        setNewDbOpen(true)
      }
    },
    {
      key: 'new-table',
      icon: <PlusOutlined />,
      label: '新建表',
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
    { type: 'divider' },
    {
      key: 'delete-db',
      icon: <DeleteOutlined />,
      label: '删除 JDB 文件',
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
      label: '重命名表',
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
      label: '删除表',
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
        <span>JDB 文件</span>
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
          placeholder="搜索过滤 (支持正则)"
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
        title="新建 JDB 文件"
        open={newDbOpen}
        onCancel={() => setNewDbOpen(false)}
        onOk={handleCreateDb}
        okText="创建"
        cancelText="取消"
        okButtonProps={{ disabled: !newDbName.trim() || !newTableInDbName.trim() }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ marginBottom: 4, color: token.colorText }}>文件名</div>
            <Input
              placeholder="例如: CropData"
              value={newDbName}
              onChange={(e) => setNewDbName(e.target.value)}
              suffix=".jdb"
            />
          </div>
          <div>
            <div style={{ marginBottom: 4, color: token.colorText }}>初始表名</div>
            <Input
              placeholder="例如: CropData"
              value={newTableInDbName}
              onChange={(e) => setNewTableInDbName(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* New Table Dialog */}
      <Modal
        title="新建表"
        open={newTableOpen}
        onCancel={() => setNewTableOpen(false)}
        onOk={handleAddTable}
        okText="创建"
        cancelText="取消"
        okButtonProps={{ disabled: !newTableName.trim() }}
      >
        <div>
          <div style={{ marginBottom: 4, color: token.colorText }}>表名</div>
          <Input
            placeholder="例如: ItemData"
            value={newTableName}
            onChange={(e) => setNewTableName(e.target.value)}
          />
        </div>
      </Modal>

      {/* Rename Table Dialog */}
      <Modal
        title="重命名表"
        open={renameOpen}
        onCancel={() => setRenameOpen(false)}
        onOk={handleRenameTable}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ disabled: !renameValue.trim() }}
      >
        <div>
          <div style={{ marginBottom: 4, color: token.colorText }}>新表名</div>
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
