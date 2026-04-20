import React, { useEffect, useState } from 'react'
import {
  Button, Tabs, Row, Col, Spin, Modal, Input, Checkbox,
  Typography, App, theme, Result, Space, Empty
} from 'antd'
import {
  ArrowLeftOutlined, ExclamationCircleFilled,
  MessageOutlined, ThunderboltOutlined, BuildOutlined,
  ScheduleOutlined, DatabaseOutlined
} from '@ant-design/icons'
import Icon from '@ant-design/icons'
import hermesLogoUrl from '../../assets/hermes-logo.svg'
import { useNavigate } from 'react-router-dom'
import { useHermesStore } from '../../stores/useHermesStore'
import type { HermesConfig } from '../../types/hermes'
import { useT } from '../../i18n'
import { getProviderIcon } from '../../components/ProviderIcons'
import HermesStatusBar from './HermesStatusBar'
import HermesModuleCard, { type HermesModuleField } from './HermesModuleCard'
import HermesBottomBar from './HermesBottomBar'
import { buildProviderBadgeKey, getDefaultModelConfig, getProviderGroups } from './hermes-provider-helpers'
import { HERMES_CHANNEL_REGISTRY } from './hermes-channel-registry'

const { Text } = Typography

const BrainSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
    <path d="M13 3a5 5 0 0 1 4.36 2.56A4 4 0 0 1 20 9a4 4 0 0 1-1.19 2.83c.12.37.19.76.19 1.17a4 4 0 0 1-2 3.46V18a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-1.54A4 4 0 0 1 5 13c0-.41.07-.8.19-1.17A4 4 0 0 1 4 9a4 4 0 0 1 2.64-3.44A5 5 0 0 1 11 3c.7 0 1.38.14 2 .4A5 5 0 0 1 13 3z"/>
    <rect x="11" y="3" width="2" height="17" fill="rgba(0,0,0,0.18)" rx="1"/>
  </svg>
)
const BrainIcon = (props: any) => <Icon component={BrainSvg} {...props} />

