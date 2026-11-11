import React from 'react'
import { Button, Tooltip, Dropdown, theme } from 'antd'
import { Plus, Sparkles, Zap, Pencil, FileEdit, Trash2, Flame } from 'lucide'
import { InteractiveMorphIcon } from '../../components/common/InteractiveMorphIcon'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import { useT } from '../../i18n'
import type { QuickCommand } from '../../types/ai-terminal'

interface Props {
  onNew: () => void
  onEdit: (cmd: QuickCommand) => void
}

const QuickBar: React.FC<Props> = ({ onNew, onEdit }) => {
  const { token } = theme.useToken()
  const t = useT()
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
      <InteractiveMorphIcon icon={Zap} hoverIcon={Sparkles} size={12} style={{ color: token.colorTextTertiary, flexShrink: 0 }} />
      {applicableCommands.map(cmd => (
        <Dropdown
          key={cmd.id}
          trigger={['contextMenu']}
          menu={{
            items: [
              { key: 'edit', label: t('terminal.edit'), icon: <InteractiveMorphIcon icon={Pencil} hoverIcon={FileEdit} size={13} /> },
              { key: 'delete', label: t('common.delete'), icon: <InteractiveMorphIcon icon={Trash2} hoverIcon={Flame} size={13} />, danger: true }
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
      <Tooltip title={t('terminal.newQuickCmdTooltip')}>
        <Button
          type="dashed"
          size="small"
          icon={<InteractiveMorphIcon icon={Plus} hoverIcon={Sparkles} size={12} />}
          onClick={onNew}
          style={{ fontSize: 12, flexShrink: 0 }}
        />
      </Tooltip>
    </div>
  )
}

export default QuickBar
