import React, { useRef, useEffect, useCallback } from 'react'
import { theme, Spin, Typography } from 'antd'
import { RobotOutlined, MessageOutlined, CheckCircleFilled, CloseCircleFilled, ToolOutlined, DashboardOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeHighlightPlugin } from '../../utils/markdown-plugins'
import WorkbenchChatMessage, { getToolSummary } from './WorkbenchChatMessage'
import AskUserQuestionBlock from './AskUserQuestionBlock'
import TodoUpdateBlock from './TodoUpdateBlock'
import { useT } from '../../i18n'
import type { WorkbenchMessage, WorkbenchContentBlock } from '../../types/ai-workbench'
import { externalLinkMarkdownComponents } from '../../utils/markdown-links'
import '../AIChat/chat-styles.css'

const { Text } = Typography
const AUTO_SCROLL_THRESHOLD = 80

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= AUTO_SCROLL_THRESHOLD
}

interface WorkbenchMessageListProps {
  messages: WorkbenchMessage[]
  isStreaming: boolean
  streamingBlocks: WorkbenchContentBlock[]
  hasExistingSession?: boolean
  sessionId?: string
}

const WorkbenchMessageList: React.FC<WorkbenchMessageListProps> = ({
  messages, isStreaming, streamingBlocks, hasExistingSession, sessionId
}) => {
  const { token } = theme.useToken()
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const thinkingRef = useRef<HTMLDivElement>(null)
  const suppressNextAutoScrollRef = useRef(false)
  const restoreScrollTopRef = useRef<number | null>(null)
  const restoreScrollTimeoutRef = useRef<number | null>(null)
  const stickToBottomRef = useRef(true)
  const lastMessageIdRef = useRef<string | null>(null)
  const lastSessionIdRef = useRef<string | undefined>(sessionId)

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el || suppressNextAutoScrollRef.current) return
    stickToBottomRef.current = isNearBottom(el)
  }, [])

  const handleToolToggle = useCallback(() => {
    const el = containerRef.current
    if (!el) return

    suppressNextAutoScrollRef.current = true
    restoreScrollTopRef.current = el.scrollTop

    if (restoreScrollTimeoutRef.current !== null) {
      window.clearTimeout(restoreScrollTimeoutRef.current)
    }

    const restoreScrollTop = () => {
      const target = restoreScrollTopRef.current
      if (target !== null && containerRef.current) {
        containerRef.current.scrollTop = target
      }
    }

    restoreScrollTop()
    requestAnimationFrame(() => {
      restoreScrollTop()
      requestAnimationFrame(restoreScrollTop)
    })

    restoreScrollTimeoutRef.current = window.setTimeout(() => {
      restoreScrollTop()
      restoreScrollTopRef.current = null
      suppressNextAutoScrollRef.current = false
      restoreScrollTimeoutRef.current = null
    }, 220)
  }, [])

  useEffect(() => {
    if (lastSessionIdRef.current === sessionId) return
    lastSessionIdRef.current = sessionId
    lastMessageIdRef.current = null
    stickToBottomRef.current = true

    requestAnimationFrame(() => {
      const el = containerRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [sessionId])

  // Follow streaming only while the user is already near the bottom.
  useEffect(() => {
    const el = containerRef.current
    const lastMessage = messages[messages.length - 1]
    const lastMessageId = lastMessage?.id ?? null
    const isFirstRender = lastMessageIdRef.current === null
    const isNewMessage = !!lastMessageId && lastMessageId !== lastMessageIdRef.current
    const isNewUserMessage = isNewMessage && lastMessage?.role === 'user'

    if (el) {
      if (suppressNextAutoScrollRef.current) {
        const target = restoreScrollTopRef.current
        if (target !== null) el.scrollTop = target
      } else if (stickToBottomRef.current || isNewUserMessage || isFirstRender) {
        el.scrollTop = el.scrollHeight
        stickToBottomRef.current = true
      }
    }
    lastMessageIdRef.current = lastMessageId

    if (thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight
    }
  }, [messages, streamingBlocks, isStreaming])

  useEffect(() => {
    return () => {
      if (restoreScrollTimeoutRef.current !== null) {
        window.clearTimeout(restoreScrollTimeoutRef.current)
      }
    }
  }, [])

  if (messages.length === 0 && !isStreaming) {
    return (
      <div ref={containerRef} style={{
        flex: 1, overflow: 'auto',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12, color: token.colorTextQuaternary
      }}>
        <MessageOutlined style={{ fontSize: 40 }} />
        <Text style={{ color: token.colorTextQuaternary }}>
          {hasExistingSession ? t('coding.resumeConversation') : t('coding.startConversation')}
        </Text>
      </div>
    )
  }

  // Build tool_result map for streaming blocks
  const streamResultMap = new Map<string, { content: string; isError?: boolean }>()
  for (const b of streamingBlocks) {
    if (b.type === 'tool_result') {
      streamResultMap.set(b.toolUseId, { content: b.content, isError: b.isError })
    }
  }
  const streamPairedIds = new Set<string>()

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{ flex: 1, overflow: 'auto', paddingTop: 8, paddingBottom: 8, overflowAnchor: 'none' }}
    >
      {messages.map((msg) => (
        <WorkbenchChatMessage key={msg.id} message={msg} onToolToggle={handleToolToggle} />
      ))}

      {/* Streaming message preview */}
      {isStreaming && streamingBlocks.length > 0 && (
        <div style={{ padding: '8px 16px', display: 'flex', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: token.colorFillSecondary, color: token.colorTextSecondary,
            fontSize: 14, marginTop: 2
          }}>
            <RobotOutlined />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {streamingBlocks.map((block, i) => {
              if (block.type === 'text') {
                const isLastText = streamingBlocks.slice(i + 1).every(b => b.type !== 'text')
                return (
                  <div key={i} className="markdown-body" style={{ fontSize: 13, lineHeight: 1.7 }}>
                    <ReactMarkdown
                      rehypePlugins={[rehypeHighlightPlugin]}
                      remarkPlugins={[remarkGfm]}
                      urlTransform={(url) => url}
                      components={externalLinkMarkdownComponents}
                    >
                      {block.text}
                    </ReactMarkdown>
                    {isLastText && <span className="cursor-blink">|</span>}
                  </div>
                )
              }
              if (block.type === 'raw_output') {
                return (
                  <div key={i} style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {block.text}
                  </div>
                )
              }
              if (block.type === 'thinking') {
                return (
                  <div key={i} style={{
                    background: token.colorFillQuaternary, borderRadius: 6,
                    padding: '8px 12px', marginBottom: 8
                  }}>
                    <div style={{
                      fontSize: 12, color: token.colorTextSecondary,
                      display: 'flex', alignItems: 'center', gap: 6, marginBottom: block.text ? 4 : 0
                    }}>
                      <Spin size="small" />
                      <span>{t('coding.thinking')}</span>
                    </div>
                    {block.text && (
                      <div
                        ref={thinkingRef}
                        style={{
                          fontSize: 12, color: token.colorTextSecondary,
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          maxHeight: 200, overflowY: 'auto', lineHeight: 1.5
                        }}
                      >
                        {block.text}
                      </div>
                    )}
                  </div>
                )
              }
              if (block.type === 'tool_use') {
                const summary = getToolSummary(block.name, block.input)
                const tr = streamResultMap.get(block.id)
                if (tr) streamPairedIds.add(block.id)

                return (
                  <div key={i} style={{
                    fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                    marginBottom: 4, padding: '3px 0',
                    color: tr?.isError ? token.colorError : token.colorText
                  }}>
                    {tr ? (
                      tr.isError
                        ? <CloseCircleFilled style={{ color: token.colorError, fontSize: 13 }} />
                        : <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 13 }} />
                    ) : (
                      <Spin size="small" />
                    )}
                    <ToolOutlined style={{ color: tr ? token.colorTextSecondary : token.colorPrimary, fontSize: 12 }} />
                    <span style={{ fontWeight: 500 }}>{block.name}</span>
                    {summary && (
                      <span style={{
                        color: token.colorTextSecondary, fontSize: 11,
                        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                      }}>
                        {summary}
                      </span>
                    )}
                  </div>
                )
              }
              if (block.type === 'tool_result') {
                if (streamPairedIds.has(block.toolUseId)) return null // already rendered with tool_use
                // Unpaired tool_result
                return (
                  <div key={i} style={{
                    fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                    marginBottom: 4, padding: '3px 0',
                    color: block.isError ? token.colorError : token.colorTextSecondary
                  }}>
                    {block.isError
                      ? <CloseCircleFilled style={{ color: token.colorError, fontSize: 13 }} />
                      : <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 13 }} />
                    }
                    <span>{block.isError ? t('coding.toolError') : t('coding.toolSuccess')}</span>
                  </div>
                )
              }
              if (block.type === 'context_usage') {
                const used = block.usedTokens ?? ((block.inputTokens || 0) + (block.cachedInputTokens || 0))
                const total = block.contextWindow || 0
                const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : null
                return (
                  <div key={i} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '3px 8px', margin: '2px 0 8px',
                    borderRadius: 4, fontSize: 11,
                    color: token.colorTextSecondary,
                    background: token.colorFillQuaternary,
                  }}>
                    <DashboardOutlined style={{ fontSize: 12 }} />
                    <span>
                      {percent !== null
                        ? `${used.toLocaleString()} / ${total.toLocaleString()} tokens (${percent}%)`
                        : `${used.toLocaleString()} context tokens`}
                    </span>
                  </div>
                )
              }
              if (block.type === 'ask_user_question' && sessionId) {
                return (
                  <AskUserQuestionBlock
                    key={i}
                    questionId={block.id}
                    questions={block.questions}
                    sessionId={sessionId}
                    answered={block.answered}
                    answerText={block.answerText}
                  />
                )
              }
              if (block.type === 'todo_update') {
                return <TodoUpdateBlock key={i} todos={block.todos} />
              }
              return null
            })}
          </div>
        </div>
      )}

      {/* Streaming indicator with no blocks yet */}
      {isStreaming && streamingBlocks.length === 0 && (
        <div style={{ padding: '8px 16px', display: 'flex', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: token.colorFillSecondary, color: token.colorTextSecondary,
            fontSize: 14, marginTop: 2
          }}>
            <RobotOutlined />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6 }}>
            <Spin size="small" />
            <Text style={{ color: token.colorTextSecondary, fontSize: 12 }}>{t('coding.waitingResponse')}</Text>
          </div>
        </div>
      )}
    </div>
  )
}

export default WorkbenchMessageList
