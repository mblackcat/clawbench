import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { App, Space, Button, Typography, Dropdown, Tooltip, Badge, Divider, theme } from 'antd'
import {
  LoginOutlined,
  LogoutOutlined,
  MinusOutlined,
  CloseOutlined,
  BorderOutlined,
  BlockOutlined,
  GlobalOutlined,
  BgColorsOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  CheckOutlined,
  CompassOutlined,
  CloudDownloadOutlined,
  ThunderboltOutlined,
  DesktopOutlined,
  CopyOutlined
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useT } from '../../i18n'
import { useAuthStore } from '../../stores/useAuthStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { generalModeFallbackPath, type AppMode } from '../../constants/app-mode'

import { useWorkspaceStore } from '../../stores/useWorkspaceStore'
import { useUpdaterStore } from '../../stores/useUpdaterStore'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { useAICodingStore } from '../../stores/useAICodingStore'
import { useTaskStore } from '../../stores/useTaskStore'
import { useWeatherStore } from '../../stores/useWeatherStore'
import WorkspaceSwitcher from '../WorkspaceSwitcher'
import GitBranchSelector from '../GitBranchSelector'
import ProjectSwitcher from '../ProjectSwitcher'
import AICodingIMConfigModal from '../../pages/AICoding/AICodingIMConfigModal'
import { UserAvatar } from '../ProviderIcons'
import { FeishuIcon, FeishuDisconnectedIcon } from '../icons/FeishuIcon'
import ClientUpdatePanel from '../ClientUpdatePanel'
import WeatherIcon, { useWeatherNames } from '../WeatherIcon'
import { LogsBadgeIcon, useLogsIndicator } from './LogsIndicator'
import { type MotionMode, readStoredMotionPref, setMotionMode } from '../../motion'
import {
  PALETTE_CAPSULE,
  PALETTE_SWATCH,
  THEME_PALETTES,
  resolvePalette,
  type CapsuleStyle
} from '../../theme'
import type { TaskInfo } from '../../types/subapp'
import verifiedBadge from '../../assets/claude-fable-5-verified.png'
import brandLogo from '../../../../../resources/icon.svg'

const { Text } = Typography

/** Shared capsule track for mode / language / motion / weather switches */
const CAPSULE_H = 26
const CAPSULE_PAD = 2
const CAPSULE_INNER_H = CAPSULE_H - CAPSULE_PAD * 2

/** How long the green "just completed" ring stays on the avatar */
const COMPLETE_RING_MS = 3500

interface TopBarProps {
  /** Show a logs button in the TopBar (General mode has no sider logs entry) */
  showLogsEntry?: boolean
  onToggleLogs?: () => void
}

