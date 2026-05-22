import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react'
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
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null)

  const anchorItems = useMemo(() => {
    const items = messages.map((msg) => ({
      id: msg.messageId,
      role: msg.role,
    }))

    if (streaming) {
      items.push({ id: 'streaming', role: 'assistant' })
    }

    return items
  }, [messages, streaming])

  const activeAnchorIndex = useMemo(() => {
    return anchorItems.findIndex((item) => item.id === activeAnchorId)
  }, [activeAnchorId, anchorItems])

  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const messageEls = Array.from(
      container.querySelectorAll<HTMLElement>('[data-chat-message="true"]')
    )
    if (messageEls.length === 0) return

    const activeEl = messageEls.reduce((current, el) => {
      return el.offsetTop <= container.scrollTop + 64 ? el : current
    }, messageEls[0])

    setActiveAnchorId(activeEl.dataset.messageId || null)
  }, [])

  const scrollToMessage = useCallback((messageId: string) => {
    const target = document.getElementById(`chat-message-${messageId}`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveAnchorId(messageId)
  }, [])

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }

    const lastItem = anchorItems[anchorItems.length - 1]
    if (lastItem) {
      setActiveAnchorId(lastItem.id)
    }
  }, [messages, streamingContent, streamingThinkingContent, streamingError, pendingToolCalls, agentPhase, agentToolHistory, anchorItems])

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
    <div className="chat-message-list-shell">
      <div
        ref={containerRef}
        className="chat-message-list-scroll"
        onScroll={handleScroll}
      >
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
      {anchorItems.length > 0 && (
        <div className="chat-anchor-rail" aria-label="Message anchors">
          <div className="chat-anchor-dots">
            {anchorItems.map((item, index) => {
              const distance = activeAnchorIndex >= 0 ? Math.abs(index - activeAnchorIndex) : 0
              const rangeClass = distance === 0
                ? ' is-active'
                : distance <= 2
                  ? ` is-near-${distance}`
                  : ' is-muted'

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`chat-anchor-dot${rangeClass}`}
                  style={{
                    background: item.role === 'user' ? token.colorPrimary : token.colorSuccess,
                    borderColor: item.id === activeAnchorId ? token.colorText : 'transparent',
                  }}
                  aria-label={`${item.role} message ${index + 1}`}
                  onClick={() => scrollToMessage(item.id)}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default ChatMessageList
