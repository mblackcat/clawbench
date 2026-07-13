import React, { useEffect, useState } from 'react'
import ChatSidebar from './ChatSidebar'
import ChatArea from './ChatArea'
import WelcomeChatView from './WelcomeChatView'
import ScheduledTaskView from './ScheduledTaskView'
import { useAIModelStore } from '../../stores/useAIModelStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useChatStore } from '../../stores/useChatStore'
import { useScheduledTaskStore } from '../../stores/useScheduledTaskStore'
import './chat-styles.css'

const AIChatPage: React.FC = () => {
  const { fetchBuiltinModels, fetchLocalModels, initializeSelectedModel } = useAIModelStore()
  const theme = useSettingsStore((state) => state.theme)
  const activeConversationId = useChatStore((state) => state.activeConversationId)
  const messages = useChatStore((state) => state.messages)
  const conversations = useChatStore((state) => state.conversations)
  const favConversations = useChatStore((state) => state.favConversations)
  const { fetchConversations, fetchFavConversations } = useChatStore()
  const [conversationsLoaded, setConversationsLoaded] = useState(false)

  useEffect(() => {
    Promise.all([fetchBuiltinModels(), fetchLocalModels()]).then(() => {
      initializeSelectedModel()
    })
  }, [fetchBuiltinModels, fetchLocalModels, initializeSelectedModel])

  useEffect(() => {
    Promise.all([fetchConversations(), fetchFavConversations()]).finally(() => {
      setConversationsLoaded(true)
    })
  }, [fetchConversations, fetchFavConversations])

  // Listen for scheduled task execution results and refresh task list
  useEffect(() => {
    const unsubscribe = window.api.scheduledTask.onExecuted((data) => {
      // Refresh task list to show updated lastRunAt / nextRunAt
      useScheduledTaskStore.getState().fetchTasks()
      // Surface the AI result as a chat message pair (user prompt + assistant
      // answer) so scheduled tasks actually produce visible output.
      useChatStore.getState().appendScheduledResult({
        taskId: data.taskId,
        taskName: data.taskName,
        status: data.status,
        result: data.result,
        prompt: data.prompt,
        keepInOneChat: data.keepInOneChat,
        conversationId: data.conversationId,
        modelId: data.modelId
      })
      // Refresh conversations in case a new one was created
      fetchConversations()
    })
    return unsubscribe
  }, [fetchConversations])

  const mainView = useScheduledTaskStore((s) => s.mainView)

  const hasHistory = conversations.length > 0 || favConversations.length > 0
  const showWelcome = conversationsLoaded && !activeConversationId && messages.length === 0 && !hasHistory

  return (
    <div data-theme={theme} style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {showWelcome && mainView !== 'task' ? (
        <WelcomeChatView />
      ) : (
        <>
          <ChatSidebar />
          {mainView === 'task' ? (
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <ScheduledTaskView />
            </div>
          ) : (
            <ChatArea />
          )}
        </>
      )}
    </div>
  )
}

export default AIChatPage
