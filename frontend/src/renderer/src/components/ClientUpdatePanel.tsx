/**
 * Minimal client version / update row for the user menu.
 * Shows current version + a manual "check for updates" refresh button; only
 * shows an install button when an update is ready.
 * Auto-download is handled by the main process; install is always manual.
 */

import React, { useCallback, useState } from 'react'
import { App, Button, Typography, theme } from 'antd'
import { LoadingOutlined, ReloadOutlined } from '@ant-design/icons'
import { useUpdaterStore } from '../stores/useUpdaterStore'
import { useT } from '../i18n'

const { Text } = Typography

const ClientUpdatePanel: React.FC = () => {
  const { status, version, downloadPercent, install, check } = useUpdaterStore()
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const t = useT()
  const [checking, setChecking] = useState(false)

  const appVersion = import.meta.env.VITE_APP_VERSION ?? '0.1.0'
  const showUpdateAction =
    status === 'available' || status === 'downloading' || status === 'downloaded'

  /**
   * `check()` resolves only after electron-updater has emitted
   * available / not-available / error, so the store status is already settled
   * by the time we read it back here.
   */
  const handleCheck = useCallback(async (): Promise<void> => {
    if (checking) return
    setChecking(true)
    try {
      const result = await check()
      if (!result.success) {
        message.error(`${t('statusbar.checkUpdateFailed')}${result.error ? ` — ${result.error}` : ''}`)
        return
      }
      const state = useUpdaterStore.getState()
      if (state.status === 'error') {
        message.error(
          `${t('statusbar.checkUpdateFailed')}${state.errorMessage ? ` — ${state.errorMessage}` : ''}`
        )
      } else if (state.status === 'downloaded') {
        message.success(t('topbar.updateAvailableShort', state.version || ''))
      } else if (state.status === 'available' || state.status === 'downloading') {
        message.info(t('statusbar.newVersion', state.version || ''))
      } else {
        message.success(t('statusbar.upToDate'))
      }
    } catch (err) {
      message.error(
        `${t('statusbar.checkUpdateFailed')} — ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      setChecking(false)
    }
  }, [checking, check, message, t])

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        <Text style={{ fontSize: 13, color: token.colorText }}>
          {t('topbar.currentVersion', appVersion)}
        </Text>
        <Button
          type="text"
          size="small"
          title={t('statusbar.checkUpdate')}
          aria-label={t('statusbar.checkUpdate')}
          loading={checking || status === 'checking'}
          icon={<ReloadOutlined style={{ fontSize: 12 }} />}
          onClick={(e) => {
            e.stopPropagation()
            void handleCheck()
          }}
          style={{ width: 22, height: 22, minWidth: 22, color: token.colorTextSecondary }}
        />
      </div>

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
