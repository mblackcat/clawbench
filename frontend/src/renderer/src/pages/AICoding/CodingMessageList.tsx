import React, { useRef, useEffect, useCallback, useState } from 'react'
import { theme, Spin, Typography } from 'antd'
import { MessageOutlined, CheckCircleFilled, CloseCircleFilled, ToolOutlined, DashboardOutlined } from '@ant-design/icons'
import remarkGfm from 'remark-gfm'
import ReactMarkdown from 'react-markdown'
import CodingChatMessage, { getToolSummary } from './CodingChatMessage'
import AskUserQuestionBlock from './AskUserQuestionBlock'
import TodoUpdateBlock from './TodoUpdateBlock'
import ThinkingBlock from '../../components/ThinkingBlock'
import { ModelAvatar, toolTypeToProvider } from '../../components/ProviderIcons'
import { MONO_FONT_STACK } from '../../utils/mono-font'
import { useT } from '../../i18n'
import type { CodingMessage, CodingContentBlock, AIToolType } from '../../types/ai-coding'
import { externalLinkMarkdownComponents } from '../../utils/markdown-links'
import '../AIChat/chat-styles.css'

const { Text } = Typography
const AUTO_SCROLL_THRESHOLD = 80

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= AUTO_SCROLL_THRESHOLD
}

/**
 * Streaming text block.
 *
 * Memoized on its text content so that, in a multi-step turn
 * (text → tool → text → tool …), already-complete text segments are NOT
 * re-parsed on every token — only the currently-growing last segment is.
 *
 * Syntax highlighting is intentionally omitted here: rehype-highlight
 * re-tokenizes every code block on each re-render, and during streaming that
 * cost grows with the message until the main thread stalls. Highlighting is
 * applied once when the turn finalizes (see CodingChatMessage). While
 * streaming, code still renders as styled monospace blocks — just without
 * token colors.
 */
const StreamingTextBlock: React.FC<{ text: string; renderKey: number }> = React.memo(
  ({ text, renderKey }) => (
    <div className="markdown-body" style={{ fontSize: 13, lineHeight: 1.7 }}>
      <ReactMarkdown
        key={renderKey}
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => url}
        components={externalLinkMarkdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  ),
  (prev, next) => prev.text === next.text && prev.renderKey === next.renderKey
)

interface CodingMessageListProps {
  messages: CodingMessage[]
  isStreaming: boolean
  streamingBlocks: CodingContentBlock[]
  hasExistingSession?: boolean
  sessionId?: string
  toolType?: AIToolType
}

const CodingMessageList: React.FC<CodingMessageListProps> = ({
  messages, isStreaming, streamingBlocks, hasExistingSession, sessionId, toolType
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
  const provider = toolTypeToProvider(toolType || 'claude')

  // rAF-coalesced streaming display: the store flushes deltas on a timer, and
  // we additionally coalesce into one paint per frame so a burst of flushes
  // never triggers more than one expensive re-render per tick.
  const latestBlocksRef = useRef<CodingContentBlock[]>(streamingBlocks)
  latestBlocksRef.current = streamingBlocks
  const [displayedBlocks, setDisplayedBlocks] = useState<CodingContentBlock[]>(streamingBlocks)
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    if (!isStreaming) {
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      setDisplayedBlocks(streamingBlocks)
      return
    }
    if (rafRef.current != null) return  // a coalescing frame is already scheduled
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      setDisplayedBlocks(latestBlocksRef.current)
    })
  }, [streamingBlocks, isStreaming])
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }, [])

  // Track container width to force ReactMarkdown re-render on resize.
  // Debounce the key update so streaming content growth (which can cause
  // scrollbar appear/disappear → width change → ReactMarkdown remount loops)
  // does NOT trigger constant expensive remounts. Only update after resize
  // settles for 200ms, which covers genuine window/pane resize events.
  const [containerWidth, setContainerWidth] = useState(0)
  const [renderKey, setRenderKey] = useState(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width !== undefined && width > 0) setContainerWidth(width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (containerWidth <= 0) return
    const timer = setTimeout(() => {
      setRenderKey(prev => prev + 1)
    }, 200)
    return () => clearTimeout(timer)
  }, [containerWidth])

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
  for (const b of displayedBlocks) {
    if (b.type === 'tool_result') {
      streamResultMap.set(b.toolUseId, { content: b.content, isError: b.isError })
    }
  }
  const streamPairedIds = new Set<string>()

  // Index of the last text block — used to show the blinking caret only on the
  // segment that is still growing.
  let lastTextIdx = -1
  for (let k = displayedBlocks.length - 1; k >= 0; k--) {
    if (displayedBlocks[k].type === 'text') { lastTextIdx = k; break }
  }

  const streamingAvatar = (
    <div style={{ flexShrink: 0, marginTop: 2 }}>
      <ModelAvatar provider={provider} size={28} />
    </div>
  )

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{ flex: 1, overflow: 'auto', paddingTop: 8, paddingBottom: 8, overflowAnchor: 'none' }}
    >
      {messages.map((msg) => (
        <CodingChatMessage key={msg.id} message={msg} onToolToggle={handleToolToggle} markdownRenderKey={renderKey} toolType={toolType} />
      ))}

      {/* Streaming message preview */}
      {isStreaming && displayedBlocks.length > 0 && (
        <div style={{ padding: '8px 16px', display: 'flex', gap: 10 }}>
          {streamingAvatar}
          <div style={{ flex: 1, minWidth: 0 }}>
            {displayedBlocks.map((block, i) => {
              if (block.type === 'text') {
                return (
                  <div key={i}>
                    <StreamingTextBlock text={block.text} renderKey={renderKey} />
                    {i === lastTextIdx && <span className="cursor-blink">|</span>}
                  </div>
                )
              }
              if (block.type === 'raw_output') {
                return (
                  <div key={i} style={{ fontFamily: MONO_FONT_STACK, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {block.text}
                  </div>
                )
              }
              if (block.type === 'thinking') {
                // Spinner only while this is the active (last) block still
                // receiving deltas; once a later block arrives, thinking is
                // done and the block collapses to its static state.
                const isThinkingActive = isStreaming && i === displayedBlocks.length - 1
                return (
                  <div key={i}>
                    <ThinkingBlock content={block.text} isStreaming={isThinkingActive} />
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
          {streamingAvatar}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6 }}>
            <Spin size="small" />
            <Text style={{ color: token.colorTextSecondary, fontSize: 12 }}>{t('coding.waitingResponse')}</Text>
          </div>
        </div>
      )}
    </div>
  )
}

export default CodingMessageList
