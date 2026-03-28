import React, { useState, useEffect } from 'react'
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
import type { OpenClawServiceStatus } from '../../types/openclaw'
import { useT } from '../../i18n'

interface StatusBarProps {
  status: OpenClawServiceStatus
  version?: string
  latestVersion?: string | null
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

const StatusBar: React.FC<StatusBarProps> = ({
  status, version, latestVersion, onStart, onStop, onRestart, onUninstall, onUpgrade, starting, stopping, restarting, upgrading
}) => {
  const { token } = theme.useToken()
  const t = useT()
  const [gatewayUrl, setGatewayUrl] = useState<string | null>(null)

  useEffect(() => {
    window.api.openclaw.getGatewayUrl().then(({ url }) => setGatewayUrl(url))
  }, [status])

  const statusConfig = {
    running: { label: t('agents.statusRunning'), icon: <CheckCircleOutlined />, color: token.colorSuccess },
    stopped: { label: t('agents.statusStopped'), icon: <CloseCircleOutlined />, color: token.colorError },
    unknown: { label: t('agents.statusUnknown'), icon: <QuestionCircleOutlined />, color: token.colorTextQuaternary }
  }
  const current = statusConfig[status] ?? statusConfig.unknown

  const cleanVersion = (v?: string | null) => (v || '').replace(/^v/i, '').replace(/^openclaw\s*/i, '').replace(/\s*\(.*\)$/, '').trim()
  const updateAvailable = !!(
    latestVersion &&
    version &&
    cleanVersion(latestVersion) !== cleanVersion(version)
  )

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
      {/* Left: status info */}
      <Space size={20}>
        <Tooltip title={current.label}>
          <Space size={4} style={{ color: current.color, fontSize: 13 }}>
            {current.icon}
            <span style={{ fontWeight: 500 }}>{current.label}</span>
          </Space>
        </Tooltip>
        {version && (
          <Space size={4} style={{ color: token.colorTextSecondary, fontSize: 13 }}>
            <TagOutlined />
            <span>v{cleanVersion(version)}</span>
          </Space>
        )}
      </Space>

      {/* Right: action buttons */}
      <Space size={8}>
        {updateAvailable && (
          <Tooltip title={t('agents.upgradeTooltip', cleanVersion(version) || '', cleanVersion(latestVersion) || '')}>
            <Button
              size="small"
              icon={<ArrowUpOutlined />}
              loading={upgrading}
              onClick={onUpgrade}
              style={{ color: token.colorWarning, borderColor: token.colorWarning }}
            >
              {t('agents.upgradeTo', cleanVersion(latestVersion) || '')}
            </Button>
          </Tooltip>
        )}
        <Tooltip title={gatewayUrl ? 'Gateway Dashboard' : t('agents.gatewayNotRunning')}>
          <Button
            size="small"
            icon={<MonitorOutlined />}
            disabled={!gatewayUrl}
            onClick={() => { if (gatewayUrl) window.open(gatewayUrl) }}
          >
            Dashboard
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
            {t('agents.start')}
          </Button>
        ) : (
          <>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={restarting}
              onClick={onRestart}
            >
              {t('agents.restart')}
            </Button>
            <Button
              danger
              size="small"
              icon={<PoweroffOutlined />}
              loading={stopping}
              onClick={onStop}
            >
              {t('agents.stop')}
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
          {t('agents.uninstall')}
        </Button>
      </Space>
    </div>
  )
}

export default StatusBar
