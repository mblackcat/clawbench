import React, { useEffect, useState } from 'react'
import { Button, Space, Tooltip, theme } from 'antd'
import {
  PlayCircleOutlined,
  PoweroffOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  TagOutlined,
  ArrowUpOutlined,
  MonitorOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import type { HermesServiceStatus } from '../../types/hermes'
import { useT } from '../../i18n'

interface HermesStatusBarProps {
  status: HermesServiceStatus
  version?: string
  onStart: () => void
  onStop: () => void
  onRestart: () => void
  onUninstall: () => void
  onUpgrade?: () => void
  starting?: boolean
  stopping?: boolean
  restarting?: boolean
  upgrading?: boolean
}

const HermesStatusBar: React.FC<HermesStatusBarProps> = ({
  status, version, onStart, onStop, onRestart, onUninstall, onUpgrade,
  starting, stopping, restarting, upgrading
}) => {
  const { token } = theme.useToken()
  const t = useT()
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null)

  useEffect(() => {
    window.api.hermes.getDashboardUrl().then((url) => setDashboardUrl(url))
  }, [status])

  const statusConfig = {
    running: { label: t('hermes.statusRunning'), icon: <CheckCircleOutlined />, color: token.colorSuccess },
    stopped: { label: t('hermes.statusStopped'), icon: <CloseCircleOutlined />, color: token.colorError },
    unknown: { label: t('hermes.statusUnknown'), icon: <QuestionCircleOutlined />, color: token.colorTextQuaternary }
  }
  const current = statusConfig[status] ?? statusConfig.unknown

  return (
    <div
      className="cb-glass-card"
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px'
      }}
    >
      {/* Left: status + version */}
      <Space size={20}>
        <Space size={4} style={{ color: current.color, fontSize: 13 }}>
          {current.icon}
          <span style={{ fontWeight: 500 }}>{current.label}</span>
        </Space>
        {version && (
          <Space size={4} style={{ color: token.colorTextSecondary, fontSize: 13 }}>
            <TagOutlined />
            <span>v{version.replace(/^v/i, '')}</span>
          </Space>
        )}
      </Space>

      {/* Right: actions */}
      <Space size={8}>
        {onUpgrade && (
          <Button
            size="small"
            icon={<ArrowUpOutlined />}
            loading={upgrading}
            onClick={onUpgrade}
          >
            {t('hermes.upgrade')}
          </Button>
        )}
        <Tooltip title={dashboardUrl ? 'Hermes Web Dashboard' : t('hermes.gatewayNotRunning')}>
          <Button
            size="small"
            icon={<MonitorOutlined />}
            disabled={!dashboardUrl}
            onClick={() => { if (dashboardUrl) window.open(dashboardUrl) }}
          >
            {t('hermes.dashboard')}
          </Button>
        </Tooltip>
        {status !== 'running' ? (
          <Button
            type="primary"
            size="small"
            icon={<PlayCircleOutlined />}
            loading={starting}
            onClick={onStart}
          >
            {t('hermes.start')}
          </Button>
        ) : (
          <>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={restarting}
              onClick={onRestart}
            >
              {t('hermes.restart')}
            </Button>
            <Button
              danger
              size="small"
              icon={<PoweroffOutlined />}
              loading={stopping}
              onClick={onStop}
            >
              {t('hermes.stop')}
            </Button>
          </>
        )}
        <Button
          danger
          type="text"
          size="small"
          icon={<DeleteOutlined />}
          onClick={onUninstall}
        >
          {t('hermes.uninstall')}
        </Button>
      </Space>
    </div>
  )
}

export default HermesStatusBar
