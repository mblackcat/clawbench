import React, { useEffect, useMemo, useState } from 'react'
import { Modal, List, Tag, Spin, theme, Button, Tooltip } from 'antd'
import { CheckCircleOutlined, ReloadOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { AI_TOOL_TAG_COLORS, AI_TOOL_TAG_STYLE, renderAIToolTagLabel } from './aiToolMeta'
import { useT } from '../../i18n'
import type { AIToolType, DetectedCLI } from '../../types/ai-coding'
import { toolsCache, setToolsCache } from '../../utils/coding-tools-cache'

interface AICodingNewSessionDialogProps {
  open: boolean
  onOk: (toolType: AIToolType) => void
  onCancel: () => void
}

const AICodingNewSessionDialog: React.FC<AICodingNewSessionDialogProps> = ({
  open,
  onOk,
  onCancel
}) => {
  const t = useT()
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const [tools, setTools] = useState<DetectedCLI[]>(toolsCache ?? [])
  const [loading, setLoading] = useState(toolsCache === null)
  const fetchTools = (useCache: boolean): void => {
    if (useCache && toolsCache !== null) {
      setTools(toolsCache)
      return
    }
    setLoading(true)
    window.api.aiCoding
      .detectTools()
      .then((detected) => {
        // Exclude plain terminal — users open that via the sidebar terminal icon
        const coding = detected.filter((c) => c.toolType !== 'terminal')
        setToolsCache(coding)
        setTools(coding)
      })
      .catch(() => setTools([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!open) return
    // Always re-detect on open so enablement toggles are reflected immediately
    fetchTools(false)
  }, [open])

  const handleRefresh = (): void => {
    fetchTools(false)
  }
  const availableTools = useMemo(
    () => tools.filter((c) => c.installed && c.enabled !== false),
    [tools]
  )

  const handleGoToInstall = (): void => {
    onCancel()
    navigate('/local-env', { state: { scrollTo: 'ai-tools' } })
  }

  const isNotice = !loading && availableTools.length === 0

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{isNotice ? t('coding.noticeTitle') : t('coding.selectCodingTool')}</span>
          <Tooltip title={t('coding.refreshTools')}>
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined spin={loading} />}
              onClick={handleRefresh}
              disabled={loading}
            />
          </Tooltip>
        </div>
      }
      open={open}
      onCancel={onCancel}
      footer={null}
      destroyOnHidden={false}
      width={420}
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : availableTools.length === 0 ? (
        <div style={{ padding: '16px 8px 8px', textAlign: 'center' }}>
          <ExclamationCircleOutlined
            style={{ fontSize: 44, color: token.colorWarning, marginBottom: 16 }}
          />
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: token.colorText,
              marginBottom: 8
            }}
          >
            {t('coding.noInstalledToolsTitle')}
          </div>
          <div
            style={{
              fontSize: 13,
              color: token.colorTextSecondary,
              lineHeight: 1.6,
              marginBottom: 24,
              padding: '0 8px'
            }}
          >
            {t('coding.noInstalledToolsDesc')}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={onCancel}>{t('common.cancel')}</Button>
            <Button type="primary" onClick={handleGoToInstall}>
              {t('coding.goToInstall')}
            </Button>
          </div>
        </div>
      ) : (
        <List
          dataSource={availableTools}
          renderItem={(cli) => (
            <List.Item
              onClick={() => onOk(cli.toolType)}
              style={{
                cursor: 'pointer',
                padding: '10px 12px',
                borderRadius: token.borderRadius,
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = token.colorFillSecondary
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                <Tag color={AI_TOOL_TAG_COLORS[cli.toolType] ?? 'default'} style={AI_TOOL_TAG_STYLE}>
                  {renderAIToolTagLabel(cli.toolType, cli.name)}
                </Tag>
                <span style={{ flex: 1, color: token.colorTextSecondary, fontSize: 12 }}>
                  {cli.version || ''}
                </span>
                <CheckCircleOutlined style={{ color: token.colorSuccess }} />
              </div>
            </List.Item>
          )}
        />
      )}
    </Modal>
  )
}

export default AICodingNewSessionDialog
