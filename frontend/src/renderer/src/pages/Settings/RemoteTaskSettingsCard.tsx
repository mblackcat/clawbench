import React, { useEffect, useState } from 'react'
import { App, Button, Card, Radio, Typography, theme } from 'antd'
import { FileTextOutlined } from '@ant-design/icons'
import { useAuthStore } from '../../stores/useAuthStore'
import type { RemoteTaskMode } from '../../types/ipc'
import { useT } from '../../i18n'

const { Text } = Typography

/**
 * Settings → General: how this client handles tasks dispatched by the server
 * (remote task dispatch). Hidden in local mode (no server, no tasks).
 */
const RemoteTaskSettingsCard: React.FC = () => {
  const isLocalMode = useAuthStore((s) => s.isLocalMode)
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const t = useT()
  const [mode, setMode] = useState<RemoteTaskMode | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api?.remoteTask
      ?.getMode()
      .then((m) => {
        if (!cancelled) setMode(m)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (isLocalMode) return null

  const handleChange = async (next: RemoteTaskMode): Promise<void> => {
    const prev = mode
    setMode(next)
    try {
      const res = await window.api.remoteTask.setMode(next)
      if (!res?.success) throw new Error('setMode failed')
    } catch {
      setMode(prev)
      message.error(t('settings.remoteTaskSaveFailed'))
    }
  }

  return (
    <Card
      size="small"
      style={{ borderRadius: token.borderRadiusLG, borderColor: token.colorPrimaryBorder }}
      styles={{ body: { padding: '14px 16px' } }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Text strong style={{ fontSize: 14 }}>
            {t('settings.remoteTaskTitle')}
          </Text>
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
            {t('settings.remoteTaskDesc')}
          </Text>
        </div>
        <Button
          size="small"
          icon={<FileTextOutlined />}
          onClick={() => void window.api.remoteTask.openLogDir()}
        >
          {t('settings.viewRemoteTaskLogs')}
        </Button>
      </div>
      <Radio.Group
        value={mode ?? undefined}
        onChange={(e) => void handleChange(e.target.value as RemoteTaskMode)}
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <Radio value="always-confirm">{t('settings.remoteTaskAlwaysConfirm')}</Radio>
        <Radio value="silent">{t('settings.remoteTaskSilent')}</Radio>
        <Radio value="disabled">{t('settings.remoteTaskDisabled')}</Radio>
      </Radio.Group>
    </Card>
  )
}

export default RemoteTaskSettingsCard
