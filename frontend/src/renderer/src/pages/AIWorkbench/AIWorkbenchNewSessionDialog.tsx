import React, { useEffect, useState } from 'react'
import { Modal, List, Tag, Spin, theme, Button, Tooltip } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { AI_TOOL_TAG_COLORS, AI_TOOL_TAG_STYLE, renderAIToolTagLabel } from './aiToolMeta'
import { useT } from '../../i18n'
import type { AIToolType, DetectedCLI } from '../../types/ai-workbench'

// Module-level cache so tools are only detected once per app session
let toolsCache: DetectedCLI[] | null = null

interface AIWorkbenchNewSessionDialogProps {
  open: boolean
  onOk: (toolType: AIToolType) => void
  onCancel: () => void
}

const AIWorkbenchNewSessionDialog: React.FC<AIWorkbenchNewSessionDialogProps> = ({
  open,
  onOk,
  onCancel
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const [tools, setTools] = useState<DetectedCLI[]>(toolsCache ?? [])
  const [loading, setLoading] = useState(false)

  const fetchTools = (useCache: boolean): void => {
    if (useCache && toolsCache !== null) {
      setTools(toolsCache)
      return
    }
    setLoading(true)
    window.api.aiWorkbench
      .detectTools()
      .then((detected) => {
        // Exclude plain terminal — users open that via the sidebar terminal icon
        const coding = detected.filter((c) => c.toolType !== 'terminal')
        toolsCache = coding
        setTools(coding)
      })
      .catch(() => setTools([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!open) return
    fetchTools(true)
  }, [open])

  const handleRefresh = (): void => {
    fetchTools(false)
  }

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{t('coding.selectCodingTool')}</span>
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
      ) : (
        <List
          dataSource={tools}
          renderItem={(cli) => (
            <List.Item
              onClick={() => {
                if (cli.installed) onOk(cli.toolType)
              }}
              style={{
                cursor: cli.installed ? 'pointer' : 'not-allowed',
                opacity: cli.installed ? 1 : 0.45,
                padding: '10px 12px',
                borderRadius: token.borderRadius
              }}
              onMouseEnter={(e) => {
                if (cli.installed)
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
                  {cli.version || (cli.installed ? '' : t('coding.notInstalled'))}
                </span>
                {cli.installed ? (
                  <CheckCircleOutlined style={{ color: token.colorSuccess }} />
                ) : (
                  <CloseCircleOutlined style={{ color: token.colorTextQuaternary }} />
                )}
              </div>
            </List.Item>
          )}
        />
      )}
    </Modal>
  )
}

export default AIWorkbenchNewSessionDialog
