import React, { useState, useMemo, useCallback } from 'react'
import { Button, Dropdown, Spin, Tooltip, Typography, theme } from 'antd'
import {
  PlusOutlined, CodeOutlined, HistoryOutlined, CloseOutlined,
  DollarOutlined, BranchesOutlined, MessageOutlined
} from '@ant-design/icons'
import { getAIToolIcon } from './aiToolMeta'
import type { AIToolType, AIWorkbenchSession, ClaudeViewMode } from '../../types/ai-workbench'

const { Text } = Typography

const TOOLS_WITH_NATIVE_SESSIONS: Set<AIToolType> = new Set(['claude', 'codex', 'gemini'])

interface NativeSession {
  sessionId: string
  title: string
  modifiedAt: number
  sizeBytes?: number
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface PaneTabBarProps {
  paneId: string
  tabs: AIWorkbenchSession[]
  activeTabId: string | null
  workingDir: string
  onSelectTab: (sessionId: string) => void
  onCloseTab: (sessionId: string) => void
  onNewSession: () => void
  onResumeNativeSession?: (toolType: AIToolType, nativeSessionId: string, title?: string) => void
  onTabDragStart?: (sessionId: string, paneId: string) => void
  onTabDrop?: (paneId: string) => void
  onSplitRight?: (sessionId: string) => void
  onSplitDown?: (sessionId: string) => void
  claudeViewMode?: ClaudeViewMode
  onClaudeViewModeChange?: (mode: ClaudeViewMode) => void
  gitPanelOpen?: boolean
  onToggleGitPanel?: () => void
  isFocused?: boolean
}

const PaneTabBar: React.FC<PaneTabBarProps> = ({
  paneId, tabs, activeTabId, workingDir,
  onSelectTab, onCloseTab, onNewSession, onResumeNativeSession,
  onTabDragStart, onTabDrop,
  onSplitRight, onSplitDown,
  claudeViewMode, onClaudeViewModeChange,
  gitPanelOpen, onToggleGitPanel,
  isFocused,
}) => {
  const { token } = theme.useToken()
  const activeSession = useMemo(() => tabs.find(t => t.id === activeTabId), [tabs, activeTabId])
  const activeToolType = activeSession?.toolType

  const [nativeSessions, setNativeSessions] = useState<NativeSession[]>([])
  const [loadingNative, setLoadingNative] = useState(false)

  const fetchNativeSessions = useCallback(async (toolType: AIToolType) => {
    if (!workingDir) return
    setLoadingNative(true)
    try {
      const sessions = await window.api.aiWorkbench.listNativeSessions(workingDir, toolType)
      setNativeSessions(sessions || [])
    } catch { setNativeSessions([]) }
    finally { setLoadingNative(false) }
  }, [workingDir])

  const historyItems = useMemo(() => {
    if (nativeSessions.length === 0) return []
    const loadedIds = new Set(tabs.filter(s => s.toolSessionId).map(s => s.toolSessionId))
    return nativeSessions
      .filter(ns => !loadedIds.has(ns.sessionId))
      .map(ns => {
        const time = formatRelativeTime(ns.modifiedAt)
        const size = ns.sizeBytes ? ` · ${formatSize(ns.sizeBytes)}` : ''
        return {
          key: ns.sessionId,
          label: (
            <span title={ns.title} style={{ display: 'block', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ns.title}  ({time}{size})
            </span>
          ),
        }
      })
  }, [nativeSessions, tabs])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-pane-tab')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    onTabDrop?.(paneId)
  }, [paneId, onTabDrop])

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 0,
        height: 38,
        borderBottom: `1px solid ${isFocused ? token.colorPrimary : token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        overflow: 'hidden',
        flexShrink: 0,
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Fixed buttons: [+] [>_] */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 4px 0 8px', flexShrink: 0 }}>
        <Tooltip title="新建会话">
          <Button type="text" size="small" icon={<PlusOutlined />} onClick={onNewSession} />
        </Tooltip>
        <Tooltip title="在终端中打开">
          <Button
            type="text" size="small" icon={<CodeOutlined />}
            onClick={() => workingDir && window.api.aiWorkbench.openTerminal(workingDir).catch(() => {})}
          />
        </Tooltip>
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: token.colorBorderSecondary, flexShrink: 0 }} />

      {/* Scrollable tab area */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 0,
        overflow: 'hidden', minWidth: 0,
        overflowX: 'auto',
      }}>
        <style>{`.pane-tab-scroll::-webkit-scrollbar { display: none; }`}</style>
        {tabs.map((session, idx) => {
          const isActive = session.id === activeTabId
          const icon = getAIToolIcon(session.toolType, 12)
          const title = session.title || `#${idx + 1}`

