import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { Space, Button, Typography, Dropdown, Tooltip, Badge, Divider, theme } from 'antd'
import {
  LoginOutlined,
  LogoutOutlined,
  MinusOutlined,
  CloseOutlined,
  BorderOutlined,
  BlockOutlined,
  GlobalOutlined,
  BgColorsOutlined,
  SunOutlined,
  MoonOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  CheckOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useT } from '../../i18n'
import { useAuthStore } from '../../stores/useAuthStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { generalModeFallbackPath, type AppMode } from '../../constants/app-mode'

import { useWorkspaceStore } from '../../stores/useWorkspaceStore'
import { useUpdaterStore } from '../../stores/useUpdaterStore'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { useAICodingStore } from '../../stores/useAICodingStore'
import WorkspaceSwitcher from '../WorkspaceSwitcher'
import GitBranchSelector from '../GitBranchSelector'
import AICodingIMConfigModal from '../../pages/AICoding/AICodingIMConfigModal'
import { UserAvatar } from '../ProviderIcons'
import { FeishuIcon, FeishuDisconnectedIcon } from '../icons/FeishuIcon'
import ClientUpdatePanel from '../ClientUpdatePanel'
import verifiedBadge from '../../assets/claude-fable-5-verified.png'

const { Text } = Typography

