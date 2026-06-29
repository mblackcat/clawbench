/**
 * EmbeddedCodingPanel — 在 CodeEditor 右侧边栏嵌入 AI Coding session。
 * 处理 workspace/session 生命周期，渲染 CodingChatPanel。
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Button, Tooltip, Spin, Typography, theme } from 'antd'
import { CloseOutlined, CodeOutlined } from '@ant-design/icons'
import { useAICodingStore } from '../stores/useAICodingStore'
import CodingChatPanel from '../pages/AICoding/CodingChatPanel'
import { renderAIToolTagLabel, AI_TOOL_SHORT_NAMES, AI_TOOL_NAMES } from '../pages/AICoding/aiToolMeta'
import { useT } from '../i18n'
import type { AIToolType, DetectedCLI } from '../types/ai-coding'

const { Text } = Typography

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '')
}

interface EmbeddedCodingPanelProps {
  appPath: string
  onFilesChanged?: () => void
  onClose: () => void
}

const EmbeddedCodingPanel: React.FC<EmbeddedCodingPanelProps> = ({
  appPath,
  onFilesChanged,
  onClose
}) => {
  const t = useT()
  const { token } = theme.useToken()

  const {
    sessions, workspaces,
    sessionMessages,
    fetchAll, createSession
  } = useAICodingStore()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [tools, setTools] = useState<DetectedCLI[]>([])
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)

  // Initialize: fetch store data + detect tools + check for existing session
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        await fetchAll()
        if (cancelled) return

        // Detect available tools
        const detected = await window.api.aiCoding.detectTools()
        const coding = detected.filter((c: DetectedCLI) => c.toolType !== 'terminal' && c.installed)
        if (!cancelled) setTools(coding)

        // Check if there's already a workspace + session for this app path
        const normalized = normalizePath(appPath)
        const existingWs = useAICodingStore.getState().workspaces.find(
          (w) => normalizePath(w.workingDir) === normalized
        )
        if (existingWs) {
          // Find an active or recent session for this workspace
          const wsSessions = useAICodingStore.getState().sessions.filter(
            (s) => s.workspaceId === existingWs.id && s.status !== 'closed'
          )
          if (wsSessions.length > 0 && !cancelled) {
            setSessionId(wsSessions[0].id)
          }
        }
      } catch (err) {
        console.error('[EmbeddedCodingPanel] Init failed:', err)
      } finally {
        if (!cancelled) setInitializing(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [appPath, fetchAll])

  // Watch for file-modifying tool results and trigger refresh
  const messages = sessionId ? (sessionMessages[sessionId] || []) : []
  const prevMsgCountRef = React.useRef(messages.length)

  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      // New messages added — check if any are assistant messages with tool_use
      const newMsgs = messages.slice(prevMsgCountRef.current)
      const hasToolUse = newMsgs.some(
        (m) => m.role === 'assistant' && m.blocks.some((b) => b.type === 'tool_use')
      )
      if (hasToolUse && onFilesChanged) {
        onFilesChanged()
      }
    }
    prevMsgCountRef.current = messages.length
  }, [messages, onFilesChanged])

  const handleToolSelect = useCallback(async (toolType: AIToolType) => {
    setLoading(true)
    try {
      // Find or create workspace
      const currentWorkspaces = useAICodingStore.getState().workspaces
      const normalized = normalizePath(appPath)
      const existing = currentWorkspaces.find(
        (w) => normalizePath(w.workingDir) === normalized
      )

      let workspaceId: string
      if (existing) {
        workspaceId = existing.id
      } else {
        const groups = useAICodingStore.getState().groups
        const defaultGroupId = groups.find((g) => g.isDefault)?.id || 'default'
        const ws = await window.api.aiCoding.createWorkspace(appPath, defaultGroupId)
        workspaceId = ws.id
        // Refresh store to pick up new workspace
        await fetchAll()
      }

      // Create runtime session
      const session = await createSession(workspaceId, toolType, 'local')
      setSessionId(session.id)
    } catch (err) {
      console.error('[EmbeddedCodingPanel] Failed to create session:', err)
    } finally {
      setLoading(false)
    }
  }, [appPath, createSession, fetchAll])

  const handleNewSession = useCallback(() => {
    setSessionId(null)
  }, [])

  // Loading state
  if (initializing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin />
      </div>
    )
  }

  // Tool selection (no active session)
  if (!sessionId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderBottom: `1px solid ${token.colorBorderSecondary}`
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <CodeOutlined style={{ color: token.colorPrimary }} />
            <Text strong style={{ fontSize: 13 }}>{t('codeEditor.selectCodingTool')}</Text>
          </div>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
        </div>

        {/* Tool list */}
        <div style={{ flex: 1, padding: 12, overflow: 'auto' }}>
          {tools.length === 0 ? (
            <div style={{ textAlign: 'center', color: token.colorTextSecondary, marginTop: 40 }}>
              <CodeOutlined style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }} />
              <div>{t('workbench.noAIToolDetected')}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tools.map((cli) => (
                <div
                  key={cli.toolType}
                  onClick={() => !loading && handleToolSelect(cli.toolType as AIToolType)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 8,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    cursor: loading ? 'wait' : 'pointer',
                    transition: 'all 0.2s',
                    background: token.colorBgContainer
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = token.colorPrimary
                    e.currentTarget.style.background = token.colorPrimaryBg
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = token.colorBorderSecondary
                    e.currentTarget.style.background = token.colorBgContainer
                  }}
                >
                  <div style={{ fontSize: 20 }}>
                    {renderAIToolTagLabel(cli.toolType, '', 20)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>
                      {AI_TOOL_NAMES[cli.toolType as AIToolType] || cli.name}
                    </div>
                    {cli.version && (
                      <div style={{ fontSize: 11, color: token.colorTextSecondary }}>
                        {cli.version}
                      </div>
                    )}
                  </div>
                  {loading && <Spin size="small" />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Active session — render CodingChatPanel
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Mini header with session info + close */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 8px 4px 12px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        fontSize: 12, color: token.colorTextSecondary
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CodeOutlined style={{ color: token.colorPrimary, fontSize: 12 }} />
          <span>AI Coding</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Tooltip title={t('codeEditor.newCodingSession')}>
            <Button type="text" size="small" icon={<CodeOutlined />} onClick={handleNewSession} />
          </Tooltip>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
        </div>
      </div>

      {/* CodingChatPanel fills remaining space */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <CodingChatPanel
          sessionId={sessionId}
          onNewSession={handleNewSession}
        />
      </div>
    </div>
  )
}

export default EmbeddedCodingPanel