          const tabContextMenu = [
            { key: 'split-right', label: '向右拆分', onClick: () => onSplitRight?.(session.id) },
            { key: 'split-down', label: '向下拆分', onClick: () => onSplitDown?.(session.id) },
            { type: 'divider' as const },
            { key: 'close', label: '关闭', onClick: () => onCloseTab(session.id) },
            { key: 'close-others', label: '关闭其他', onClick: () => {
              tabs.forEach(t => { if (t.id !== session.id) onCloseTab(t.id) })
            }},
          ]

          return (
            <Dropdown key={session.id} menu={{ items: tabContextMenu }} trigger={['contextMenu']}>
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-pane-tab', JSON.stringify({ sessionId: session.id, paneId }))
                  e.dataTransfer.effectAllowed = 'move'
                  onTabDragStart?.(session.id, paneId)
                }}
                onClick={() => onSelectTab(session.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '0 8px', height: 37,
                  cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                  borderBottom: isActive ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
                  color: isActive ? token.colorText : token.colorTextSecondary,
                  background: isActive ? token.colorBgContainer : 'transparent',
                  fontSize: 12, flexShrink: 0,
                  transition: 'border-color 0.2s, color 0.2s',
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget.style.background = token.colorFillQuaternary) }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget.style.background = 'transparent') }}
              >
                {icon && <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>}
                <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }} title={title}>
                  {title}
                </span>

                {TOOLS_WITH_NATIVE_SESSIONS.has(session.toolType) && (
                  <Dropdown
                    menu={{
                      items: loadingNative
                        ? [{ key: 'loading', label: <Spin size="small" />, disabled: true }]
                        : historyItems.length > 0
                          ? historyItems
                          : [{ key: 'empty', label: '无历史会话', disabled: true }],
                      onClick: ({ key }) => {
                        const ns = nativeSessions.find(s => s.sessionId === key)
                        onResumeNativeSession?.(session.toolType, key, ns?.title)
                      },
                      style: { maxHeight: 'min(400px, 60vh)', overflowY: 'auto' },
                    }}
                    trigger={['click']}
                    placement="bottomLeft"
                    onOpenChange={(open) => open && fetchNativeSessions(session.toolType)}
                  >
                    <span
                      role="button"
                      style={{ display: 'inline-flex', alignItems: 'center', padding: 2, borderRadius: 4, cursor: 'pointer' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <HistoryOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />
                    </span>
                  </Dropdown>
                )}

                <span
                  role="button"
                  style={{ display: 'inline-flex', alignItems: 'center', padding: 2, borderRadius: 4, cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); onCloseTab(session.id) }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <CloseOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />
                </span>
              </div>
            </Dropdown>
          )
        })}
      </div>

      {/* Right zone: cost, Claude toggle, git */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', flexShrink: 0 }}>
        {activeSession?.costUsd !== undefined && activeSession.costUsd > 0 && (
          <Text style={{ fontSize: 11, color: token.colorTextSecondary }}>
            <DollarOutlined /> {activeSession.costUsd.toFixed(4)}
          </Text>
        )}

        {activeToolType === 'claude' && claudeViewMode && onClaudeViewModeChange && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', borderRadius: 8,
            background: token.colorFillTertiary, padding: 2, flexShrink: 0,
          }}>
            {(['chat', 'cli'] as ClaudeViewMode[]).map((m) => {
              const active = claudeViewMode === m
              return (
                <div
                  key={m}
                  role="button"
                  onClick={() => onClaudeViewModeChange(m)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    padding: '2px 8px', fontSize: 11, cursor: 'pointer',
                    borderRadius: 6, border: 'none',
                    background: active ? token.colorPrimary : 'transparent',
                    color: active ? '#fff' : token.colorTextSecondary,
                    fontWeight: active ? 500 : 400,
                    userSelect: 'none', whiteSpace: 'nowrap',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  {m === 'chat' ? <MessageOutlined style={{ fontSize: 10 }} /> : <CodeOutlined style={{ fontSize: 10 }} />}
                  {m === 'chat' ? 'Chat' : 'CLI'}
                </div>
              )
            })}
          </div>
        )}

        {onToggleGitPanel && (
          <Tooltip title="Changes">
            <Button
              type="text" size="small" icon={<BranchesOutlined />}
              onClick={onToggleGitPanel}
              style={{
                color: gitPanelOpen ? token.colorPrimary : token.colorTextSecondary,
                background: gitPanelOpen ? token.colorPrimaryBg : undefined,
              }}
            />
          </Tooltip>
        )}
      </div>
    </div>
  )
}

export default PaneTabBar
