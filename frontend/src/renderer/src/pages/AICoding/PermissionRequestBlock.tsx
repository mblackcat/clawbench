import React, { useState, useCallback, useMemo } from 'react'
import { Button, Space, Tag, theme } from 'antd'
import {
  SafetyCertificateOutlined, CheckCircleFilled, StopFilled, WarningOutlined
} from '@ant-design/icons'
import { useT } from '../../i18n'
import { useAICodingStore } from '../../stores/useAICodingStore'
import { MONO_FONT_STACK } from '../../utils/mono-font'

// ── Input preview ──
//
// Show the most meaningful field per tool (command / file path / pattern) as a
// one-line title, with the full input available as a monospace block below.

function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v))
  const cmd = s(input.command)
  if (cmd) return cmd
  const path = s(input.file_path || input.path || input.notebook_path)
  if (path) return path
  const pattern = s(input.pattern || input.query || input.url)
  if (pattern) return pattern
  return toolName
}

interface PermissionRequestBlockProps {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  sessionId: string
  resolved?: boolean
  decision?: 'allow' | 'deny'
}

const PermissionRequestBlock: React.FC<PermissionRequestBlockProps> = ({
  requestId, toolName, input, sessionId, resolved, decision
}) => {
  const { token } = theme.useToken()
  const t = useT()
  const resolvePermission = useAICodingStore(s => s.resolvePermission)
  const [submitting, setSubmitting] = useState<'allow' | 'deny' | null>(null)

  const title = useMemo(() => summarizeInput(toolName, input), [toolName, input])
  const fullInput = useMemo(() => JSON.stringify(input, null, 2), [input])
  const [expanded, setExpanded] = useState(false)

  const handle = useCallback(async (behavior: 'allow' | 'deny') => {
    if (submitting || resolved) return
    setSubmitting(behavior)
    try {
      await resolvePermission(sessionId, requestId, { behavior })
    } finally {
      setSubmitting(null)
    }
  }, [submitting, resolved, resolvePermission, sessionId, requestId])

  // ── Resolved state: compact read-only summary ──
  if (resolved) {
    const allowed = decision === 'allow'
    return (
      <div style={{
        padding: '8px 12px', marginBottom: 6,
        borderRadius: token.borderRadiusSM,
        border: `1px solid ${allowed ? token.colorSuccessBorder : token.colorErrorBorder}`,
        background: allowed ? token.colorSuccessBg : token.colorErrorBg,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
          color: allowed ? token.colorSuccess : token.colorError,
        }}>
          {allowed ? <CheckCircleFilled /> : <StopFilled />}
          <span style={{ fontWeight: 500 }}>
            {allowed ? t('coding.permissionAllowed') : t('coding.permissionDenied')}
          </span>
          <Tag style={{ marginInlineStart: 4, fontSize: 11 }}>{toolName}</Tag>
        </div>
        <div style={{
          marginTop: 4, fontSize: 12, color: token.colorTextSecondary,
          fontFamily: MONO_FONT_STACK, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {title}
        </div>
      </div>
    )
  }

  // ── Pending state: interactive ──
  return (
    <div style={{
      padding: '12px 14px', marginBottom: 6,
      borderRadius: token.borderRadiusSM,
      border: `1px solid ${token.colorWarningBorder}`,
      background: token.colorBgElevated,
    }}>
      {/* Icon + title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 12, color: token.colorWarning }}>
        <SafetyCertificateOutlined />
        <span style={{ fontWeight: 500 }}>{t('coding.permissionTitle')}</span>
        <Tag color="warning" style={{ marginInlineStart: 4, fontSize: 11 }}>{toolName}</Tag>
      </div>

      {/* One-line summary of the request */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          padding: '8px 10px', borderRadius: 4,
          background: token.colorFillQuaternary,
          fontFamily: MONO_FONT_STACK, fontSize: 12, color: token.colorText,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', cursor: 'pointer',
        }}
      >
        {title}
      </div>

      {/* Full input (toggled) */}
      {expanded && fullInput !== title && (
        <pre style={{
          margin: '6px 0 0', padding: '8px 10px', fontSize: 11,
          fontFamily: MONO_FONT_STACK, background: token.colorFillQuaternary,
          borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          maxHeight: 200, overflow: 'auto', color: token.colorTextSecondary,
        }}>
          {fullInput}
        </pre>
      )}

      {/* Actions */}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: token.colorTextTertiary }}>
          <WarningOutlined />
          {t('coding.permissionHint')}
        </span>
        <Space size={8}>
          <Button
            size="small"
            danger
            onClick={() => handle('deny')}
            loading={submitting === 'deny'}
            disabled={submitting === 'allow'}
          >
            {t('coding.permissionDeny')}
          </Button>
          <Button
            type="primary"
            size="small"
            onClick={() => handle('allow')}
            loading={submitting === 'allow'}
            disabled={submitting === 'deny'}
          >
            {t('coding.permissionAllow')}
          </Button>
        </Space>
      </div>
    </div>
  )
}

export default PermissionRequestBlock