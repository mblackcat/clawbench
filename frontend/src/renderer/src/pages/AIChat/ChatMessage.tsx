import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeHighlightPlugin } from '../../utils/markdown-plugins'
import { Tag, Image, theme, Dropdown, Button, Input, App, Modal, Typography } from 'antd'
import {
  FileOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  DownloadOutlined,
  StopOutlined,
  SearchOutlined,
  CopyOutlined,
  EditOutlined,
  ReloadOutlined,
  RollbackOutlined,
  LikeOutlined,
  DislikeOutlined,
  LikeFilled,
  DislikeFilled,
} from '@ant-design/icons'
import type { Message, ChatAttachment } from '../../types/chat'
import { API_BASE_URL } from '../../services/apiClient'
import ToolCallCard from './ToolCallCard'
import SearchSourcesCard from './SearchSourcesCard'
import ThinkingBlock from '../../components/ThinkingBlock'
import { ModelAvatar, UserAvatar, guessProviderFromModelId } from '../../components/ProviderIcons'
import { useAuthStore } from '../../stores/useAuthStore'
import { useChatStore } from '../../stores/useChatStore'

import { useT } from '../../i18n'

const STATUS_LABELS_ZH = [
  '理解问题中',
  '分析上下文',
  '组织思路中',
  '整理回答中',
  '梳理细节中',
]
const STATUS_LABELS_EN = [
  'Understanding',
  'Analyzing',
  'Organizing thoughts',
  'Composing',
  'Refining',
]

function StreamingStatus() {
  const { token } = theme.useToken()
  const t = useT()
  const isZh = t('coding.thinking').includes('思考')
  const labels = isZh ? STATUS_LABELS_ZH : STATUS_LABELS_EN
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % labels.length)
    }, 6000)
    return () => clearInterval(timer)
  }, [labels.length])

  return (
    <span className="streaming-status" style={{ color: token.colorTextSecondary, fontSize: 13 }}>
      <span className="streaming-status-dot" />
      <span className="streaming-status-text" key={index}>{labels[index]}</span>
    </span>
  )
}

function SearchIndicator() {
  const { token } = theme.useToken()
  const t = useT()
  const isZh = t('coding.thinking').includes('思考')
  const pendingToolCalls = useChatStore((s) => s.pendingToolCalls)
  const hasActiveSearch = pendingToolCalls.some(
    (tc) => tc.toolName === 'web_search' || tc.toolName === 'plan_search'
  )

  if (!hasActiveSearch) return null

  return (
    <Tag
      icon={<SearchOutlined />}
      color="processing"
      style={{ marginBottom: 6, fontSize: 12 }}
    >
      {isZh ? '正在搜索...' : 'Searching...'}
    </Tag>
  )
}

function MessageActionBar({ message }: { message: Message }) {
  const { token } = theme.useToken()
  const t = useT()
  const { message: messageApi } = App.useApp()
  const feedback = message.metadata?.feedback

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content)
    messageApi.success(t('chat.copied'))
  }, [message.content, messageApi, t])

  const handleFeedback = useCallback((type: 'up' | 'down') => {
    // Update the message metadata in the store
    useChatStore.setState((state) => ({
      messages: state.messages.map((m) =>
        m.messageId === message.messageId
          ? { ...m, metadata: { ...m.metadata, feedback: type } }
          : m
      ),
    }))

    // Gather conversation snippet and fire-and-forget to agent memory
    const messages = useChatStore.getState().messages
    const snippet = messages.slice(-20).map((m) => `${m.role}: ${m.content}`).join('\n').slice(0, 4000)
    window.api.agent.processFeedback({ messageId: message.messageId, type, snippet }).catch(() => {})
  }, [message.messageId])

  const tokenCount = message.metadata?.tokenCount
  const durationMs = message.metadata?.durationMs
  const durationStr = durationMs ? (durationMs / 1000).toFixed(1) + 's' : null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 2,
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', gap: 2 }}>
        <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} style={{ color: token.colorTextTertiary, width: 28, height: 24 }} />
        <Button
          type="text"
          size="small"
          icon={feedback === 'up' ? <LikeFilled /> : <LikeOutlined />}
          onClick={() => handleFeedback('up')}
          style={{ color: feedback === 'up' ? token.colorPrimary : token.colorTextTertiary, width: 28, height: 24 }}
        />
        <Button
          type="text"
          size="small"
          icon={feedback === 'down' ? <DislikeFilled /> : <DislikeOutlined />}
          onClick={() => handleFeedback('down')}
          style={{ color: feedback === 'down' ? token.colorError : token.colorTextTertiary, width: 28, height: 24 }}
        />
      </div>
      {(tokenCount || durationStr) && (
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {tokenCount ? `~${tokenCount} tokens` : ''}{tokenCount && durationStr ? ' · ' : ''}{durationStr || ''}
        </Typography.Text>
      )}
    </div>
  )
}

