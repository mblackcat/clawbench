/**
 * AI Coding 模块入口（canonical: `aiCoding` / 路由 `/ai-coding`）
 * 子概念：chat bubble & tui —— Claude Code / Codex / Gemini 编程会话。
 * 注意：本模块旧名为 "AIWorkbench"，与资源中心 Workbench(`/workbench`) 无关。
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { Spin, App, theme, Typography } from 'antd'
import { MessageOutlined } from '@ant-design/icons'
import { useLocation } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import AICodingSidebar from './AICodingSidebar'
import SplitContainer from './SplitContainer'
import VcsChangesPanel from './VcsChangesPanel'
import AICodingNewWorkspaceDialog from './AICodingNewWorkspaceDialog'
import AICodingNewSessionDialog from './AICodingNewSessionDialog'
import WorkspaceLandingPanel from './WorkspaceLandingPanel'
import PaneTabBar from './PaneTabBar'
import { useT } from '../../i18n'
import { useAICodingStore } from '../../stores/useAICodingStore'
import { findLeafBySessionId, collectLeaves } from '../../types/split-layout'
import type { AIToolType } from '../../types/ai-coding'

const { Text } = Typography

/** Tab callbacks the landing toolbar has no tabs for. */

const AICodingPage: React.FC = () => {
  const t = useT()
  const { message } = App.useApp()
  const { token } = theme.useToken()
  // Explicit slices: a full-store subscription here re-rendered the entire
  // pane/split tree — and therefore every mounted terminal — on each streaming
  // token, since streaming state lives in the same store.
  const sessions = useAICodingStore((s) => s.sessions)
  const groups = useAICodingStore((s) => s.groups)
  const loading = useAICodingStore((s) => s.loading)
  const activeSessionId = useAICodingStore((s) => s.activeSessionId)
  const focusedPaneId = useAICodingStore((s) => s.focusedPaneId)
  // Actions are stable references, so this bag never triggers a re-render.
  const {
    setActiveSession,
    fetchAll,
    getOrCreateLayout,
    addTabToPane,
    createSession,
    setPaneActiveTab,
    removeTabFromPane,
    stopSession,
  } = useAICodingStore(useShallow((s) => ({
    setActiveSession: s.setActiveSession,
    fetchAll: s.fetchAll,
    getOrCreateLayout: s.getOrCreateLayout,
    addTabToPane: s.addTabToPane,
    createSession: s.createSession,
    setPaneActiveTab: s.setPaneActiveTab,
    removeTabFromPane: s.removeTabFromPane,
    stopSession: s.stopSession,
  })))

  const activeSession = useMemo(
    () => sessions.find(s => s.id === activeSessionId),
    [sessions, activeSessionId]
  )

  // Dialog state
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [newSessionWorkspaceId, setNewSessionWorkspaceId] = useState<string | null>(null)

  // Workspace whose landing view (quick start / terminal / changes) is shown.
  // Set by clicking a workspace title; cleared by picking a session tab.
  const [landingWorkspaceId, setLandingWorkspaceId] = useState<string | null>(null)

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

  // Every open tab across all panes (skipping tabs whose session is gone),
  // listed in the landing view's tab bar so the user can switch back.
  const openTabs = useMemo(() => {
    if (!layout) return []
    const byId = new Map(sessions.map((s) => [s.id, s]))
    return collectLeaves(layout).flatMap((leaf) =>
      leaf.tabIds.flatMap((id) => {
        const session = byId.get(id)
        return session ? [session] : []
      })
    )
  }, [layout, sessions])
  const landingWorkspace = useMemo(
    () => workspaces.find((w) => w.id === landingWorkspaceId) || null,
    [workspaces, landingWorkspaceId]
  )
  // The landing view takes over the right side whenever a workspace title was
  // clicked, open sessions or not; the panes stay mounted underneath.
  const showLanding = !!landingWorkspace

  // The Changes panel follows the landing workspace while it is shown,
  // otherwise the active session's workspace.
  const vcsPanelWorkingDir = landingWorkspace
    ? landingWorkspace.workingDir
    : activeSessionId
      ? activeWorkingDir
      : ''

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
    setLandingWorkspaceId(null)
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

  /** Create a session and open it as a tab in the focused (or first) pane. */
  const openSessionInPane = useCallback(
    async (workspaceId: string, toolType: AIToolType) => {
      try {
        const session = await createSession(workspaceId, toolType, 'local')
        setLandingWorkspaceId(null)
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
    [createSession, getOrCreateLayout, focusedPaneId, addTabToPane, setActiveSession, message, t]
  )

  const handleCreateSession = useCallback(
    async (toolType: AIToolType) => {
      if (!newSessionWorkspaceId) return
      setNewSessionOpen(false)
      await openSessionInPane(newSessionWorkspaceId, toolType)
    },
    [newSessionWorkspaceId, openSessionInPane]
  )

  // Sidebar workspace title click — show that workspace's landing view.
  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    setLandingWorkspaceId(workspaceId)
  }, [])

  // Tab picked from the landing view's tab bar: leave the landing view and
  // bring that tab forward in the pane that holds it.
  const handleLandingSelectTab = useCallback((sessionId: string) => {
    const leaf = findLeafBySessionId(getOrCreateLayout(), sessionId)
    setLandingWorkspaceId(null)
    if (leaf) setPaneActiveTab(leaf.id, sessionId)
    else setActiveSession(sessionId)
  }, [getOrCreateLayout, setPaneActiveTab, setActiveSession])

  const handleLandingCloseTab = useCallback(async (sessionId: string) => {
    const leaf = findLeafBySessionId(getOrCreateLayout(), sessionId)
    if (leaf) removeTabFromPane(leaf.id, sessionId)
    // Same as closing a tab in its pane: stop the process, keep the record.
    try { await stopSession(sessionId) } catch { /* already stopped */ }
  }, [getOrCreateLayout, removeTabFromPane, stopSession])

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
        onSelectWorkspace={handleSelectWorkspace}
      />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {showLanding && landingWorkspace && (
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 1,
              display: 'flex', flexDirection: 'column', minHeight: 0,
              background: token.colorBgContainer
            }}
          >
            {/* The landing view stands in for a pane, so it keeps the pane's
                toolbar — same Terminal / Changes entries on the right, now
                scoped to the clicked workspace instead of an active session. */}
            <PaneTabBar
              paneId="landing"
              tabs={openTabs}
              activeTabId={null}
              workingDir={landingWorkspace.workingDir}
              onSelectTab={handleLandingSelectTab}
              onCloseTab={handleLandingCloseTab}
              onNewSession={() => handleNewSession(landingWorkspace.id)}
              onToggleTerminalPanel={() => openSessionInPane(landingWorkspace.id, 'terminal')}
              gitPanelOpen={vcsPanelOpen}
              onToggleGitPanel={toggleVcsPanel}
            />
            <WorkspaceLandingPanel
              workspace={landingWorkspace}
              onOpenSession={(toolType) => openSessionInPane(landingWorkspace.id, toolType)}
              onNewSession={() => handleNewSession(landingWorkspace.id)}
              onOpenTerminal={() => openSessionInPane(landingWorkspace.id, 'terminal')}
              onToggleChanges={toggleVcsPanel}
              changesOpen={vcsPanelOpen}
            />
          </div>
        )}
        {layout ? (
          // Kept mounted and laid out under the landing view (visibility, not
          // display:none) so terminals keep their size, PTYs see no resize, and
          // chats keep their scroll position for when a tab is picked.
          <div style={{ flex: 1, minHeight: 0, minWidth: 0, width: '100%', height: '100%', visibility: showLanding ? 'hidden' : undefined }}>
            <SplitContainer
              layout={layout}
              gitPanelOpen={vcsPanelOpen}
              onToggleGitPanel={toggleVcsPanel}
            />
          </div>
        ) : !showLanding && (
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
      {vcsPanelWorkingDir && (
        <VcsChangesPanel
          workingDir={vcsPanelWorkingDir}
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
