import React, { useState } from 'react'
import { Button, Tag, theme, Spin } from 'antd'
import {
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CaretRightOutlined,
  CaretDownOutlined,
  StopOutlined,
  ToolOutlined,
  SearchOutlined,
  GlobalOutlined,
  CodeOutlined,
  PictureOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import { useChatStore } from '../../stores/useChatStore'
import ToolCallCard from './ToolCallCard'
import { useT } from '../../i18n'

const AgentStatusBar: React.FC = () => {
  const t = useT()
  const { token } = theme.useToken()
  const [timelineExpanded, setTimelineExpanded] = useState(false)
  const {
    agentPhase,
    agentStepDescription,
    agentToolHistory,
    pendingToolCalls,
    toolLoopController,
    cancelStreaming,
  } = useChatStore()

  if (agentPhase === 'idle' && pendingToolCalls.length === 0 && agentToolHistory.length === 0) {
    return null
  }

  // Hide the status bar during pure "thinking" phase with no tool activity —
  // the chat bubble already shows a streaming status indicator
  if (agentPhase === 'thinking' && pendingToolCalls.length === 0 && agentToolHistory.length === 0) {
    return null
  }

  const stepCount = toolLoopController?.getStepCount() ?? 0
  const maxSteps = 15

  const phaseIcon = agentPhase === 'thinking'
    ? <Spin size="small"><BulbOutlined style={{ color: token.colorPrimary, fontSize: 14 }} /></Spin>
    : agentPhase === 'calling-tools'
      ? <ToolOutlined style={{ color: token.colorWarning }} />
      : agentPhase === 'summarizing'
        ? <LoadingOutlined style={{ color: token.colorSuccess }} />
        : null

  const phaseLabel = agentPhase === 'thinking' ? t('chat.agent.thinking')
    : agentPhase === 'calling-tools' ? t('chat.agent.callingTools')
    : agentPhase === 'summarizing' ? t('chat.agent.summarizing')
    : ''

  const getToolIcon = (name: string) => {
    if (name === 'web_search' || name === 'plan_search') return <SearchOutlined style={{ fontSize: 11 }} />
    if (name === 'web_browse') return <GlobalOutlined style={{ fontSize: 11 }} />
    if (name === 'execute_command') return <CodeOutlined style={{ fontSize: 11 }} />
    if (name === 'generate_image' || name === 'edit_image') return <PictureOutlined style={{ fontSize: 11 }} />
    return <ToolOutlined style={{ fontSize: 11 }} />
  }

  return (
    <div style={{ padding: '8px 56px' }}>
      <div
        style={{
          borderRadius: 8,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgElevated,
          overflow: 'hidden',
        }}
      >
        {/* Status header */}
        <div
          style={{
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: token.colorFillQuaternary,
          }}
        >
          {phaseIcon}
          <span style={{ fontSize: 13, fontWeight: 500, color: token.colorText }}>
            {phaseLabel}
          </span>
          {stepCount > 0 && (
            <Tag style={{ fontSize: 10, margin: 0 }}>
              Step {stepCount}/{maxSteps}
            </Tag>
          )}
          {agentStepDescription && (
            <span style={{
              fontSize: 12,
              color: token.colorTextSecondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}>
              {agentStepDescription}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {agentPhase !== 'idle' && (
            <Button
              size="small"
              type="text"
              danger
              icon={<StopOutlined />}
              onClick={cancelStreaming}
            >
              {t('chat.agent.cancel')}
            </Button>
          )}
        </div>

        {/* Pending tool calls needing approval */}
        {pendingToolCalls.length > 0 && (
          <div style={{ padding: '8px 12px' }}>
            {pendingToolCalls.map((tc) => (
              <ToolCallCard
                key={tc.toolCallId}
                isPending
                toolCall={{
                  id: tc.toolCallId,
                  name: tc.toolName,
                  input: tc.input,
                  status: 'pending',
                }}
              />
            ))}
          </div>
        )}

        {/* Collapsible tool execution timeline */}
        {agentToolHistory.length > 0 && (
          <>
            <div
              style={{
                padding: '6px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                borderTop: `1px solid ${token.colorBorderSecondary}`,
                fontSize: 12,
                color: token.colorTextSecondary,
              }}
              onClick={() => setTimelineExpanded(!timelineExpanded)}
            >
              {timelineExpanded ? (
                <CaretDownOutlined style={{ fontSize: 10 }} />
              ) : (
                <CaretRightOutlined style={{ fontSize: 10 }} />
              )}
              {t('chat.agent.toolHistory')} ({agentToolHistory.length})
            </div>
            {timelineExpanded && (
              <div style={{ padding: '4px 12px 8px' }}>
                {agentToolHistory.map((entry) => {
                  const duration = entry.endTime
                    ? ((entry.endTime - entry.startTime) / 1000).toFixed(1) + 's'
                    : null

                  return (
                    <div
                      key={entry.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '3px 0',
                        fontSize: 12,
                        color: token.colorText,
                      }}
                    >
                      {getToolIcon(entry.name)}
                      <span style={{ fontWeight: 500 }}>{entry.name}</span>
                      {entry.name === 'web_search' && entry.input?.query && (
                        <span style={{ color: token.colorTextSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                          {entry.input.query}
                        </span>
                      )}
                      {entry.name === 'web_browse' && entry.input?.url && (
                        <span style={{ color: token.colorTextSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                          {entry.input.url}
                        </span>
                      )}
                      <div style={{ flex: 1 }} />
                      {entry.status === 'running' ? (
                        <LoadingOutlined style={{ fontSize: 11, color: token.colorPrimary }} />
                      ) : entry.status === 'completed' ? (
                        <CheckCircleOutlined style={{ fontSize: 11, color: token.colorSuccess }} />
                      ) : (
                        <CloseCircleOutlined style={{ fontSize: 11, color: token.colorError }} />
                      )}
                      {duration && (
                        <span style={{ fontSize: 11, color: token.colorTextTertiary, minWidth: 36, textAlign: 'right' }}>
                          {duration}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default AgentStatusBar
