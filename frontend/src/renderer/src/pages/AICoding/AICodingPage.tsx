/**
 * AI Coding 模块入口（canonical: `aiCoding` / 路由 `/ai-coding`）
 * 子概念：chat bubble & tui —— Claude Code / Codex / Gemini 编程会话。
 * 注意：本模块旧名为 "AIWorkbench"，与资源中心 Workbench(`/workbench`) 无关。
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { Spin, App, theme, Typography } from 'antd'
import { MessageOutlined } from '@ant-design/icons'
import { useLocation } from 'react-router-dom'
import AICodingSidebar from './AICodingSidebar'
import SplitContainer from './SplitContainer'
import VcsChangesPanel from './VcsChangesPanel'
import AICodingNewWorkspaceDialog from './AICodingNewWorkspaceDialog'
import AICodingNewSessionDialog from './AICodingNewSessionDialog'
import { useT } from '../../i18n'
import { useAICodingStore } from '../../stores/useAICodingStore'
import { findLeafBySessionId, collectLeaves } from '../../types/split-layout'
import type { AIToolType } from '../../types/ai-coding'

const { Text } = Typography

const AICodingPage: React.FC = () => {
  const t = useT()
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const {
    sessions,
    groups,
    loading,
    activeSessionId,
    setActiveSession,
    fetchAll,
    getOrCreateLayout,
    addTabToPane,
    focusedPaneId,
    createSession,
  } = useAICodingStore()

  const activeSession = useMemo(
    () => sessions.find(s => s.id === activeSessionId),
    [sessions, activeSessionId]
  )

  // Dialog state
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [newSessionWorkspaceId, setNewSessionWorkspaceId] = useState<string | null>(null)

  // VCS panel state (persisted in localStorage)
  const [vcsPanelOpen, setVcsPanelOpen] = useState(
    () => localStorage.getItem('cb-workbench-vcs-panel') === 'true' || localStorage.getItem('cb-workbench-git-panel') === 'true'
  )

  const toggleVcsPanel = useCallback(() => {
    setVcsPanelOpen((prev) => {
      const next = !prev
      localStorage.setItem('cb-workbench-vcs-panel', String(next))
      return next
    })
  }, [])

  // Get the working dir for the active session's workspace
  const workspaces = useAICodingStore((s) => s.workspaces)
  const activeWorkingDir = useMemo(() => {
    if (!activeSession) return ''
    const ws = workspaces.find((w) => w.id === activeSession.workspaceId)
    return ws?.workingDir || ''
  }, [activeSession, workspaces])

  // Global layout (not per-workspace)
  const globalLayout = useAICodingStore((s) => s.globalLayout)
  const layout = useMemo(() => {
    return getOrCreateLayout()
  }, [globalLayout, getOrCreateLayout])

  const defaultGroupId = useMemo(
    () => groups.find((g) => g.isDefault)?.id || 'default',
    [groups]
  )

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // After route re-entry, flex + Allotment + xterm may measure against a
  // transient container size. Kick a couple of layout passes once paint settles
  // so panes and terminals pick up the real width without a manual window resize.
  useEffect(() => {
    const forceLayout = (): void => {
      window.dispatchEvent(new Event('resize'))
    }
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(forceLayout)
    })
    const t1 = window.setTimeout(forceLayout, 50)
    const t2 = window.setTimeout(forceLayout, 200)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])

  // Handle session selection from sidebar
  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSession(sessionId)
    // Ensure the session is in a pane
    const currentLayout = getOrCreateLayout()
    const existingLeaf = findLeafBySessionId(currentLayout, sessionId)
    if (!existingLeaf) {
      const targetPaneId = focusedPaneId || collectLeaves(currentLayout)[0]?.id
      if (targetPaneId) {
        addTabToPane(targetPaneId, sessionId)
      }
    }
  }, [setActiveSession, getOrCreateLayout, focusedPaneId, addTabToPane])

  // Auto-select session passed via navigation state (e.g. from workbench "AI Code" button)
  const location = useLocation()
  const pendingSessionId = (location.state as { selectSessionId?: string } | null)?.selectSessionId

  useEffect(() => {
    if (!pendingSessionId || loading) return
    const exists = sessions.some(s => s.id === pendingSessionId)
    if (exists) {
      handleSelectSession(pendingSessionId)
      // Clear state to prevent re-trigger on back-navigation
      window.history.replaceState({}, '')
    }
  }, [pendingSessionId, loading, sessions, handleSelectSession])

  // New workspace flow
  const handleNewWorkspace = useCallback(() => {
    setNewWorkspaceOpen(true)
  }, [])

  const handleCreateWorkspace = useCallback(
    async (workingDir: string, groupId: string) => {
      try {
        await window.api.aiCoding.createWorkspace(workingDir, groupId)
        setNewWorkspaceOpen(false)
        await fetchAll()
      } catch {
        message.error(t('coding.createWorkspaceFailed'))
      }
    },
    [fetchAll, message]
  )

  // New session flow (from sidebar)
  const handleNewSession = useCallback((workspaceId: string) => {
    setNewSessionWorkspaceId(workspaceId)
    setNewSessionOpen(true)
  }, [])

  const handleCreateSession = useCallback(
    async (toolType: AIToolType) => {
      if (!newSessionWorkspaceId) return
      try {
        const session = await createSession(newSessionWorkspaceId, toolType, 'local')
        setNewSessionOpen(false)
        // Add to focused pane
        const currentLayout = getOrCreateLayout()
        const targetPaneId = focusedPaneId || collectLeaves(currentLayout)[0]?.id
        if (targetPaneId) {
          addTabToPane(targetPaneId, session.id)
        }
        setActiveSession(session.id)
      } catch {
        message.error(t('coding.createSessionFailed'))
      }
    },
    [newSessionWorkspaceId, createSession, message, setActiveSession, t, getOrCreateLayout, focusedPaneId, addTabToPane]
  )

  if (loading) {
    return (
      <div style={{ display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%' }}>
        <Spin />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0, width: '100%', height: '100%', overflow: 'hidden' }}>
      <AICodingSidebar
        onNewWorkspace={handleNewWorkspace}
        onNewSession={handleNewSession}
        onSelectSession={handleSelectSession}
      />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {layout ? (
          <div style={{ flex: 1, minHeight: 0, minWidth: 0, width: '100%', height: '100%' }}>
            <SplitContainer
              layout={layout}
              gitPanelOpen={vcsPanelOpen}
              onToggleGitPanel={toggleVcsPanel}
            />
          </div>
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 12, color: token.colorTextQuaternary
          }}>
            <MessageOutlined style={{ fontSize: 48 }} />
            <Text style={{ color: token.colorTextQuaternary, fontSize: 14 }}>
              {t('coding.emptyPlaceholder')}
            </Text>
          </div>
        )}
      </div>

      {/* VCS changes right panel */}
      {activeSessionId && activeWorkingDir && (
        <VcsChangesPanel
          workingDir={activeWorkingDir}
          visible={vcsPanelOpen}
        />
      )}

      <AICodingNewWorkspaceDialog
        open={newWorkspaceOpen}
        groups={groups}
        defaultGroupId={defaultGroupId}
        onOk={handleCreateWorkspace}
        onCancel={() => setNewWorkspaceOpen(false)}
      />

      <AICodingNewSessionDialog
        open={newSessionOpen}
        onOk={handleCreateSession}
        onCancel={() => setNewSessionOpen(false)}
      />
    </div>
  )
}

export default AICodingPage
