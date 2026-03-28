import React, { useMemo, useCallback, useRef, useState } from 'react'
import { Typography, theme } from 'antd'
import { MessageOutlined } from '@ant-design/icons'
import PaneTabBar from './PaneTabBar'
import WorkbenchChatPanel from './WorkbenchChatPanel'
import WorkbenchTerminalView from './WorkbenchTerminalView'
import { useAIWorkbenchStore } from '../../stores/useAIWorkbenchStore'
import { useT } from '../../i18n'
import type { AIToolType, ClaudeViewMode } from '../../types/ai-workbench'

const { Text } = Typography

interface TabGroupProps {
  paneId: string
  tabIds: string[]
  activeTabId: string | null
  onTabDragStart?: (sessionId: string, paneId: string) => void
  onTabDrop?: (paneId: string) => void
  onEdgeDrop?: (paneId: string, edge: 'left' | 'right' | 'top' | 'bottom') => void
  gitPanelOpen?: boolean
  onToggleGitPanel?: () => void
  isFocused?: boolean
}

const EDGE_THRESHOLD = 0.2

const TabGroup: React.FC<TabGroupProps> = ({
  paneId, tabIds, activeTabId,
  onTabDragStart, onTabDrop, onEdgeDrop,
  gitPanelOpen, onToggleGitPanel,
  isFocused,
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const {
    sessions, workspaces,
    claudeViewModes, setClaudeViewMode,
    setPaneActiveTab, removeTabFromPane, addTabToPane,
    createSession, updateSession, setFocusedPane, fetchAll, setActiveSession,
  } = useAIWorkbenchStore()

  const tabs = useMemo(
    () => tabIds.map(id => sessions.find(s => s.id === id)).filter(Boolean) as typeof sessions,
    [tabIds, sessions]
  )

  const activeSession = useMemo(() => tabs.find(s => s.id === activeTabId), [tabs, activeTabId])

  // Derive workingDir from the active tab's workspace (each tab may belong to a different workspace)
  const activeWorkingDir = useMemo(() => {
    if (!activeSession) return ''
    const ws = workspaces.find(w => w.id === activeSession.workspaceId)
    return ws?.workingDir || ''
  }, [activeSession, workspaces])

  const claudeViewMode: ClaudeViewMode = useMemo(() => {
    if (!activeTabId) return 'chat'
    return claudeViewModes[activeTabId] || (localStorage.getItem('cb-claude-view-mode') as ClaudeViewMode) || 'chat'
  }, [activeTabId, claudeViewModes])

  const handleClaudeViewModeChange = useCallback(async (mode: ClaudeViewMode) => {
    if (!activeTabId) return
    const session = sessions.find(s => s.id === activeTabId)
    if (session && session.status !== 'closed' && session.status !== 'completed' && session.status !== 'error') {
      try { await window.api.aiWorkbench.stopSession(activeTabId) } catch { /* */ }
    }
    setClaudeViewMode(activeTabId, mode)
  }, [activeTabId, sessions, setClaudeViewMode])

  const handleSelectTab = useCallback((sessionId: string) => {
    setPaneActiveTab(paneId, sessionId)
    setFocusedPane(paneId)
  }, [paneId, setPaneActiveTab, setFocusedPane])

  const handleCloseTab = useCallback(async (sessionId: string) => {
    removeTabFromPane(paneId, sessionId)
  }, [paneId, removeTabFromPane])

  const handleNewSession = useCallback(async () => {
    // Use the active tab's workspace + tool type for the new session
    const refSession = activeSession || tabs[tabs.length - 1]
    if (!refSession) return // no reference session — can't determine workspace
    const toolType: AIToolType = refSession.toolType || 'claude'
    try {
      const session = await createSession(refSession.workspaceId, toolType, 'local')
      await fetchAll()
      addTabToPane(paneId, session.id)
      setActiveSession(session.id)
    } catch { /* */ }
  }, [activeSession, tabs, paneId, createSession, fetchAll, addTabToPane, setActiveSession])

  const handleResumeNativeSession = useCallback(async (toolType: AIToolType, nativeSessionId: string, title?: string) => {
    // Resume into the active tab's workspace
    const refSession = activeSession || tabs[tabs.length - 1]
    if (!refSession) return
    try {
      const session = await createSession(refSession.workspaceId, toolType, 'local')
      await updateSession(session.id, { toolSessionId: nativeSessionId, ...(title ? { title } : {}) })
      await fetchAll()
      addTabToPane(paneId, session.id)
      setActiveSession(session.id)
    } catch { /* */ }
  }, [activeSession, tabs, paneId, createSession, updateSession, fetchAll, addTabToPane, setActiveSession])

  // Edge drop detection
  const contentRef = useRef<HTMLDivElement>(null)
  const [dropEdge, setDropEdge] = useState<'left' | 'right' | 'top' | 'bottom' | null>(null)

  const handleContentDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-pane-tab')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const rect = contentRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    if (x < EDGE_THRESHOLD) setDropEdge('left')
    else if (x > 1 - EDGE_THRESHOLD) setDropEdge('right')
    else if (y < EDGE_THRESHOLD) setDropEdge('top')
    else if (y > 1 - EDGE_THRESHOLD) setDropEdge('bottom')
    else setDropEdge(null)
  }, [])

  const handleContentDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (dropEdge) {
      onEdgeDrop?.(paneId, dropEdge)
    } else {
      onTabDrop?.(paneId)
    }
    setDropEdge(null)
  }, [dropEdge, paneId, onEdgeDrop, onTabDrop])

  const handleContentDragLeave = useCallback(() => setDropEdge(null), [])

  const handleSplitRight = useCallback((sessionId: string) => {
    useAIWorkbenchStore.getState().splitPane(paneId, 'horizontal', sessionId)
  }, [paneId])

  const handleSplitDown = useCallback((sessionId: string) => {
    useAIWorkbenchStore.getState().splitPane(paneId, 'vertical', sessionId)
  }, [paneId])

  const handlePaneClick = useCallback(() => {
    setFocusedPane(paneId)
    if (activeTabId) setActiveSession(activeTabId)
  }, [paneId, activeTabId, setFocusedPane, setActiveSession])

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      onClick={handlePaneClick}
    >
      <PaneTabBar
        paneId={paneId}
        tabs={tabs}
        activeTabId={activeTabId}
        workingDir={activeWorkingDir}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewSession={handleNewSession}
        onResumeNativeSession={handleResumeNativeSession}
        onTabDragStart={onTabDragStart}
        onTabDrop={onTabDrop}
        onSplitRight={handleSplitRight}
        onSplitDown={handleSplitDown}
        claudeViewMode={activeSession?.toolType === 'claude' ? claudeViewMode : undefined}
        onClaudeViewModeChange={activeSession?.toolType === 'claude' ? handleClaudeViewModeChange : undefined}
        gitPanelOpen={gitPanelOpen}
        onToggleGitPanel={onToggleGitPanel}
        isFocused={isFocused}
      />

      <div
        ref={contentRef}
        style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
        onDragOver={handleContentDragOver}
        onDrop={handleContentDrop}
        onDragLeave={handleContentDragLeave}
      >
        {dropEdge && (
          <div style={{
            position: 'absolute', zIndex: 100, pointerEvents: 'none',
            background: `${token.colorPrimary}22`,
            border: `2px solid ${token.colorPrimary}`,
            borderRadius: 4,
            ...(dropEdge === 'left' ? { left: 0, top: 0, bottom: 0, width: '50%' } :
              dropEdge === 'right' ? { right: 0, top: 0, bottom: 0, width: '50%' } :
              dropEdge === 'top' ? { left: 0, top: 0, right: 0, height: '50%' } :
              { left: 0, bottom: 0, right: 0, height: '50%' }),
          }} />
        )}

        {activeTabId && activeSession ? (
          activeSession.toolType === 'claude' && claudeViewMode === 'chat' ? (
            <WorkbenchChatPanel
              sessionId={activeTabId}
              onNewSession={handleNewSession}
              onCloseSession={handleCloseTab}
            />
          ) : (
            <WorkbenchTerminalView
              key={activeTabId}
              sessionId={activeTabId}
              onNewSession={handleNewSession}
              onCloseSession={handleCloseTab}
              claudeViewMode={activeSession.toolType === 'claude' ? claudeViewMode : undefined}
              onClaudeViewModeChange={activeSession.toolType === 'claude' ? handleClaudeViewModeChange : undefined}
            />
          )
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 12, color: token.colorTextQuaternary, height: '100%',
          }}>
            <MessageOutlined style={{ fontSize: 36 }} />
            <Text style={{ color: token.colorTextQuaternary, fontSize: 13 }}>
              {t('coding.emptyPlaceholder')}
            </Text>
          </div>
        )}
      </div>
    </div>
  )
}

export default TabGroup
