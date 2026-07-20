import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAttentionStore } from '../stores/useAttentionStore'
import { useChatStore } from '../stores/useChatStore'
import { useAICodingStore } from '../stores/useAICodingStore'

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

  // Register navigation handler for openFirst / tray activate
  useEffect(() => {
    useAttentionStore.getState().setNavigateHandler((item) => {
      if (item.source === 'workbench') {
        navigate('/workbench/installed')
        return
      }
      if (item.source === 'ai-chat') {
        navigate('/ai-chat')
        if (item.targetId) {
          void useChatStore.getState().selectConversation(item.targetId)
        }
        return
      }
      if (item.source === 'ai-coding') {
        navigate('/ai-coding')
        if (item.targetId) {
          useAICodingStore.getState().setActiveSession(item.targetId)
        }
      }
    })
    return () => {
      useAttentionStore.getState().setNavigateHandler(null)
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