interface ChatMessageProps {
  message: Message
  isStreaming?: boolean
}

function getFileIcon(mimeType: string) {
  if (mimeType === 'application/pdf') return <FilePdfOutlined />
  if (mimeType.startsWith('text/')) return <FileTextOutlined />
  return <FileOutlined />
}

function AttachmentPreview({ att }: { att: ChatAttachment }) {
  const { token } = theme.useToken()
  const isImage = att.mimeType.startsWith('image/')

  if (isImage) {
    const url = `${API_BASE_URL}/chat/attachments/${att.attachmentId}/download`
    return (
      <Image
        src={url}
        width={200}
        style={{ borderRadius: 8, maxHeight: 300, objectFit: 'contain' }}
      />
    )
  }

  const downloadUrl = `${API_BASE_URL}/chat/attachments/${att.attachmentId}/download`
  return (
    <a
      href={downloadUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: 'none' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderRadius: 6,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgElevated,
          cursor: 'pointer',
          maxWidth: 240,
        }}
      >
        <span style={{ fontSize: 18, color: token.colorPrimary }}>{getFileIcon(att.mimeType)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              color: token.colorText,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {att.fileName}
          </div>
          <div style={{ fontSize: 10, color: token.colorTextSecondary }}>
            {(att.fileSize / 1024).toFixed(0)} KB
          </div>
        </div>
        <DownloadOutlined style={{ fontSize: 14, color: token.colorTextSecondary }} />
      </div>
    </a>
  )
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message, isStreaming }) => {
  const isUser = message.role === 'user'
  const { token } = theme.useToken()
  const t = useT()
  const { message: messageApi, modal } = App.useApp()
  const avatarUrl = useAuthStore((s) => s.user?.avatarUrl)
  const cancelStreaming = useChatStore((s) => s.cancelStreaming)
  const deleteMessages = useChatStore((s) => s.deleteMessages)
  const editAndResend = useChatStore((s) => s.editAndResend)
  const regenerateFromMessage = useChatStore((s) => s.regenerateFromMessage)
  const streaming = useChatStore((s) => s.streaming)

  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')

  const imageAttachments = message.attachments?.filter((a) => a.mimeType.startsWith('image/')) || []
  const fileAttachments = message.attachments?.filter((a) => !a.mimeType.startsWith('image/')) || []

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content)
    messageApi.success(t('chat.copied'))
  }, [message.content, messageApi, t])

  const handleEdit = useCallback(() => {
    setEditContent(message.content)
    setEditing(true)
  }, [message.content])

  const handleEditConfirm = useCallback(() => {
    if (editContent.trim()) {
      editAndResend(message.messageId, editContent.trim())
    }
    setEditing(false)
  }, [editContent, editAndResend, message.messageId])

  const handleRegenerate = useCallback(() => {
    regenerateFromMessage(message.messageId)
  }, [regenerateFromMessage, message.messageId])

  const handleRetract = useCallback(() => {
    const instance = modal.confirm({
      title: t('chat.retractConfirm'),
      content: t('chat.retractConfirmContent'),
      okText: t('chat.retractFromHere'),
      cancelText: t('chat.editCancel'),
      onOk: () => deleteMessages(message.messageId, 'from-here'),
      footer: (_, { OkBtn, CancelBtn }) => (
        <>
          <CancelBtn />
          <Button onClick={() => { deleteMessages(message.messageId, 'single'); instance.destroy() }}>
            {t('chat.retractSingle')}
          </Button>
          <OkBtn />
        </>
      ),
    })
  }, [modal, t, deleteMessages, message.messageId])

  const userContextMenuItems = [
    { key: 'copy', icon: <CopyOutlined />, label: t('chat.copy'), onClick: handleCopy },
    { key: 'edit', icon: <EditOutlined />, label: t('chat.edit'), onClick: handleEdit, disabled: streaming },
    { key: 'regenerate', icon: <ReloadOutlined />, label: t('chat.regenerate'), onClick: handleRegenerate, disabled: streaming },
    { key: 'retract', icon: <RollbackOutlined />, label: t('chat.retract'), onClick: handleRetract, disabled: streaming },
  ]

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 16,
        padding: '0 16px',
      }}
    >
      <div
        style={{
          maxWidth: '75%',
          minWidth: 0,
          display: 'flex',
          flexDirection: isUser ? 'row-reverse' : 'row',
          gap: 8,
          alignItems: 'flex-start',
        }}
      >
        {isUser ? (
          <UserAvatar size={32} primaryColor={token.colorPrimary} avatarUrl={avatarUrl || undefined} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <ModelAvatar provider={guessProviderFromModelId(message.modelId || '')} size={32} />
            {isStreaming && (
              <Button
                size="small"
                type="text"
                icon={<StopOutlined style={{ fontSize: 14 }} />}
                onClick={cancelStreaming}
                style={{
                  color: token.colorTextTertiary,
                  width: 32,
                  height: 24,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              />
            )}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
        <Dropdown
          menu={{ items: userContextMenuItems }}
          trigger={isUser ? ['contextMenu'] : []}
        >
          <div
            style={{
              background: isUser ? token.colorPrimary : token.colorFillSecondary,
              color: isUser ? '#fff' : token.colorText,
              padding: '8px 14px',
              borderRadius: 12,
              borderTopLeftRadius: isUser ? 12 : 4,
              borderTopRightRadius: isUser ? 4 : 12,
              lineHeight: 1.6,
              wordBreak: 'break-word',
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
          {/* Image attachments */}
          {imageAttachments.length > 0 && (
            <div style={{ marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {imageAttachments.map((att) => (
                <AttachmentPreview key={att.attachmentId} att={att} />
              ))}
            </div>
          )}

          {/* Text content */}
          {isUser ? (
            editing ? (
              <div>
                <Input.TextArea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  autoSize={{ minRows: 1, maxRows: 8 }}
                  style={{ marginBottom: 8, color: token.colorText }}
                />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Button size="small" onClick={() => setEditing(false)}>{t('chat.editCancel')}</Button>
                  <Button size="small" type="primary" onClick={handleEditConfirm}>{t('chat.editConfirm')}</Button>
                </div>
              </div>
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
            )
          ) : (
            <div className="markdown-body" style={{ fontSize: 14 }}>
              {/* Search status indicator during streaming */}
              {isStreaming && <SearchIndicator />}
              {/* Thinking block — only for completed messages */}
              {!isStreaming && message.thinkingContent && (
                <ThinkingBlock
                  content={message.thinkingContent}
                />
              )}
              {isStreaming && !message.content && !message.thinkingContent ? (
                <StreamingStatus />
              ) : (
                <>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlightPlugin]}
                    urlTransform={(url) => {
                      if (url.startsWith('data:image/')) return url
                      return defaultUrlTransform(url)
                    }}
                    components={{
                      img: ({ src, alt, ...props }) => {
                        const b64Match = src?.match(/^data:image\/[^;]+;base64,(.+)$/)
                        const menuItems = b64Match
                          ? [{ key: 'save', icon: <DownloadOutlined />, label: '保存图片' }]
                          : []
                        const handleMenuClick = ({ key }: { key: string }) => {
                          if (key === 'save' && b64Match) {
                            window.api.dialog.saveImage(b64Match[1])
                          }
                        }
                        return (
                          <Dropdown
                            menu={{ items: menuItems, onClick: handleMenuClick }}
                            trigger={['contextMenu']}
                          >
                            <span>
                              <Image
                                src={src}
                                alt={alt}
                                style={{ maxWidth: '100%', maxHeight: 400, borderRadius: 8 }}
                                {...props}
                              />
                            </span>
                          </Dropdown>
                        )
                      }
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                  {isStreaming && <span className="cursor-blink">|</span>}
                </>
              )}
            </div>
          )}

          {/* File attachments */}
          {fileAttachments.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {fileAttachments.map((att) => (
                <AttachmentPreview key={att.attachmentId} att={att} />
              ))}
            </div>
          )}

          {/* Tool calls */}
          {message.metadata?.toolCalls && message.metadata.toolCalls.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {message.metadata.toolCalls.map((tc) => (
                <ToolCallCard key={tc.id} toolCall={tc} />
              ))}
            </div>
          )}

          {/* Search sources */}
          {message.metadata?.searchSources && message.metadata.searchSources.length > 0 && (
            <SearchSourcesCard sources={message.metadata.searchSources} />
          )}

          {/* Model tag */}
          {message.modelId && !isUser && (
            <div style={{ marginTop: 4, textAlign: 'right' }}>
              <Tag style={{ fontSize: 10, margin: 0 }}>{message.modelId}</Tag>
            </div>
          )}
        </div>
        </Dropdown>
        {/* AI reply action bar — outside bubble, below it */}
        {!isUser && !isStreaming && <MessageActionBar message={message} />}
        </div>
      </div>
    </div>
  )
}

export default ChatMessage
