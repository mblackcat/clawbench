import React from 'react'
import { Button, Spin, Space, theme, Badge, Tooltip } from 'antd'
import {
  FileTextOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  CloudOutlined
} from '@ant-design/icons'
import { useTaskStore } from '../../stores/useTaskStore'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { useAttentionStore } from '../../stores/useAttentionStore'
import type { WeatherType } from '../WeatherEffect'
import { useT } from '../../i18n'

interface StatusBarProps {
  onToggleErrorLog: () => void
  weatherVisible: boolean
  onToggleWeather: () => void
  onCycleWeather: () => void
  weatherType: WeatherType
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
// Right cluster only: weather → status → logs
// Version/update moved to the avatar menu; the notification bell is merged
// into the log icon's badge (errors / attention / legacy notifications).

const StatusBar: React.FC<StatusBarProps> = ({ onToggleErrorLog, weatherVisible, onToggleWeather, onCycleWeather, weatherType }) => {
  const tasks = useTaskStore((state) => state.tasks)
  const { token } = theme.useToken()
  const unreadCount = useNotificationStore((state) => state.unreadCount)
  const attentionItems = useAttentionStore((state) => state.items)
  const attentionHasAction = useAttentionStore((state) => {
    // Inline so Zustand tracks item/context changes via selector return value
    return state.hasAction()
  })
  const t = useT()
  const weatherNames = useWeatherNames()

  const runningTasks = Object.values(tasks).filter((task) => task.status === 'running')
  const isRunning = runningTasks.length > 0
  const activeTaskName = runningTasks.length > 0 ? runningTasks[0].appName : ''

  const hasErrors = Object.values(tasks).some(
    (task) => task.status === 'failed' || task.outputs.some((o) => o.type === 'error')
  )

  const attentionCount = attentionItems.length
  // Log entry absorbs the former notification bell: badge for errors / attention / legacy notifications
  const logBadgeCount = attentionCount > 0 ? attentionCount : unreadCount
  const logHasAlert = hasErrors || attentionCount > 0 || unreadCount > 0

  return (
    <div
      className="cb-statusbar"
      style={{
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '0 12px',
        fontSize: 12
      }}
    >
      {/* Right cluster only: weather → status → logs */}
      <Space size="middle" align="center">
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
              justifyContent: 'center',
              height: 22,
              width: 22,
              lineHeight: 1,
              color: weatherVisible ? token.colorPrimary : token.colorTextSecondary,
              userSelect: 'none'
            }}
          >
            {weatherVisible
              ? <WeatherIcon type={weatherType} color={token.colorPrimary} />
              : <CloudOutlined style={{ display: 'block', lineHeight: 0 }} />}
          </span>
        </Tooltip>

        {/* Ready / running status */}
        {isRunning ? (
          <Tooltip title={t('statusbar.working', activeTaskName)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', height: 22 }}>
              <Spin size="small" />
            </span>
          </Tooltip>
        ) : (
          <Tooltip title={t('statusbar.ready')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', height: 22 }}>
              <CheckCircleOutlined style={{ color: token.colorTextSecondary, fontSize: 14 }} />
            </span>
          </Tooltip>
        )}

        {/* Logs + merged attention/notification badge */}
        <Tooltip title={t('statusbar.logs')}>
          <Badge
            count={logBadgeCount > 0 ? logBadgeCount : 0}
            size="small"
            offset={[-2, 2]}
            color={attentionHasAction || hasErrors ? token.colorError : undefined}
            dot={logHasAlert && logBadgeCount === 0}
          >
            <Button
              type="text"
              size="small"
              icon={
                logHasAlert ? (
                  <ExclamationCircleOutlined
                    className={attentionHasAction ? 'cb-attention-flash' : undefined}
                    style={{ color: token.colorError }}
                  />
                ) : (
                  <FileTextOutlined />
                )
              }
              onClick={onToggleErrorLog}
              style={{ fontSize: 12, height: 22, width: 22, padding: 0 }}
            />
          </Badge>
        </Tooltip>
      </Space>
    </div>
  )
}

export default StatusBar
