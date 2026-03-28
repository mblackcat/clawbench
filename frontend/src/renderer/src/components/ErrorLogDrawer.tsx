import React, { useState } from 'react'
import { Drawer, Button, Typography, Tag, Empty, Divider, theme, Segmented } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { useTaskStore } from '../stores/useTaskStore'
import type { SystemLogEntry } from '../stores/useTaskStore'
import { useT } from '../i18n'
import type { TaskInfo } from '../types/subapp'

const { Text } = Typography

interface ErrorLogDrawerProps {
  open: boolean
  onClose: () => void
}

const ErrorLogDrawer: React.FC<ErrorLogDrawerProps> = ({ open, onClose }) => {
  const tasks = useTaskStore((state) => state.tasks)
  const systemLogs = useTaskStore((state) => state.systemLogs)
  const { token } = theme.useToken()
  const t = useT()
  const [tab, setTab] = useState<'system' | 'app'>('system')

  // 将任务转换为数组并按开始时间倒序排序
  const taskList: TaskInfo[] = Object.values(tasks).sort((a, b) => b.startedAt - a.startedAt)

  const handleClear = (): void => {
    if (tab === 'app') {
      useTaskStore.getState().clearCompleted()
    } else {
      useTaskStore.getState().clearSystemLogs()
    }
  }

  // 根据类型获取标签颜色
  const getTagColor = (type: string) => {
    switch (type) {
      case 'error':
        return 'red'
      case 'progress':
        return 'blue'
      case 'result':
        return 'green'
      default:
        return 'default'
    }
  }

  // 根据类型获取文本类型
  const getTextType = (type: string): 'danger' | 'success' | undefined => {
    switch (type) {
      case 'error':
        return 'danger'
      case 'result':
        return 'success'
      default:
        return undefined
    }
  }

  // 获取任务状态标签
  const getStatusTag = (task: TaskInfo) => {
    switch (task.status) {
      case 'running':
        return <Tag color="processing">{t('logs.running')}</Tag>
      case 'completed':
        return <Tag color="success">{t('logs.completed')}</Tag>
      case 'failed':
        return <Tag color="error">{t('logs.failed')}</Tag>
      case 'cancelled':
        return <Tag color="default">{t('logs.cancelled')}</Tag>
      default:
        return <Tag>{task.status}</Tag>
    }
  }

  const getLevelTagColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'red'
      case 'warn':
        return 'orange'
      case 'info':
        return 'blue'
      default:
        return 'default'
    }
  }

  const isEmpty = tab === 'system' ? systemLogs.length === 0 : taskList.length === 0

  const renderSystemLogs = () => (
    <div style={{ height: '100%', overflow: 'auto' }}>
      {systemLogs.slice().reverse().map((entry: SystemLogEntry, idx: number) => (
        <div
          key={idx}
          style={{
            padding: '2px 0',
            fontSize: 12,
            lineHeight: '20px',
            display: 'flex',
            alignItems: 'baseline',
            gap: 8
          }}
        >
          <Tag
            color={getLevelTagColor(entry.level)}
            style={{
              fontSize: 11,
              margin: 0,
              padding: '0 4px',
              lineHeight: '18px',
              minWidth: 44,
              textAlign: 'center'
            }}
          >
            {entry.level}
          </Tag>
          <Text type="secondary" style={{ fontSize: 11, minWidth: 60 }}>
            {new Date(entry.timestamp).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })}
          </Text>
          <Text
            type={entry.level === 'error' ? 'danger' : entry.level === 'warn' ? 'warning' : undefined}
            style={{ fontSize: 12, flex: 1, wordBreak: 'break-word' }}
          >
            {entry.message}
          </Text>
        </div>
      ))}
    </div>
  )

  const renderAppLogs = () => (
    <div style={{ height: '100%', overflow: 'auto' }}>
      {taskList.map((task, taskIndex) => (
        <div key={task.taskId}>
          {/* 任务分隔符 */}
          {taskIndex > 0 && (
            <Divider style={{ margin: '12px 0', borderColor: token.colorBorder }} />
          )}

          {/* 任务头部 */}
          <div style={{
            marginBottom: 8,
            padding: '6px 12px',
            background: token.colorPrimaryBg,
            borderLeft: `3px solid ${token.colorPrimary}`,
            borderRadius: 2
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text strong style={{ color: token.colorPrimary }}>{task.appName}</Text>
              {getStatusTag(task)}
              <Text type="secondary" style={{ fontSize: 12 }}>
                {new Date(task.startedAt).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })}
              </Text>
              {task.result && (
                <Text type={task.result.success ? 'success' : 'danger'} style={{ fontSize: 12 }}>
                  {task.result.summary}
                </Text>
              )}
            </div>
          </div>

          {/* 任务输出 - 紧凑单行显示 */}
          {task.outputs.length > 0 && (
            <div style={{ paddingLeft: 12 }}>
              {task.outputs.map((output, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '2px 0',
                    fontSize: 12,
                    lineHeight: '20px',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8
                  }}
                >
                  <Tag
                    color={getTagColor(output.type)}
                    style={{
                      fontSize: 11,
                      margin: 0,
                      padding: '0 4px',
                      lineHeight: '18px',
                      minWidth: 50,
                      textAlign: 'center'
                    }}
                  >
                    {output.type}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 11, minWidth: 60 }}>
                    {output.timestamp
                      ? new Date(output.timestamp).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })
                      : '--:--:--'}
                  </Text>
                  <Text
                    type={getTextType(output.type)}
                    style={{
                      fontSize: 12,
                      flex: 1,
                      wordBreak: 'break-word'
                    }}
                  >
                    {output.message ?? output.details ?? output.summary ?? t('logs.noContent')}
                  </Text>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )

  return (
    <Drawer
      title={t('logs.title')}
      placement="bottom"
      height={400}
      open={open}
      onClose={onClose}
      extra={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Segmented
            size="small"
            value={tab}
            onChange={(v) => setTab(v as 'system' | 'app')}
            options={[
              { label: t('logs.systemLogs'), value: 'system' },
              { label: t('logs.appLogs'), value: 'app' }
            ]}
          />
          <Button
            size="small"
            icon={<DeleteOutlined />}
            onClick={handleClear}
            disabled={isEmpty}
          >
            {t('logs.clearCompleted')}
          </Button>
        </div>
      }
    >
      {isEmpty ? (
        <Empty description={t('logs.empty')} />
      ) : tab === 'system' ? (
        renderSystemLogs()
      ) : (
        renderAppLogs()
      )}
    </Drawer>
  )
}

export default ErrorLogDrawer
