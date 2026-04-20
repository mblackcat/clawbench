import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Card, Typography, Space, Button, Result, Tag, theme, App } from 'antd'
import {
  RightOutlined, DownloadOutlined, PoweroffOutlined,
  PlayCircleOutlined, ReloadOutlined,
  CheckCircleOutlined, CloseCircleOutlined, QuestionCircleOutlined,
  TagOutlined, MessageOutlined
} from '@ant-design/icons'
import Icon from '@ant-design/icons'
import hermesLogoUrl from '../../assets/hermes-logo.svg'
import { useNavigate } from 'react-router-dom'
import { useHermesStore } from '../../stores/useHermesStore'
import { useT } from '../../i18n'

const { Text } = Typography

// ── Hermes SVG icon ────────────────────────────────────────────────────────

const HermesSvg = () => (
  <svg viewBox="0 0 100 100" width="1em" height="1em" xmlns="http://www.w3.org/2000/svg">
    <image href={hermesLogoUrl} x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet" />
  </svg>
)
const HermesIcon = (props: any) => <Icon component={HermesSvg} {...props} />

// ── Agent visual scene ─────────────────────────────────────────────────────

const HermesAgentScene: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 160 }}>
    <img src={hermesLogoUrl} style={{ maxHeight: 160, maxWidth: '100%', objectFit: 'contain' }} />
  </div>
)

// ── Info panel ─────────────────────────────────────────────────────────────

interface HermesInfoPanelProps {
  version?: string
  serviceStatus: 'running' | 'stopped' | 'unknown'
  model: string
  activeChannels: string[]
}

