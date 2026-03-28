import React from 'react'
import { Tabs, Button, Typography, theme } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import DBTableBrowser from './DBTableBrowser'
import DBQueryEditor from './DBQueryEditor'

const { Text } = Typography

const DBContentPanel: React.FC = () => {
  const { token } = theme.useToken()
  const { openDBTabs, activeDBTabId, setActiveDBTab, closeDBTab } = useAITerminalStore()

  if (openDBTabs.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: token.colorTextTertiary,
        fontSize: 14
      }}>
        双击左侧表名浏览数据，或右键连接打开 SQL 查询
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgLayout,
        overflowX: 'auto',
        flexShrink: 0
      }}>
        {openDBTabs.map(tab => (
          <div
            key={tab.id}
            onClick={() => setActiveDBTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              cursor: 'pointer',
              borderBottom: tab.id === activeDBTabId ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
              background: tab.id === activeDBTabId ? token.colorBgContainer : 'transparent',
              fontSize: 12,
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
          >
            <Text ellipsis style={{ fontSize: 12, maxWidth: 160 }}>{tab.title}</Text>
            <CloseOutlined
              onClick={(e) => { e.stopPropagation(); closeDBTab(tab.id) }}
              style={{ fontSize: 10, color: token.colorTextTertiary }}
            />
          </div>
        ))}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {openDBTabs.map(tab => (
          <div
            key={tab.id}
            style={{
              display: tab.id === activeDBTabId ? 'flex' : 'none',
              flexDirection: 'column',
              height: '100%',
              overflow: 'hidden'
            }}
          >
            {tab.type === 'table' && tab.tableName ? (
              <DBTableBrowser tabId={tab.id} connectionId={tab.connectionId} tableName={tab.tableName} />
            ) : (
              <DBQueryEditor tabId={tab.id} connectionId={tab.connectionId} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default DBContentPanel
