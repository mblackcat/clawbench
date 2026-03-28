import React, { useCallback } from 'react'
import { Typography, Tabs, Button, Tooltip, App, theme } from 'antd'
import {
  PlusOutlined, SyncOutlined, CloseOutlined, DesktopOutlined,
  CloudServerOutlined, DeleteOutlined, EditOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, FileTextOutlined
} from '@ant-design/icons'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import { useT } from '../../i18n'
import type { TerminalConnection, DBConnection } from '../../types/ai-terminal'
import DBConnectionList from './DBConnectionList'

const { Text } = Typography

interface Props {
  onNewConnection: () => void
  onEditConnection: (conn: TerminalConnection) => void
  onNewDBConnection: () => void
  onEditDBConnection: (conn: DBConnection) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

const AITerminalSidebar: React.FC<Props> = ({ onNewConnection, onEditConnection, onNewDBConnection, onEditDBConnection, collapsed, onToggleCollapse }) => {
  const { token } = theme.useToken()
  const { modal, message } = App.useApp()
  const t = useT()
  const {
    connections, openTabs, activeTabId, sideMode,
    openTerminal, closeTab, setActiveTab, setSideMode,
    deleteConnection, syncSSHConfig
  } = useAITerminalStore()

  const handleOpenLocal = useCallback(() => {
    openTerminal('local', t('terminal.localTerminal'))
  }, [openTerminal, t])

  const handleOpenConnection = useCallback(async (conn: TerminalConnection) => {
    try {
      await openTerminal(conn.id, conn.name)
    } catch (err: any) {
      message.error(`SSH ${t('common.failed')}: ${err.message || String(err)}`)
    }
  }, [openTerminal, message, t])

  const handleDeleteConnection = useCallback((conn: TerminalConnection) => {
    const warning = conn.fromSSHConfig
      ? t('terminal.deleteSSHWarning')
      : t('terminal.deleteConnectionConfirm')
    modal.confirm({
      title: t('terminal.deleteConnection'),
      content: warning,
      okType: 'danger',
      onOk: () => deleteConnection(conn.id)
    })
  }, [modal, deleteConnection])

  const handleOpenSSHConfig = useCallback(async () => {
    try {
      await window.api.developer.openSSHConfig()
    } catch (err: any) {
      message.error(err.message || String(err))
    }
  }, [message])

  const sshConnections = connections.filter(c => c.type === 'ssh')

  const cardStyle: React.CSSProperties = {
    background: token.colorBgLayout,
    borderRadius: token.borderRadiusSM,
    margin: '3px 4px',
    overflow: 'hidden'
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: token.colorBgContainer,
      overflow: 'hidden'
    }}>
      {collapsed ? (
        /* Collapsed: show collapse toggle + icon buttons for Terminal/DB mode switch */
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 0' }}>
          <Tooltip title={t('common.expandSidebar')} placement="right">
            <Button
              type="text"
              size="small"
              icon={<MenuUnfoldOutlined />}
              onClick={onToggleCollapse}
            />
          </Tooltip>
          <Tooltip title={t('terminal.tabTerminal')} placement="right">
            <Button
              type={sideMode === 'terminal' ? 'primary' : 'text'}
              size="small"
              icon={<DesktopOutlined />}
              onClick={() => setSideMode('terminal' as any)}
              style={{ width: 28, height: 28 }}
            />
          </Tooltip>
          <Tooltip title={t('terminal.tabDB')} placement="right">
            <Button
              type={sideMode === 'db' ? 'primary' : 'text'}
              size="small"
              icon={<CloudServerOutlined />}
              onClick={() => setSideMode('db' as any)}
              style={{ width: 28, height: 28 }}
            />
          </Tooltip>
        </div>
      ) : (
        <>
      {/* Tabs at top with collapse toggle */}
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <Tabs
          activeKey={sideMode}
          onChange={(key) => setSideMode(key as any)}
          size="small"
          centered
          style={{ marginBottom: 0, flex: 1 }}
          items={[
            { key: 'terminal', label: t('terminal.tabTerminal') },
            { key: 'db', label: t('terminal.tabDB') }
          ]}
        />
        <Tooltip title={t('common.collapseSidebar')} placement="right">
          <Button
            type="text"
            size="small"
            icon={<MenuFoldOutlined />}
            onClick={onToggleCollapse}
            style={{ flexShrink: 0, marginRight: 4, marginBottom: 10 }}
          />
        </Tooltip>
      </div>

      {/* Tab content */}
      {sideMode === 'terminal' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Top: Open tabs card */}
          <div style={cardStyle}>
            <div style={{ padding: '2px 10px 2px' }}>
              <Text strong style={{ fontSize: 11, color: token.colorTextTertiary }}>{t('terminal.openedTerminals')}</Text>
            </div>
            <div style={{ maxHeight: 180, overflowY: 'auto', padding: '2px 4px 4px' }}>
              {openTabs.length === 0 ? (
                <div style={{ padding: '8px 10px', textAlign: 'center', color: token.colorTextTertiary, fontSize: 11 }}>
                  {t('terminal.noOpenTerminals')}
                </div>
              ) : (
                openTabs.map(tab => (
                  <div
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '2px 2px',
                      cursor: 'pointer',
                      borderRadius: token.borderRadiusSM,
                      background: tab.id === activeTabId ? token.colorPrimaryBg : 'transparent',
                      marginBottom: 1
                    }}
                    onMouseEnter={(e) => { if (tab.id !== activeTabId) e.currentTarget.style.background = token.colorFillTertiary }}
                    onMouseLeave={(e) => { if (tab.id !== activeTabId) e.currentTarget.style.background = '' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                        background: tab.status === 'connected' ? token.colorSuccess
                          : tab.status === 'connecting' ? token.colorWarning
                          : token.colorTextDisabled
                      }} />
                      <Text ellipsis style={{ fontSize: 12 }}>{tab.title}</Text>
                    </div>
                    <CloseOutlined
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                      style={{ fontSize: 10, color: token.colorTextTertiary, flexShrink: 0 }}
                    />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Bottom: Connections card */}
          <div style={{ ...cardStyle, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '2px 10px',
              background: token.colorFillQuaternary,
              borderRadius: `${token.borderRadiusSM}px ${token.borderRadiusSM}px 0 0`
            }}>
              <Text strong style={{ fontSize: 11, color: token.colorTextTertiary }}>{t('terminal.connectionList')}</Text>
              <div style={{ display: 'flex', gap: 2 }}>
                <Tooltip title={t('terminal.syncSSHConfig')}>
                  <Button type="text" size="small" icon={<SyncOutlined style={{ fontSize: 11 }} />} onClick={() => syncSSHConfig()} style={{ width: 22, height: 22 }} />
                </Tooltip>
                <Tooltip title={t('terminal.newConnection')}>
                  <Button type="text" size="small" icon={<PlusOutlined style={{ fontSize: 11 }} />} onClick={onNewConnection} style={{ width: 22, height: 22 }} />
                </Tooltip>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px 4px' }}>
              {/* Local terminal - pinned */}
              <div
                onDoubleClick={handleOpenLocal}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 8px',
                  cursor: 'pointer',
                  borderRadius: token.borderRadiusSM,
                  fontWeight: 500,
                  fontSize: 12
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = token.colorFillTertiary }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
              >
                <DesktopOutlined style={{ color: token.colorPrimary }} />
                <Text style={{ fontSize: 12 }}>{t('terminal.localTerminal')}</Text>
              </div>

              {/* SSH connections */}
              {sshConnections.length > 0 && (
                <div style={{ marginTop: 2 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 8px', marginBottom: 2,
                    margin: '0 -4px',
                    background: token.colorFillQuaternary
                  }}>
                    <Text style={{ fontSize: 11, color: token.colorTextTertiary }}>
                      {t('terminal.sshConnections')}
                    </Text>
                    <Tooltip title={t('terminal.openSSHConfig')}>
                      <Button
                        type="text" size="small"
                        icon={<FileTextOutlined style={{ fontSize: 11 }} />}
                        onClick={handleOpenSSHConfig}
                        style={{ width: 22, height: 22 }}
                      />
                    </Tooltip>
                  </div>
                  {sshConnections.map(conn => (
                    <div
                      key={conn.id}
                      onDoubleClick={() => handleOpenConnection(conn)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '4px 8px',
                        cursor: 'pointer',
                        borderRadius: token.borderRadiusSM,
                        fontSize: 12
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = token.colorFillTertiary }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                        <CloudServerOutlined style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
                        <div style={{ overflow: 'hidden' }}>
                          <Text ellipsis style={{ fontSize: 12, display: 'block' }}>{conn.name}</Text>
                          <Text ellipsis type="secondary" style={{ fontSize: 10, display: 'block' }}>
                            {conn.username ? `${conn.username}@` : ''}{conn.host}{conn.port !== 22 ? `:${conn.port}` : ''}
                          </Text>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                        <Button
                          type="text" size="small" icon={<EditOutlined style={{ fontSize: 11 }} />}
                          onClick={() => onEditConnection(conn)}
                          style={{ width: 22, height: 22 }}
                        />
                        <Button
                          type="text" size="small" danger icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                          onClick={() => handleDeleteConnection(conn)}
                          style={{ width: 22, height: 22 }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <DBConnectionList onNew={onNewDBConnection} onEdit={onEditDBConnection} />
      )}
        </>
      )}
    </div>
  )
}

export default AITerminalSidebar
