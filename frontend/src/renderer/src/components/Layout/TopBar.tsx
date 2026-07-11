import React, { useEffect, useState, useCallback } from 'react'
import { Space, Button, Typography, Dropdown, Tooltip, theme } from 'antd'
import {
  LoginOutlined,
  LogoutOutlined,
  MinusOutlined,
  CloseOutlined,
  BorderOutlined,
  BlockOutlined,
  GlobalOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useT } from '../../i18n'
import { useAuthStore } from '../../stores/useAuthStore'
import { useSettingsStore } from '../../stores/useSettingsStore'

import { useWorkspaceStore } from '../../stores/useWorkspaceStore'
import { useUpdaterStore } from '../../stores/useUpdaterStore'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { useAICodingStore } from '../../stores/useAICodingStore'
import WorkspaceSwitcher from '../WorkspaceSwitcher'
import GitBranchSelector from '../GitBranchSelector'
import AICodingIMConfigModal from '../../pages/AICoding/AICodingIMConfigModal'
import { UserAvatar } from '../ProviderIcons'
import { FeishuIcon, FeishuDisconnectedIcon } from '../icons/FeishuIcon'

const { Text } = Typography

const TopBar: React.FC = () => {
  const navigate = useNavigate()
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const user = useAuthStore((state) => state.user)
  const activeWorkspace = useWorkspaceStore((state) => state.activeWorkspace)
  const { token } = theme.useToken()
  const t = useT()
  const currentTheme = useSettingsStore((state) => state.theme)
  const language = useSettingsStore((state) => state.language)
  const updateSetting = useSettingsStore((state) => state.updateSetting)

  const initUpdater = useUpdaterStore((state) => state.init)
  const initNotifications = useNotificationStore((state) => state.init)

  const imConfig = useAICodingStore((state) => state.imConfig)
  const imStatus = useAICodingStore((state) => state.imStatus)
  const saveIMConfig = useAICodingStore((state) => state.saveIMConfig)
  const imConnect = useAICodingStore((state) => state.imConnect)
  const imDisconnect = useAICodingStore((state) => state.imDisconnect)
  const imTest = useAICodingStore((state) => state.imTest)

  const [imModalOpen, setIMModalOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)

  const isMac = window.api.platform === 'darwin'
  const isWin = window.api.platform === 'win32'

  useEffect(() => {
    const cleanupUpdater = initUpdater()
    const cleanupNotifications = initNotifications()
    return () => {
      cleanupUpdater()
      cleanupNotifications()
    }
  }, [initUpdater, initNotifications])

  const handleLogout = async (): Promise<void> => {
    await useAuthStore.getState().logout()
    navigate('/login')
  }

  const dropdownItems = {
    items: [
      {
        key: 'language',
        icon: <GlobalOutlined />,
        label: language === 'zh-CN' ? 'English' : '中文',
        onClick: () => updateSetting('language', language === 'zh-CN' ? 'en' : 'zh-CN'),
      },
      { type: 'divider' as const },
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        label: t('topbar.logout'),
        onClick: handleLogout,
      },
    ],
  }

  // ── IM icon state ──
  const isConfigured =
    imConfig.feishu.appId.trim() !== '' && imConfig.feishu.appSecret.trim() !== ''
  const isConnected = imStatus.state === 'connected'
  const isConnecting = imStatus.state === 'connecting'

  let imTooltipText: string
  let imIconNode: React.ReactNode
  if (!isConfigured) {
    imTooltipText = t('topbar.imNotConfigured')
    imIconNode = <FeishuDisconnectedIcon color={token.colorTextQuaternary} />
  } else if (isConnected) {
    imTooltipText = t('topbar.imConnected')
    imIconNode = <FeishuIcon />
  } else if (isConnecting) {
    imTooltipText = t('topbar.imConnecting')
    imIconNode = <FeishuIcon dimmed />
  } else {
    imTooltipText = imStatus.state === 'error'
      ? `${t('topbar.imError')} — ${imStatus.error || t('topbar.imConnectionFailed')}`
      : t('topbar.imDisconnected')
    imIconNode = <FeishuIcon dimmed />
  }

  const handleWindowMinimize = useCallback(() => window.api.windowControl.minimize(), [])
  const handleWindowMaximize = useCallback(async () => {
    await window.api.windowControl.maximize()
    setIsMaximized(await window.api.windowControl.isMaximized())
  }, [])
  const handleWindowClose = useCallback(() => window.api.windowControl.close(), [])

  // Sync maximized state on mount and window resize (which fires on maximize/unmaximize)
  useEffect(() => {
    if (!isWin) return
    const syncMaximized = async (): Promise<void> => {
      setIsMaximized(await window.api.windowControl.isMaximized())
    }
    syncMaximized()
    window.addEventListener('resize', syncMaximized)
    return () => window.removeEventListener('resize', syncMaximized)
  }, [isWin])

  return (
    <div
      className="cb-topbar"
      style={{
        height: 38,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        // macOS: 给红绿灯按钮留出空间
        paddingLeft: isMac ? 78 : 12,
        // 整个 TopBar 可拖拽移动窗口
        WebkitAppRegion: 'drag'
      } as React.CSSProperties}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <WorkspaceSwitcher />
        {activeWorkspace?.vcsType === 'git' && (
          <GitBranchSelector workspacePath={activeWorkspace.path} />
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* IM entry is non-persistent: only when remote IM control is enabled */}
        {imConfig.remoteEnabled && (
          <>
            <Tooltip title={imTooltipText}>
              <div
                onClick={() => setIMModalOpen(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 26,
                  height: 26,
                  background: token.colorFillTertiary,
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                }}
              >
                {imIconNode}
              </div>
            </Tooltip>
            <div style={{ width: 1, height: 16, background: token.colorBorderSecondary }} />
          </>
        )}

        {/* Theme toggle capsule */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          background: token.colorFillTertiary,
          borderRadius: 8,
          padding: 2,
          gap: 2,
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute',
            left: 2,
            width: 22,
            height: 22,
            borderRadius: 6,
            background: token.colorPrimary,
            transform: currentTheme === 'light' ? 'translateX(0)' : 'translateX(24px)',
            transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            zIndex: 0,
          }} />
          <Tooltip title={t('topbar.lightMode')}>
            <button
              onClick={() => updateSetting('theme', 'light')}
              style={{
                width: 22, height: 22, borderRadius: 6, border: 'none',
                background: 'transparent',
                color: currentTheme === 'light' ? '#fff' : token.colorTextSecondary,
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 13,
                transition: 'color 0.2s',
                position: 'relative', zIndex: 1,
              }}
            >
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 000-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>
            </button>
          </Tooltip>
          <Tooltip title={t('topbar.darkMode')}>
            <button
              onClick={() => updateSetting('theme', 'dark')}
              style={{
                width: 22, height: 22, borderRadius: 6, border: 'none',
                background: 'transparent',
                color: currentTheme === 'dark' ? '#fff' : token.colorTextSecondary,
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 13,
                transition: 'color 0.2s',
                position: 'relative', zIndex: 1,
              }}
            >
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
            </button>
          </Tooltip>
        </div>

        <div style={{ width: 1, height: 16, background: token.colorBorderSecondary }} />

        {loggedIn && user ? (
          <Dropdown menu={dropdownItems} trigger={['click']}>
            <Space style={{ cursor: 'pointer' }}>
              <UserAvatar
                size={24}
                primaryColor={token.colorPrimary}
                avatarUrl={user.avatarUrl || undefined}
                userName={user.name}
                userId={user.id}
              />
              <Text style={{ fontSize: 12 }}>{user.name}</Text>
            </Space>
          </Dropdown>
        ) : (
          <Space>
            <Text type="secondary">{t('topbar.notLoggedIn')}</Text>
            <Button
              type="link"
              size="small"
              icon={<LoginOutlined />}
              onClick={() => navigate('/login')}
            >
              {t('topbar.login')}
            </Button>
          </Space>
        )}

        {/* Windows: 自定义窗口控制按钮 */}
        {isWin && (
          <>
            <div style={{ width: 1, height: 16, background: token.colorBorderSecondary }} />
            <div className="cb-win-controls" style={{ display: 'flex', alignItems: 'center', marginRight: -8 }}>
              <button className="cb-win-btn" onClick={handleWindowMinimize} title={t('topbar.minimize')}>
                <MinusOutlined style={{ fontSize: 12 }} />
              </button>
              <button className="cb-win-btn" onClick={handleWindowMaximize} title={isMaximized ? t('topbar.restore') : t('topbar.maximize')}>
                {isMaximized ? <BlockOutlined style={{ fontSize: 12 }} /> : <BorderOutlined style={{ fontSize: 12 }} />}
              </button>
              <button className="cb-win-btn cb-win-btn-close" onClick={handleWindowClose} title={t('topbar.close')}>
                <CloseOutlined style={{ fontSize: 12 }} />
              </button>
            </div>
          </>
        )}
      </div>

      <AICodingIMConfigModal
        open={imModalOpen}
        config={imConfig}
        imStatus={imStatus}
        onOk={async (config) => {
          await saveIMConfig(config)
        }}
        onCancel={() => setIMModalOpen(false)}
        onConnect={imConnect}
        onDisconnect={imDisconnect}
        onTest={imTest}
      />
    </div>
  )
}

export default TopBar