const CAPSULE_H = 26
const CAPSULE_PAD = 2
const CAPSULE_INNER_H = CAPSULE_H - CAPSULE_PAD * 2

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
  const appMode = useSettingsStore((state) => state.appMode)
  const setAppMode = useSettingsStore((state) => state.setAppMode)

  const initUpdater = useUpdaterStore((state) => state.init)
  const updaterStatus = useUpdaterStore((state) => state.status)
  const initNotifications = useNotificationStore((state) => state.init)

  const imConfig = useAICodingStore((state) => state.imConfig)
  const imStatus = useAICodingStore((state) => state.imStatus)
  const saveIMConfig = useAICodingStore((state) => state.saveIMConfig)
  const imConnect = useAICodingStore((state) => state.imConnect)
  const imDisconnect = useAICodingStore((state) => state.imDisconnect)
  const imTest = useAICodingStore((state) => state.imTest)

  const [imModalOpen, setIMModalOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const isMac = window.api.platform === 'darwin'
  const isWin = window.api.platform === 'win32'

  const hasUpdate =
    updaterStatus === 'available' ||
    updaterStatus === 'downloading' ||
    updaterStatus === 'downloaded'

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

  // ── App shell mode (通用 / 研发) ──
  const handleModeChange = useCallback(
    (mode: AppMode) => {
      setAppMode(mode)
      // Collapsing into general mode lands on the workbench; expanding into
      // pro leaves the user on whatever route they're already viewing.
      if (mode === 'general') {
        navigate(generalModeFallbackPath())
      }
    },
    [setAppMode, navigate]
  )

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

  /** Unified 2-option capsule: equal halves, sliding indicator, centered content */
  const renderCapsule = (
    leftActive: boolean,
    left: { key: string; content: React.ReactNode; onClick: () => void; title?: string },
    right: { key: string; content: React.ReactNode; onClick: () => void; title?: string },
    opts?: { minWidth?: number }
  ) => (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        height: CAPSULE_H,
        background: token.colorFillTertiary,
        borderRadius: 8,
        padding: CAPSULE_PAD,
        position: 'relative',
        boxSizing: 'border-box',
        minWidth: opts?.minWidth
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: CAPSULE_PAD,
          left: leftActive ? CAPSULE_PAD : '50%',
          width: `calc(50% - ${CAPSULE_PAD}px)`,
          height: CAPSULE_INNER_H,
          borderRadius: 6,
          background: token.colorPrimary,
          transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 0,
          boxSizing: 'border-box'
        }}
      />
      {[left, right].map((item, idx) => {
        const active = idx === 0 ? leftActive : !leftActive
        return (
          <button
            key={item.key}
            type="button"
            title={item.title}
            onClick={item.onClick}
            style={{
              flex: 1,
              height: CAPSULE_INNER_H,
              minWidth: 0,
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              color: active ? '#fff' : token.colorTextSecondary,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              lineHeight: 1,
              padding: '0 10px',
              position: 'relative',
              zIndex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.2s',
              boxSizing: 'border-box'
            }}
          >
            {item.content}
          </button>
        )
      })}
    </div>
  )

  const menuRowBase: React.CSSProperties = {
    padding: '8px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    minHeight: 36,
    boxSizing: 'border-box'
  }

  const menuIconStyle: React.CSSProperties = {
    fontSize: 14,
    width: 16,
    flexShrink: 0,
    color: token.colorTextSecondary
  }

  const userMenu = useMemo(
    () => (
      <div
        style={{
          background: token.colorBgElevated,
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowSecondary,
          width: 248,
          padding: '4px 0',
          border: `1px solid ${token.colorBorderSecondary}`
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Group 1: 外观 / 语言 / 设置 — unified icon + label rows */}
        <div style={{ ...menuRowBase, gap: 8 }}>
          <BgColorsOutlined style={menuIconStyle} />
          <Text style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{t('topbar.theme')}</Text>
          {renderCapsule(
            currentTheme === 'light',
            {
              key: 'light',
              title: t('topbar.lightMode'),
              content: <SunOutlined style={{ fontSize: 13 }} />,
              onClick: () => updateSetting('theme', 'light')
            },
            {
              key: 'dark',
              title: t('topbar.darkMode'),
              content: <MoonOutlined style={{ fontSize: 13 }} />,
              onClick: () => updateSetting('theme', 'dark')
            },
            { minWidth: 72 }
          )}
        </div>

        <div style={{ ...menuRowBase, gap: 8 }}>
          <GlobalOutlined style={menuIconStyle} />
          <Text style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{t('topbar.language')}</Text>
          {renderCapsule(
            language === 'en',
            {
              key: 'en',
              content: 'EN',
              onClick: () => updateSetting('language', 'en')
            },
            {
              key: 'zh',
              content: 'CH',
              onClick: () => updateSetting('language', 'zh-CN')
            },
            { minWidth: 72 }
          )}
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setUserMenuOpen(false)
            navigate('/settings')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setUserMenuOpen(false)
              navigate('/settings')
            }
          }}
          style={{ ...menuRowBase, cursor: 'pointer' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = token.colorFillTertiary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <SettingOutlined style={menuIconStyle} />
          <span style={{ flex: 1 }}>{t('menu.settings')}</span>
        </div>

        <Divider style={{ margin: '4px 0' }} />

        {/* Group 2: 版本 / Fable 5 认证 */}
        <div style={{ ...menuRowBase, gap: 8 }}>
          <InfoCircleOutlined style={menuIconStyle} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <ClientUpdatePanel />
          </div>
        </div>
        <div style={{ ...menuRowBase, gap: 8 }}>
          <CheckOutlined style={menuIconStyle} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>
            <img
              src={verifiedBadge}
              alt="Claude Fable 5 verified"
              draggable={false}
              style={{ display: 'block', maxWidth: '100%', borderRadius: 4 }}
            />
          </div>
        </div>

        <Divider style={{ margin: '4px 0' }} />

        {/* Group 3: 退出 */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setUserMenuOpen(false)
            void handleLogout()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setUserMenuOpen(false)
              void handleLogout()
            }
          }}
          style={{
            ...menuRowBase,
            cursor: 'pointer',
            color: token.colorError
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = token.colorFillTertiary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <LogoutOutlined style={{ ...menuIconStyle, color: token.colorError }} />
          <span>{t('topbar.logout')}</span>
        </div>
      </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, t, currentTheme, language, updateSetting, handleLogout, navigate]
  )

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
        {renderCapsule(
          appMode === 'general',
          {
            key: 'general',
            title: t('topbar.modeGeneral'),
            content: t('topbar.modeGeneral'),
            onClick: () => handleModeChange('general')
          },
          {
            key: 'pro',
            title: t('topbar.modePro'),
            content: t('topbar.modePro'),
            onClick: () => handleModeChange('pro')
          },
          { minWidth: 96 }
        )}
        <div style={{ width: 1, height: 16, background: token.colorBorderSecondary }} />
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

        {loggedIn && user ? (
          <Dropdown
            open={userMenuOpen}
            onOpenChange={setUserMenuOpen}
            dropdownRender={() => userMenu}
            trigger={['click']}
            placement="bottomRight"
          >
            {/* inline-flex (not Space): Badge is inline-block and otherwise sits on the top edge */}
            <div
              style={{
                cursor: 'pointer',
                height: 26,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                lineHeight: 1
              }}
            >
              <Badge
                dot={hasUpdate}
                offset={[-2, 2]}
                color={token.colorError}
                style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 0 }}
              >
                <UserAvatar
                  size={24}
                  primaryColor={token.colorPrimary}
                  avatarUrl={user.avatarUrl || undefined}
                  userName={user.name}
                  userId={user.id}
                />
              </Badge>
              <Text style={{ fontSize: 12, lineHeight: '26px' }}>{user.name}</Text>
            </div>
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