const HermesSvg = () => (
  <svg viewBox="0 0 100 100" width="1em" height="1em" xmlns="http://www.w3.org/2000/svg">
    <image href={hermesLogoUrl} x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet" />
  </svg>
)
const HermesIcon = (props: any) => <Icon component={HermesSvg} {...props} />

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

  const renderGrid = (children: React.ReactNode[]) => (
    <Row gutter={[16, 16]} style={{ padding: '16px 0' }}>
      {children.map((child, i) => (
        <Col key={i} xs={24} sm={12} md={8} lg={6}>
          {child}
        </Col>
      ))}
    </Row>
  )

  const buildProviderFields = (providerId: string): HermesModuleField[] => {
    if (!config) return []
    const provider = getProviderGroups().flatMap((group) => group.providers).find((item) => item.id === providerId)
    if (!provider) return []

    const fields: HermesModuleField[] = [
      {
        key: 'model',
        label: t('hermes.modelName'),
        type: 'select',
        value: config.model.model,
        options: provider.recommendedModels,
        onChange: (value) => patchModel({ model: value as string })
      },
      {
        key: 'custom-model',
        label: t('hermes.modelCustom'),
        type: 'text',
        value: config.model.model,
        placeholder: provider.defaultModel || t('hermes.modelCustomPlaceholder'),
        onChange: (value) => patchModel({ model: value as string })
      },
    ]

    if (provider.authType === 'api_key' || provider.authType === 'compatible') {
      fields.push({
        key: 'apiKey',
        label: t('hermes.apiKey'),
        type: 'password',
        placeholder: t('hermes.apiKeyPlaceholder'),
        value: config.model.apiKey,
        onChange: (value) => patchModel({ apiKey: value as string })
      })
    }

    if (provider.authType === 'aws') {
      fields.push(
        {
          key: 'region',
          label: t('hermes.field.awsRegion'),
          type: 'text',
          value: config.model.aws?.region || '',
          placeholder: 'us-east-1',
          onChange: (value) => patchModel({ aws: { ...(config.model.aws || {}), region: value as string } })
        },
        {
          key: 'profile',
          label: t('hermes.field.awsProfile'),
          type: 'text',
          value: config.model.aws?.profile || '',
          placeholder: 'default',
          onChange: (value) => patchModel({ aws: { ...(config.model.aws || {}), profile: value as string } })
        }
      )
    }

    if (provider.authType === 'oauth') {
      fields.push({
        key: 'accountLabel',
        label: t('hermes.field.oauthAccount'),
        type: 'text',
        value: config.model.oauth?.accountLabel || '',
        placeholder: 'user@example.com',
        onChange: (value) => patchModel({ oauth: { ...(config.model.oauth || {}), accountLabel: value as string, configured: !!value } })
      })
    }

    if (provider.authType === 'local' || provider.authType === 'compatible') {
      fields.push({
        key: 'base_url',
        label: t('hermes.baseUrlOptional'),
        type: 'text',
        value: config.model.base_url,
        placeholder: 'https://api.example.com/v1',
        onChange: (value) => patchModel({ base_url: value as string })
      })
    }

    return fields
  }

  const buildChannelFields = (channelId: keyof HermesConfig['channels']): HermesModuleField[] => {
    if (!config) return []
    const channelMeta = HERMES_CHANNEL_REGISTRY.find((c) => c.id === channelId)
    if (!channelMeta) return []
    const channelConfig = config.channels[channelId] as Record<string, unknown> | undefined
    if (!channelConfig?.enabled) return []
    return channelMeta.fields.map((fieldMeta) => ({
      key: fieldMeta.key,
      label: t(fieldMeta.labelKey),
      type: fieldMeta.type,
      placeholder: fieldMeta.placeholder,
      value: (channelConfig?.[fieldMeta.key] ?? '') as string,
      onChange: (value: unknown) =>
        patchChannels({ [channelId]: { ...channelConfig, [fieldMeta.key]: value } })
    }))
  }

  const renderProviderSection = (groupId: 'hosted' | 'oauth' | 'self-hosted-compatible', titleKey: string) => {
    if (!config) return null
    const group = getProviderGroups().find((item) => item.id === groupId)
    if (!group) return null

    return (
      <div key={groupId} style={{ marginBottom: 24 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          {t(titleKey)}
        </Text>
        <Row gutter={[16, 16]}>
          {group.providers.map((provider) => {
            const isActive = config.model.provider === provider.id
            const ProviderIconComp = getProviderIcon(provider.id)

            return (
              <Col key={provider.id} xs={24} sm={12} md={8} lg={6}>
                <HermesModuleCard
                  icon={<ProviderIconComp style={{ width: 14, height: 14, display: 'block', objectFit: 'contain' }} />}
                  iconColor={token.colorFillTertiary}
                  title={t(provider.titleKey)}
                  description={isActive ? t(provider.descriptionKey) : undefined}
                  summary={t(provider.modelSummaryKey)}
                  badge={t(buildProviderBadgeKey(provider.authType))}
                  enabled={isActive}
                  onToggle={(checked) => {
                    if (!checked) return
                    patchModel(getDefaultModelConfig(provider.id))
                  }}
                  onExpandChange={(expanded) => {
                    if (!expanded || isActive) return
                    patchModel(getDefaultModelConfig(provider.id))
                  }}
                  fields={isActive ? buildProviderFields(provider.id) : []}
                  extraActions={provider.docsUrl ? (
                    <Button type="link" size="small" href={provider.docsUrl} target="_blank" style={{ paddingInline: 0 }}>
                      {t('hermes.docs')}
                    </Button>
                  ) : undefined}
                />
              </Col>
            )
          })}
        </Row>
      </div>
    )
  }

  const providersTab = config ? (
    <div style={{ paddingTop: 12 }}>
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
        {t('hermes.providersIntro')}
      </Text>
      {renderProviderSection('hosted', 'hermes.providerGroup.hosted')}
      {renderProviderSection('oauth', 'hermes.providerGroup.oauth')}
      {renderProviderSection('self-hosted-compatible', 'hermes.providerGroup.compatible')}
    </div>
  ) : null

  const channelsTab = config ? (
    <div>
      {renderGrid(
        HERMES_CHANNEL_REGISTRY.map((channel) => {
          const enabled = config.channels[channel.id]?.enabled ?? false
          return (
            <HermesModuleCard
              key={channel.id}
              icon={channel.icon}
              title={t(channel.titleKey)}
              description={t(channel.descriptionKey)}
              note={channel.noteKey ? t(channel.noteKey) : undefined}
              enabled={enabled}
              onToggle={(v) =>
                patchChannels({ [channel.id]: { ...config.channels[channel.id], enabled: v } })
              }
              fields={buildChannelFields(channel.id)}
            />
          )
        })
      )}
    </div>
  ) : null

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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

      <HermesBottomBar
        dirty={dirty}
        saving={saving}
        applying={applying}
        onSave={handleSave}
        onApply={handleApply}
      />

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
