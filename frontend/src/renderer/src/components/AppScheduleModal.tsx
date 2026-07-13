import React, { useEffect, useState, useRef } from 'react'
import {
  App as AntdApp,
  Modal,
  Button,
  Form,
  Select,
  TimePicker,
  DatePicker,
  Typography,
  Tag,
  Tooltip,
  Space,
  Divider,
  theme
} from 'antd'
import { PlayCircleOutlined, PauseCircleOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { SubAppManifest } from '../types/subapp'
import type { AppScheduleInput } from '../types/app-schedule'
import { buildManifestDefaultParams } from '../utils/subapp-params'
import { useAppScheduleStore } from '../stores/useAppScheduleStore'
import AppParamFields, { type AppParamFieldsHandle } from './AppParamFields'
import { useT } from '../i18n'

const { Text } = Typography

const dayKeys = ['task.sun', 'task.mon', 'task.tue', 'task.wed', 'task.thu', 'task.fri', 'task.sat']

function formatNextRun(ts?: number): string {
  if (!ts) return ''
  return dayjs(ts).format('MM-DD HH:mm')
}

interface AppScheduleModalProps {
  open: boolean
  onClose: () => void
  manifest: SubAppManifest | null
  resolveSlot: (appId: string, slot: string, params?: Record<string, unknown>) => Promise<unknown>
}

const AppScheduleModal: React.FC<AppScheduleModalProps> = ({
  open,
  onClose,
  manifest,
  resolveSlot
}) => {
  const { token } = theme.useToken()
  const { message } = AntdApp.useApp()
  const t = useT()
  const [form] = Form.useForm()
  const schedules = useAppScheduleStore((s) => s.schedules)
  const saveSchedule = useAppScheduleStore((s) => s.saveSchedule)
  const deleteSchedule = useAppScheduleStore((s) => s.deleteSchedule)
  const setEnabled = useAppScheduleStore((s) => s.setEnabled)

  const paramFormRef = useRef<AppParamFieldsHandle>(null)
  const [repeatRule, setRepeatRule] = useState<string>('daily')
  const [timeValue, setTimeValue] = useState<dayjs.Dayjs>(dayjs('09:00', 'HH:mm'))
  const [paramInitialValues, setParamInitialValues] = useState<Record<string, unknown> | undefined>(
    undefined
  )
  const [resetCounter, setResetCounter] = useState(0)
  const [saving, setSaving] = useState(false)

  const schedule = manifest ? schedules.find((s) => s.appId === manifest.id) : undefined

  // Populate form whenever the modal opens for a (different) app
  useEffect(() => {
    if (!open || !manifest) return
    const existing = schedules.find((s) => s.appId === manifest.id)
    form.setFieldsValue({
      repeatRule: existing?.repeatRule || 'daily',
      dayOfWeek: existing?.dayOfWeek ?? 1,
      dayOfMonth: existing?.dayOfMonth ?? 1,
      endDate: existing?.endDate ? dayjs(existing.endDate) : undefined
    })
    setRepeatRule(existing?.repeatRule || 'daily')
    setTimeValue(existing ? dayjs(existing.time, 'HH:mm') : dayjs('09:00', 'HH:mm'))
    setParamInitialValues(existing?.params || buildManifestDefaultParams(manifest.params || []))
    setResetCounter((c) => c + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, manifest?.id])

  const gatherInput = async (enabled: boolean): Promise<AppScheduleInput | null> => {
    try {
      const values = await form.validateFields()
      const params = await paramFormRef.current?.validate()
      if (!params) return null
      return {
        appName: manifest?.name || '',
        enabled,
        repeatRule: values.repeatRule,
        time: timeValue.format('HH:mm'),
        dayOfWeek: values.repeatRule === 'weekly' ? values.dayOfWeek : undefined,
        dayOfMonth: values.repeatRule === 'monthly' ? values.dayOfMonth : undefined,
        endDate: values.endDate ? values.endDate.format('YYYY-MM-DD') : undefined,
        params
      }
    } catch {
      return null
    }
  }

  const handleStart = async () => {
    if (!manifest) return
    const input = await gatherInput(true)
    if (!input) return
    setSaving(true)
    try {
      await saveSchedule(manifest.id, input)
      message.success(t('appSchedule.started'))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleStop = async () => {
    if (!manifest) return
    setSaving(true)
    try {
      await setEnabled(manifest.id, false)
      message.success(t('appSchedule.stopped'))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    if (!manifest) return
    const input = await gatherInput(schedule?.enabled ?? false)
    if (!input) return
    setSaving(true)
    try {
      await saveSchedule(manifest.id, input)
      message.success(t('appSchedule.saved'))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!manifest || !schedule) return
    setSaving(true)
    try {
      await deleteSchedule(manifest.id)
      message.success(t('appSchedule.deleted'))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space size={6}>
          <Text strong>{t('appSchedule.title')}</Text>
          {manifest && <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>{manifest.name}</Text>}
        </Space>
      }
      width={460}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {schedule ? (
              <Button danger icon={<DeleteOutlined />} onClick={handleDelete} loading={saving} disabled={saving}>
                {t('appSchedule.delete')}
              </Button>
            ) : null}
          </div>
          <Space>
            <Button onClick={onClose}>{t('task.cancel')}</Button>
            <Button onClick={handleSave} loading={saving} disabled={saving}>
              {t('task.save')}
            </Button>
            {schedule?.enabled ? (
              <Button danger icon={<PauseCircleOutlined />} onClick={handleStop} loading={saving} disabled={saving}>
                {t('appSchedule.stop')}
              </Button>
            ) : (
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleStart} loading={saving} disabled={saving}>
                {t('appSchedule.start')}
              </Button>
            )}
          </Space>
        </div>
      }
    >
      {schedule?.enabled && schedule.nextRunAt && (
        <div style={{ marginBottom: 12 }}>
          <Tag color="processing" style={{ margin: 0 }}>
            {t('appSchedule.nextRun')}: {formatNextRun(schedule.nextRunAt)}
          </Tag>
        </div>
      )}

      <Form form={form} layout="vertical">
        <Form.Item label={t('task.repeat')} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Form.Item name="repeatRule" noStyle>
              <Select style={{ width: 110 }} onChange={(v) => setRepeatRule(v)}>
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
                    <Select.Option key={i} value={i}>
                      {t(key)}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            )}

            {repeatRule === 'monthly' && (
              <Form.Item name="dayOfMonth" noStyle>
                <Select style={{ width: 80 }}>
                  {Array.from({ length: 31 }, (_, i) => (
                    <Select.Option key={i + 1} value={i + 1}>
                      {i + 1}
                    </Select.Option>
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
                <DatePicker placeholder={t('task.endDatePlaceholder')} style={{ width: 150 }} />
              </Form.Item>
            )}
          </div>
        </Form.Item>
      </Form>

      <Divider style={{ margin: '8px 0 16px' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{t('appSchedule.executionParams')}</Text>
      </Divider>

      <AppParamFields
        ref={paramFormRef}
        manifest={manifest}
        initialValues={paramInitialValues}
        resolveSlot={resolveSlot}
        resetKey={resetCounter}
      />

      <div style={{ marginTop: 4 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {t('appSchedule.hint')}
        </Text>
      </div>
    </Modal>
  )
}

export default AppScheduleModal
