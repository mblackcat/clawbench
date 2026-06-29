/**
 * AICodeButton — 从 workbench app 卡片一键跳转 AI Coding 的自包含按钮。
 * 点击弹出已安装 CLI 工具列表，选择后创建 workspace + session 并跳转。
 */
import React, { useState, useCallback, useRef } from 'react'
import { Dropdown, Tooltip, theme, App } from 'antd'
import { CodeOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useT } from '../i18n'
import { renderAIToolTagLabel, AI_TOOL_SHORT_NAMES } from '../pages/AICoding/aiToolMeta'
import type { DetectedCLI, AIToolType } from '../types/ai-coding'

// Module-level cache (same pattern as AICodingNewSessionDialog)
let _toolsCache: DetectedCLI[] | null = null

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '')
}

interface AICodeButtonProps {
  appId: string
}

const AICodeButton: React.FC<AICodeButtonProps> = ({ appId }) => {
  const t = useT()
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const { message } = App.useApp()

  const [tools, setTools] = useState<DetectedCLI[]>(_toolsCache ?? [])
  const [loading, setLoading] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const mountedRef = useRef(true)

  // Lazy-load tools on first dropdown open
  const ensureTools = useCallback(async () => {
    if (_toolsCache !== null) {
      setTools(_toolsCache)
      return
    }
    try {
      const detected = await window.api.aiCoding.detectTools()
      const coding = detected.filter((c: DetectedCLI) => c.toolType !== 'terminal')
      _toolsCache = coding
      if (mountedRef.current) setTools(coding)
    } catch {
      // keep empty
    }
  }, [])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) ensureTools()
      if (!loading) setDropdownOpen(open)
    },
    [loading, ensureTools]
  )

  const handleToolSelect = useCallback(
    async (toolType: AIToolType) => {
      if (loading) return
      setLoading(true)
      try {
        // 1. Resolve app directory
        const appPath: string = await window.api.developer.getAppPath(appId)

        // 2. Find or create workspace
        const workspaces: Array<{ id: string; workingDir: string }> =
          await window.api.aiCoding.getWorkspaces()
        const normalized = normalizePath(appPath)
        const existing = workspaces.find(
          (w) => normalizePath(w.workingDir) === normalized
        )

        let workspaceId: string
        if (existing) {
          workspaceId = existing.id
        } else {
          const groups: Array<{ id: string; isDefault?: boolean }> =
            await window.api.aiCoding.getGroups()
          const defaultGroupId =
            groups.find((g) => g.isDefault)?.id || 'default'
          const ws = await window.api.aiCoding.createWorkspace(
            appPath,
            defaultGroupId
          )
          workspaceId = ws.id
        }

        // 3. Create session
        const session = await window.api.aiCoding.createSession(
          workspaceId,
          toolType,
          'local'
        )

        // 4. Navigate to AI Coding with session auto-select
        navigate('/ai-coding', { state: { selectSessionId: session.id } })
      } catch (err) {
        console.error('[AICodeButton] Failed:', err)
        if (mountedRef.current) {
          message.error(t('coding.createSessionFailed'))
          setLoading(false)
          setDropdownOpen(false)
        }
      }
    },
    [appId, loading, navigate, message, t]
  )

  // Build menu items from installed tools
  const installedTools = tools.filter((c) => c.installed)
  const menuItems = installedTools.map((cli) => ({
    key: cli.toolType,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {renderAIToolTagLabel(
          cli.toolType,
          AI_TOOL_SHORT_NAMES[cli.toolType] || cli.name,
          14
        )}
        {cli.version && (
          <span style={{ fontSize: 11, color: token.colorTextSecondary }}>
            {cli.version}
          </span>
        )}
      </div>
    ),
    disabled: loading,
    onClick: () => handleToolSelect(cli.toolType as AIToolType)
  }))

  const buttonStyle: React.CSSProperties = {
    flex: 1,
    padding: '8px 0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    cursor: loading ? 'wait' : 'pointer',
    color: token.colorPrimary,
    fontWeight: 500,
    fontSize: 13
  }

  // No tools installed → disabled button with tooltip
  if (installedTools.length === 0 && _toolsCache !== null) {
    return (
      <Tooltip title={t('workbench.noAIToolDetected')}>
        <div style={{ ...buttonStyle, opacity: 0.4, cursor: 'not-allowed' }}>
          <CodeOutlined /> {t('workbench.aiCode')}
        </div>
      </Tooltip>
    )
  }

  return (
    <Dropdown
      open={dropdownOpen}
      onOpenChange={handleOpenChange}
      placement="top"
      trigger={['click']}
      menu={{ items: menuItems }}
      disabled={loading}
    >
      <div style={buttonStyle}>
        {loading ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CodeOutlined spin /> {t('workbench.aiCode')}
          </span>
        ) : (
          <>
            <CodeOutlined /> {t('workbench.aiCode')}
          </>
        )}
      </div>
    </Dropdown>
  )
}

export default AICodeButton
