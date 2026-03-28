import React, { useState, useEffect, useRef } from 'react'
import { Spin, theme } from 'antd'
import { LoadingOutlined, UpOutlined, DownOutlined } from '@ant-design/icons'
import { useT } from '../i18n'

interface ThinkingBlockProps {
  content: string
  isStreaming?: boolean
  /** Compact mode: smaller font, padding, and max-height (used by AITerminal) */
  compact?: boolean
}

const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ content, isStreaming, compact }) => {
  const [expanded, setExpanded] = useState(!!isStreaming)
  const { token } = theme.useToken()
  const prevStreaming = useRef(isStreaming)
  const t = useT()

  useEffect(() => {
    // Auto-expand when streaming starts, auto-collapse when it ends
    if (!prevStreaming.current && isStreaming) {
      setExpanded(true)
    } else if (prevStreaming.current && !isStreaming) {
      setExpanded(false)
    }
    prevStreaming.current = isStreaming
  }, [isStreaming])

  const fontSize = compact ? 11 : 12
  const iconSize = compact ? 10 : 11
  const arrowSize = compact ? 9 : 10
  const headerPadding = compact ? '4px 8px' : '5px 10px'
  const contentPadding = compact ? '4px 8px' : '6px 10px'
  const maxHeight = compact ? 120 : 200
  const lineHeight = compact ? 1.4 : 1.5
  const marginBottom = compact ? 6 : 8

  return (
    <div
      style={{
        marginBottom,
        borderRadius: 6,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        overflow: 'hidden',
        fontSize,
      }}
    >
      {/* Header */}
      <div
        onClick={() => { if (!isStreaming) setExpanded((v) => !v) }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: compact ? 5 : 6,
          padding: headerPadding,
          cursor: isStreaming ? 'default' : 'pointer',
          userSelect: 'none',
          color: token.colorTextSecondary,
        }}
      >
        {isStreaming ? (
          <Spin size="small" />
        ) : (
          <LoadingOutlined style={{ fontSize: iconSize }} />
        )}
        <span style={{ flex: 1 }}>{isStreaming ? t('coding.thinking') : t('coding.thinkingProcess')}</span>
        {!isStreaming && (
          expanded
            ? <UpOutlined style={{ fontSize: arrowSize }} />
            : <DownOutlined style={{ fontSize: arrowSize }} />
        )}
      </div>
      {/* Content */}
      {expanded && content && (
        <div
          style={{
            padding: contentPadding,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            color: token.colorTextTertiary,
            fontStyle: 'italic',
            maxHeight,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            lineHeight,
          }}
        >
          {content}
        </div>
      )}
    </div>
  )
}

export default ThinkingBlock
