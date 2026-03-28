import React, { useState } from 'react'
import { Button, Spin, Space, theme, Popover, Switch, Badge, App, Typography, Tooltip } from 'antd'
import {
  FileTextOutlined,
  ExclamationCircleOutlined,
  BellOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  CloudOutlined
} from '@ant-design/icons'
import { useTaskStore } from '../../stores/useTaskStore'
import { useUpdaterStore } from '../../stores/useUpdaterStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useNotificationStore } from '../../stores/useNotificationStore'
import type { WeatherType } from '../WeatherEffect'
import { useT } from '../../i18n'

const { Text } = Typography

interface StatusBarProps {
  onToggleErrorLog: () => void
  weatherVisible: boolean
  onToggleWeather: () => void
  onCycleWeather: () => void
  weatherType: WeatherType
}

// ---- Notification Bell Popover Content ----

const NotificationList: React.FC = () => {
  const notifications = useNotificationStore((state) => state.notifications)
  const unreadCount = useNotificationStore((state) => state.unreadCount)
  const dismiss = useNotificationStore((state) => state.dismiss)
  const dismissAll = useNotificationStore((state) => state.dismissAll)
  const { token } = theme.useToken()
  const t = useT()

  if (notifications.length === 0) {
    return (
      <div style={{ padding: '16px 0', textAlign: 'center', color: token.colorTextSecondary }}>
        {t('statusbar.noNotifications')}
      </div>
    )
  }

  return (
    <div style={{ width: 300, maxHeight: 400, overflow: 'auto' }}>
      {unreadCount > 0 && (
        <div style={{ textAlign: 'right', marginBottom: 8 }}>
          <Button type="link" size="small" onClick={dismissAll} style={{ fontSize: 12, padding: 0 }}>
            {t('statusbar.markAllRead')}
          </Button>
        </div>
      )}
      {notifications.map((n) => (
        <div
          key={n.id}
          style={{
            padding: '8px 0',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            opacity: n.read ? 0.6 : 1
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, marginRight: 8 }}>
              <Text strong style={{ fontSize: 13 }}>{n.title}</Text>
              <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 2 }}>
                {n.body}
              </div>
              <div style={{ fontSize: 11, color: token.colorTextQuaternary, marginTop: 4 }}>
                {new Date(n.timestamp).toLocaleTimeString()}
              </div>
            </div>
            {!n.read && (
              <Button
                type="link"
                size="small"
                onClick={() => dismiss(n.id)}
                style={{ fontSize: 12, padding: 0, whiteSpace: 'nowrap' }}
              >
                {t('statusbar.gotIt')}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Version Popover Content ----

const VersionPopoverContent: React.FC = () => {
  const { status, version, downloadPercent, errorMessage, checked, check, install } = useUpdaterStore()
  const { autoUpdate, updateSetting } = useSettingsStore()
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const t = useT()
  const [checking, setChecking] = useState(false)

  const handleCheck = async (): Promise<void> => {
    setChecking(true)
    try {
      const result = await check()
      if (!result.success) {
        message.error(result.error || t('statusbar.checkUpdateFailed'))
      }
    } catch {
      message.error(t('statusbar.checkUpdateFailed'))
    } finally {
      setChecking(false)
    }
  }

  const renderStatus = (): React.ReactNode => {
    if (status === 'checking') {
      return (
        <Space size={6}>
          <LoadingOutlined spin style={{ fontSize: 12 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>{t('statusbar.checkingUpdate')}</Text>
        </Space>
      )
    }
    if (status === 'available') {
      return (
        <Text style={{ fontSize: 12, color: token.colorPrimary }}>
          <LoadingOutlined style={{ marginRight: 4 }} />
          {t('statusbar.newVersion', version || '')}
        </Text>
      )
    }
    if (status === 'downloading') {
      return (
        <Text style={{ fontSize: 12, color: token.colorPrimary }}>
          <LoadingOutlined style={{ marginRight: 4 }} />
          {t('statusbar.downloading', String(downloadPercent))}
        </Text>
      )
    }
    if (status === 'downloaded') {
      return (
        <Button
          type="primary"
          size="small"
          onClick={install}
          style={{ fontSize: 12 }}
        >
          {t('statusbar.restartInstall', version || '')}
        </Button>
      )
    }
    if (status === 'error') {
      return (
        <Text type="danger" style={{ fontSize: 12 }}>
          <CloseCircleOutlined style={{ marginRight: 4 }} />
          {errorMessage || t('statusbar.checkUpdateFailed')}
        </Text>
      )
    }
    if (checked) {
      return (
        <Text style={{ fontSize: 12, color: token.colorSuccess }}>
          <CheckCircleOutlined style={{ marginRight: 4 }} />
          {t('statusbar.upToDate')}
        </Text>
      )
    }
    return null
  }

  const canCheck = status === 'idle' || status === 'error'

  return (
    <div style={{ width: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text strong style={{ fontSize: 13 }}>{t('statusbar.autoUpdate')}</Text>
        <Switch
          size="small"
          checked={autoUpdate}
          onChange={(val) => updateSetting('autoUpdate', val)}
        />
      </div>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 12 }}>
        {t('statusbar.autoUpdateDesc')}
      </Text>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 }}>
        <span>{renderStatus()}</span>
        {canCheck && (
          <Button size="small" loading={checking} onClick={handleCheck}>
            {t('statusbar.checkUpdate')}
          </Button>
        )}
      </div>
    </div>
  )
}

// ---- Weather mini SVG icons (avoid emoji → CoreText warning) ----

const WeatherIcon: React.FC<{ type: WeatherType; color: string }> = ({ type, color }) => {
  const size = 14
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { display: 'block' as const } }

  if (type === 'snow') {
    // snowflake
    return (
      <svg {...props}>
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
      </svg>
    )
  }
  if (type === 'rain') {
    // cloud + rain drops
    return (
      <svg {...props}>
        <path d="M18 10a4 4 0 00-7.46-2A4 4 0 104 14h14a3 3 0 000-6z" fill={color} fillOpacity={0.15} />
        <line x1="8" y1="18" x2="8" y2="21" />
        <line x1="12" y1="17" x2="12" y2="22" />
        <line x1="16" y1="18" x2="16" y2="21" />
      </svg>
    )
  }
  if (type === 'leaves') {
    // leaf
    return (
      <svg {...props}>
        <path d="M17 8C17 8 13 2 6 2c0 7 6 11 11 6z" fill={color} fillOpacity={0.2} />
        <path d="M6 2c0 7 6 11 11 6" />
        <line x1="6" y1="22" x2="12" y2="12" />
      </svg>
    )
  }
  if (type === 'fireworks') {
    // starburst
    return (
      <svg {...props}>
        <line x1="12" y1="2" x2="12" y2="6" />
        <line x1="12" y1="18" x2="12" y2="22" />
        <line x1="2" y1="12" x2="6" y2="12" />
        <line x1="18" y1="12" x2="22" y2="12" />
        <line x1="5" y1="5" x2="8" y2="8" />
        <line x1="16" y1="16" x2="19" y2="19" />
        <line x1="19" y1="5" x2="16" y2="8" />
        <line x1="8" y1="16" x2="5" y2="19" />
        <circle cx="12" cy="12" r="2" fill={color} fillOpacity={0.3} />
      </svg>
    )
  }
  if (type === 'sakura') {
    // cherry blossom (5-petal flower)
    return (
      <svg {...props}>
        <circle cx="12" cy="8" r="3" fill={color} fillOpacity={0.25} />
        <circle cx="8" cy="11" r="3" fill={color} fillOpacity={0.25} />
        <circle cx="16" cy="11" r="3" fill={color} fillOpacity={0.25} />
        <circle cx="9.5" cy="15" r="3" fill={color} fillOpacity={0.25} />
        <circle cx="14.5" cy="15" r="3" fill={color} fillOpacity={0.25} />
        <circle cx="12" cy="12" r="1.5" fill={color} fillOpacity={0.5} />
      </svg>
    )
  }
  if (type === 'meteor') {
    // shooting star
    return (
      <svg {...props}>
        <line x1="20" y1="4" x2="8" y2="16" />
        <line x1="20" y1="4" x2="14" y2="4" />
        <line x1="20" y1="4" x2="20" y2="10" />
        <circle cx="6" cy="18" r="1.5" fill={color} fillOpacity={0.3} />
      </svg>
    )
  }
  // lantern
  return (
    <svg {...props}>
      <ellipse cx="12" cy="13" rx="5" ry="6" fill={color} fillOpacity={0.2} />
      <line x1="12" y1="7" x2="12" y2="4" />
      <line x1="9" y1="4" x2="15" y2="4" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="10" y1="22" x2="14" y2="22" />
    </svg>
  )
}

const useWeatherNames = (): Record<WeatherType, string> => {
  const t = useT()
  return {
    snow: t('statusbar.weatherSnow'),
    rain: t('statusbar.weatherRain'),
    leaves: t('statusbar.weatherLeaves'),
    fireworks: t('statusbar.weatherFireworks'),
    sakura: t('statusbar.weatherSakura'),
    meteor: t('statusbar.weatherMeteor'),
    lantern: t('statusbar.weatherLantern')
  }
}

// ---- StatusBar ----

const StatusBar: React.FC<StatusBarProps> = ({ onToggleErrorLog, weatherVisible, onToggleWeather, onCycleWeather, weatherType }) => {
  const tasks = useTaskStore((state) => state.tasks)
  const { token } = theme.useToken()
  const updaterStatus = useUpdaterStore((state) => state.status)
  const unreadCount = useNotificationStore((state) => state.unreadCount)
  const t = useT()
  const weatherNames = useWeatherNames()

  const runningTasks = Object.values(tasks).filter((t) => t.status === 'running')
  const isRunning = runningTasks.length > 0
  const activeTaskName = runningTasks.length > 0 ? runningTasks[0].appName : ''

  const hasErrors = Object.values(tasks).some(
    (t) => t.status === 'failed' || t.outputs.some((o) => o.type === 'error')
  )

  const hasUpdate = updaterStatus === 'available' || updaterStatus === 'downloading' || updaterStatus === 'downloaded'

  return (
    <div
      className="cb-statusbar"
      style={{
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        fontSize: 12
      }}
    >
      <Space size="small">
        <Button
          type="text"
          size="small"
          icon={hasErrors ? <ExclamationCircleOutlined style={{ color: token.colorError }} /> : <FileTextOutlined />}
          onClick={onToggleErrorLog}
          style={{ fontSize: 12, height: 22, padding: '0 4px' }}
        >
          {t('statusbar.logs')}
        </Button>
        {isRunning ? (
          <Space size={4}>
            <Spin size="small" />
            <span>{t('statusbar.working', activeTaskName)}</span>
          </Space>
        ) : (
          <span style={{ color: token.colorTextSecondary }}>{t('statusbar.ready')}</span>
        )}
      </Space>

      <Space size="middle">
        {/* Weather toggle */}
        <Tooltip title={weatherVisible ? t('statusbar.weatherClickHint', weatherNames[weatherType]) : t('statusbar.weather')}>
          <span
            onClick={onToggleWeather}
            onContextMenu={(e) => {
              e.preventDefault()
              if (weatherVisible) onCycleWeather()
            }}
            style={{
              cursor: 'pointer',
              fontSize: 14,
              display: 'inline-flex',
              alignItems: 'center',
              height: 20,
              lineHeight: 1,
              color: weatherVisible ? token.colorPrimary : token.colorTextSecondary,
              userSelect: 'none'
            }}
          >
            {weatherVisible
              ? <WeatherIcon type={weatherType} color={token.colorPrimary} />
              : <CloudOutlined style={{ display: 'block', lineHeight: 0}} />}
          </span>
        </Tooltip>

        {/* Notification bell */}
        <Popover
          content={<NotificationList />}
          title={t('statusbar.notifications')}
          trigger="click"
          placement="topRight"
        >
          <Badge count={unreadCount} size="small" offset={[-2, 2]}>
            <BellOutlined
              style={{
                fontSize: 14,
                cursor: 'pointer',
                color: token.colorTextSecondary
              }}
            />
          </Badge>
        </Popover>

        {/* Version with update popover */}
        <Popover
          content={<VersionPopoverContent />}
          trigger="click"
          placement="topRight"
        >
          <span style={{ cursor: 'pointer', color: token.colorTextSecondary, userSelect: 'none' }}>
            <Badge dot={hasUpdate} offset={[4, 0]}>
              <span style={{ color: token.colorTextSecondary }}>
                v{import.meta.env.VITE_APP_VERSION ?? '0.1.0'}
              </span>
            </Badge>
            {hasUpdate && (
              <span style={{ color: token.colorError, fontSize: 10, marginLeft: 4, fontWeight: 600 }}>
                [new]
              </span>
            )}
          </span>
        </Popover>
      </Space>
    </div>
  )
}

export default StatusBar
