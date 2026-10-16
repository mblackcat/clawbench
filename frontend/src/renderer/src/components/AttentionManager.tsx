import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAttentionStore } from '../stores/useAttentionStore'
import { useChatStore } from '../stores/useChatStore'
import { useAICodingStore } from '../stores/useAICodingStore'
import { findLeafBySessionId } from '../types/split-layout'

/** Select an AI Coding session and bring its tab/pane to the front. */
function focusCodingSession(sessionId: string): void {
  const codingState = useAICodingStore.getState()
  codingState.setActiveSession(sessionId)
  const leaf = findLeafBySessionId(codingState.getOrCreateLayout(), sessionId)
  if (leaf) {
    codingState.setPaneActiveTab(leaf.id, sessionId)
    codingState.setFocusedPane(leaf.id)
  }
}

/**
 * Keeps attention context in sync with route/session selection,
 * handles tray → open-first navigation, and registers the navigator.
 */
const AttentionManager: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()

  const activeChatId = useChatStore((s) => s.activeConversationId)
  const activeCodingId = useAICodingStore((s) => s.activeSessionId)

  // Sync viewing context
  useEffect(() => {
    useAttentionStore.getState().setContext({
      pathname: location.pathname,
      activeChatId,
      activeCodingId
    })
  }, [location.pathname, activeChatId, activeCodingId])

  // Register navigation handler for openFirst / tray activate / tray menu items
  useEffect(() => {
    const goTo = (target: { source: string; targetId?: string }): void => {
      if (target.source === 'workbench') {
        navigate('/workbench/installed')
        return
      }
      if (target.source === 'ai-chat') {
        navigate('/ai-chat')
        if (target.targetId) {
          void useChatStore.getState().selectConversation(target.targetId)
        }
        return
      }
      if (target.source === 'ai-coding') {
        navigate('/ai-coding')
        if (target.targetId) focusCodingSession(target.targetId)
      }
    }
    useAttentionStore.getState().setNavigateHandler(goTo)
    const unsubNavigateTo = window.api.attention?.onNavigateTo?.(goTo)
    return () => {
      useAttentionStore.getState().setNavigateHandler(null)
      unsubNavigateTo?.()
    }
  }, [navigate])

  // Tray left-click → open first attention
  useEffect(() => {
    const unsub = window.api.attention?.onActivateFirst?.(() => {
      useAttentionStore.getState().openFirst()
    })
    return () => {
      unsub?.()
    }
  }, [])

  return null
}

export default AttentionManager
