import React, { useState } from 'react'
import { Button, Space, Switch, theme, Typography } from 'antd'
import { DownOutlined, UpOutlined } from '@ant-design/icons'

const { Text } = Typography

interface AgentConfigCardProps {
  icon: React.ReactNode
  iconBackground?: string
  title: string
  summary?: string
  badge?: string
  description?: React.ReactNode
  actions?: React.ReactNode
  fields?: React.ReactNode
  footerNote?: React.ReactNode
  enabled?: boolean
  onToggle?: (next: boolean) => void
  onExpandChange?: (next: boolean) => void
  readOnly?: boolean
  alwaysExpanded?: boolean
}

const AgentConfigCard: React.FC<AgentConfigCardProps> = ({
  icon,
  iconBackground,
  title,
  summary,
  badge,
  description,
  actions,
  fields,
  footerNote,
  enabled,
  onToggle,
  onExpandChange,
  readOnly = false,
  alwaysExpanded = false,
}) => {
  const { token } = theme.useToken()
  const [expanded, setExpanded] = useState(alwaysExpanded)
  const hasSwitch = onToggle !== undefined || (enabled !== undefined && !readOnly)
  const hasContent = !!description || !!actions || !!fields || !!footerNote

  return (
    <div className="cb-glass-card">
      <div style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: enabled !== false ? (iconBackground || token.colorPrimary) : token.colorTextDisabled,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              flexShrink: 0,
              transition: 'background 0.2s',
            }}
          >
            {icon}
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Text
              strong
              style={{
                display: 'block',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 13,
              }}
            >
              {title}
            </Text>
            {summary && !expanded && !alwaysExpanded && (
              <Text
                type="secondary"
                style={{
                  display: 'block',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 10,
                }}
              >
                {summary}
              </Text>
            )}
          </div>

          {badge && (
            <Text
              style={{
                fontSize: 10,
                color: token.colorSuccess,
                padding: '0 6px',
                background: `${token.colorSuccess}20`,
                borderRadius: 4,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {badge}
            </Text>
          )}
          {!alwaysExpanded && hasContent && (
            <Button
              type="text"
              size="small"
              icon={expanded ? <UpOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
              onClick={() => {
                const next = !expanded
                setExpanded(next)
                onExpandChange?.(next)
              }}
              style={{ padding: '0 4px', height: 20, flexShrink: 0, color: token.colorTextTertiary }}
            />
          )}
          {hasSwitch && (
            <Switch
              size="small"
              checked={!!enabled}
              disabled={readOnly}
              onChange={onToggle}
            />
          )}
        </div>

        {(expanded || alwaysExpanded) && hasContent && (
          <div style={{ marginTop: 8 }}>
            {description && (
              <div style={{ marginBottom: actions || fields ? 8 : 0 }}>
                {typeof description === 'string' ? (
                  <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    {description}
                  </Text>
                ) : description}
              </div>
            )}

            {actions && (
              <Space size={4} wrap style={{ marginBottom: fields ? 8 : 0 }}>
                {actions}
              </Space>
            )}

            {fields}

            {footerNote && (
              <div style={{ marginTop: 6 }}>
                {typeof footerNote === 'string' ? (
                  <Text type="secondary" style={{ display: 'block', fontSize: 11, fontStyle: 'italic' }}>
                    {footerNote}
                  </Text>
                ) : footerNote}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default AgentConfigCard
