import React, { useState, useEffect, useCallback } from 'react'
import {
  Card, Form, Input, Select, Slider, Typography, theme, App, Button,
  Tabs, Statistic, Row, Col, Tag, Popconfirm, Space, Switch, Empty,
} from 'antd'
import {
  ReloadOutlined,
  DeleteOutlined,
  CheckOutlined,
  CloseOutlined,
  LikeOutlined,
  DislikeOutlined,
  EditOutlined,
} from '@ant-design/icons'
import { useT } from '../../i18n'
import { MONO_FONT_STACK } from '../../utils/mono-font'
import { ROLE_LABELS, ROLE_LABELS_EN, type SetupRole } from '../../constants/module-visibility'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useAICodingStore } from '../../stores/useAICodingStore'

const { Text } = Typography
const { TextArea } = Input

interface FeedbackStats {
  totalFeedback: { up: number; down: number }
  byTopic: Record<string, { up: number; down: number }>
  recentTrend: { date: string; up: number; down: number }[]
  soulSuggestions: { suggestion: string; reason: string; feedbackCount: number }[]
}

const SOUL_ROLES: SetupRole[] = ['general', 'design', 'tech', 'art']

type MemoryFilename = 'soul.md' | 'memory.md' | 'user.md' | 'tools.md' | 'agents.md'
type EditableDocKey = 'user' | 'agents' | 'tools'

