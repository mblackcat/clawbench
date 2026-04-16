// frontend/src/renderer/src/pages/Hermes/HermesPage.tsx
import React, { useEffect, useState } from 'react'
import {
  Button, Tabs, Form, Input, Select, Switch, InputNumber,
  Space, Typography, Spin, App, theme, Result
} from 'antd'
import {
  ArrowLeftOutlined, PoweroffOutlined, ReloadOutlined,
  ExclamationCircleFilled
} from '@ant-design/icons'
import Icon from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useHermesStore, type HermesConfig } from '../../stores/useHermesStore'
import { useT } from '../../i18n'

const { Title, Text } = Typography

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

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'nous', label: 'Nous Portal' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'custom', label: 'Custom' }
]

const REASONING_EFFORTS = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' }
]

const HermesPage: React.FC = () => {
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const { message, modal } = App.useApp()
  const t = useT()

  const installCheck = useHermesStore((s) => s.installCheck)
  const serviceStatus = useHermesStore((s) => s.serviceStatus)
  const config = useHermesStore((s) => s.config)
  const configLoading = useHermesStore((s) => s.configLoading)
  const dirty = useHermesStore((s) => s.dirty)
  const saving = useHermesStore((s) => s.saving)
  const uninstalling = useHermesStore((s) => s.uninstalling)

  const checkInstalled = useHermesStore((s) => s.checkInstalled)
  const fetchStatus = useHermesStore((s) => s.fetchStatus)
  const fetchConfig = useHermesStore((s) => s.fetchConfig)
  const updateConfig = useHermesStore((s) => s.updateConfig)
  const saveConfigAction = useHermesStore((s) => s.saveConfig)
  const startGateway = useHermesStore((s) => s.startGateway)
  const stopGateway = useHermesStore((s) => s.stopGateway)
  const uninstallHermes = useHermesStore((s) => s.uninstallHermes)
  const upgradeHermes = useHermesStore((s) => s.upgradeHermes)

  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [upgrading, setUpgrading] = useState(false)

  useEffect(() => {
    checkInstalled()
  }, [])

  useEffect(() => {
    if (installCheck?.installed) {
      fetchStatus()
      fetchConfig()
    }
  }, [installCheck?.installed])

  const isRunning = serviceStatus === 'running'

  const handleStart = async () => {
    setStarting(true)
    const result = await startGateway()
    setStarting(false)
    if (result.success) {
      message.success(t('hermes.started'))
    } else {
      modal.error({
        title: t('hermes.startFailed'),
        content: (
          <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {result.error || t('hermes.unknownError')}
          </pre>
        ),
        width: 600
      })
    }
  }

  const handleStop = () => {
    modal.confirm({
      title: t('hermes.stopConfirm'),
      icon: <ExclamationCircleFilled />,
      content: t('hermes.stopContent'),
      okText: t('hermes.stop'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        setStopping(true)
        const result = await stopGateway()
        setStopping(false)
        if (result.success) {
          message.success(t('hermes.stopped'))
        } else {
          message.error(result.error || t('hermes.stopFailed'))
        }
      }
    })
  }

  const handleRestart = () => {
    modal.confirm({
      title: t('hermes.restartConfirm'),
      icon: <ExclamationCircleFilled />,
      content: t('hermes.restartContent'),
      okText: t('hermes.restart'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        setStarting(true)
        await stopGateway()
        const result = await startGateway()
        setStarting(false)
        if (result.success) {
          message.success(t('hermes.restarted'))
        } else {
          message.error(result.error || t('hermes.restartFailed'))
        }
      }
    })
  }

  const handleSave = async () => {
    const result = await saveConfigAction()
    if (result.success) {
      message.success(t('hermes.configSaved'))
    } else {
      message.error(result.error || t('hermes.configSaveFailed'))
    }
  }

  const handleSaveAndRestart = async () => {
    const saveResult = await saveConfigAction()
    if (!saveResult.success) {
      message.error(saveResult.error || t('hermes.configSaveFailed'))
      return
    }
    setStarting(true)
    if (isRunning) await stopGateway()
    const startResult = await startGateway()
    setStarting(false)
    if (startResult.success) {
      message.success(t('hermes.configApplied'))
    } else {
      message.error(startResult.error || t('hermes.startFailed'))
    }
  }

  const handleUninstall = () => {
    modal.confirm({
      title: t('hermes.uninstallTitle'),
      icon: <ExclamationCircleFilled />,
      content: t('hermes.uninstallDesc'),
      okText: t('hermes.confirmUninstall'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        const result = await uninstallHermes()
        if (result.success) {
          message.success(t('hermes.uninstalled'))
          navigate('/ai-agents')
        } else {
          message.error(result.error || t('hermes.uninstallFailed'))
        }
      }
    })
  }

  const handleUpgrade = async () => {
    setUpgrading(true)
    const result = await upgradeHermes()
    setUpgrading(false)
    if (result.success) {
      message.success(t('hermes.upgraded'))
    } else {
      message.error(result.error || t('hermes.upgradeFailed'))
    }
  }

  if (installCheck === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!installCheck.installed) {
    return (
      <div style={{ maxWidth: 700, margin: '60px auto', padding: '0 24px' }}>
        <Result
          icon={<HermesIcon style={{ fontSize: 64, color: token.colorTextSecondary }} />}
          title={t('hermes.notInstalled')}
          subTitle={t('hermes.notInstalledDesc')}
          extra={
            <Button onClick={() => navigate('/ai-agents')} icon={<ArrowLeftOutlined />}>
              {t('hermes.backToAgents')}
            </Button>
          }
        />
      </div>
    )
  }

  const statusColor = isRunning ? token.colorSuccess : token.colorTextDisabled

  const modelTab = config ? (
    <div style={{ maxWidth: 520, paddingTop: 16 }}>
      <Form layout="vertical">
        <Form.Item label={t('hermes.provider')}>
          <Select
            value={config.model.provider}
            options={PROVIDERS}
            onChange={(v) => updateConfig({ model: { ...config.model, provider: v } })}
          />
        </Form.Item>
        <Form.Item label={t('hermes.model')}>
          <Input
            value={config.model.model}
            onChange={(e) => updateConfig({ model: { ...config.model, model: e.target.value } })}
            placeholder="e.g. claude-opus-4-6"
          />
        </Form.Item>
        <Form.Item label={t('hermes.apiKey')}>
          <Input.Password
            value={config.model.apiKey}
            onChange={(e) => updateConfig({ model: { ...config.model, apiKey: e.target.value } })}
            placeholder={t('hermes.apiKeyPlaceholder')}
          />
        </Form.Item>
        <Form.Item label={t('hermes.baseUrl')}>
          <Input
            value={config.model.base_url}
            onChange={(e) => updateConfig({ model: { ...config.model, base_url: e.target.value } })}
            placeholder="https://api.example.com/v1 (optional)"
          />
        </Form.Item>
      </Form>
    </div>
  ) : null

  const channelsTab = config ? (
    <div style={{ maxWidth: 520, paddingTop: 16 }}>
      <Form layout="vertical">
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>{t('hermes.channelTelegram')}</Text>
        <Form.Item label={t('hermes.enabled')}>
          <Switch
            checked={config.channels.telegram.enabled}
            onChange={(v) => updateConfig({ channels: { ...config.channels, telegram: { ...config.channels.telegram, enabled: v } } })}
          />
        </Form.Item>
        {config.channels.telegram.enabled && (
          <Form.Item label={t('hermes.botToken')}>
            <Input.Password
              value={config.channels.telegram.token}
              onChange={(e) => updateConfig({ channels: { ...config.channels, telegram: { ...config.channels.telegram, token: e.target.value } } })}
              placeholder="123456:ABC-DEF..."
            />
          </Form.Item>
        )}

        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 16, marginBottom: 8 }}>{t('hermes.channelDiscord')}</Text>
        <Form.Item label={t('hermes.enabled')}>
          <Switch
            checked={config.channels.discord.enabled}
            onChange={(v) => updateConfig({ channels: { ...config.channels, discord: { ...config.channels.discord, enabled: v } } })}
          />
        </Form.Item>
        {config.channels.discord.enabled && (
          <Form.Item label={t('hermes.botToken')}>
            <Input.Password
              value={config.channels.discord.token}
              onChange={(e) => updateConfig({ channels: { ...config.channels, discord: { ...config.channels.discord, token: e.target.value } } })}
              placeholder="Bot token..."
            />
          </Form.Item>
        )}

        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 16, marginBottom: 8 }}>{t('hermes.channelSlack')}</Text>
        <Form.Item label={t('hermes.enabled')}>
          <Switch
            checked={config.channels.slack.enabled}
            onChange={(v) => updateConfig({ channels: { ...config.channels, slack: { ...config.channels.slack, enabled: v } } })}
          />
        </Form.Item>
        {config.channels.slack.enabled && (
          <>
            <Form.Item label={t('hermes.slackBotToken')}>
              <Input.Password
                value={config.channels.slack.bot_token}
                onChange={(e) => updateConfig({ channels: { ...config.channels, slack: { ...config.channels.slack, bot_token: e.target.value } } })}
                placeholder="xoxb-..."
              />
            </Form.Item>
            <Form.Item label={t('hermes.slackAppToken')}>
              <Input.Password
                value={config.channels.slack.app_token}
                onChange={(e) => updateConfig({ channels: { ...config.channels, slack: { ...config.channels.slack, app_token: e.target.value } } })}
                placeholder="xapp-..."
              />
            </Form.Item>
          </>
        )}

        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 16, marginBottom: 8 }}>{t('hermes.channelSignal')}</Text>
        <Form.Item label={t('hermes.enabled')}>
          <Switch
            checked={config.channels.signal.enabled}
            onChange={(v) => updateConfig({ channels: { ...config.channels, signal: { ...config.channels.signal, enabled: v } } })}
          />
        </Form.Item>
        {config.channels.signal.enabled && (
          <Form.Item label={t('hermes.signalPhone')}>
            <Input
              value={config.channels.signal.phone}
              onChange={(e) => updateConfig({ channels: { ...config.channels, signal: { ...config.channels.signal, phone: e.target.value } } })}
              placeholder="+1234567890"
            />
          </Form.Item>
        )}
      </Form>
    </div>
  ) : null

  const agentTab = config ? (
    <div style={{ maxWidth: 520, paddingTop: 16 }}>
      <Form layout="vertical">
        <Form.Item label={t('hermes.memoryEnabled')}>
          <Switch
            checked={config.agent.memory_enabled}
            onChange={(v) => updateConfig({ agent: { ...config.agent, memory_enabled: v } })}
          />
        </Form.Item>
        <Form.Item label={t('hermes.userProfileEnabled')}>
          <Switch
            checked={config.agent.user_profile_enabled}
            onChange={(v) => updateConfig({ agent: { ...config.agent, user_profile_enabled: v } })}
          />
        </Form.Item>
        <Form.Item label={t('hermes.maxTurns')}>
          <InputNumber
            min={1}
            max={500}
            value={config.agent.max_turns}
            onChange={(v) => updateConfig({ agent: { ...config.agent, max_turns: v ?? 50 } })}
            style={{ width: 120 }}
          />
        </Form.Item>
        <Form.Item label={t('hermes.reasoningEffort')}>
          <Select
            value={config.agent.reasoning_effort}
            options={REASONING_EFFORTS}
            onChange={(v) => updateConfig({ agent: { ...config.agent, reasoning_effort: v } })}
            style={{ width: 180 }}
          />
        </Form.Item>
      </Form>
    </div>
  ) : null

  const tabItems = [
    { key: 'model', label: t('hermes.tabModel'), children: modelTab },
    { key: 'channels', label: t('hermes.tabChannels'), children: channelsTab },
    { key: 'agent', label: t('hermes.tabAgent'), children: agentTab }
  ]

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 24px 80px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate('/ai-agents')}>
          {t('hermes.backToAgents')}
        </Button>
      </div>

      {/* Title + status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Space size={12} align="center">
          <HermesIcon style={{ fontSize: 36, color: token.colorPrimary }} />
          <div>
            <Title level={4} style={{ margin: 0 }}>{t('hermes.title')}</Title>
            {installCheck.version && (
              <Text type="secondary" style={{ fontSize: 12 }}>v{installCheck.version}</Text>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {isRunning ? t('hermes.statusRunning') : t('hermes.statusStopped')}
            </Text>
          </div>
        </Space>
        <Space>
          {!isRunning && (
            <Button icon={<ReloadOutlined />} loading={starting} onClick={handleStart}>
              {t('hermes.start')}
            </Button>
          )}
          {isRunning && (
            <Button icon={<ReloadOutlined />} loading={starting} onClick={handleRestart}>
              {t('hermes.restart')}
            </Button>
          )}
          {isRunning && (
            <Button danger icon={<PoweroffOutlined />} loading={stopping} onClick={handleStop}>
              {t('hermes.stop')}
            </Button>
          )}
        </Space>
      </div>

      {/* Config tabs */}
      <Spin spinning={configLoading}>
        <Tabs items={tabItems} />
      </Spin>

      {/* Bottom action bar */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '12px 24px',
          background: token.colorBgElevated,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 100
        }}
      >
        <Button danger onClick={handleUninstall} loading={uninstalling}>
          {t('hermes.uninstall')}
        </Button>
        <Space>
          <Button onClick={handleUpgrade} loading={upgrading}>
            {t('hermes.upgrade')}
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!dirty}>
            {t('hermes.save')}
          </Button>
          <Button type="primary" onClick={handleSaveAndRestart} loading={saving} disabled={!dirty}>
            {t('hermes.saveAndRestart')}
          </Button>
        </Space>
      </div>
    </div>
  )
}

export default HermesPage
