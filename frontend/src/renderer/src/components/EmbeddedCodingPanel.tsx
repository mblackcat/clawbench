/**
 * EmbeddedCodingPanel — 在 CodeEditor 右侧边栏嵌入 AI Coding session。
 * 处理 workspace/session 生命周期，渲染 CodingChatPanel。
 */
import React, { useState, useEffect, useCallback } from 'react'
import { Button, Tooltip, Spin, Typography, theme } from 'antd'
import { CloseOutlined, CodeOutlined, PauseCircleOutlined, StopOutlined } from '@ant-design/icons'
import { useAICodingStore } from '../stores/useAICodingStore'
import CodingChatPanel from '../pages/AICoding/CodingChatPanel'
import { renderAIToolTagLabel, AI_TOOL_SHORT_NAMES, AI_TOOL_NAMES } from '../pages/AICoding/aiToolMeta'
import { useT } from '../i18n'
import type { AIToolType, DetectedCLI } from '../types/ai-coding'

const { Text } = Typography

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '')
}

const LAST_SESSION_KEY_PREFIX = 'cb-embedded-coding-session:'
function lastSessionKey(appPath: string): string {
  return LAST_SESSION_KEY_PREFIX + normalizePath(appPath)
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
    sessionMessages, sessionStreaming,
    fetchAll, createSession,
    hydrateSessionTranscript, setActiveSession,
    interruptSession, stopSession,
  } = useAICodingStore()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [tools, setTools] = useState<DetectedCLI[]>([])
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)

  const isStreaming = sessionId ? (sessionStreaming[sessionId] || false) : false

  /** Select a session: load its transcript and mark it active so its history shows. */
  const selectSession = useCallback((id: string) => {
    setSessionId(id)
    setActiveSession(id)
    void hydrateSessionTranscript(id)
    try { localStorage.setItem(lastSessionKey(appPath), id) } catch { /* storage full */ }
  }, [appPath, setActiveSession, hydrateSessionTranscript])

  // Initialize: fetch store data + detect tools + restore the most recent session
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

        // Check if there's already a workspace + sessions for this app path
        const normalized = normalizePath(appPath)
        const state = useAICodingStore.getState()
        const existingWs = state.workspaces.find(
          (w) => normalizePath(w.workingDir) === normalized
        )
        if (existingWs && !cancelled) {
          const wsSessions = state.sessions.filter((s) => s.workspaceId === existingWs.id)
          if (wsSessions.length > 0) {
            // Prefer the last session the user had open here; otherwise the most
            // recently updated one — regardless of closed status, so a finished
            // conversation is restored instead of dropping back to the tool picker.
            const lastId = (() => {
              try { return localStorage.getItem(lastSessionKey(appPath)) } catch { return null }
            })()
            const sorted = [...wsSessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            const chosen =
              wsSessions.find((s) => s.id === lastId) ||
              sorted.find((s) => s.status !== 'closed') ||
              sorted[0]
            if (chosen) selectSession(chosen.id)
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
  }, [appPath, fetchAll, selectSession])

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
      selectSession(session.id)
    } catch (err) {
      console.error('[EmbeddedCodingPanel] Failed to create session:', err)
    } finally {
      setLoading(false)
    }
  }, [appPath, createSession, fetchAll, selectSession])

  const handleNewSession = useCallback(() => {
    setSessionId(null)
  }, [])

  const handleInterrupt = useCallback(() => {
    if (sessionId) void interruptSession(sessionId)
  }, [sessionId, interruptSession])

  const handleStop = useCallback(() => {
    if (sessionId) void stopSession(sessionId)
  }, [sessionId, stopSession])

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, overflow: 'hidden' }}>
      {/* Mini header with session info + lifecycle controls */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 8px 4px 12px', gap: 8,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        fontSize: 12, color: token.colorTextSecondary
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <CodeOutlined style={{ color: token.colorPrimary, fontSize: 12, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>AI Coding</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {isStreaming && (
            <>
              <Tooltip title={t('coding.interruptTask')}>
                <Button type="text" size="small" icon={<PauseCircleOutlined />} onClick={handleInterrupt} />
              </Tooltip>
              <Tooltip title={t('coding.stopSession')}>
                <Button type="text" size="small" danger icon={<StopOutlined />} onClick={handleStop} />
              </Tooltip>
            </>
          )}
          <Tooltip title={t('codeEditor.newCodingSession')}>
            <Button type="text" size="small" icon={<CodeOutlined />} onClick={handleNewSession} />
          </Tooltip>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
        </div>
      </div>

      {/* CodingChatPanel fills remaining space */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <CodingChatPanel
          sessionId={sessionId}
          onNewSession={handleNewSession}
        />
      </div>
    </div>
  )
}

export default EmbeddedCodingPanel
