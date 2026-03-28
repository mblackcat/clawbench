import React, { useEffect, useState, useCallback } from 'react'
import {
  Button, Form, Input, Select, TimePicker, DatePicker, Switch,
  Typography, theme, Tooltip, Popover, Space, Spin, App
} from 'antd'
import {
  ArrowLeftOutlined, CaretRightOutlined, ThunderboltOutlined,
  HourglassOutlined, ControlOutlined, ApiOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useScheduledTaskStore } from '../../stores/useScheduledTaskStore'
import { useAIModelStore } from '../../stores/useAIModelStore'
import { ProviderIcon } from '../../components/ProviderIcons'
import { useT } from '../../i18n'

const { Text } = Typography
const { TextArea } = Input

const dayKeys = ['task.sun', 'task.mon', 'task.tue', 'task.wed', 'task.thu', 'task.fri', 'task.sat']

type McpServerStatus = { id: string; name: string; connected: boolean; toolCount: number }

const ScheduledTaskEditor: React.FC = () => {
  const t = useT()
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const { editingTaskId, tasks, createTask, updateTask, closeEditor, runNow, fetchTasks } = useScheduledTaskStore()
  const { builtinModels, localModels } = useAIModelStore()

  const existingTask = editingTaskId ? tasks.find((t) => t.id === editingTaskId) : null

  const [form] = Form.useForm()
  const [repeatRule, setRepeatRule] = useState<string>(existingTask?.repeatRule || 'daily')
  const [chatMode, setChatMode] = useState<'fast' | 'thinking'>(existingTask?.chatMode || 'fast')
  const [toolsEnabled, setToolsEnabled] = useState(existingTask?.toolsEnabled ?? false)
  const [keepInOneChat, setKeepInOneChat] = useState(existingTask?.keepInOneChat ?? false)
  const [imNotifyEnabled, setImNotifyEnabled] = useState(existingTask?.imNotifyEnabled ?? false)
  const [imAvailable, setImAvailable] = useState(false)
  const [running, setRunning] = useState(false)
  const [timeValue, setTimeValue] = useState<dayjs.Dayjs>(
    existingTask ? dayjs(existingTask.time, 'HH:mm') : dayjs('09:00', 'HH:mm')
  )

  // MCP/features popover state
  const [featuresOpen, setFeaturesOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)

  useEffect(() => {
    window.api.scheduledTask.getImStatus().then((s) => setImAvailable(s.connected))
  }, [])

  useEffect(() => {
    if (existingTask) {
      const t = dayjs(existingTask.time, 'HH:mm')
      setTimeValue(t)
      setRepeatRule(existingTask.repeatRule)
      setChatMode(existingTask.chatMode || 'fast')
      setToolsEnabled(existingTask.toolsEnabled ?? false)
      setKeepInOneChat(existingTask.keepInOneChat ?? false)
      setImNotifyEnabled(existingTask.imNotifyEnabled ?? false)
      form.setFieldsValue({
        name: existingTask.name,
        prompt: existingTask.prompt,
        repeatRule: existingTask.repeatRule,
        dayOfWeek: existingTask.dayOfWeek ?? 0,
        dayOfMonth: existingTask.dayOfMonth ?? 1,
        endDate: existingTask.endDate ? dayjs(existingTask.endDate) : undefined,
        modelValue: existingTask.modelSource === 'builtin'
          ? `builtin:${existingTask.modelId}`
          : `local:${existingTask.modelConfigId}:${existingTask.modelId}`,
      })
    } else {
      setTimeValue(dayjs('09:00', 'HH:mm'))
      form.setFieldsValue({
        repeatRule: 'daily',
        dayOfWeek: 1,
        dayOfMonth: 1,
      })
    }
  }, [existingTask, form])

  const loadMcpServers = useCallback(async () => {
    setMcpLoading(true)
    try {
      const status = await window.api.mcp.getStatus()
      setMcpServers(status)
    } catch {
      setMcpServers([])
    } finally {
      setMcpLoading(false)
    }
  }, [])

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const timeStr = timeValue.format('HH:mm')
      const modelValue = values.modelValue as string
      const modelParts = modelValue?.split(':') || []

      let modelSource: 'builtin' | 'local' = 'builtin'
      let modelId = ''
      let modelConfigId: string | undefined

      if (modelParts[0] === 'builtin') {
        modelSource = 'builtin'
        modelId = modelParts[1]
      } else if (modelParts[0] === 'local') {
        modelSource = 'local'
        modelConfigId = modelParts[1]
        modelId = modelParts[2]
      }

      const data = {
        name: values.name,
        prompt: values.prompt,
        repeatRule: values.repeatRule,
        time: timeStr,
        dayOfWeek: values.repeatRule === 'weekly' ? values.dayOfWeek : undefined,
        dayOfMonth: values.repeatRule === 'monthly' ? values.dayOfMonth : undefined,
        endDate: values.endDate ? values.endDate.format('YYYY-MM-DD') : undefined,
        modelSource,
        modelId,
        modelConfigId,
        chatMode,
        toolsEnabled,
        keepInOneChat,
        imNotifyEnabled,
        enabled: existingTask?.enabled ?? true
      }

      if (editingTaskId) {
        await updateTask(editingTaskId, data)
      } else {
        await createTask(data as any)
      }
      await fetchTasks()
      closeEditor()
    } catch {
      // validation error
    }
  }

  const handleRunNow = async () => {
    if (!editingTaskId) return
    setRunning(true)
    try {
      const result = await runNow(editingTaskId)
      if (result.success) {
        message.success(t('task.taskExecuted', existingTask?.name || ''))
      } else {
        message.error(result.error || t('task.error'))
      }
      await fetchTasks()
    } finally {
      setRunning(false)
    }
  }

  // Build model options
  const modelOptions: { label: React.ReactNode; value: string }[] = []
  for (const m of builtinModels) {
    modelOptions.push({
      value: `builtin:${m.id}`,
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ProviderIcon provider={m.provider} size={14} />
          {m.name}
        </span>
      )
    })
  }
  for (const config of localModels) {
    for (const mid of config.models) {
      modelOptions.push({
        value: `local:${config.id}:${mid}`,
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ProviderIcon provider={config.provider} size={14} />
            {mid}
          </span>
        )
      })
    }
  }

  // Features popover content (matches ChatInput)
  const featuresContent = (
    <div style={{ width: 220 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{t('chat.availableFeatures')}</Text>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space size={6}>
            <ControlOutlined style={{ color: token.colorTextSecondary }} />
            <Text>{t('task.tools')}</Text>
          </Space>
          <Switch size="small" checked={toolsEnabled} onChange={setToolsEnabled} />
        </div>
      </div>
    </div>
  )

  // MCP popover content (matches ChatInput)
  const mcpContent = (
    <div style={{ width: 240 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{t('chat.mcpServers')}</Text>
      {mcpLoading ? (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <Spin size="small" />
        </div>
      ) : mcpServers.length === 0 ? (
        <div style={{ padding: '12px 0', color: token.colorTextTertiary, fontSize: 12 }}>
          {t('chat.noMcpServers')}
        </div>
      ) : (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mcpServers.map((server) => (
            <div key={server.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Space size={6}>
                <ApiOutlined style={{ color: token.colorTextSecondary }} />
                <div>
                  <Text style={{ fontSize: 13 }}>{server.name}</Text>
                  {server.connected && server.toolCount > 0 && (
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                      {server.toolCount} tools
                    </Text>
                  )}
                </div>
              </Space>
              <Switch size="small" checked={server.connected} disabled />
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0
      }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={closeEditor}
          size="small"
        />
        <Text strong style={{ fontSize: 16 }}>
          {editingTaskId ? t('task.editTask') : t('task.newTask')}
        </Text>
        <div style={{ flex: 1 }} />
        {editingTaskId && (
          <Button
            icon={<CaretRightOutlined />}
            onClick={handleRunNow}
            loading={running}
            size="small"
          >
            {t('task.runNow')}
          </Button>
        )}
      </div>

      {/* Form — centered */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 640, padding: '20px 24px' }}>
          <Form form={form} layout="vertical" size="middle">
            {/* Task name */}
            <Form.Item
              name="name"
              label={t('task.taskName')}
              rules={[{ required: true, message: t('task.taskNamePlaceholder') }]}
              style={{ marginBottom: 16 }}
            >
              <Input placeholder={t('task.taskNamePlaceholder')} />
            </Form.Item>

            {/* Schedule row: repeat + conditional day + time + end date all inline */}
            <Form.Item label={t('task.repeat')} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Form.Item name="repeatRule" noStyle>
                  <Select
                    style={{ width: 110 }}
                    onChange={(v) => setRepeatRule(v)}
                  >
                    <Select.Option value="none">{t('task.repeatNone')}</Select.Option>
                    <Select.Option value="daily">{t('task.repeatDaily')}</Select.Option>
                    <Select.Option value="weekly">{t('task.repeatWeekly')}</Select.Option>
                    <Select.Option value="monthly">{t('task.repeatMonthly')}</Select.Option>
                  </Select>
                </Form.Item>

                {repeatRule === 'weekly' && (
                  <Form.Item name="dayOfWeek" noStyle>
                    <Select style={{ width: 90 }}>
                      {dayKeys.map((key, i) => (
                        <Select.Option key={i} value={i}>{t(key)}</Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                )}

                {repeatRule === 'monthly' && (
                  <Form.Item name="dayOfMonth" noStyle>
                    <Select style={{ width: 80 }}>
                      {Array.from({ length: 31 }, (_, i) => (
                        <Select.Option key={i + 1} value={i + 1}>{i + 1}</Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                )}

                <TimePicker
                  format="HH:mm"
                  style={{ width: 100 }}
                  value={timeValue}
                  onChange={(v) => v && setTimeValue(v)}
                />

                {repeatRule !== 'none' && (
                  <Form.Item name="endDate" noStyle>
                    <DatePicker
                      placeholder={t('task.endDatePlaceholder')}
                      style={{ width: 160 }}
                    />
                  </Form.Item>
                )}
              </div>
            </Form.Item>

            {/* Prompt — chat-input style: textarea with toolbar below */}
            <Form.Item
              name="prompt"
              label={t('task.prompt')}
              rules={[{ required: true, message: t('task.promptPlaceholder') }]}
              style={{ marginBottom: 16 }}
            >
              <TextArea
                placeholder={t('task.promptPlaceholder')}
                autoSize={{ minRows: 4, maxRows: 12 }}
              />
            </Form.Item>

            {/* Toolbar row — mimics ChatInput: model selector + mode capsule + features + mcp */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 20,
              flexWrap: 'wrap'
            }}>
              {/* Model selector */}
              <Form.Item name="modelValue" noStyle rules={[{ required: true }]}>
                <Select
                  options={modelOptions}
                  popupMatchSelectWidth={false}
                  placeholder={t('task.model')}
                  style={{ width: 200 }}
                />
              </Form.Item>

              {/* Fast / Thinking capsule toggle */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                background: token.colorFillTertiary,
                borderRadius: 8,
                padding: 2,
                gap: 2,
                position: 'relative',
              }}>
                <div style={{
                  position: 'absolute',
                  left: 2,
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: token.colorPrimary,
                  transform: chatMode === 'fast' ? 'translateX(0)' : 'translateX(24px)',
                  transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  zIndex: 0,
                }} />
                <Tooltip title={t('task.fast')}>
                  <button
                    type="button"
                    onClick={() => setChatMode('fast')}
                    style={{
                      width: 22, height: 22, borderRadius: 6, border: 'none',
                      background: 'transparent',
                      color: chatMode === 'fast' ? '#fff' : token.colorTextSecondary,
                      cursor: 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 12,
                      transition: 'color 0.2s',
                      position: 'relative', zIndex: 1,
                    }}
                  >
                    <ThunderboltOutlined />
                  </button>
                </Tooltip>
                <Tooltip title={t('task.thinking')}>
                  <button
                    type="button"
                    onClick={() => setChatMode('thinking')}
                    style={{
                      width: 22, height: 22, borderRadius: 6, border: 'none',
                      background: 'transparent',
                      color: chatMode === 'thinking' ? '#fff' : token.colorTextSecondary,
                      cursor: 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 12,
                      transition: 'color 0.2s',
                      position: 'relative', zIndex: 1,
                    }}
                  >
                    <HourglassOutlined />
                  </button>
                </Tooltip>
              </div>

              {/* Features toggle (tools on/off) */}
              <Popover
                content={featuresContent}
                trigger="click"
                open={featuresOpen}
                onOpenChange={setFeaturesOpen}
                placement="topLeft"
              >
                <Button
                  size="small"
                  type={toolsEnabled ? 'primary' : 'text'}
                  icon={<ControlOutlined />}
                />
              </Popover>

              {/* MCP servers */}
              <Popover
                content={mcpContent}
                trigger="click"
                open={mcpOpen}
                onOpenChange={(open) => {
                  setMcpOpen(open)
                  if (open) loadMcpServers()
                }}
                placement="topLeft"
              >
                <Button
                  size="small"
                  type="text"
                  icon={<ApiOutlined />}
                />
              </Popover>
            </div>

            {/* Behavior switches — state-controlled (not form-controlled) */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: '12px 0',
              borderTop: `1px solid ${token.colorBorderSecondary}`
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Switch
                  size="small"
                  checked={keepInOneChat}
                  onChange={setKeepInOneChat}
                />
                <div style={{ lineHeight: 1.4 }}>
                  <Text style={{ fontSize: 13 }}>{t('task.keepInOneChat')}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 11 }}>{t('task.keepInOneChatDesc')}</Text>
                </div>
              </div>

              {imAvailable && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Switch
                    size="small"
                    checked={imNotifyEnabled}
                    onChange={setImNotifyEnabled}
                  />
                  <div style={{ lineHeight: 1.4 }}>
                    <Text style={{ fontSize: 13 }}>{t('task.imNotify')}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 11 }}>{t('task.imNotifyDesc')}</Text>
                  </div>
                </div>
              )}
            </div>
          </Form>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 20px',
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 8,
        flexShrink: 0
      }}>
        <Button onClick={closeEditor}>{t('task.cancel')}</Button>
        <Button type="primary" onClick={handleSave}>{t('task.save')}</Button>
      </div>
    </div>
  )
}

export default ScheduledTaskEditor
