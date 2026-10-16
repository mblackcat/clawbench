import React, { useEffect, useState } from 'react'
import { Form, Switch, Typography } from 'antd'
import { useT } from '../i18n'

const { Text } = Typography

/**
 * Settings row: also raise an OS notification for each attention alert
 * (AI Coding turn finished / waiting for input, workbench task done).
 * Self-contained so it can be dropped into any settings form.
 */
const AttentionNotificationSetting: React.FC = () => {
  const t = useT()
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    let cancelled = false
    void window.api.settings.get().then((s) => {
      if (!cancelled) setEnabled(s?.attentionSystemNotification !== false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleChange = (checked: boolean): void => {
    setEnabled(checked)
    void window.api.settings.set('attentionSystemNotification', checked)
  }

  return (
    <Form.Item label={t('settings.attentionNotification')} style={{ marginTop: 16, marginBottom: 0 }}>
      <Switch checked={enabled} onChange={handleChange} />
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
        {t('settings.attentionNotificationDesc')}
      </Text>
    </Form.Item>
  )
}

export default AttentionNotificationSetting
