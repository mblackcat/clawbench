import React, { useState } from 'react'
import { Button, Tag, Image, theme, Space } from 'antd'
import {
  CodeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  CaretRightOutlined,
  CaretDownOutlined,
  ToolOutlined,
  PictureOutlined,
  SearchOutlined,
  GlobalOutlined,
} from '@ant-design/icons'
import type { ToolCall } from '../../types/chat'
import { useChatStore } from '../../stores/useChatStore'
import { useT } from '../../i18n'

interface ToolCallCardProps {
  toolCall: ToolCall
  isPending?: boolean
}

const statusColors: Record<string, string> = {
  pending: 'processing',
  approved: 'processing',
  completed: 'success',
  error: 'error',
  rejected: 'default',
}

const ToolCallCard: React.FC<ToolCallCardProps> = ({ toolCall, isPending }) => {
  const { token } = theme.useToken()
  const t = useT()
  // Default to collapsed for completed/error tools
  const [expanded, setExpanded] = useState(toolCall.status === 'pending' || toolCall.status === 'approved')
  const { approveToolCall, rejectToolCall, setToolApprovalMode } = useChatStore()

  const isCommand = toolCall.name === 'execute_command'
  const isImageGen = toolCall.name === 'generate_image' || toolCall.name === 'edit_image'
  const isWebSearch = toolCall.name === 'web_search'
  const isWebBrowse = toolCall.name === 'web_browse'
  const commandStr = isCommand ? toolCall.input.command : JSON.stringify(toolCall.input, null, 2)

  // Parse image output if applicable
  let imageData: { base64: string; format: string; revisedPrompt?: string } | null = null
  if (isImageGen && toolCall.output) {
    try {
      const parsed = JSON.parse(toolCall.output)
      if (parsed.type === 'image' && parsed.base64) {
        imageData = parsed
      }
    } catch {
      // not JSON, show as text
    }
  }

  const toolLabel = isCommand
    ? t('chat.tool.command')
    : isImageGen
      ? t('chat.tool.imageGen')
      : isWebSearch
        ? t('chat.tool.webSearch')
        : isWebBrowse
          ? t('chat.tool.webBrowse')
          : toolCall.name

  const toolIcon = isImageGen ? (
    <PictureOutlined style={{ color: token.colorPrimary }} />
  ) : isWebSearch ? (
    <SearchOutlined style={{ color: token.colorPrimary }} />
  ) : isWebBrowse ? (
    <GlobalOutlined style={{ color: token.colorPrimary }} />
  ) : (
    <ToolOutlined style={{ color: token.colorPrimary }} />
  )

  const statusLabel = toolCall.status === 'pending' ? t('chat.tool.statusPending')
    : toolCall.status === 'approved' ? t('chat.tool.statusRunning')
    : toolCall.status === 'completed' ? t('chat.tool.statusDone')
    : toolCall.status === 'error' ? t('chat.tool.statusError')
    : toolCall.status === 'rejected' ? t('chat.tool.statusRejected')
    : toolCall.status

  // Search-specific preview text
  const searchPreview = isWebSearch ? toolCall.input.query : isWebBrowse ? toolCall.input.url : null

  return (
    <div
      style={{
        margin: '8px 0',
        borderRadius: 8,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgElevated,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          background: token.colorFillQuaternary,
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <CaretDownOutlined style={{ fontSize: 10, color: token.colorTextSecondary }} />
        ) : (
          <CaretRightOutlined style={{ fontSize: 10, color: token.colorTextSecondary }} />
        )}
        {toolIcon}
        <span style={{ fontSize: 13, fontWeight: 500, color: token.colorText }}>
          {toolLabel}
        </span>
        <Tag
          color={statusColors[toolCall.status] || 'default'}
          style={{ fontSize: 10, margin: 0 }}
          icon={
            toolCall.status === 'approved' ? (
              <LoadingOutlined />
            ) : toolCall.status === 'completed' ? (
              <CheckCircleOutlined />
            ) : toolCall.status === 'error' ? (
              <CloseCircleOutlined />
            ) : undefined
          }
        >
          {statusLabel}
        </Tag>
        {/* Inline search query/URL preview in header */}
        {searchPreview && (
          <span style={{
            fontSize: 12,
            color: token.colorTextSecondary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}>
            {searchPreview}
          </span>
        )}
      </div>

      {/* Command preview (always shown for commands) */}
      {isCommand && (
        <div
          style={{
            padding: '6px 12px',
            background: token.colorFillTertiary,
            fontFamily: 'monospace',
            fontSize: 12,
            color: token.colorText,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 120,
            overflow: 'auto',
          }}
        >
          <CodeOutlined style={{ marginRight: 4, color: token.colorTextSecondary }} />
          {commandStr}
        </div>
      )}

      {/* Image gen prompt preview */}
      {isImageGen && toolCall.input.prompt && (
        <div
          style={{
            padding: '6px 12px',
            background: token.colorFillTertiary,
            fontSize: 12,
            color: token.colorText,
            whiteSpace: 'pre-wrap',
            maxHeight: 120,
            overflow: 'auto',
          }}
        >
          <PictureOutlined style={{ marginRight: 4, color: token.colorTextSecondary }} />
          {toolCall.input.prompt}
        </div>
      )}

      {/* Generated image (always shown when available) */}
      {imageData && (
        <div style={{ padding: '8px 12px' }}>
          <Image
            src={`data:image/${imageData.format || 'png'};base64,${imageData.base64}`}
            style={{ maxWidth: '100%', maxHeight: 400, borderRadius: 8 }}
          />
          {imageData.revisedPrompt && (
            <div style={{ fontSize: 11, color: token.colorTextSecondary, marginTop: 4 }}>
              {imageData.revisedPrompt}
            </div>
          )}
        </div>
      )}

      {/* Expanded: input + output */}
      {expanded && (
        <div style={{ padding: '8px 12px' }}>
          {!isCommand && !isWebSearch && !isWebBrowse && (
            <div style={{ marginBottom: 8 }}>
              <div
                style={{ fontSize: 11, color: token.colorTextSecondary, marginBottom: 4 }}
              >
                {t('chat.tool.input')}:
              </div>
              <pre
                style={{
                  fontSize: 11,
                  background: token.colorFillTertiary,
                  padding: 8,
                  borderRadius: 4,
                  maxHeight: 200,
                  overflow: 'auto',
                  margin: 0,
                  color: token.colorText,
                }}
              >
                {JSON.stringify(toolCall.input, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.output && (
            <div>
              <div
                style={{ fontSize: 11, color: token.colorTextSecondary, marginBottom: 4 }}
              >
                {t('chat.tool.output')}:
              </div>
              {!imageData && (
                <pre
                  style={{
                    fontSize: 11,
                    background: token.colorFillTertiary,
                    padding: 8,
                    borderRadius: 4,
                    maxHeight: 300,
                    overflow: 'auto',
                    margin: 0,
                    color: toolCall.error ? token.colorError : token.colorText,
                  }}
                >
                  {toolCall.output}
                </pre>
              )}
              {imageData && (
                <div style={{ fontSize: 11, color: token.colorTextSecondary }}>
                  {t('chat.tool.imageShownAbove')}
                </div>
              )}
            </div>
          )}
          {toolCall.error && !toolCall.output && (
            <div style={{ fontSize: 12, color: token.colorError }}>{toolCall.error}</div>
          )}
        </div>
      )}

      {/* Approval buttons for pending tool calls */}
      {isPending && toolCall.status === 'pending' && (
        <div
          style={{
            padding: '8px 12px',
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <Space>
            <Button
              type="primary"
              size="small"
              onClick={() => approveToolCall(toolCall.id)}
            >
              {t('chat.tool.approve')}
            </Button>
            <Button
              size="small"
              onClick={() => {
                setToolApprovalMode('auto-approve-session')
                approveToolCall(toolCall.id)
              }}
            >
              {t('chat.tool.autoApprove')}
            </Button>
            <Button
              size="small"
              danger
              onClick={() => rejectToolCall(toolCall.id)}
            >
              {t('chat.tool.reject')}
            </Button>
          </Space>
        </div>
      )}
    </div>
  )
}

export default ToolCallCard
