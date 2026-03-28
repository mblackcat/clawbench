import React from 'react'
import { theme, Typography } from 'antd'
import { CloseOutlined, ReloadOutlined } from '@ant-design/icons'
import { useAITerminalStore } from '../../stores/useAITerminalStore'

const { Text } = Typography

const TerminalTabBar: React.FC = () => {
  const { token } = theme.useToken()
  const { openTabs, activeTabId, setActiveTab, closeTab, reconnectTab } = useAITerminalStore()

  if (openTabs.length === 0) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      borderBottom: `1px solid ${token.colorBorderSecondary}`,
      background: token.colorBgLayout,
      overflowX: 'auto',
      flexShrink: 0
    }}>
      {openTabs.map(tab => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              cursor: 'pointer',
              borderBottom: isActive ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
              background: isActive ? token.colorBgContainer : 'transparent',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: tab.status === 'connected' ? token.colorSuccess
                : tab.status === 'connecting' ? token.colorWarning
                : token.colorTextDisabled,
              flexShrink: 0
            }} />
            <Text style={{ fontSize: 12, color: isActive ? token.colorText : token.colorTextSecondary }}>
              {tab.title}
            </Text>
            {tab.status === 'disconnected' && (
              <ReloadOutlined
                onClick={(e) => { e.stopPropagation(); reconnectTab(tab.id) }}
                style={{
                  fontSize: 10,
                  color: token.colorWarning,
                  marginLeft: 4,
                  cursor: 'pointer'
                }}
              />
            )}
            <CloseOutlined
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
              style={{
                fontSize: 10,
                color: token.colorTextTertiary,
                marginLeft: 4
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

export default TerminalTabBar
