import React, { useEffect, useState } from 'react'
import {
  Button, Tabs, Row, Col, Spin, Modal, Input, Checkbox,
  Typography, App, theme, Result, Space, Empty
} from 'antd'
import {
  ArrowLeftOutlined, ExclamationCircleFilled,
  MessageOutlined, ThunderboltOutlined, BuildOutlined,
  ScheduleOutlined, DatabaseOutlined, FileTextOutlined
} from '@ant-design/icons'
import Icon from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useHermesStore, type HermesConfig } from '../../stores/useHermesStore'
import { useT } from '../../i18n'
import HermesStatusBar from './HermesStatusBar'
import HermesModuleCard, { type HermesModuleField } from './HermesModuleCard'
import HermesBottomBar from './HermesBottomBar'

const { Text } = Typography

const BrainSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
    <path d="M13 3a5 5 0 0 1 4.36 2.56A4 4 0 0 1 20 9a4 4 0 0 1-1.19 2.83c.12.37.19.76.19 1.17a4 4 0 0 1-2 3.46V18a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-1.54A4 4 0 0 1 5 13c0-.41.07-.8.19-1.17A4 4 0 0 1 4 9a4 4 0 0 1 2.64-3.44A5 5 0 0 1 11 3c.7 0 1.38.14 2 .4A5 5 0 0 1 13 3z"/>
    <rect x="11" y="3" width="2" height="17" fill="rgba(0,0,0,0.18)" rx="1"/>
  </svg>
)
const BrainIcon = (props: any) => <Icon component={BrainSvg} {...props} />

