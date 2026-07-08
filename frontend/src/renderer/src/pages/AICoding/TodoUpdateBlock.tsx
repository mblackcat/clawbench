import React from 'react'
import { theme } from 'antd'
import { CheckSquareOutlined } from '@ant-design/icons'
import { useT } from '../../i18n'
import type { TodoItem } from '../../types/ai-coding'

interface TodoUpdateBlockProps {
  todos: TodoItem[]
}

const BOX = 15

/**
 * Renders a TodoWrite / "Update Todos" call as a checklist, mirroring the
 * official Claude Code task panel:
 *   - completed   → filled check square (green) + strikethrough text
 *   - in_progress → indeterminate square (primary border + dash) + bold text
 *   - pending     → empty square outline
 */
const TodoUpdateBlock: React.FC<TodoUpdateBlockProps> = ({ todos }) => {
  const { token } = theme.useToken()
  const t = useT()

  if (!todos || todos.length === 0) return null

  const completed = todos.filter(item => item.status === 'completed').length
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
        <CheckSquareOutlined style={{ color: token.colorPrimary }} />
        <span style={{ fontWeight: 600 }}>{t('coding.updateTodos')}</span>
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

      {/* Checklist */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {todos.map((item, i) => {
          const isDone = item.status === 'completed'
          const isActive = item.status === 'in_progress'
          const text = isActive ? (item.activeForm || item.content) : item.content
          return (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                fontSize: 12, lineHeight: 1.5, padding: '2px 0',
              }}
            >
              {/* Checkbox */}
              {isDone ? (
                <div style={{
                  width: BOX, height: BOX, flexShrink: 0, marginTop: 1,
                  borderRadius: 3, background: token.colorSuccess,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                    <path d="M2 5l2 2 4-4.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              ) : isActive ? (
                <div style={{
                  width: BOX, height: BOX, flexShrink: 0, marginTop: 1,
                  borderRadius: 3, border: `1.5px solid ${token.colorPrimary}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ width: 7, height: 2, borderRadius: 1, background: token.colorPrimary }} />
                </div>
              ) : (
                <div style={{
                  width: BOX, height: BOX, flexShrink: 0, marginTop: 1,
                  borderRadius: 3, border: `1.5px solid ${token.colorBorder}`,
                }} />
              )}

              {/* Text */}
              <span style={{
                flex: 1,
                color: isDone
                  ? token.colorTextQuaternary
                  : isActive
                    ? token.colorPrimary
                    : token.colorText,
                textDecoration: isDone ? 'line-through' : 'none',
                fontWeight: isActive ? 500 : 400,
              }}>
                {text}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default TodoUpdateBlock
