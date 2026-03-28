import React, { useEffect } from 'react'
import { Button, Switch, Typography, theme, App, Empty } from 'antd'
import { PlusOutlined, ClockCircleOutlined, DeleteOutlined, CaretRightOutlined } from '@ant-design/icons'
import { useScheduledTaskStore } from '../../stores/useScheduledTaskStore'
import { useT } from '../../i18n'
import type { ScheduledTask } from '../../types/scheduled-task'

const { Text, Paragraph } = Typography

const repeatLabels: Record<string, string> = {
  none: 'task.repeatNone',
  daily: 'task.repeatDaily',
  weekly: 'task.repeatWeekly',
  monthly: 'task.repeatMonthly'
}

const dayKeys = ['task.sun', 'task.mon', 'task.tue', 'task.wed', 'task.thu', 'task.fri', 'task.sat']

function formatNextRun(ts: number | undefined, t: (key: string) => string): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (isToday) return time
  return `${d.toLocaleDateString()} ${time}`
}

function getFrequencyText(task: ScheduledTask, t: (key: string, ...args: string[]) => string): string {
  const time = task.time
  if (task.repeatRule === 'none') return `${t('task.repeatNone')} ${time}`
  if (task.repeatRule === 'daily') return `${t('task.repeatDaily')} ${time}`
  if (task.repeatRule === 'weekly') {
    const day = t(dayKeys[task.dayOfWeek ?? 0])
    return `${t('task.repeatWeekly')} ${day} ${time}`
  }
  if (task.repeatRule === 'monthly') {
    return `${t('task.repeatMonthly')} ${task.dayOfMonth ?? 1}${t('task.dayOfMonth') === '日期' ? '日' : 'th'} ${time}`
  }
  return time
}

const ScheduledTaskList: React.FC = () => {
  const t = useT()
  const { token } = theme.useToken()
  const { modal } = App.useApp()
  const { tasks, fetchTasks, setEnabled, deleteTask, openEditor } = useScheduledTaskStore()

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const handleDelete = (task: ScheduledTask, e: React.MouseEvent) => {
    e.stopPropagation()
    modal.confirm({
      title: t('task.delete'),
      content: t('task.confirmDelete', task.name),
      okText: t('task.delete'),
      okButtonProps: { danger: true },
      cancelText: t('task.cancel'),
      onOk: () => deleteTask(task.id)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0
      }}>
        <Text strong style={{ fontSize: 16 }}>{t('task.title')}</Text>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => openEditor()}
          size="small"
        >
          {t('task.newTask')}
        </Button>
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {tasks.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div>
                <div>{t('task.noTasks')}</div>
                <Text type="secondary" style={{ fontSize: 12 }}>{t('task.noTasksDesc')}</Text>
              </div>
            }
            style={{ marginTop: 80 }}
          />
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10
          }}>
            {tasks.map((task) => (
              <div
                key={task.id}
                onClick={() => openEditor(task.id)}
                style={{
                  padding: '10px 12px',
                  borderRadius: token.borderRadiusLG,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                  cursor: 'pointer',
                  transition: 'border-color 0.2s',
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = token.colorPrimary)}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = token.colorBorderSecondary)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text strong style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {task.name}
                  </Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 4 }}>
                    <Switch
                      size="small"
                      checked={task.enabled}
                      onClick={(checked, e) => {
                        e.stopPropagation()
                        setEnabled(task.id, checked)
                      }}
                    />
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      danger
                      onClick={(e) => handleDelete(task, e)}
                      style={{ padding: '0 2px' }}
                    />
                  </div>
                </div>

                <Paragraph
                  ellipsis={{ rows: 2 }}
                  style={{ margin: 0, fontSize: 11, color: token.colorTextSecondary, lineHeight: 1.4 }}
                >
                  {task.prompt}
                </Paragraph>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 10, color: token.colorTextTertiary, flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <ClockCircleOutlined />
                    {getFrequencyText(task, t)}
                  </span>
                  {task.lastRunStatus && (
                    <span style={{
                      color: task.lastRunStatus === 'success' ? token.colorSuccess : token.colorError
                    }}>
                      {task.lastRunStatus === 'success' ? t('task.success') : t('task.error')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ScheduledTaskList
