import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { Typography, Progress, Tag, Button, Space, Empty, theme } from 'antd'
import {
  UpOutlined,
  DownOutlined,
  StopOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  CloseOutlined
} from '@ant-design/icons'
import { useTaskStore } from '../stores/useTaskStore'
import type { SubAppOutput, TaskStatus } from '../types/subapp'

const { Text } = Typography

interface OutputPanelProps {
  taskId: string | null
}

const STATUS_CONFIG: Record<
  TaskStatus,
  { color: string; label: string; icon: React.ReactNode }
> = {
  idle: { color: 'default', label: '空闲', icon: <ClockCircleOutlined /> },
  running: { color: 'processing', label: '运行中', icon: <LoadingOutlined /> },
  completed: { color: 'success', label: '已完成', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', label: '失败', icon: <CloseCircleOutlined /> },
  cancelled: { color: 'warning', label: '已取消', icon: <MinusCircleOutlined /> }
}

const OutputLine: React.FC<{ output: SubAppOutput }> = React.memo(({ output }) => {
  const { token } = theme.useToken()

  if (output.type === 'progress') {
    return null // Progress is handled by the header progress bar
  }

  if (output.type === 'result') {
    const isSuccess = output.success
    return (
      <div
        style={{
          padding: '6px 12px',
          background: isSuccess ? token.colorSuccessBg : token.colorErrorBg,
          borderLeft: `3px solid ${isSuccess ? token.colorSuccess : token.colorError}`,
          marginBottom: 2,
          borderRadius: 2
        }}
      >
        <Text strong style={{ color: isSuccess ? token.colorSuccess : token.colorError }}>
          {isSuccess ? '[完成] ' : '[失败] '}
        </Text>
        <Text style={{ color: isSuccess ? token.colorSuccess : token.colorError }}>
          {output.summary || output.message || ''}
        </Text>
        {output.details && (
          <div style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {output.details}
            </Text>
          </div>
        )}
      </div>
    )
  }

  // output or error type
  const level = output.level || 'info'
  const levelColors: Record<string, string> = {
    info: token.colorText,
    warn: token.colorWarning,
    error: token.colorError
  }
  const levelBgs: Record<string, string> = {
    info: 'transparent',
    warn: token.colorWarningBg,
    error: token.colorErrorBg
  }
  const color = levelColors[level] || token.colorText

  const timestamp = output.timestamp
    ? new Date(output.timestamp).toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    : null

  return (
    <div
      style={{
        padding: '3px 12px',
        fontFamily: 'Menlo, Monaco, Consolas, monospace',
        fontSize: 13,
        lineHeight: '20px',
        color,
        background: levelBgs[level] || 'transparent',
        borderBottom: `1px solid ${token.colorBorderSecondary}`
      }}
    >
      {timestamp && (
        <Text
          type="secondary"
          style={{
            fontSize: 11,
            marginRight: 8,
            fontFamily: 'inherit',
            userSelect: 'none'
          }}
        >
          [{timestamp}]
        </Text>
      )}
      <span>{output.message || ''}</span>
    </div>
  )
})

OutputLine.displayName = 'OutputLine'

const OutputPanel: React.FC<OutputPanelProps> = ({ taskId }) => {
  const [collapsed, setCollapsed] = useState(false)
  const outputEndRef = useRef<HTMLDivElement>(null)
  const { token } = theme.useToken()

  const task = useTaskStore((state) => (taskId ? state.tasks[taskId] : undefined))
  const setActiveTask = useTaskStore((state) => state.setActiveTask)

  // Memoize outputs array reference to avoid unnecessary re-renders
  const outputs = useMemo(() => task?.outputs ?? [], [task?.outputs])

  // Auto-scroll to bottom on new output
  useEffect(() => {
    if (!collapsed && outputEndRef.current) {
      outputEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [outputs.length, collapsed])

  const handleCancel = useCallback(async () => {
    if (taskId) {
      await window.api.subapp.cancel(taskId)
    }
  }, [taskId])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  // Empty state
  if (!taskId || !task) {
    return (
      <div
        style={{
          height: collapsed ? 40 : 250,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          flexDirection: 'column',
          background: token.colorBgContainer
        }}
      >
        <div
          style={{
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            borderBottom: collapsed ? 'none' : `1px solid ${token.colorBorderSecondary}`,
            flexShrink: 0
          }}
        >
          <Text type="secondary">输出面板</Text>
          <Space size={4}>
            <Button
              type="text"
              size="small"
              icon={collapsed ? <UpOutlined /> : <DownOutlined />}
              onClick={toggleCollapsed}
            />
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={() => setActiveTask(null)}
            />
          </Space>
        </div>
        {!collapsed && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Empty description="暂无运行中的任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
      </div>
    )
  }

  const statusInfo = STATUS_CONFIG[task.status]

  return (
    <div
      style={{
        height: collapsed ? 40 : 250,
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgContainer,
        transition: 'height 0.2s ease'
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          borderBottom: collapsed ? 'none' : `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0
        }}
      >
        <Space size={12}>
          <Text strong style={{ fontSize: 13 }}>
            {task.appName}
          </Text>

          <Tag icon={statusInfo.icon} color={statusInfo.color} style={{ margin: 0 }}>
            {statusInfo.label}
          </Tag>

          {task.status === 'running' && (
            <Progress
              percent={task.progress}
              size="small"
              style={{ width: 160, margin: 0 }}
              strokeColor={token.colorPrimary}
            />
          )}
        </Space>

        <Space size={8}>
          {task.status === 'running' && (
            <Button
              type="text"
              danger
              size="small"
              icon={<StopOutlined />}
              onClick={handleCancel}
            >
              取消
            </Button>
          )}
          <Button
            type="text"
            size="small"
            icon={collapsed ? <UpOutlined /> : <DownOutlined />}
            onClick={toggleCollapsed}
          />
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            disabled={task.status === 'running'}
            onClick={() => setActiveTask(null)}
          />
        </Space>
      </div>

      {/* Output body */}
      {!collapsed && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            background: token.colorBgLayout
          }}
        >
          {outputs.length === 0 ? (
            <div
              style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Text type="secondary">等待输出...</Text>
            </div>
          ) : (
            outputs.map((output, index) => (
              <OutputLine key={`${output.taskId}-${index}`} output={output} />
            ))
          )}
          <div ref={outputEndRef} />
        </div>
      )}

      {/* Result bar at the bottom when task is done */}
      {!collapsed && task.result && (
        <div
          style={{
            height: 32,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            background: task.result.success ? token.colorSuccessBg : token.colorErrorBg,
            borderTop: `1px solid ${task.result.success ? token.colorSuccessBorder : token.colorErrorBorder}`
          }}
        >
          {task.result.success ? (
            <CheckCircleOutlined style={{ color: token.colorSuccess, marginRight: 8 }} />
          ) : (
            <CloseCircleOutlined style={{ color: token.colorError, marginRight: 8 }} />
          )}
          <Text
            style={{
              color: task.result.success ? token.colorSuccess : token.colorError,
              fontSize: 13
            }}
          >
            {task.result.summary}
          </Text>
        </div>
      )}
    </div>
  )
}

export default OutputPanel
