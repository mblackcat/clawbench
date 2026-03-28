import React from 'react'
import { Button, Tooltip, Dropdown, theme } from 'antd'
import { PlusOutlined, ThunderboltOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import type { QuickCommand } from '../../types/ai-terminal'

interface Props {
  onNew: () => void
  onEdit: (cmd: QuickCommand) => void
}

const QuickBar: React.FC<Props> = ({ onNew, onEdit }) => {
  const { token } = theme.useToken()
  const { quickCommands, activeTabId, executeQuickCommand, deleteQuickCommand } = useAITerminalStore()

  // Filter commands applicable to current tab
  const activeTab = useAITerminalStore(s => s.openTabs.find(t => t.id === s.activeTabId))
  const applicableCommands = quickCommands.filter(cmd =>
    cmd.targets.length === 0 || (activeTab && cmd.targets.includes(activeTab.connectionId))
  )

  if (applicableCommands.length === 0 && !activeTabId) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '4px 8px',
      borderBottom: `1px solid ${token.colorBorderSecondary}`,
      background: token.colorBgLayout,
      flexShrink: 0,
      overflowX: 'auto'
    }}>
      <ThunderboltOutlined style={{ color: token.colorTextTertiary, fontSize: 12, flexShrink: 0 }} />
      {applicableCommands.map(cmd => (
        <Dropdown
          key={cmd.id}
          trigger={['contextMenu']}
          menu={{
            items: [
              { key: 'edit', label: '编辑', icon: <EditOutlined /> },
              { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true }
            ],
            onClick: ({ key }) => {
              if (key === 'edit') onEdit(cmd)
              else if (key === 'delete') deleteQuickCommand(cmd.id)
            }
          }}
        >
          <Button
            size="small"
            onClick={() => executeQuickCommand(cmd.id)}
            style={{ fontSize: 12 }}
          >
            {cmd.name}
          </Button>
        </Dropdown>
      ))}
      <Tooltip title="新建快捷命令">
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={onNew}
          style={{ fontSize: 12, flexShrink: 0 }}
        />
      </Tooltip>
    </div>
  )
}

export default QuickBar
