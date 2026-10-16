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
import { ClockCircleOutlined, CloseOutlined, SyncOutlined } from '@ant-design/icons'
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
    if (!open) return
    void fetchSchedules().catch(() => {
      /* offline / tests without appSchedule mock */
    })
  }, [open, fetchSchedules])

  const handleSubmit = useCallback(async () => {
    const values = await paramFormRef.current?.validate()
    if (!values) return
    onSubmit(values)
  }, [onSubmit])

  // Own the header row: default Drawer close sits under a flex:1 title and only
  // a corner stays clickable. Use closable={false} + an explicit close Button.
  const titleNode = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
        width: '100%'
      }}
    >
      <Button
        type="text"
        size="small"
        icon={<CloseOutlined />}
        onClick={onClose}
        aria-label={t('paramDrawer.close')}
        style={{
          flexShrink: 0,
          width: 32,
          height: 32,
          minWidth: 32,
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      />
      <Text strong ellipsis style={{ minWidth: 0, flex: 1 }}>
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
  )

  const extraNode = canSchedule ? (
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
        style={{
          width: 32,
          height: 32,
          minWidth: 32,
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      />
    </Tooltip>
  ) : null

  return (
    <Drawer
      rootClassName="cb-param-drawer"
      title={titleNode}
      extra={extraNode}
      closable={false}
      placement="right"
      width={400}
      open={open}
      onClose={onClose}
      destroyOnHidden
      // Keep above layout chrome; no-drag is enforced globally in theme-overhaul.css
      zIndex={1100}
      styles={{
        header: {
          paddingInlineEnd: 16,
          // Ensure header controls are not clipped / covered
          position: 'relative',
          zIndex: 1
        },
        body: { paddingTop: 16 }
      }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Space>
            <Button onClick={onClose}>{manifest?.params?.length ? t('common.cancel') : t('skillDetail.close')}</Button>
            <Button type="primary" onClick={handleSubmit} disabled={isRefreshing}>
              {t('paramDrawer.run')}
            </Button>
          </Space>
        </div>
      }
    >
      <Descriptions column={1} size="small" style={{ marginBottom: 12 }}>
        <Descriptions.Item label={t('paramDrawer.name')}>{manifest?.name}</Descriptions.Item>
        <Descriptions.Item label={t('paramDrawer.version')}>{manifest?.version}</Descriptions.Item>
        {manifest?.author && (
          <Descriptions.Item label={t('paramDrawer.author')}>
            {typeof manifest.author === 'string' ? manifest.author : manifest.author.name}
          </Descriptions.Item>
        )}
      </Descriptions>

      {/* Same Descriptions label chrome (size/color/colon); vertical so body is full width */}
      {manifest?.description ? (
        <Descriptions column={1} size="small" layout="vertical" style={{ marginBottom: 16 }}>
          <Descriptions.Item label={t('paramDrawer.description')}>
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
              {manifest.description}
            </span>
          </Descriptions.Item>
        </Descriptions>
      ) : null}

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
