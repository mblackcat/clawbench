import React, { useEffect, useRef, useState, useCallback } from 'react'
import { theme } from 'antd'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import { useT } from '../../i18n'
import AITerminalSidebar from './AITerminalSidebar'
import TerminalTabBar from './TerminalTabBar'
import TerminalPanel from './TerminalPanel'
import QuickBar from './QuickBar'
import AIAssistantPanel from './AIAssistantPanel'
import EditConnectionModal from './EditConnectionModal'
import EditQuickCommandModal from './EditQuickCommandModal'
import EditDBConnectionModal from './EditDBConnectionModal'
import DBContentPanel from './DBContentPanel'
import type { TerminalConnection, QuickCommand, DBConnection } from '../../types/ai-terminal'

const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 400
const DEFAULT_SIDEBAR_WIDTH = 240
const COLLAPSED_SIDEBAR_WIDTH = 44

const AITerminalPage: React.FC = () => {
  const { token } = theme.useToken()
  const t = useT()
  const {
    openTabs, activeTabId, sideMode, openDBTabs,
    fetchQuickCommands, syncSSHConfig, fetchDBConnections, initListeners
  } = useAITerminalStore()

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [editingConnection, setEditingConnection] = useState<TerminalConnection | null>(null)
  const [showConnectionModal, setShowConnectionModal] = useState(false)
  const [editingQuickCmd, setEditingQuickCmd] = useState<QuickCommand | null>(null)
  const [showQuickCmdModal, setShowQuickCmdModal] = useState(false)
  const [editingDBConnection, setEditingDBConnection] = useState<DBConnection | null>(null)
  const [showDBConnectionModal, setShowDBConnectionModal] = useState(false)
  const resizingRef = useRef(false)

  useEffect(() => {
    syncSSHConfig()
    fetchQuickCommands()
    fetchDBConnections()
    const cleanup = initListeners()
    return cleanup
  }, [])

  // Sidebar resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    const startX = e.clientX
    const startWidth = sidebarWidth

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = ev.clientX - startX
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth + delta))
      setSidebarWidth(newWidth)
    }

    const onMouseUp = () => {
      resizingRef.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  const handleNewConnection = useCallback(() => {
    setEditingConnection(null)
    setShowConnectionModal(true)
  }, [])

  const handleEditConnection = useCallback((conn: TerminalConnection) => {
    setEditingConnection(conn)
    setShowConnectionModal(true)
  }, [])

  const handleNewQuickCommand = useCallback(() => {
    setEditingQuickCmd(null)
    setShowQuickCmdModal(true)
  }, [])

  const handleEditQuickCommand = useCallback((cmd: QuickCommand) => {
    setEditingQuickCmd(cmd)
    setShowQuickCmdModal(true)
  }, [])

  const handleNewDBConnection = useCallback(() => {
    setEditingDBConnection(null)
    setShowDBConnectionModal(true)
  }, [])

  const handleEditDBConnection = useCallback((conn: DBConnection) => {
    setEditingDBConnection(conn)
    setShowDBConnectionModal(true)
  }, [])

  // Determine what to show in right panel
  const showTerminalContent = sideMode === 'terminal' && openTabs.length > 0
  const showDBContent = sideMode === 'db' && openDBTabs.length > 0
  const hasContent = showTerminalContent || showDBContent

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left sidebar */}
      <div style={{
        width: sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth,
        minWidth: sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : MIN_SIDEBAR_WIDTH,
        position: 'relative',
        flexShrink: 0,
        transition: 'width 0.2s ease, min-width 0.2s ease',
        borderRight: `1px solid ${token.colorBorderSecondary}`
      }}>
        <AITerminalSidebar
          onNewConnection={handleNewConnection}
          onEditConnection={handleEditConnection}
          onNewDBConnection={handleNewDBConnection}
          onEditDBConnection={handleEditDBConnection}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />
        {/* Resize handle */}
        {!sidebarCollapsed && (
        <div
          onMouseDown={handleResizeStart}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 4,
            cursor: 'col-resize',
            zIndex: 10
          }}
        />
        )}
      </div>

      {/* Right content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {showTerminalContent ? (
          <>
            <TerminalTabBar />
            <QuickBar
              onNew={handleNewQuickCommand}
              onEdit={handleEditQuickCommand}
            />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                {activeTabId && <TerminalPanel key={activeTabId} sessionId={activeTabId} />}
              </div>
              <AIAssistantPanel />
            </div>
          </>
        ) : showDBContent ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <DBContentPanel />
            <AIAssistantPanel />
          </div>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: token.colorTextTertiary,
            fontSize: 14
          }}>
            {sideMode === 'terminal'
              ? t('terminal.emptyTerminal')
              : t('terminal.emptyDB')}
          </div>
        )}
      </div>

      {/* Modals */}
      <EditConnectionModal
        open={showConnectionModal}
        connection={editingConnection}
        onClose={() => setShowConnectionModal(false)}
      />
      <EditQuickCommandModal
        open={showQuickCmdModal}
        command={editingQuickCmd}
        onClose={() => setShowQuickCmdModal(false)}
      />
      <EditDBConnectionModal
        open={showDBConnectionModal}
        connection={editingDBConnection}
        onClose={() => setShowDBConnectionModal(false)}
      />
    </div>
  )
}

export default AITerminalPage