const HermesInfoPanel: React.FC<HermesInfoPanelProps> = ({ version, serviceStatus, model, activeChannels }) => {
  const { token } = theme.useToken()
  const t = useT()

  const statusConfig = {
    running: { label: t('hermes.statusRunning'), icon: <CheckCircleOutlined />, color: token.colorSuccess },
    stopped: { label: t('hermes.statusStopped'), icon: <CloseCircleOutlined />, color: token.colorError },
    unknown: { label: t('hermes.statusUnknown'), icon: <QuestionCircleOutlined />, color: token.colorTextQuaternary }
  }
  const current = statusConfig[serviceStatus] ?? statusConfig.unknown

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Version */}
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          <TagOutlined style={{ marginRight: 4 }} />{t('hermes.infoVersion')}
        </Text>
        <Text style={{ fontSize: 14 }}>
          {version ? `v${version.replace(/^v/i, '')}` : t('hermes.notConfigured')}
        </Text>
      </div>

      {/* Status */}
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          {t('hermes.infoStatus')}
        </Text>
        <Space size={4} style={{ color: current.color, fontSize: 14 }}>
          {current.icon}
          <span>{current.label}</span>
        </Space>
      </div>

      {/* Model */}
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          🧠 {t('hermes.infoModel')}
        </Text>
        {model ? (
          <Tag color="blue" style={{ margin: 0 }}>{model}</Tag>
        ) : (
          <Text type="secondary" style={{ fontSize: 13 }}>{t('hermes.notConfigured')}</Text>
        )}
      </div>

      {/* Channels */}
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          <MessageOutlined style={{ marginRight: 4 }} />{t('hermes.infoChannels')}
        </Text>
        {activeChannels.length > 0 ? (
          <Space size={4} wrap>
            {activeChannels.map((ch) => (
              <Tag key={ch} style={{ margin: 0 }}>{ch}</Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary" style={{ fontSize: 13 }}>{t('hermes.notConfigured')}</Text>
        )}
      </div>
    </div>
  )
}

// ── Card props ─────────────────────────────────────────────────────────────

interface HermesCardProps {
  isInstalled: boolean
  installing: boolean
  serviceStatus: 'running' | 'stopped' | 'unknown'
  onInstall: () => void
}

// ── Main card ──────────────────────────────────────────────────────────────

const HermesCard: React.FC<HermesCardProps> = ({ isInstalled, installing, serviceStatus, onInstall }) => {
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const { modal } = App.useApp()
  const t = useT()

  const startGateway  = useHermesStore((s) => s.startGateway)
  const stopGateway   = useHermesStore((s) => s.stopGateway)
  const installCheck  = useHermesStore((s) => s.installCheck)
  const config        = useHermesStore((s) => s.config)
  const installLog    = useHermesStore((s) => s.installLog)

  const [actionLoading, setActionLoading] = useState<'start' | 'stop' | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [installLog])

  const isRunning = serviceStatus === 'running'
  const isStopped = serviceStatus !== 'running'

  const handleStart = useCallback(async () => {
    setActionLoading('start')
    await startGateway()
    setActionLoading(null)
  }, [startGateway])

  const handleRestart = useCallback(() => {
    modal.confirm({
      title: t('hermes.restartConfirm'),
      content: t('hermes.restartContent'),
      okText: t('hermes.restart'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setActionLoading('start')
        await stopGateway()
        await startGateway()
        setActionLoading(null)
      }
    })
  }, [modal, stopGateway, startGateway, t])

  const handleStop = useCallback(() => {
    modal.confirm({
      title: t('hermes.stopConfirm'),
      content: t('hermes.stopContent'),
      okText: t('hermes.stop'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setActionLoading('stop')
        await stopGateway()
        setActionLoading(null)
      }
    })
  }, [modal, stopGateway, t])

  // Compute active channels from config
  const activeChannels: string[] = config ? [
    config.channels.telegram.enabled     && t('hermes.channelTelegram'),
    config.channels.discord.enabled      && t('hermes.channelDiscord'),
    config.channels.slack.enabled        && t('hermes.channelSlack'),
    config.channels.signal.enabled       && t('hermes.channelSignal'),
    config.channels.whatsapp.enabled     && t('hermes.channelWhatsApp'),
    config.channels.matrix.enabled       && t('hermes.channelMatrix'),
    config.channels.mattermost.enabled   && t('hermes.channelMattermost'),
    config.channels.homeassistant.enabled && t('hermes.channelHomeAssistant'),
    config.channels.dingtalk.enabled     && t('hermes.channelDingTalk'),
    config.channels.feishu.enabled       && t('hermes.channelFeishu'),
    config.channels.wecom.enabled        && t('hermes.channelWeCom'),
    config.channels.weixin.enabled       && t('hermes.channelWeixin'),
    config.channels.sms.enabled          && t('hermes.channelSMS'),
    config.channels.email.enabled        && t('hermes.channelEmail'),
    config.channels.bluebubbles.enabled  && t('hermes.channelBlueBubbles'),
    config.channels.qqbot.enabled        && t('hermes.channelQQBot'),
  ].filter(Boolean) as string[] : []

  return (
    <Card
      hoverable
      style={{ borderRadius: token.borderRadiusLG, marginTop: 16 }}
      styles={{ body: { padding: 0 } }}
    >
      {isInstalled ? (
        <div style={{ padding: '20px 24px' }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Space size={12} align="center">
              <HermesIcon style={{ fontSize: 32, color: token.colorPrimary }} />
              <div>
                <Text strong style={{ fontSize: 16 }}>{t('hermes.title')}</Text>
                <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  {t('hermes.description')}
                </Text>
              </div>
            </Space>
            <Space size={8}>
              {isStopped && (
                <Button
                  icon={<PlayCircleOutlined />}
                  loading={actionLoading === 'start'}
                  onClick={handleStart}
                >
                  {t('hermes.start')}
                </Button>
              )}
              {isRunning && (
                <Button
                  icon={<ReloadOutlined />}
                  loading={actionLoading === 'start'}
                  onClick={handleRestart}
                >
                  {t('hermes.restart')}
                </Button>
              )}
              {isRunning && (
                <Button
                  danger
                  icon={<PoweroffOutlined />}
                  loading={actionLoading === 'stop'}
                  onClick={handleStop}
                >
                  {t('hermes.stop')}
                </Button>
              )}
              <Button
                type="primary"
                icon={<RightOutlined />}
                onClick={() => navigate('/ai-agents/hermes')}
              >
                {t('hermes.detail')}
              </Button>
            </Space>
          </div>

          {/* Body: scene (left) + info panel (right) */}
          <div style={{ display: 'flex', gap: 16, minHeight: 190 }}>
            {/* Left: visual */}
            <div style={{ flex: 2, minWidth: 0 }}>
              <HermesAgentScene />
            </div>
            {/* Right: info */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingRight: 8 }}>
              <HermesInfoPanel
                version={installCheck?.version}
                serviceStatus={serviceStatus}
                model={config?.model.model || ''}
                activeChannels={activeChannels}
              />
            </div>
          </div>
        </div>
      ) : (
        /* Not installed */
        <div style={{ padding: '40px 24px' }}>
          <Result
            icon={<HermesIcon style={{ fontSize: 64, color: token.colorTextSecondary }} />}
            title={t('hermes.notInstalled')}
            subTitle={t('hermes.notInstalledDesc')}
            extra={
              <Button type="primary" size="large" icon={<DownloadOutlined />} loading={installing} onClick={onInstall}>
                {installing ? t('hermes.installing') : t('hermes.oneClickInstall')}
              </Button>
            }
          />
          {installing && installLog.length > 0 && (
            <div
              ref={logRef}
              style={{
                marginTop: 16,
                maxHeight: 160,
                overflowY: 'auto',
                background: token.colorFillTertiary,
                borderRadius: token.borderRadius,
                padding: '8px 12px',
                fontFamily: 'monospace',
                fontSize: 11,
                color: token.colorTextSecondary
              }}
            >
              {installLog.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export default HermesCard
