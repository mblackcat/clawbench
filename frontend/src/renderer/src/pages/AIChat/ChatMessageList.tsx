import React, { useRef, useEffect } from 'react'
import { Empty, Alert, theme } from 'antd'
import { MessageOutlined } from '@ant-design/icons'
import ChatMessage from './ChatMessage'
import AgentStatusBar from './AgentStatusBar'
import { useChatStore } from '../../stores/useChatStore'
import { useT } from '../../i18n'

const ChatMessageList: React.FC = () => {
  const t = useT()
  const { messages, streaming, streamingContent, streamingThinkingContent, streamingError, pendingToolCalls, agentPhase, agentToolHistory } = useChatStore()
  const { token } = theme.useToken()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [messages, streamingContent, streamingThinkingContent, streamingError, pendingToolCalls, agentPhase, agentToolHistory])

  if (messages.length === 0 && !streaming && !streamingError && pendingToolCalls.length === 0 && agentPhase === 'idle') {
    return (
      <div ref={containerRef} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty
          image={<MessageOutlined style={{ fontSize: 48, color: token.colorTextDisabled }} />}
          description={t('chat.startNewChat')}
        />
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 0' }}>
      {messages.map(msg => (
        <ChatMessage key={msg.messageId} message={msg} />
      ))}
      {streaming && (
        <ChatMessage
          message={{
            messageId: 'streaming',
            conversationId: '',
            role: 'assistant',
            content: streamingContent || '',
            modelId: null,
            thinkingContent: streamingThinkingContent || undefined,
            createdAt: Date.now(),
          }}
          isStreaming
        />
      )}
      {/* Agent status bar — shows phase, pending tool calls, and tool history */}
      <AgentStatusBar />
      {streamingError && (
        <div style={{ padding: '8px 16px' }}>
          <Alert
            type="error"
            showIcon
            message={t('chat.requestFailed')}
            description={streamingError}
            closable
            onClose={() => useChatStore.setState({ streamingError: null })}
          />
        </div>
      )}
    </div>
  )
}

export default ChatMessageList
