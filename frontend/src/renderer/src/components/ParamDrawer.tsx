import React, { useCallback, useRef, useState } from 'react'
import {
  Drawer,
  Button,
  Space,
  Tooltip,
  Typography,
  Descriptions,
  Tag,
  theme
} from 'antd'
import { ClockCircleOutlined, SyncOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { SubAppManifest } from '../types/subapp'
import AppParamFields, { type AppParamFieldsHandle } from './AppParamFields'
import AppScheduleModal from './AppScheduleModal'
import { useAppScheduleStore } from '../stores/useAppScheduleStore'
import { useT } from '../i18n'

const { Text } = Typography

function formatNextRun(ts?: number): string {
  if (!ts) return ''
  return dayjs(ts).format('MM-DD HH:mm')
}

interface ParamDrawerProps {
  open: boolean
  onClose: () => void
  manifest: SubAppManifest | null
  initialValues?: Record<string, unknown>
  resolveSlot: (
    appId: string,
    slot: string,
    params?: Record<string, unknown>
  ) => Promise<unknown>
  onSubmit: (params: Record<string, unknown>) => void
}

const ParamDrawer: React.FC<ParamDrawerProps> = ({
  open,
  onClose,
  manifest,
  initialValues,
  resolveSlot,
  onSubmit
}) => {
  const { token } = theme.useToken()
  const t = useT()
  const paramFormRef = useRef<AppParamFieldsHandle>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)

  // Only "app" resources support scheduling (Python sub-apps)
  const canSchedule = !manifest?.type || manifest.type === 'app'
  const schedule = useAppScheduleStore((s) =>
    manifest && canSchedule ? s.schedules.find((x) => x.appId === manifest.id) : undefined
  )
  const fetchSchedules = useAppScheduleStore((s) => s.fetchSchedules)

  // Keep schedule badges fresh whenever this drawer is opened
  React.useEffect(() => {
    if (open) fetchSchedules()
  }, [open, fetchSchedules])

  const handleSubmit = useCallback(async () => {
    const values = await paramFormRef.current?.validate()
    if (!values) return
    onSubmit(values)
  }, [onSubmit])

  const titleNode = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        paddingRight: 4
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
        <Text strong ellipsis style={{ minWidth: 0 }}>
          {manifest ? manifest.name : ''}
        </Text>
        {schedule?.enabled && schedule.nextRunAt && (
          <Tooltip title={`${t('appSchedule.nextRun')}: ${dayjs(schedule.nextRunAt).format('YYYY-MM-DD HH:mm')}`}>
            <Tag
              icon={<SyncOutlined spin />}
              color="processing"
              style={{ margin: 0, flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              {formatNextRun(schedule.nextRunAt)}
            </Tag>
          </Tooltip>
        )}
      </div>
      {canSchedule && (
        <Tooltip title={schedule ? t('appSchedule.editSchedule') : t('appSchedule.setupSchedule')}>
          <Button
            type="text"
            size="small"
            icon={<ClockCircleOutlined style={{ color: token.colorPrimary }} />}
            onClick={(e) => {
              e.stopPropagation()
              setScheduleModalOpen(true)
            }}
            aria-label={t('appSchedule.title')}
          />
        </Tooltip>
      )}
    </div>
  )

  return (
    <Drawer
      title={titleNode}
      placement="right"
      width={400}
      open={open}
      onClose={onClose}
      destroyOnHidden
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Space>
            <Button onClick={onClose}>{manifest?.params?.length ? '取消' : '关闭'}</Button>
            <Button type="primary" onClick={handleSubmit} disabled={isRefreshing}>
              执行
            </Button>
          </Space>
        </div>
      }
    >
      <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
        <Descriptions.Item label="名称">{manifest?.name}</Descriptions.Item>
        <Descriptions.Item label="版本">{manifest?.version}</Descriptions.Item>
        {manifest?.description && (
          <Descriptions.Item label="描述">{manifest.description}</Descriptions.Item>
        )}
        {manifest?.author && (
          <Descriptions.Item label="作者">
            {typeof manifest.author === 'string' ? manifest.author : manifest.author.name}
          </Descriptions.Item>
        )}
      </Descriptions>

      <AppParamFields
        ref={paramFormRef}
        manifest={manifest}
        initialValues={initialValues}
        resolveSlot={resolveSlot}
        resetKey={open}
        onRefreshingChange={setIsRefreshing}
      />

      {canSchedule && (
        <AppScheduleModal
          open={scheduleModalOpen}
          onClose={() => setScheduleModalOpen(false)}
          manifest={manifest}
          resolveSlot={resolveSlot}
        />
      )}
    </Drawer>
  )
}

export default ParamDrawer
