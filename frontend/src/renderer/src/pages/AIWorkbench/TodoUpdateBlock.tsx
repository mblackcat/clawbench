import React from 'react'
import { theme, Spin } from 'antd'
import { CheckCircleFilled, ClockCircleOutlined } from '@ant-design/icons'
import { useT } from '../../i18n'
import type { TodoItem } from '../../types/ai-workbench'

interface TodoUpdateBlockProps {
  todos: TodoItem[]
}

const TodoUpdateBlock: React.FC<TodoUpdateBlockProps> = ({ todos }) => {
  const { token } = theme.useToken()
  const t = useT()

  if (todos.length === 0) return null

  const completed = todos.filter(t => t.status === 'completed').length
  const total = todos.length

  return (
    <div style={{
      padding: '10px 14px', marginBottom: 6,
      borderRadius: token.borderRadiusSM,
      border: `1px solid ${token.colorBorderSecondary}`,
      background: token.colorBgElevated,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: 8, fontSize: 12, color: token.colorTextSecondary,
      }}>
        <ClockCircleOutlined />
        <span style={{ fontWeight: 500 }}>{t('coding.todoProgress')}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: token.colorTextQuaternary }}>
          {completed}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 3, borderRadius: 2,
        background: token.colorFillSecondary,
        marginBottom: 10, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 2,
          background: token.colorSuccess,
          width: `${total > 0 ? (completed / total) * 100 : 0}%`,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Todo items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {todos.map((item, i) => (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              fontSize: 12, lineHeight: 1.5, padding: '2px 0',
            }}
          >
            {/* Status icon */}
            {item.status === 'completed' ? (
              <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 14, flexShrink: 0, marginTop: 1 }} />
            ) : item.status === 'in_progress' ? (
              <Spin size="small" style={{ flexShrink: 0, marginTop: 1 }} />
            ) : (
              <div style={{
                width: 14, height: 14, flexShrink: 0, marginTop: 1,
                borderRadius: '50%',
                border: `1.5px solid ${token.colorTextQuaternary}`,
              }} />
            )}

            {/* Text */}
            <span style={{
              color: item.status === 'completed'
                ? token.colorTextQuaternary
                : item.status === 'in_progress'
                  ? token.colorPrimary
                  : token.colorText,
              textDecoration: item.status === 'completed' ? 'line-through' : 'none',
              fontWeight: item.status === 'in_progress' ? 500 : 400,
            }}>
              {item.status === 'in_progress' ? item.activeForm : item.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default TodoUpdateBlock
