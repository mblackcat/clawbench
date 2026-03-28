import React, { useState, useEffect, useCallback } from 'react'
import {
  Card, Form, Input, Select, Slider, Typography, theme, App, Button,
  Tabs, Statistic, Row, Col, Tag, Popconfirm, Space,
} from 'antd'
import {
  ReloadOutlined,
  DeleteOutlined,
  CheckOutlined,
  CloseOutlined,
  LikeOutlined,
  DislikeOutlined,
} from '@ant-design/icons'
import { useT } from '../../i18n'

const { Text, Title } = Typography
const { TextArea } = Input

interface FeedbackStats {
  totalFeedback: { up: number; down: number }
  byTopic: Record<string, { up: number; down: number }>
  recentTrend: { date: string; up: number; down: number }[]
  soulSuggestions: { suggestion: string; reason: string; feedbackCount: number }[]
}

const AIAssistantSettings: React.FC = () => {
  const t = useT()
  const { token } = theme.useToken()
  const { message } = App.useApp()

  // Existing behavior settings
  const [toolApprovalMode, setToolApprovalMode] = useState('auto-approve-safe')
  const [maxToolSteps, setMaxToolSteps] = useState(15)

  // Agent memory files
  const [soul, setSoul] = useState('')
  const [memory, setMemory] = useState('')
  const [userMd, setUserMd] = useState('')
  const [agents, setAgents] = useState('')
  const [tools, setTools] = useState('')
  const [stats, setStats] = useState<FeedbackStats | null>(null)

  const [memoryTab, setMemoryTab] = useState('memory.md')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.settings.getAgentSettings(),
      window.api.agent.readAllMemories(),
      window.api.agent.readStats(),
    ]).then(([settings, memories, statsData]: any[]) => {
      setToolApprovalMode(settings?.defaultToolApprovalMode || 'auto-approve-safe')
      setMaxToolSteps(settings?.maxAgentToolSteps ?? 15)

      setSoul(memories['soul.md'] || '')
      setMemory(memories['memory.md'] || '')
      setUserMd(memories['user.md'] || '')
      setAgents(memories['agents.md'] || '')
      setTools(memories['tools.md'] || '')
      setStats(statsData)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  const saveApprovalMode = useCallback((value: string) => {
    setToolApprovalMode(value)
    window.api.settings.setAgentSettings({ defaultToolApprovalMode: value }).catch(() => {})
  }, [])

  const saveMaxSteps = useCallback((value: number) => {
    setMaxToolSteps(value)
    window.api.settings.setAgentSettings({ maxAgentToolSteps: value }).catch(() => {})
  }, [])

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

  const saveMemoryFile = useCallback((filename: string, content: string) => {
    window.api.agent.writeMemory(filename, content).then(() => {
      message.success(t('common.saved'))
    }).catch(() => message.error(t('common.saveFailed')))
  }, [message, t])

  const clearMemoryFile = useCallback((filename: string) => {
    window.api.agent.writeMemory(filename, '').then(() => {
      if (filename === 'memory.md') setMemory('')
      else if (filename === 'user.md') setUserMd('')
      message.success(t('common.saved'))
    }).catch(() => {})
  }, [message, t])

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Agent Persona (soul.md) */}
      <Card
        size="small"
        title={t('settings.aiAssistant.soulTitle')}
        extra={
          <Space size={4}>
            <Popconfirm title={t('settings.aiAssistant.restoreDefaultConfirm')} onConfirm={restoreSoulDefault}>
              <Button size="small" icon={<ReloadOutlined />}>{t('settings.aiAssistant.restoreDefault')}</Button>
            </Popconfirm>
            <Button size="small" type="primary" onClick={saveSoul}>{t('common.save')}</Button>
          </Space>
        }
        style={{ borderRadius: token.borderRadiusLG }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
          {t('settings.aiAssistant.soulDesc')}
        </Text>
        <TextArea
          value={soul}
          onChange={(e) => setSoul(e.target.value)}
          rows={8}
          style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
        />
      </Card>

      {/* Long-term Memory */}
      <Card
        size="small"
        title={t('settings.aiAssistant.memoryTitle')}
        style={{ borderRadius: token.borderRadiusLG }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <Tabs
          activeKey={memoryTab}
          onChange={setMemoryTab}
          size="small"
          items={[
            {
              key: 'memory.md',
              label: 'memory.md',
              children: (
                <div>
                  <TextArea
                    value={memory}
                    onChange={(e) => setMemory(e.target.value)}
                    rows={6}
                    style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 13, marginBottom: 8 }}
                  />
                  <Space>
                    <Button size="small" type="primary" onClick={() => saveMemoryFile('memory.md', memory)}>
                      {t('common.save')}
                    </Button>
                    <Popconfirm title={t('settings.aiAssistant.clearConfirm')} onConfirm={() => clearMemoryFile('memory.md')}>
                      <Button size="small" danger icon={<DeleteOutlined />}>{t('settings.aiAssistant.clear')}</Button>
                    </Popconfirm>
                  </Space>
                </div>
              ),
            },
            {
              key: 'user.md',
              label: 'user.md',
              children: (
                <div>
                  <TextArea
                    value={userMd}
                    onChange={(e) => setUserMd(e.target.value)}
                    rows={6}
                    style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 13, marginBottom: 8 }}
                  />
                  <Space>
                    <Button size="small" type="primary" onClick={() => saveMemoryFile('user.md', userMd)}>
                      {t('common.save')}
                    </Button>
                    <Popconfirm title={t('settings.aiAssistant.clearConfirm')} onConfirm={() => clearMemoryFile('user.md')}>
                      <Button size="small" danger icon={<DeleteOutlined />}>{t('settings.aiAssistant.clear')}</Button>
                    </Popconfirm>
                  </Space>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Feedback Statistics */}
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

        {/* Topic breakdown */}
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

        {/* Pending soul suggestions */}
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

      {/* Capabilities & Sub-agents */}
      <Card
        size="small"
        title={t('settings.aiAssistant.capabilitiesTitle')}
        style={{ borderRadius: token.borderRadiusLG }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <Tabs
          size="small"
          items={[
            {
              key: 'tools.md',
              label: 'tools.md',
              children: (
                <TextArea
                  value={tools}
                  readOnly
                  rows={4}
                  style={{ fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
                />
              ),
            },
            {
              key: 'agents.md',
              label: 'agents.md',
              children: (
                <div>
                  <TextArea
                    value={agents}
                    onChange={(e) => setAgents(e.target.value)}
                    rows={4}
                    style={{ fontFamily: 'monospace', fontSize: 13, resize: 'vertical', marginBottom: 8 }}
                  />
                  <Button size="small" type="primary" onClick={() => saveMemoryFile('agents.md', agents)}>
                    {t('common.save')}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Behavior Settings */}
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
                min={5}
                max={30}
                value={maxToolSteps}
                onChange={setMaxToolSteps}
                onChangeComplete={saveMaxSteps}
                style={{ flex: 1 }}
              />
              <Text strong style={{ minWidth: 30, textAlign: 'right' }}>{maxToolSteps}</Text>
            </div>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}

export default AIAssistantSettings
