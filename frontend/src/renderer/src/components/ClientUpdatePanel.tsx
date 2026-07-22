/**
 * Minimal client version / update row for the user menu.
 * Shows current version; only shows an action button when an update is ready.
 * Auto-download is handled by the main process; install is always manual.
 */

import React from 'react'
import { Button, Typography, theme } from 'antd'
import { LoadingOutlined } from '@ant-design/icons'
import { useUpdaterStore } from '../stores/useUpdaterStore'
import { useT } from '../i18n'

const { Text } = Typography

const ClientUpdatePanel: React.FC = () => {
  const { status, version, downloadPercent, install } = useUpdaterStore()
  const { token } = theme.useToken()
  const t = useT()

  const appVersion = import.meta.env.VITE_APP_VERSION ?? '0.1.0'
  const showUpdateAction =
    status === 'available' || status === 'downloading' || status === 'downloaded'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        width: '100%',
        minHeight: 20
      }}
    >
      <Text style={{ fontSize: 13, color: token.colorText }}>
        {t('topbar.currentVersion', appVersion)}
      </Text>

      {status === 'available' && (
        <Text style={{ fontSize: 12, color: token.colorPrimary }}>
          {t('topbar.updateAvailableShort', version || '')}
        </Text>
      )}

      {status === 'downloading' && (
        <Text style={{ fontSize: 12, color: token.colorPrimary, whiteSpace: 'nowrap' }}>
          <LoadingOutlined style={{ marginRight: 4 }} />
          {downloadPercent}%
        </Text>
      )}

      {status === 'downloaded' && (
        <Button type="primary" size="small" onClick={install}>
          {t('topbar.installUpdate', version || '')}
        </Button>
      )}

      {!showUpdateAction && null}
    </div>
  )
}

export default ClientUpdatePanel