const AIAssistantSettings: React.FC = () => {
  const t = useT()
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const language = useSettingsStore((s) => s.language)
  const roleLabels = language === 'en' ? ROLE_LABELS_EN : ROLE_LABELS

  const imConfig = useAICodingStore((s) => s.imConfig)
  const fetchIMConfig = useAICodingStore((s) => s.fetchIMConfig)
  const [remoteImSaving, setRemoteImSaving] = useState(false)

  const [toolApprovalMode, setToolApprovalMode] = useState('auto-approve-safe')
  const [maxToolSteps, setMaxToolSteps] = useState(0)
  const [assistantEnabled, setAssistantEnabled] = useState(true)
  const [setupRole, setSetupRole] = useState<SetupRole | ''>('')

  const [soul, setSoul] = useState('')
  const [memory, setMemory] = useState('')
  const [userMd, setUserMd] = useState('')
  const [agents, setAgents] = useState('')
  const [tools, setTools] = useState('')
  const [stats, setStats] = useState<FeedbackStats | null>(null)

  const [profileGroup, setProfileGroup] = useState('youAndI')
  const [youAndITab, setYouAndITab] = useState('persona')
  const [editingDocs, setEditingDocs] = useState<Partial<Record<EditableDocKey, boolean>>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.settings.getAgentSettings(),
      window.api.agent.readAllMemories(),
      window.api.agent.readStats(),
      fetchIMConfig(),
    ]).then(([settings, memories, statsData]: any[]) => {
      setToolApprovalMode(settings?.defaultToolApprovalMode || 'auto-approve-safe')
      setMaxToolSteps(settings?.maxAgentToolSteps ?? 0)
      setAssistantEnabled(settings?.assistantEnabled !== false)
      setSetupRole((settings?.setupRole as SetupRole) || '')

      setSoul(memories['soul.md'] || '')
      setMemory(memories['memory.md'] || '')
      setUserMd(memories['user.md'] || '')
      setAgents(memories['agents.md'] || '')
      setTools(memories['tools.md'] || '')
      setStats(statsData)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [fetchIMConfig])

  const saveApprovalMode = useCallback((value: string) => {
    setToolApprovalMode(value)
    window.api.settings.setAgentSettings({ defaultToolApprovalMode: value }).catch(() => {})
  }, [])

  const saveMaxSteps = useCallback((value: number) => {
    setMaxToolSteps(value)
    window.api.settings.setAgentSettings({ maxAgentToolSteps: value }).catch(() => {})
  }, [])

  const saveAssistantEnabled = useCallback((value: boolean) => {
    setAssistantEnabled(value)
    window.api.settings.setAgentSettings({ assistantEnabled: value }).catch(() => {})
  }, [])

  const saveRemoteImEnabled = useCallback(async (value: boolean) => {
    setRemoteImSaving(true)
    try {
      const store = useAICodingStore.getState()
      if (!value && store.imStatus.state === 'connected') {
        await store.imDisconnect()
      }
      await store.saveIMConfig({ ...store.imConfig, remoteEnabled: value })
    } catch {
      message.error(t('common.saveFailed'))
    } finally {
      setRemoteImSaving(false)
    }
  }, [message, t])

  const saveSoul = useCallback(() => {
    window.api.agent.writeMemory('soul.md', soul).then(() => {
      message.success(t('common.saved'))
    }).catch(() => message.error(t('common.saveFailed')))
  }, [soul, message, t])

  const restoreSoulDefault = useCallback(() => {
    window.api.agent.restoreSoulDefault().then(async () => {
      const content = await window.api.agent.readMemory('soul.md')
      setSoul(content)
      message.success(t('common.saved'))
    }).catch(() => {})
  }, [message, t])

  const applyTemplate = useCallback((role: SetupRole) => {
    window.api.agent.applySoulTemplate(role).then(async () => {
      const content = await window.api.agent.readMemory('soul.md')
      setSoul(content)
      setSetupRole(role)
      await window.api.settings.setAgentSettings({ setupRole: role })
      message.success(t('common.saved'))
    }).catch(() => message.error(t('common.saveFailed')))
  }, [message, t])

  const applyDocValue = useCallback((filename: MemoryFilename, content: string) => {
    if (filename === 'soul.md') setSoul(content)
    else if (filename === 'memory.md') setMemory(content)
    else if (filename === 'user.md') setUserMd(content)
    else if (filename === 'tools.md') setTools(content)
    else if (filename === 'agents.md') setAgents(content)
  }, [])

  const saveMemoryFile = useCallback((filename: MemoryFilename, content: string, editKey?: EditableDocKey) => {
    window.api.agent.writeMemory(filename, content).then(() => {
      message.success(t('common.saved'))
      if (editKey) {
        setEditingDocs((prev) => ({ ...prev, [editKey]: false }))
      }
    }).catch(() => message.error(t('common.saveFailed')))
  }, [message, t])

  const clearMemoryFile = useCallback((filename: MemoryFilename) => {
    window.api.agent.writeMemory(filename, '').then(() => {
      applyDocValue(filename, '')
      message.success(t('common.saved'))
    }).catch(() => {})
  }, [applyDocValue, message, t])

  const startEditDoc = useCallback((key: EditableDocKey) => {
    setEditingDocs((prev) => ({ ...prev, [key]: true }))
  }, [])

  const cancelEditDoc = useCallback(async (key: EditableDocKey, filename: MemoryFilename) => {
    try {
      const content = await window.api.agent.readMemory(filename)
      applyDocValue(filename, content)
    } catch {
      // keep local value if reload fails
    }
    setEditingDocs((prev) => ({ ...prev, [key]: false }))
  }, [applyDocValue])

  const handleAcceptSuggestion = useCallback(async (index: number) => {
    if (!stats) return
    const suggestion = stats.soulSuggestions[index]
    const updatedSoul = soul + '\n' + suggestion.suggestion
    setSoul(updatedSoul)
    await window.api.agent.writeMemory('soul.md', updatedSoul)

    const updatedStats = { ...stats }
    updatedStats.soulSuggestions = updatedStats.soulSuggestions.filter((_, i) => i !== index)
    setStats(updatedStats)
    await window.api.agent.writeMemory('stats.json', JSON.stringify(updatedStats, null, 2))
    message.success(t('common.saved'))
  }, [stats, soul, message, t])

  const handleDismissSuggestion = useCallback(async (index: number) => {
    if (!stats) return
    const updatedStats = { ...stats }
    updatedStats.soulSuggestions = updatedStats.soulSuggestions.filter((_, i) => i !== index)
    setStats(updatedStats)
    await window.api.agent.writeMemory('stats.json', JSON.stringify(updatedStats, null, 2))
  }, [stats])

  const resetStats = useCallback(async () => {
    const defaultStats: FeedbackStats = {
      totalFeedback: { up: 0, down: 0 },
      byTopic: {},
      recentTrend: [],
      soulSuggestions: [],
    }
    await window.api.agent.writeMemory('stats.json', JSON.stringify(defaultStats, null, 2))
    setStats(defaultStats)
    message.success(t('common.saved'))
  }, [message, t])

  if (!loaded) return null

  const totalUp = stats?.totalFeedback.up || 0
  const totalDown = stats?.totalFeedback.down || 0
  const totalFeedback = totalUp + totalDown
  const monoAreaStyle: React.CSSProperties = {
    resize: 'vertical',
    fontFamily: MONO_FONT_STACK,
    fontSize: 13,
    marginBottom: 8,
  }

  const renderReadonlyHint = (hint: string) => (
    <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
      {hint}
    </Text>
  )

  const renderDocArea = (
    value: string,
    onChange: (v: string) => void,
    options: {
      rows?: number
      readOnly: boolean
      disabled?: boolean
      emptyHint?: string
    },
  ) => {
    if (options.readOnly && !value.trim()) {
      return (
        <div
          style={{
            marginBottom: 8,
            padding: '20px 12px',
            borderRadius: token.borderRadius,
            border: `1px dashed ${token.colorBorderSecondary}`,
            background: token.colorFillQuaternary,
          }}
        >
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {options.emptyHint || t('settings.aiAssistant.emptyAuto')}
              </Text>
            }
          />
        </div>
      )
    }
    return (
      <TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={options.rows ?? 8}
        readOnly={options.readOnly}
        disabled={options.disabled}
        style={{
          ...monoAreaStyle,
          cursor: options.readOnly ? 'default' : undefined,
          background: options.readOnly ? token.colorFillQuaternary : undefined,
        }}
      />
    )
  }

  const renderManagedDocActions = (
    key: EditableDocKey,
    filename: MemoryFilename,
    content: string,
    canClear = true,
  ) => {
    const editing = !!editingDocs[key]
    if (!editing) {
      return (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => startEditDoc(key)}>
            {t('settings.aiAssistant.edit')}
          </Button>
          {canClear && (
            <Popconfirm title={t('settings.aiAssistant.clearConfirm')} onConfirm={() => clearMemoryFile(filename)}>
              <Button size="small" danger icon={<DeleteOutlined />}>
                {t('settings.aiAssistant.clear')}
              </Button>
            </Popconfirm>
          )}
        </Space>
      )
    }
    return (
      <Space>
        <Button size="small" type="primary" onClick={() => saveMemoryFile(filename, content, key)}>
          {t('common.save')}
        </Button>
        <Button size="small" onClick={() => cancelEditDoc(key, filename)}>
          {t('common.cancel')}
        </Button>
        {canClear && (
          <Popconfirm title={t('settings.aiAssistant.clearConfirm')} onConfirm={() => clearMemoryFile(filename)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              {t('settings.aiAssistant.clear')}
            </Button>
          </Popconfirm>
        )}
      </Space>
    )
  }

  const personaPanel = (
    <div>
      {renderReadonlyHint(t('settings.aiAssistant.soulDesc'))}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 12 }}>{t('settings.aiAssistant.templateLabel')}</Text>
        <Select
          size="small"
          style={{ minWidth: 140 }}
          placeholder={t('settings.aiAssistant.templatePlaceholder')}
          value={setupRole || undefined}
          onChange={(role: SetupRole) => applyTemplate(role)}
          options={SOUL_ROLES.map((r) => ({ value: r, label: roleLabels[r] }))}
          disabled={!assistantEnabled}
        />
        <div style={{ flex: 1 }} />
        <Popconfirm title={t('settings.aiAssistant.restoreDefaultConfirm')} onConfirm={restoreSoulDefault}>
          <Button size="small" icon={<ReloadOutlined />} disabled={!assistantEnabled}>
            {t('settings.aiAssistant.restoreDefault')}
          </Button>
        </Popconfirm>
        <Button size="small" type="primary" onClick={saveSoul} disabled={!assistantEnabled}>
          {t('common.save')}
        </Button>
      </div>
      {renderDocArea(soul, setSoul, {
        rows: 10,
        readOnly: false,
        disabled: !assistantEnabled,
      })}
    </div>
  )

  const userPanel = (
    <div>
      {renderReadonlyHint(t('settings.aiAssistant.userDesc'))}
      {renderDocArea(userMd, setUserMd, {
        rows: 10,
        readOnly: !editingDocs.user,
        emptyHint: t('settings.aiAssistant.emptyUser'),
      })}
      {renderManagedDocActions('user', 'user.md', userMd)}
    </div>
  )

  const subAgentsPanel = (
    <div>
      {renderReadonlyHint(t('settings.aiAssistant.subAgentsDesc'))}
      {renderDocArea(agents, setAgents, {
        rows: 8,
        readOnly: !editingDocs.agents,
        emptyHint: t('settings.aiAssistant.emptySubAgents'),
      })}
      {renderManagedDocActions('agents', 'agents.md', agents)}
    </div>
  )

  const toolsPanel = (
    <div>
      {renderReadonlyHint(t('settings.aiAssistant.toolsDesc'))}
      {renderDocArea(tools, setTools, {
        rows: 12,
        readOnly: !editingDocs.tools,
        emptyHint: t('settings.aiAssistant.emptyTools'),
      })}
      {renderManagedDocActions('tools', 'tools.md', tools, false)}
    </div>
  )

  const memoryPanel = (
    <div>
      {renderReadonlyHint(t('settings.aiAssistant.memoryDesc'))}
      {renderDocArea(memory, setMemory, {
        rows: 12,
        readOnly: true,
        emptyHint: t('settings.aiAssistant.emptyMemory'),
      })}
      <Space>
        <Popconfirm title={t('settings.aiAssistant.clearConfirm')} onConfirm={() => clearMemoryFile('memory.md')}>
          <Button size="small" danger icon={<DeleteOutlined />} disabled={!assistantEnabled}>
            {t('settings.aiAssistant.clear')}
          </Button>
        </Popconfirm>
      </Space>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 1. Master switch */}
      <Card
        size="small"
        title={t('settings.aiAssistant.masterTitle')}
        style={{ borderRadius: token.borderRadiusLG }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('settings.aiAssistant.masterDesc')}
            </Text>
          </div>
          <Switch checked={assistantEnabled} onChange={saveAssistantEnabled} />
        </div>
      </Card>

      {/* Remote IM — enable-style toggle next to master */}
      <Card
        size="small"
        title={t('settings.aiAssistant.remoteImTitle')}
        style={{ borderRadius: token.borderRadiusLG }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('settings.aiAssistant.remoteImDesc')}
            </Text>
          </div>
          <Switch
            checked={imConfig.remoteEnabled === true}
            loading={remoteImSaving}
            onChange={saveRemoteImEnabled}
          />
        </div>
      </Card>

      {/* 2. Unified profile / knowledge card — 3 groups, 5 leaf tabs */}
      <Card
        size="small"
        title={t('settings.aiAssistant.profileTitle')}
        style={{ borderRadius: token.borderRadiusLG, opacity: assistantEnabled ? 1 : 0.55 }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <Tabs
          activeKey={profileGroup}
          onChange={setProfileGroup}
          size="small"
          items={[
            {
              key: 'youAndI',
              label: t('settings.aiAssistant.groupYouAndI'),
              children: (
                <Tabs
                  activeKey={youAndITab}
                  onChange={setYouAndITab}
                  size="small"
                  items={[
                    {
                      key: 'persona',
                      label: t('settings.aiAssistant.tabPersona'),
                      children: personaPanel,
                    },
                    {
                      key: 'user',
                      label: t('settings.aiAssistant.tabUser'),
                      children: userPanel,
                    },
                    {
                      key: 'subAgents',
                      label: t('settings.aiAssistant.tabSubAgents'),
                      children: subAgentsPanel,
                    },
                  ]}
                />
              ),
            },
            {
              key: 'canDo',
              label: t('settings.aiAssistant.groupCanDo'),
              children: toolsPanel,
            },
            {
              key: 'learned',
              label: t('settings.aiAssistant.groupLearned'),
              children: memoryPanel,
            },
          ]}
        />
      </Card>

      {/* 3. Behavior */}
      <Card
        size="small"
        title={t('settings.aiAssistant.behaviorTitle')}
        style={{ borderRadius: token.borderRadiusLG }}
        styles={{ body: { padding: '14px 16px' } }}
      >
        <Form layout="vertical" style={{ marginBottom: 0 }}>
          <Form.Item
            label={t('settings.aiAssistant.toolApproval')}
            style={{ marginBottom: 16 }}
          >
            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
              {t('settings.aiAssistant.toolApprovalDesc')}
            </Text>
            <Select
              value={toolApprovalMode}
              onChange={saveApprovalMode}
              style={{ width: '100%' }}
              options={[
                { value: 'auto-approve-safe', label: t('settings.aiAssistant.autoApproveSafe') },
                { value: 'auto-approve-session', label: t('settings.aiAssistant.autoApproveSession') },
                { value: 'ask-every-time', label: t('settings.aiAssistant.askEveryTime') },
              ]}
            />
          </Form.Item>

          <Form.Item
            label={t('settings.aiAssistant.maxToolSteps')}
            style={{ marginBottom: 0 }}
          >
            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
              {t('settings.aiAssistant.maxToolStepsDesc')}
            </Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Slider
                min={0}
                max={100}
                value={maxToolSteps}
                onChange={setMaxToolSteps}
                onChangeComplete={saveMaxSteps}
                style={{ flex: 1 }}
              />
              <Text strong style={{ minWidth: 48, textAlign: 'right' }}>
                {maxToolSteps === 0 ? t('settings.aiAssistant.unlimited') : maxToolSteps}
              </Text>
            </div>
          </Form.Item>
        </Form>
      </Card>

      {/* 4. Feedback */}
      <Card
        size="small"
        title={t('settings.aiAssistant.feedbackTitle')}
        extra={
          <Popconfirm title={t('settings.aiAssistant.resetStatsConfirm')} onConfirm={resetStats}>
            <Button size="small" danger>{t('settings.aiAssistant.resetStats')}</Button>
          </Popconfirm>
        }
        style={{ borderRadius: token.borderRadiusLG }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}>
            <Statistic title={t('settings.aiAssistant.totalFeedback')} value={totalFeedback} />
          </Col>
          <Col span={8}>
            <Statistic
              title={t('settings.aiAssistant.helpful')}
              value={totalUp}
              prefix={<LikeOutlined />}
              valueStyle={{ color: token.colorSuccess }}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title={t('settings.aiAssistant.unhelpful')}
              value={totalDown}
              prefix={<DislikeOutlined />}
              valueStyle={{ color: token.colorError }}
            />
          </Col>
        </Row>

        {Object.keys(stats?.byTopic || {}).length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
              {t('settings.aiAssistant.topicBreakdown')}
            </Text>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(stats?.byTopic || {}).map(([topic, counts]) => {
                const rate = Math.round((counts.up / (counts.up + counts.down)) * 100)
                return (
                  <Tag key={topic} color={rate >= 70 ? 'green' : rate >= 40 ? 'orange' : 'red'}>
                    {topic}: {rate}% ({counts.up + counts.down})
                  </Tag>
                )
              })}
            </div>
          </div>
        )}

        {stats?.soulSuggestions && stats.soulSuggestions.length > 0 && (
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
              {t('settings.aiAssistant.soulSuggestions')}
            </Text>
            {stats.soulSuggestions.map((s, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: `1px solid ${s.feedbackCount >= 3 ? token.colorWarningBorder : token.colorBorderSecondary}`,
                  background: s.feedbackCount >= 3 ? token.colorWarningBg : token.colorBgElevated,
                  marginBottom: 6,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13 }}>{s.suggestion}</div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {s.reason} ({s.feedbackCount} {t('settings.aiAssistant.feedbackCount')})
                  </Text>
                </div>
                <Button size="small" type="text" icon={<CheckOutlined />} onClick={() => handleAcceptSuggestion(i)} />
                <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => handleDismissSuggestion(i)} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

export default AIAssistantSettings