const TopBar: React.FC<TopBarProps> = ({ showLogsEntry = false, onToggleLogs }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const user = useAuthStore((state) => state.user)
  const activeWorkspace = useWorkspaceStore((state) => state.activeWorkspace)
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const t = useT()
  const currentTheme = useSettingsStore((state) => state.theme)
  const language = useSettingsStore((state) => state.language)
  const updateSetting = useSettingsStore((state) => state.updateSetting)
  const appMode = useSettingsStore((state) => state.appMode)
  const setAppMode = useSettingsStore((state) => state.setAppMode)

  const initUpdater = useUpdaterStore((state) => state.init)
  const updaterStatus = useUpdaterStore((state) => state.status)
  const updaterVersion = useUpdaterStore((state) => state.version)
  const installUpdate = useUpdaterStore((state) => state.install)
  const initNotifications = useNotificationStore((state) => state.init)

  const imConfig = useAICodingStore((state) => state.imConfig)
  const imStatus = useAICodingStore((state) => state.imStatus)
  const saveIMConfig = useAICodingStore((state) => state.saveIMConfig)
  const imConnect = useAICodingStore((state) => state.imConnect)
  const imDisconnect = useAICodingStore((state) => state.imDisconnect)
  const imTest = useAICodingStore((state) => state.imTest)

  const weatherVisible = useWeatherStore((state) => state.weatherVisible)
  const weatherType = useWeatherStore((state) => state.weatherType)
  const toggleWeather = useWeatherStore((state) => state.toggleWeather)
  const cycleWeather = useWeatherStore((state) => state.cycleWeather)
  const weatherNames = useWeatherNames()

  const logsIndicator = useLogsIndicator()

  const topbarRef = useRef<HTMLDivElement>(null)
  const [imModalOpen, setIMModalOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [motionMode, setMotionModeState] = useState<MotionMode>(() => readStoredMotionPref())
  const [localIp, setLocalIp] = useState<string>('')

  const isMac = window.api.platform === 'darwin'
  const isWin = window.api.platform === 'win32'

  const hasUpdate =
    updaterStatus === 'available' ||
    updaterStatus === 'downloading' ||
    updaterStatus === 'downloaded'

  const palette = resolvePalette(currentTheme)
  const capsuleStyle: CapsuleStyle = PALETTE_CAPSULE[palette]

  // ── Avatar status ring: running (conic) / error (pulse) / just completed (green) ──
  const tasks = useTaskStore((state) => state.tasks)
  const hasErrorAlert = useTaskStore((state) => state.hasErrorAlert)
  const errorAlertSummary = useTaskStore((state) => state.errorAlertSummary)

  const runningTasks = useMemo(
    () => Object.values(tasks).filter((task) => task.status === 'running'),
    [tasks]
  )
  const isRunning = runningTasks.length > 0
  const activeTaskName = runningTasks.length > 0 ? runningTasks[0].appName : ''

  const latestFailedTask = useMemo<TaskInfo | undefined>(() => {
    const failed = Object.values(tasks).filter(
      (task) => task.status === 'failed' || task.outputs.some((o) => o.type === 'error')
    )
    return failed.sort((a, b) => (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt))[0]
  }, [tasks])

  const errorTip = useMemo(() => {
    if (!hasErrorAlert) return ''
    const result = latestFailedTask?.result
    if (result?.summaryI18nKey) return t(result.summaryI18nKey, ...(result.summaryI18nArgs ?? []))
    if (errorAlertSummary) return errorAlertSummary
    const errOut = latestFailedTask?.outputs.find((o) => o.type === 'error')
    return (
      result?.summary ||
      errOut?.message ||
      (latestFailedTask ? t('topbar.taskFailed', latestFailedTask.appName) : t('topbar.taskError'))
    )
  }, [hasErrorAlert, errorAlertSummary, latestFailedTask, t])

  const [justCompleted, setJustCompleted] = useState(false)
  const prevRunningRef = useRef(false)

  useEffect(() => {
    const wasRunning = prevRunningRef.current
    prevRunningRef.current = isRunning
    if (isRunning) {
      setJustCompleted(false)
      return
    }
    if (wasRunning && !hasErrorAlert) {
      setJustCompleted(true)
      const timer = setTimeout(() => setJustCompleted(false), COMPLETE_RING_MS)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [isRunning, hasErrorAlert])

  const avatarTooltipTitle = useMemo(() => {
    if (hasErrorAlert) return errorTip
    if (isRunning) return t('statusbar.working', activeTaskName)
    if (justCompleted) return t('statusbar.ready')
    return undefined
  }, [hasErrorAlert, errorTip, isRunning, activeTaskName, justCompleted, t])

  const handleMotionChange = useCallback((mode: MotionMode) => {
    setMotionMode(mode)
    setMotionModeState(mode)
  }, [])

  useEffect(() => {
    const cleanupUpdater = initUpdater()
    const cleanupNotifications = initNotifications()
    return () => {
      cleanupUpdater()
      cleanupNotifications()
    }
  }, [initUpdater, initNotifications])

  /*
   * Frameless-window drag regions go stale after heavy route swaps: Chromium
   * keeps the previously published region and the titlebar stops dragging until
   * the window is resized. Nudging the app-region property re-marks the
   * document's regions dirty so a fresh set is pushed to the browser process.
   * Two frames: one to apply, one to restore.
   */
  useEffect(() => {
    const el = topbarRef.current
    if (!el) return
    let restoreRaf = 0
    const dirtyRaf = requestAnimationFrame(() => {
      el.style.setProperty('-webkit-app-region', 'no-drag')
      restoreRaf = requestAnimationFrame(() => {
        el.style.removeProperty('-webkit-app-region')
      })
    })
    return () => {
      cancelAnimationFrame(dirtyRaf)
      cancelAnimationFrame(restoreRaf)
      el.style.removeProperty('-webkit-app-region')
    }
  }, [location.pathname, appMode])

  // Local IP (avatar menu) — refreshed whenever the menu opens
  useEffect(() => {
    if (!userMenuOpen && localIp) return
    let active = true
    window.api.system
      .getLocalIp()
      .then((ip) => {
        if (active && ip) setLocalIp(ip)
      })
      .catch(() => {
        // silent fallback — row shows a dash
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userMenuOpen])

  const copyLocalIp = useCallback(async (): Promise<void> => {
    if (!localIp) return
    try {
      await navigator.clipboard.writeText(localIp)
      message.success(t('topbar.ipCopied'))
    } catch {
      message.error(t('workbench.copyFailed'))
    }
  }, [localIp, message, t])

  const handleLogout = useCallback(async (): Promise<void> => {
    await useAuthStore.getState().logout()
    navigate('/login')
  }, [navigate])

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

  /** Double-click empty titlebar area → maximize/restore (Windows titlebar UX). */
  const handleTitlebarDoubleClick = useCallback(async () => {
    if (!isWin) return
    await window.api.windowControl.maximize()
    setIsMaximized(await window.api.windowControl.isMaximized())
  }, [isWin])

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
  const renderCapsule = useCallback(
    (
      leftActive: boolean,
      left: { key: string; content: React.ReactNode; onClick: () => void; title?: string },
      right: { key: string; content: React.ReactNode; onClick: () => void; title?: string },
      opts?: { minWidth?: number } & Partial<CapsuleStyle>
    ) => {
      const activeBg = opts?.activeBg ?? token.colorPrimary
      const activeColor = opts?.activeColor ?? token.colorTextLightSolid
      const trackBg = opts?.trackBg ?? token.colorFillTertiary
      const inactiveColor = opts?.inactiveColor ?? token.colorTextSecondary
      return (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'stretch',
            height: CAPSULE_H,
            background: trackBg,
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
              background: activeBg,
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
                  color: active ? activeColor : inactiveColor,
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
    },
    [token.colorFillTertiary, token.colorPrimary, token.colorTextSecondary, token.colorTextLightSolid]
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
    height: 16,
    flexShrink: 0,
    color: token.colorTextSecondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center'
  }

  const menuCapsuleOpts = {
    activeBg: capsuleStyle.activeBg,
    activeColor: capsuleStyle.activeColor
  }

  const renderActionRow = (
    key: string,
    icon: React.ReactNode,
    label: React.ReactNode,
    onActivate: () => void,
    extraStyle?: React.CSSProperties
  ): React.ReactNode => (
    <div
      key={key}
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate()
        }
      }}
      style={{ ...menuRowBase, cursor: 'pointer', ...extraStyle }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = token.colorFillTertiary
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {icon}
      {label}
    </div>
  )

  const userMenu = (
    <div
      style={{
        background: token.colorBgElevated,
        borderRadius: token.borderRadiusLG,
        boxShadow: token.boxShadowSecondary,
        width: 264,
        padding: '4px 0',
        border: `1px solid ${token.colorBorderSecondary}`
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Group 1: 外观 / 语言 / 动效 / 氛围 */}
      <div style={menuRowBase}>
        <BgColorsOutlined style={menuIconStyle} />
        <Text style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{t('topbar.theme')}</Text>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: 2,
            borderRadius: 14,
            background: token.colorFillAlter,
            border: `1px solid ${token.colorBorderSecondary}`
          }}
        >
          {THEME_PALETTES.map((p) => {
            const active = palette === p.key
            const swatch = PALETTE_SWATCH[p.key]
            return (
              <Tooltip key={p.key} title={t(`topbar.palette.${p.key}`)}>
                <button
                  type="button"
                  aria-label={t(`topbar.palette.${p.key}`)}
                  aria-pressed={active}
                  onClick={() => updateSetting('theme', p.key)}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    padding: 0,
                    border: active ? `2px solid ${token.colorPrimary}` : '1px solid transparent',
                    background: active ? token.colorBgContainer : 'transparent',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: active ? `0 0 0 1px ${token.colorPrimary}` : 'none',
                    transition: 'box-shadow 120ms ease'
                  }}
                >
                  <svg viewBox="0 0 20 20" width="16" height="16" style={{ display: 'block' }}>
                    <circle cx="10" cy="10" r="9" fill={swatch.base} stroke={swatch.stroke} strokeWidth="1" />
                    <path d="M10 1 A 9 9 0 0 1 10 19 Z" fill={swatch.accent} />
                  </svg>
                </button>
              </Tooltip>
            )
          })}
        </div>
      </div>

      <div style={menuRowBase}>
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
          { minWidth: 72, ...menuCapsuleOpts }
        )}
      </div>

      <div style={menuRowBase}>
        <ThunderboltOutlined style={menuIconStyle} />
        <Text style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{t('topbar.motion')}</Text>
        {renderCapsule(
          motionMode === 'agile',
          {
            key: 'agile',
            title: t('topbar.motionAgileTip'),
            content: t('topbar.motionAgile'),
            onClick: () => handleMotionChange('agile')
          },
          {
            key: 'elegant',
            title: t('topbar.motionElegantTip'),
            content: t('topbar.motionElegant'),
            onClick: () => handleMotionChange('elegant')
          },
          { minWidth: 84, ...menuCapsuleOpts }
        )}
      </div>

      {/* Atmosphere (weather): click label = next effect; capsule = on/off. Right-click = next effect. */}
      <div style={menuRowBase}>
        <div
          role="button"
          tabIndex={0}
          title={t('topbar.atmosphereHint', weatherNames[weatherType])}
          onClick={() => {
            if (weatherVisible) cycleWeather()
            else toggleWeather()
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            cycleWeather()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              if (weatherVisible) cycleWeather()
              else toggleWeather()
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            flex: 1,
            minWidth: 0,
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <WeatherIcon
            type={weatherVisible ? weatherType : 'atmosphere'}
            size={16}
            color={weatherVisible ? token.colorPrimary : 'currentColor'}
            style={menuIconStyle}
          />
          <Text style={{ fontSize: 13, flex: 1, minWidth: 0, cursor: 'pointer' }}>
            {t('topbar.atmosphere')}
          </Text>
        </div>
        {renderCapsule(
          weatherVisible,
          {
            key: 'on',
            title: t('topbar.weatherOnTip'),
            content: t('topbar.weatherOn'),
            onClick: () => {
              if (!weatherVisible) toggleWeather()
            }
          },
          {
            key: 'off',
            title: t('topbar.weatherOffTip'),
            content: t('topbar.weatherOff'),
            onClick: () => {
              if (weatherVisible) toggleWeather()
            }
          },
          { minWidth: 72, ...menuCapsuleOpts }
        )}
      </div>

      <Divider style={{ margin: '4px 0' }} />

      {/* Group 2: 引导 / 设置 */}
      {renderActionRow(
        'guide',
        <CompassOutlined style={menuIconStyle} />,
        <span style={{ flex: 1 }}>{t('topbar.guide')}</span>,
        () => {
          setUserMenuOpen(false)
          navigate('/setup', { state: { forceShow: true } })
        }
      )}
      {renderActionRow(
        'settings',
        <SettingOutlined style={menuIconStyle} />,
        <span style={{ flex: 1 }}>{t('menu.settings')}</span>,
        () => {
          setUserMenuOpen(false)
          // Record the origin so Settings' close button can step back to it
          navigate('/settings', { state: { from: location.pathname } })
        }
      )}

      <Divider style={{ margin: '4px 0' }} />

      {/* Group 3: 本机 IP / 版本 / Fable 5 认证 */}
      {renderActionRow(
        'ip',
        <DesktopOutlined style={menuIconStyle} />,
        <>
          <Text
            style={{ fontSize: 13, color: token.colorText, flex: 1, minWidth: 0, fontFamily: 'monospace' }}
            title={t('topbar.localIp')}
          >
            {localIp || '—'}
          </Text>
          <Tooltip title={t('topbar.copyIp')}>
            <Button
              type="text"
              size="small"
              aria-label={t('topbar.copyIp')}
              icon={<CopyOutlined style={{ fontSize: 12 }} />}
              onClick={(e) => {
                e.stopPropagation()
                void copyLocalIp()
              }}
              style={{ width: 22, height: 22, minWidth: 22, color: token.colorTextSecondary }}
            />
          </Tooltip>
        </>,
        () => {
          void copyLocalIp()
        }
      )}
      <div style={menuRowBase}>
        <InfoCircleOutlined style={menuIconStyle} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <ClientUpdatePanel />
        </div>
      </div>
      <div style={menuRowBase}>
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

      {/* Group 4: 退出 */}
      {renderActionRow(
        'logout',
        <LogoutOutlined style={{ ...menuIconStyle, color: token.colorError }} />,
        <span>{t('topbar.logout')}</span>,
        () => {
          setUserMenuOpen(false)
          void handleLogout()
        },
        { color: token.colorError }
      )}
    </div>
  )

  // Avatar ring styles (colors from tokens; pulse keyframes read --cb-ring-color)
  const avatarRingStyle: React.CSSProperties = hasErrorAlert
    ? ({
        '--cb-ring-color': token.colorWarning,
        border: `1.5px solid ${token.colorWarning}`,
        animation: 'cb-avatar-error-pulse 2s ease-in-out infinite'
      } as React.CSSProperties)
    : justCompleted
      ? ({
          '--cb-ring-color': token.colorSuccess,
          border: `1.5px solid ${token.colorSuccess}`,
          animation: 'cb-avatar-complete-pulse 1.8s ease-out infinite'
        } as React.CSSProperties)
      : {}

  return (
    <div
      ref={topbarRef}
      className="cb-topbar"
      style={{
        height: 38,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        // macOS: 给红绿灯按钮留出空间
        paddingLeft: isMac ? 78 : 12
      }}
    >
      <div
        className="cb-topbar-nodrag"
        style={{ display: 'flex', alignItems: 'center', gap: 8, height: '100%', minWidth: 0 }}
      >
        {/* App brand logo + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 6, userSelect: 'none' }}>
          <img
            src={brandLogo}
            alt={t('login.brandName')}
            draggable={false}
            style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'contain', flexShrink: 0 }}
          />
          <span
            className="cb-topbar-title"
            style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}
          >
            {t('login.brandName')}
          </span>
        </div>

        <div className="cb-topbar-divider" />
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
          { minWidth: 96, ...capsuleStyle }
        )}
        <div className="cb-topbar-divider" />
        <ProjectSwitcher />
        {/* General mode: workspace + branch pickers are hidden (mode + project only) */}
        {appMode === 'pro' && (
          <>
            <WorkspaceSwitcher />
            {activeWorkspace?.vcsType === 'git' && (
              <GitBranchSelector workspacePath={activeWorkspace.path} />
            )}
          </>
        )}
      </div>

      {/*
        Explicit center drag hit-target. Relying on empty flex gaps between two
        no-drag siblings is flaky in Electron (especially with compositor layers).
      */}
      <div className="cb-topbar-drag" onDoubleClick={handleTitlebarDoubleClick} aria-hidden />

      <div
        className="cb-topbar-nodrag"
        style={{ display: 'flex', alignItems: 'center', gap: 12, height: '100%' }}
      >
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
            <div className="cb-topbar-divider" />
          </>
        )}

        {/* General mode has no sider → logs entry (with merged badge) lives here */}
        {showLogsEntry && onToggleLogs && (
          <Tooltip title={t('statusbar.logs')}>
            <Button
              type="text"
              size="small"
              aria-label={t('statusbar.logs')}
              onClick={onToggleLogs}
              style={{ width: 26, height: 26, padding: 0 }}
              icon={<LogsBadgeIcon state={logsIndicator} size={15} />}
            />
          </Tooltip>
        )}

        {/* Downloaded update: install CTA left of avatar (same action as avatar menu) */}
        {updaterStatus === 'downloaded' && (
          <Tooltip title={t('topbar.installUpdate', updaterVersion || '')}>
            <Button
              type="primary"
              size="small"
              icon={<CloudDownloadOutlined />}
              onClick={installUpdate}
              style={{ height: 26, fontSize: 12, paddingInline: 10 }}
            >
              {t('topbar.updateClient')}
            </Button>
          </Tooltip>
        )}

        {loggedIn && user ? (
          <Dropdown
            open={userMenuOpen}
            onOpenChange={setUserMenuOpen}
            dropdownRender={() => userMenu}
            trigger={['click']}
            placement="bottomRight"
          >
            <Tooltip
              title={avatarTooltipTitle}
              open={userMenuOpen || !avatarTooltipTitle ? false : undefined}
              placement="bottomRight"
            >
              {/* inline-flex (not Space): Badge is inline-block and otherwise sits on the top edge */}
              <div
                style={{
                  cursor: 'pointer',
                  height: 28,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  lineHeight: 1
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    width: 26,
                    height: 26,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    transition: 'box-shadow 0.3s ease, border-color 0.3s ease',
                    ...avatarRingStyle
                  }}
                >
                  {isRunning && (
                    <div
                      className="cb-avatar-running-ring"
                      style={{
                        position: 'absolute',
                        inset: -3,
                        borderRadius: '50%',
                        background: `conic-gradient(from 0deg, transparent 0%, ${token.colorPrimary} 40%, ${token.colorSuccess} 75%, ${token.colorTextLightSolid} 100%)`,
                        animation: 'cb-avatar-spin 1.2s linear infinite',
                        zIndex: 0,
                        pointerEvents: 'none'
                      }}
                    />
                  )}
                  <div
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isRunning ? token.colorBgContainer : 'transparent'
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
                  </div>
                </div>
                <Text style={{ fontSize: 12, lineHeight: '26px' }}>{user.name}</Text>
              </div>
            </Tooltip>
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
            <div className="cb-topbar-divider" />
            <div
              className="cb-win-controls"
              style={{ display: 'flex', alignItems: 'center', height: '100%', marginRight: -12 }}
            >
              <button className="cb-win-btn" onClick={handleWindowMinimize} title={t('topbar.minimize')}>
                <MinusOutlined style={{ fontSize: 12 }} />
              </button>
              <button
                className="cb-win-btn"
                onClick={handleWindowMaximize}
                title={isMaximized ? t('topbar.restore') : t('topbar.maximize')}
              >
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
