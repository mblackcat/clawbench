import React, { useState, useCallback } from 'react'
import { Card, Typography, Space, Button, Result, Spin, App, theme } from 'antd'
import { RightOutlined, DownloadOutlined, PoweroffOutlined, ReloadOutlined, PlayCircleOutlined } from '@ant-design/icons'
import Icon from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { OpenClawNode } from '../../types/openclaw'
import MainNodeCard from './MainNodeCard'
import SubNodeCard from './SubNodeCard'
import { useOpenClawStore } from '../../stores/useOpenClawStore'
import { useT } from '../../i18n'

const { Text } = Typography

const OpenClawSvg = () => (
  <svg viewBox="0 0 120 120" width="1em" height="1em" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z"/>
    <path d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z"/>
    <path d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z"/>
    <path d="M45 15 Q35 5 30 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none"/>
    <path d="M75 15 Q85 5 90 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none"/>
    <circle cx="45" cy="35" r="6" fill="var(--openclaw-eye, #050810)"/>
    <circle cx="75" cy="35" r="6" fill="var(--openclaw-eye, #050810)"/>
  </svg>
)
const OpenClawIcon = (props: any) => <Icon component={OpenClawSvg} {...props} />

interface OpenClawCardProps {
  isInstalled: boolean
  installing: boolean
  nodes: OpenClawNode[]
  onInstall: () => void
}

const OpenClawCard: React.FC<OpenClawCardProps> = ({
  isInstalled,
  installing,
  nodes,
  onInstall
}) => {
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const { modal } = App.useApp()
  const t = useT()
  const startService = useOpenClawStore((s) => s.startService)
  const stopService = useOpenClawStore((s) => s.stopService)
  const [actionLoading, setActionLoading] = useState<'start' | 'stop' | null>(null)

  const isSingleNode = nodes.length <= 1
  const mainNode = nodes.find((n) => n.isLocal) ?? nodes[0]
  const subNodes = nodes.filter((n) => !n.isLocal)

  const isRunning = mainNode?.status === 'running'
  const isStopped = mainNode?.status === 'stopped'

  const handleStart = useCallback(async () => {
    setActionLoading('start')
    await startService()
    setActionLoading(null)
  }, [startService])

  const handleRestart = useCallback(() => {
    modal.confirm({
      title: t('agents.restartConfirm'),
      content: t('agents.restartContent'),
      okText: t('agents.restart'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setActionLoading('start')
        await stopService()
        await startService()
        setActionLoading(null)
      }
    })
  }, [modal, stopService, startService, t])

  const handleStop = useCallback(() => {
    modal.confirm({
      title: t('agents.stopConfirm'),
      content: t('agents.stopContent'),
      okText: t('agents.stop'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setActionLoading('stop')
        await stopService()
        setActionLoading(null)
      }
    })
  }, [modal, stopService, t])

  return (
    <Card
      hoverable
      style={{ borderRadius: token.borderRadiusLG }}
      styles={{ body: { padding: 0 } }}
    >
      {isInstalled ? (
        <div style={{ padding: '20px 24px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Space size={12} align="center">
              <OpenClawIcon style={{ fontSize: 32 }} />
              <div>
                <Text strong style={{ fontSize: 16 }}>OpenClaw</Text>
                <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  {t('agents.description')}
                </Text>
              </div>
            </Space>
            <Space size={8}>
              {mainNode?.isLocal && isStopped && (
                <Button
                  icon={<PlayCircleOutlined />}
                  loading={actionLoading === 'start'}
                  onClick={handleStart}
                >
                  {t('agents.start')}
                </Button>
              )}
              {mainNode?.isLocal && isRunning && (
                <Button
                  icon={<ReloadOutlined />}
                  loading={actionLoading === 'start'}
                  onClick={handleRestart}
                >
                  {t('agents.restart')}
                </Button>
              )}
              {mainNode?.isLocal && isRunning && (
                <Button
                  danger
                  icon={<PoweroffOutlined />}
                  loading={actionLoading === 'stop'}
                  onClick={handleStop}
                >
                  {t('agents.stop')}
                </Button>
              )}
              <Button
                type="primary"
                icon={<RightOutlined />}
                onClick={() => navigate('/ai-agents/openclaw')}
              >
                {t('agents.detail')}
              </Button>
            </Space>
          </div>

          {/* Node layout */}
          {mainNode && (
            <>
              {isSingleNode ? (
                /* Single node: full width */
                <MainNodeCard node={mainNode} />
              ) : (
                /* Multi-node: split layout */
                <div style={{ display: 'flex', gap: 16, minHeight: 220 }}>
                  {/* Left: main node */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <MainNodeCard node={mainNode} />
                  </div>

                  {/* Right: sub nodes (scrollable) */}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      maxHeight: 280,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8
                    }}
                  >
                    {subNodes.map((node) => (
                      <SubNodeCard key={node.id} node={node} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* Not installed */
        <div style={{ padding: '40px 24px' }}>
          <Result
            icon={<OpenClawIcon style={{ fontSize: 64, color: token.colorTextSecondary }} />}
            title={t('agents.notInstalled')}
            subTitle={t('agents.notInstalledDesc')}
            extra={
              <Button
                type="primary"
                size="large"
                icon={<DownloadOutlined />}
                loading={installing}
                onClick={onInstall}
              >
                {installing ? t('agents.installing') : t('agents.oneClickInstall')}
              </Button>
            }
          />
        </div>
      )}
    </Card>
  )
}

export default OpenClawCard
