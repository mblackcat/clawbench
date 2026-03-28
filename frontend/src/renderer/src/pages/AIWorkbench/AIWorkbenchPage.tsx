import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { Spin, App, theme, Typography } from 'antd'
import { MessageOutlined } from '@ant-design/icons'
import AIWorkbenchSidebar from './AIWorkbenchSidebar'
import SplitContainer from './SplitContainer'
import GitChangesPanel from './GitChangesPanel'
import AIWorkbenchNewWorkspaceDialog from './AIWorkbenchNewWorkspaceDialog'
import AIWorkbenchNewSessionDialog from './AIWorkbenchNewSessionDialog'
import { useT } from '../../i18n'
import { useAIWorkbenchStore } from '../../stores/useAIWorkbenchStore'
import { findLeafBySessionId, collectLeaves } from '../../types/split-layout'
import type { AIToolType } from '../../types/ai-workbench'

const { Text } = Typography

const AIWorkbenchPage: React.FC = () => {
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
  } = useAIWorkbenchStore()

  const activeSession = useMemo(
    () => sessions.find(s => s.id === activeSessionId),
    [sessions, activeSessionId]
  )

  // Dialog state
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [newSessionWorkspaceId, setNewSessionWorkspaceId] = useState<string | null>(null)

  // Git panel state (persisted in localStorage)
  const [gitPanelOpen, setGitPanelOpen] = useState(
    () => localStorage.getItem('cb-workbench-git-panel') === 'true'
  )

  const toggleGitPanel = useCallback(() => {
    setGitPanelOpen((prev) => {
      const next = !prev
      localStorage.setItem('cb-workbench-git-panel', String(next))
      return next
    })
  }, [])

  // Get the working dir for the active session's workspace
  const workspaces = useAIWorkbenchStore((s) => s.workspaces)
  const activeWorkingDir = useMemo(() => {
    if (!activeSession) return ''
    const ws = workspaces.find((w) => w.id === activeSession.workspaceId)
    return ws?.workingDir || ''
  }, [activeSession, workspaces])

  // Global layout (not per-workspace)
  const globalLayout = useAIWorkbenchStore((s) => s.globalLayout)
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

  // New workspace flow
  const handleNewWorkspace = useCallback(() => {
    setNewWorkspaceOpen(true)
  }, [])

  const handleCreateWorkspace = useCallback(
    async (workingDir: string, groupId: string) => {
      try {
        await window.api.aiWorkbench.createWorkspace(workingDir, groupId)
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
        const session = await window.api.aiWorkbench.createSession(
          newSessionWorkspaceId, toolType, 'local'
        )
        setNewSessionOpen(false)
        await fetchAll()
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
    [newSessionWorkspaceId, fetchAll, message, setActiveSession, t, getOrCreateLayout, focusedPaneId, addTabToPane]
  )

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <Spin />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <AIWorkbenchSidebar
        onNewWorkspace={handleNewWorkspace}
        onNewSession={handleNewSession}
        onSelectSession={handleSelectSession}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {layout ? (
          <SplitContainer
            layout={layout}
            gitPanelOpen={gitPanelOpen}
            onToggleGitPanel={toggleGitPanel}
          />
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

      {/* Git changes right panel */}
      {activeSessionId && activeWorkingDir && (
        <GitChangesPanel
          workingDir={activeWorkingDir}
          visible={gitPanelOpen}
        />
      )}

      <AIWorkbenchNewWorkspaceDialog
        open={newWorkspaceOpen}
        groups={groups}
        defaultGroupId={defaultGroupId}
        onOk={handleCreateWorkspace}
        onCancel={() => setNewWorkspaceOpen(false)}
      />

      <AIWorkbenchNewSessionDialog
        open={newSessionOpen}
        onOk={handleCreateSession}
        onCancel={() => setNewSessionOpen(false)}
      />
    </div>
  )
}

export default AIWorkbenchPage
