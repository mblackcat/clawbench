/**
 * App share modal: copy the public landing page link of an app.
 * Recipients open it in any browser / IM (e.g. Feishu, Slack); the landing
 * page launches the desktop client on this app, or offers the download.
 */

import React, { useEffect, useRef, useState } from 'react'
import { Modal, Button, Alert, Spin, Typography, App, theme } from 'antd'
import { Copy, Check } from 'lucide'
import { AntdMorphIcon } from './common/AntdMorphIcon'
import { apiClient, ApiClientError } from '../services/apiClient'
import type { AppShareInfo } from '../types/api'
import { useT } from '../i18n'

const { Text } = Typography

interface AppShareModalProps {
  open: boolean
  /** Marketplace applicationId or builtin id (com.clawbench.builtin.*) */
  appId: string
  appName: string
  onClose: () => void
}

export const AppShareModal: React.FC<AppShareModalProps> = ({ open, appId, appName, onClose }) => {
  const t = useT()
  const tRef = useRef(t)
  tRef.current = t
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [shareInfo, setShareInfo] = useState<AppShareInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !appId) return
    let cancelled = false
    setShareInfo(null)
    setLoadError(null)
    setCopied(false)
    setLoading(true)

    apiClient
      .getAppShareInfo(appId)
      .then((info) => {
        if (!cancelled) setShareInfo(info)
      })
      .catch((err) => {
        if (cancelled) return
        const code = err instanceof ApiClientError ? err.code : ''
        setLoadError(
          code === 'APP_NOT_SHAREABLE' ? tRef.current('share.notShareable') : tRef.current('share.loadFailed')
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, appId])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopyLink = async () => {
    if (!shareInfo) return
    try {
      await navigator.clipboard.writeText(shareInfo.landingUrl)
      setCopied(true)
      message.success(t('share.linkCopied'))
    } catch {
      message.error(t('share.copyFailed'))
    }
  }

  return (
    <Modal
      title={t('share.title', appName)}
      open={open}
      onCancel={onClose}
      destroyOnHidden
      width={480}
      footer={
        shareInfo ? (
          <Button type="primary" icon={<AntdMorphIcon icon={copied ? Check : Copy} size={14} spring="bouncy" />} onClick={handleCopyLink}>
            {t('share.copyLink')}
          </Button>
        ) : null
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      ) : loadError ? (
        <Alert type="warning" showIcon message={loadError} />
      ) : shareInfo ? (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
            {t('share.desc')}
          </Text>
          <div
            style={{
              padding: '8px 12px',
              borderRadius: token.borderRadius,
              background: token.colorFillTertiary,
              fontSize: 12,
              wordBreak: 'break-all'
            }}
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('share.linkLabel')}
            </Text>
            <Text copyable={{ text: shareInfo.landingUrl }} style={{ fontSize: 12 }}>
              {shareInfo.landingUrl}
            </Text>
          </div>
        </>
      ) : null}
    </Modal>
  )
}

export default AppShareModal