const HermesSvg = () => (
  <svg viewBox="0 0 100 100" width="1em" height="1em" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    {/* Border frame */}
    <rect x="2" y="2" width="96" height="96" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
    {/* Headphone arc */}
    <path d="M22 46 C22 18 78 18 78 46" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
    {/* Left ear cup */}
    <ellipse cx="18" cy="51" rx="7.5" ry="10" />
    {/* Right ear cup */}
    <ellipse cx="82" cy="51" rx="7.5" ry="10" />
    {/* Hair silhouette — bob cut with flat fringe */}
    <path d="M29 42 Q50 23 71 42 L73 65 Q66 74 50 75 Q34 74 27 65 Z" />
    {/* Bangs — straight strip across forehead */}
    <path d="M32 42 L32 51 Q50 45 68 51 L68 42 Q50 33 32 42 Z" />
    {/* Face */}
    <ellipse cx="50" cy="59" rx="17" ry="19" fill="rgba(255,255,255,0.88)" />
    {/* Eyes */}
    <ellipse cx="43" cy="56" rx="4" ry="3" />
    <ellipse cx="57" cy="56" rx="4" ry="3" />
    <circle cx="44.5" cy="55" r="1.2" fill="rgba(255,255,255,0.95)" />
    <circle cx="58.5" cy="55" r="1.2" fill="rgba(255,255,255,0.95)" />
    {/* Nose */}
    <path d="M49 63 Q50 65.5 51 63" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.6" />
    {/* Mouth */}
    <path d="M46 69 Q50 73 54 69" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    {/* Shoulders */}
    <path d="M27 78 C18 87 14 97 13 99 L87 99 C86 97 82 87 73 78 Q63 75 50 75 Q37 75 27 78 Z" />
    {/* Collar N badge */}
    <rect x="43" y="81" width="14" height="11" rx="2" fill="rgba(255,255,255,0.9)" />
    <path d="M46 83.5 L46 89.5 L51 83.5 L51 89.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const HermesIcon = (props: any) => <Icon component={HermesSvg} {...props} />

// ── Static data ────────────────────────────────────────────────────────────

const PROVIDER_DEFS = [
  { id: 'anthropic', iconEmoji: '🤖', defaultModel: 'claude-opus-4-6' },
  { id: 'openai',    iconEmoji: '⚡', defaultModel: 'gpt-4o' },
  { id: 'google',    iconEmoji: '✨', defaultModel: 'gemini-2.0-flash' },
  { id: 'nous',      iconEmoji: '🧠', defaultModel: 'nous-hermes-3' },
  { id: 'openrouter',iconEmoji: '🔀', defaultModel: 'meta-llama/llama-3.3-70b-instruct' },
  { id: 'custom',    iconEmoji: '⚙️', defaultModel: '' }
]

const SKILL_DEFS = [
  { id: 'web_search', iconEmoji: '🔍', name: 'hermes.skillWebSearch', desc: 'hermes.skillWebSearchDesc' },
  { id: 'file_system',iconEmoji: '📁', name: 'hermes.skillFileSystem', desc: 'hermes.skillFileSystemDesc' },
  { id: 'shell',      iconEmoji: '💻', name: 'hermes.skillShell',      desc: 'hermes.skillShellDesc' },
  { id: 'memory',     iconEmoji: '🧠', name: 'hermes.skillMemory',     desc: 'hermes.skillMemoryDesc' },
  { id: 'learn',      iconEmoji: '📚', name: 'hermes.skillLearn',      desc: 'hermes.skillLearnDesc' },
  { id: 'reflect',    iconEmoji: '🪞', name: 'hermes.skillReflect',    desc: 'hermes.skillReflectDesc' }
]

const TOOL_DEFS = [
  { id: 'browser',       iconEmoji: '🌐', name: 'hermes.toolBrowser',      desc: 'hermes.toolBrowserDesc',      enabled: true },
  { id: 'computer_use',  iconEmoji: '🖥️', name: 'hermes.toolComputerUse',  desc: 'hermes.toolComputerUseDesc',  enabled: false },
  { id: 'image_gen',     iconEmoji: '🎨', name: 'hermes.toolImageGen',      desc: 'hermes.toolImageGenDesc',     enabled: false },
  { id: 'code_exec',     iconEmoji: '⚙️', name: 'hermes.toolCodeExec',      desc: 'hermes.toolCodeExecDesc',     enabled: true }
]

const REASONING_OPTIONS = [
  { value: 'none',   label: 'None' },
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High' },
  { value: 'xhigh',  label: 'Extra High' }
]

// ── Component ──────────────────────────────────────────────────────────────

const HermesPage: React.FC = () => {
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const { message, modal } = App.useApp()
  const t = useT()

  const installCheck  = useHermesStore((s) => s.installCheck)
  const serviceStatus = useHermesStore((s) => s.serviceStatus)
  const config        = useHermesStore((s) => s.config)
  const configLoading = useHermesStore((s) => s.configLoading)
  const dirty         = useHermesStore((s) => s.dirty)
  const saving        = useHermesStore((s) => s.saving)
  const uninstalling  = useHermesStore((s) => s.uninstalling)
  const cronJobs      = useHermesStore((s) => s.cronJobs)

  const checkInstalled  = useHermesStore((s) => s.checkInstalled)
  const fetchStatus     = useHermesStore((s) => s.fetchStatus)
  const fetchConfig     = useHermesStore((s) => s.fetchConfig)
  const updateConfig    = useHermesStore((s) => s.updateConfig)
  const saveConfigAction= useHermesStore((s) => s.saveConfig)
  const startGateway    = useHermesStore((s) => s.startGateway)
  const stopGateway     = useHermesStore((s) => s.stopGateway)
  const uninstallHermes = useHermesStore((s) => s.uninstallHermes)
  const upgradeHermes   = useHermesStore((s) => s.upgradeHermes)
  const fetchCronJobs   = useHermesStore((s) => s.fetchCronJobs)

  const [starting,   setStarting]   = useState(false)
  const [stopping,   setStopping]   = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [upgrading,  setUpgrading]  = useState(false)
  const [applying,   setApplying]   = useState(false)
  const [activeTab,  setActiveTab]  = useState('providers')

  // Uninstall modal
  const [uninstallOpen,  setUninstallOpen]  = useState(false)
  const [uninstallCode,  setUninstallCode]  = useState('')
  const [uninstallInput, setUninstallInput] = useState('')
  const [removeConfig,   setRemoveConfig]   = useState(false)

  useEffect(() => { checkInstalled() }, [])
  useEffect(() => {
    if (installCheck?.installed) {
      fetchStatus()
      fetchConfig()
    }
  }, [installCheck?.installed])

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleStart = async () => {
    setStarting(true)
    const result = await startGateway()
    setStarting(false)
    if (result.success) {
      message.success(t('hermes.started'))
    } else {
      modal.error({
        title: t('hermes.startFailed'),
        width: 640,
        content: (
          <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {result.error || t('hermes.unknownError')}
          </pre>
        )
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
        if (result.success) message.success(t('hermes.stopped'))
        else message.error(result.error || t('hermes.stopFailed'))
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
        setRestarting(true)
        await stopGateway()
        const result = await startGateway()
        setRestarting(false)
        if (result.success) message.success(t('hermes.restarted'))
        else message.error(result.error || t('hermes.restartFailed'))
      }
    })
  }

  const handleSave = async () => {
    const result = await saveConfigAction()
    if (result.success) message.success(t('hermes.configSaved'))
    else message.error(result.error || t('hermes.configSaveFailed'))
  }

  const handleApply = async () => {
    setApplying(true)
    const saveResult = await saveConfigAction()
    if (!saveResult.success) {
      setApplying(false)
      message.error(saveResult.error || t('hermes.configSaveFailed'))
      return
    }
    if (serviceStatus === 'running') await stopGateway()
    const startResult = await startGateway()
    setApplying(false)
    if (startResult.success) message.success(t('hermes.configApplied'))
    else message.error(startResult.error || t('hermes.startFailed'))
  }

  const handleUninstallOpen = () => {
    const code = String(Math.floor(1000 + Math.random() * 9000))
    setUninstallCode(code)
    setUninstallInput('')
    setRemoveConfig(false)
    setUninstallOpen(true)
  }

  const handleUninstallConfirm = async () => {
    if (uninstallInput !== uninstallCode) return
    setUninstallOpen(false)
    const result = await uninstallHermes()
    if (result.success) {
      message.success(t('hermes.uninstalled'))
      navigate('/ai-agents')
    } else {
      message.error(result.error || t('hermes.uninstallFailed'))
    }
  }

  const handleUpgrade = async () => {
    setUpgrading(true)
    const result = await upgradeHermes()
    setUpgrading(false)
    if (result.success) message.success(t('hermes.upgraded'))
    else message.error(result.error || t('hermes.upgradeFailed'))
  }

  // ── Config helpers ────────────────────────────────────────────────────

  const patchModel = (patch: Partial<HermesConfig['model']>) => {
    if (!config) return
    updateConfig({ model: { ...config.model, ...patch } })
  }

  const patchChannels = (patch: Partial<HermesConfig['channels']>) => {
    if (!config) return
    updateConfig({ channels: { ...config.channels, ...patch } })
  }

  const patchAgent = (patch: Partial<HermesConfig['agent']>) => {
    if (!config) return
    updateConfig({ agent: { ...config.agent, ...patch } })
  }

  // ── Grids ─────────────────────────────────────────────────────────────

  const renderGrid = (children: React.ReactNode[]) => (
    <Row gutter={[16, 16]} style={{ padding: '16px 0' }}>
      {children.map((child, i) => (
        <Col key={i} xs={24} sm={12} md={8} lg={6}>
          {child}
        </Col>
      ))}
    </Row>
  )

  // Providers tab
  const providersTab = config ? (
    <div>
      {renderGrid(
        PROVIDER_DEFS.map((p) => {
          const isActive = config.model.provider === p.id
          const fields: HermesModuleField[] = isActive ? [
            {
              key: 'model',
              label: t('hermes.modelName'),
              type: 'text',
              placeholder: p.defaultModel,
              value: config.model.model,
              onChange: (v) => patchModel({ model: v as string })
            },
            {
              key: 'apiKey',
              label: t('hermes.apiKey'),
              type: 'password',
              placeholder: t('hermes.apiKeyPlaceholder'),
              value: config.model.apiKey,
              onChange: (v) => patchModel({ apiKey: v as string })
            },
            ...(p.id === 'custom' ? [{
              key: 'base_url',
              label: t('hermes.baseUrlOptional'),
              type: 'text' as const,
              placeholder: 'https://api.example.com/v1',
              value: config.model.base_url,
              onChange: (v: string | number) => patchModel({ base_url: v as string })
            }] : [])
          ] : []

          return (
            <HermesModuleCard
              key={p.id}
              icon={p.iconEmoji}
              title={t(`hermes.${p.id}Name`)}
              description={isActive ? t(`hermes.${p.id}Desc`) : undefined}
              enabled={isActive}
              badge={isActive ? t('hermes.activeProvider') : undefined}
              onToggle={(on) => { if (on) patchModel({ provider: p.id, apiKey: '', model: p.defaultModel }) }}
              fields={fields}
            />
          )
        })
      )}
    </div>
  ) : null

  // Channels tab
  const channelsTab = config ? (
    <div>
      {renderGrid([
        // Telegram
        <HermesModuleCard
          icon="✈️"
          title={t('hermes.channelTelegram')}
          description={t('hermes.telegramDesc')}
          enabled={config.channels.telegram.enabled}
          onToggle={(v) => patchChannels({ telegram: { ...config.channels.telegram, enabled: v } })}
          fields={config.channels.telegram.enabled ? [{
            key: 'token', label: t('hermes.botToken'), type: 'password',
            placeholder: '123456:ABC-DEF...',
            value: config.channels.telegram.token,
            onChange: (v) => patchChannels({ telegram: { ...config.channels.telegram, token: v as string } })
          }] : []}
        />,
        // Discord
        <HermesModuleCard
          icon="🎮"
          title={t('hermes.channelDiscord')}
          description={t('hermes.discordDesc')}
          enabled={config.channels.discord.enabled}
          onToggle={(v) => patchChannels({ discord: { ...config.channels.discord, enabled: v } })}
          fields={config.channels.discord.enabled ? [{
            key: 'token', label: t('hermes.botToken'), type: 'password',
            placeholder: 'Bot token...',
            value: config.channels.discord.token,
            onChange: (v) => patchChannels({ discord: { ...config.channels.discord, token: v as string } })
          }] : []}
        />,
        // Slack
        <HermesModuleCard
          icon="💬"
          title={t('hermes.channelSlack')}
          description={t('hermes.slackDesc')}
          enabled={config.channels.slack.enabled}
          onToggle={(v) => patchChannels({ slack: { ...config.channels.slack, enabled: v } })}
          fields={config.channels.slack.enabled ? [
            {
              key: 'bot_token', label: t('hermes.slackBotToken'), type: 'password',
              placeholder: 'xoxb-...',
              value: config.channels.slack.bot_token,
              onChange: (v) => patchChannels({ slack: { ...config.channels.slack, bot_token: v as string } })
            },
            {
              key: 'app_token', label: t('hermes.slackAppToken'), type: 'password',
              placeholder: 'xapp-...',
              value: config.channels.slack.app_token,
              onChange: (v) => patchChannels({ slack: { ...config.channels.slack, app_token: v as string } })
            }
          ] : []}
        />,
        // Signal
        <HermesModuleCard
          icon="🔒"
          title={t('hermes.channelSignal')}
          description={t('hermes.signalDesc')}
          enabled={config.channels.signal.enabled}
          onToggle={(v) => patchChannels({ signal: { ...config.channels.signal, enabled: v } })}
          fields={config.channels.signal.enabled ? [{
            key: 'phone', label: t('hermes.signalPhone'), type: 'text',
            placeholder: '+1234567890',
            value: config.channels.signal.phone,
            onChange: (v) => patchChannels({ signal: { ...config.channels.signal, phone: v as string } })
          }] : []}
        />
      ])}
    </div>
  ) : null

  // Skills tab (static)
  const skillsTab = (
    <div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', padding: '12px 0 0' }}>
        {t('hermes.skillsNote')}
      </Text>
      {renderGrid(
        SKILL_DEFS.map((s) => (
          <HermesModuleCard
            key={s.id}
            icon={s.iconEmoji}
            title={t(s.name)}
            description={t(s.desc)}
            enabled={true}
            readOnly={true}
          />
        ))
      )}
    </div>
  )

  // Tools tab (static)
  const toolsTab = (
    <div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', padding: '12px 0 0' }}>
        {t('hermes.toolsNote')}
      </Text>
      {renderGrid(
        TOOL_DEFS.map((tool) => (
          <HermesModuleCard
            key={tool.id}
            icon={tool.iconEmoji}
            title={t(tool.name)}
            description={t(tool.desc)}
            enabled={tool.enabled}
            readOnly={true}
          />
        ))
      )}
    </div>
  )

  // Memory tab (configurable)
  const memoryTab = config ? (
    <Row gutter={[16, 16]} style={{ padding: '16px 0' }}>
      <Col xs={24} sm={12} md={8} lg={6}>
        <HermesModuleCard
          icon="🧠"
          title={t('hermes.memorySystemName')}
          description={t('hermes.memorySystemDesc')}
          enabled={config.agent.memory_enabled}
          onToggle={(v) => patchAgent({ memory_enabled: v })}
        />
      </Col>
      <Col xs={24} sm={12} md={8} lg={6}>
        <HermesModuleCard
          icon="👤"
          title={t('hermes.userProfileName')}
          description={t('hermes.userProfileDesc')}
          enabled={config.agent.user_profile_enabled}
          onToggle={(v) => patchAgent({ user_profile_enabled: v })}
        />
      </Col>
      <Col xs={24} sm={12} md={8} lg={6}>
        <HermesModuleCard
          icon="⚙️"
          title={t('hermes.agentSettingsName')}
          description={t('hermes.agentSettingsDesc')}
          alwaysExpanded={true}
          fields={[
            {
              key: 'max_turns',
              label: t('hermes.maxTurnsLabel'),
              type: 'number',
              value: config.agent.max_turns,
              min: 1,
              max: 500,
              onChange: (v) => patchAgent({ max_turns: v as number })
            },
            {
              key: 'reasoning_effort',
              label: t('hermes.reasoningLabel'),
              type: 'select',
              value: config.agent.reasoning_effort,
              options: REASONING_OPTIONS,
              onChange: (v) => patchAgent({ reasoning_effort: v as string })
            }
          ]}
        />
      </Col>
    </Row>
  ) : null

  // Cron tab
  const cronTab = (
    <div style={{ padding: '16px 0' }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        {t('hermes.cronJobsHint')}
      </Text>
      {cronJobs.length === 0 ? (
        <Empty
          image={<ScheduleOutlined style={{ fontSize: 48, color: token.colorTextDisabled }} />}
          description={t('hermes.noCronJobs')}
        />
      ) : (
        <Row gutter={[16, 16]}>
          {cronJobs.map((job) => (
            <Col key={job} xs={24} sm={12} md={8} lg={6}>
              <HermesModuleCard
                icon="⏰"
                title={job.replace(/\.(yaml|yml|json|sh)$/, '')}
                description={job}
                readOnly={true}
              />
            </Col>
          ))}
        </Row>
      )}
    </div>
  )

  // ── Tab config ────────────────────────────────────────────────────────

  const tabItems = [
    {
      key: 'providers',
      label: <span><BrainIcon /> {t('hermes.tabProviders')}</span>,
      children: providersTab
    },
    {
      key: 'channels',
      label: <span><MessageOutlined /> {t('hermes.tabChannels')}</span>,
      children: channelsTab
    },
    {
      key: 'skills',
      label: <span><ThunderboltOutlined /> {t('hermes.tabSkills')}</span>,
      children: skillsTab
    },
    {
      key: 'tools',
      label: <span><BuildOutlined /> {t('hermes.tabTools')}</span>,
      children: toolsTab
    },
    {
      key: 'memory',
      label: <span><DatabaseOutlined /> {t('hermes.tabMemory')}</span>,
      children: memoryTab
    },
    {
      key: 'cron',
      label: <span><ScheduleOutlined /> {t('hermes.tabCron')}</span>,
      children: cronTab
    }
  ]

  // ── Guard states ──────────────────────────────────────────────────────

  if (installCheck === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!installCheck.installed) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
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

  // ── Main render ───────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Back + StatusBar */}
      <div style={{ padding: '16px 24px 0 24px' }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/ai-agents')}
          style={{ marginBottom: 12, paddingLeft: 0 }}
        >
          {t('hermes.backToAgents')}
        </Button>
        <HermesStatusBar
          status={serviceStatus}
          version={installCheck.version}
          onStart={handleStart}
          onStop={handleStop}
          onRestart={handleRestart}
          onUninstall={handleUninstallOpen}
          onUpgrade={handleUpgrade}
          starting={starting}
          stopping={stopping}
          restarting={restarting}
          upgrading={upgrading}
        />
      </div>

      {/* Tabs */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px' }}>
        <Spin spinning={configLoading}>
          <Tabs
            activeKey={activeTab}
            items={tabItems}
            onChange={(key) => {
              setActiveTab(key)
              if (key === 'cron') fetchCronJobs()
            }}
          />
        </Spin>
      </div>

      {/* Bottom bar */}
      <HermesBottomBar
        dirty={dirty}
        saving={saving}
        applying={applying}
        onSave={handleSave}
        onApply={handleApply}
      />

      {/* Uninstall confirmation modal */}
      <Modal
        title={
          <span style={{ color: token.colorError }}>
            <ExclamationCircleFilled style={{ marginRight: 8 }} />
            {t('hermes.uninstallTitle')}
          </span>
        }
        open={uninstallOpen}
        onCancel={() => setUninstallOpen(false)}
        okText={t('hermes.confirmUninstall')}
        okType="danger"
        okButtonProps={{ disabled: uninstallInput !== uninstallCode, loading: uninstalling }}
        onOk={handleUninstallConfirm}
        cancelText={t('common.cancel')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Text>{t('hermes.uninstallDesc')}</Text>
          <Checkbox checked={removeConfig} onChange={(e) => setRemoveConfig(e.target.checked)}>
            {t('hermes.uninstallRemoveConfig')}
          </Checkbox>
          <div>
            <Text strong style={{ color: token.colorError }}>
              {t('hermes.uninstallInputHint', uninstallCode)}
            </Text>
            <Input
              style={{ marginTop: 8 }}
              placeholder={uninstallCode}
              value={uninstallInput}
              onChange={(e) => setUninstallInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              maxLength={4}
              status={uninstallInput.length === 4 && uninstallInput !== uninstallCode ? 'error' : undefined}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default HermesPage
