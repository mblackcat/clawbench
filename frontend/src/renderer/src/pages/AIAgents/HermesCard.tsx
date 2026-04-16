// frontend/src/renderer/src/pages/AIAgents/HermesCard.tsx
import React, { useState, useCallback } from 'react'
import { Card, Typography, Space, Button, Result, theme, App } from 'antd'
import { RightOutlined, DownloadOutlined, PoweroffOutlined, ReloadOutlined } from '@ant-design/icons'
import Icon from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useHermesStore } from '../../stores/useHermesStore'
import { useT } from '../../i18n'

const { Text } = Typography

const HermesSvg = () => (
  <svg viewBox="0 0 120 120" width="1em" height="1em" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="60" cy="60" rx="45" ry="50" />
    <ellipse cx="60" cy="60" rx="30" ry="35" fill="rgba(0,0,0,0.15)" />
    <circle cx="45" cy="52" r="7" fill="rgba(255,255,255,0.9)" />
    <circle cx="75" cy="52" r="7" fill="rgba(255,255,255,0.9)" />
    <circle cx="45" cy="52" r="3" fill="#111" />
    <circle cx="75" cy="52" r="3" fill="#111" />
    <path d="M48 72 Q60 82 72 72" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" fill="none" />
    <path d="M35 18 Q28 8 22 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
    <path d="M85 18 Q92 8 98 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
  </svg>
)
const HermesIcon = (props: any) => <Icon component={HermesSvg} {...props} />

interface HermesCardProps {
  isInstalled: boolean
  installing: boolean
  serviceStatus: 'running' | 'stopped' | 'unknown'
  onInstall: () => void
}

const HermesCard: React.FC<HermesCardProps> = ({ isInstalled, installing, serviceStatus, onInstall }) => {
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const { modal } = App.useApp()
  const t = useT()
  const startGateway = useHermesStore((s) => s.startGateway)
  const stopGateway = useHermesStore((s) => s.stopGateway)
  const [actionLoading, setActionLoading] = useState<'start' | 'stop' | null>(null)

  const isRunning = serviceStatus === 'running'
  const isStopped = serviceStatus === 'stopped' || serviceStatus === 'unknown'

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

  const statusColor = isRunning ? token.colorSuccess : token.colorTextDisabled

  return (
    <Card
      hoverable
      style={{ borderRadius: token.borderRadiusLG, marginTop: 16 }}
      styles={{ body: { padding: 0 } }}
    >
      {isInstalled ? (
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
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
                <Button icon={<ReloadOutlined />} loading={actionLoading === 'start'} onClick={handleStart}>
                  {t('hermes.start')}
                </Button>
              )}
              {isRunning && (
                <Button icon={<ReloadOutlined />} loading={actionLoading === 'start'} onClick={handleRestart}>
                  {t('hermes.restart')}
                </Button>
              )}
              {isRunning && (
                <Button danger icon={<PoweroffOutlined />} loading={actionLoading === 'stop'} onClick={handleStop}>
                  {t('hermes.stop')}
                </Button>
              )}
              <Button type="primary" icon={<RightOutlined />} onClick={() => navigate('/ai-agents/hermes')}>
                {t('hermes.detail')}
              </Button>
            </Space>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {isRunning ? t('hermes.statusRunning') : t('hermes.statusStopped')}
            </Text>
          </div>
        </div>
      ) : (
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
        </div>
      )}
    </Card>
  )
}

export default HermesCard
