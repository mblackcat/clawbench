import React, { useState } from 'react'
import { Switch, Input, Select, InputNumber, Typography, Button, theme } from 'antd'
import { DownOutlined, UpOutlined } from '@ant-design/icons'

const { Text } = Typography

export interface HermesModuleField {
  key: string
  label: string
  type: 'text' | 'password' | 'number' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  value: string | number
  onChange?: (val: string | number) => void
  disabled?: boolean
}

interface HermesModuleCardProps {
  icon: React.ReactNode
  iconColor?: string
  title: string
  description?: string
  note?: string
  enabled?: boolean
  onToggle?: (v: boolean) => void
  fields?: HermesModuleField[]
  alwaysExpanded?: boolean
  readOnly?: boolean
  badge?: string
}

const HermesModuleCard: React.FC<HermesModuleCardProps> = ({
  icon, iconColor, title, description, note, enabled, onToggle,
  fields = [], alwaysExpanded = false, readOnly = false, badge
}) => {
  const { token } = theme.useToken()
  const hasSwitch = onToggle !== undefined || (enabled !== undefined && !readOnly)
  const hasContent = !!description || !!note || fields.length > 0
  const [expanded, setExpanded] = useState(alwaysExpanded)

  return (
    <div className="cb-glass-card">
      <div style={{ padding: '8px 12px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: enabled !== false ? (iconColor || token.colorPrimary) : token.colorTextDisabled,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              flexShrink: 0,
              transition: 'background 0.2s'
            }}
          >
            {icon}
          </div>
          <Text
            strong
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 13
            }}
          >
            {title}
          </Text>
          {badge && (
            <Text style={{ fontSize: 10, color: token.colorSuccess, padding: '0 4px', background: `${token.colorSuccess}20`, borderRadius: 4 }}>
              {badge}
            </Text>
          )}
          {!alwaysExpanded && hasContent && (
            <Button
              type="text"
              size="small"
              icon={expanded ? <UpOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
              onClick={() => setExpanded((v) => !v)}
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

        {/* Expanded content */}
        {(expanded || alwaysExpanded) && hasContent && (
          <div style={{ marginTop: 8 }}>
            {description && (
              <Text
                type="secondary"
                style={{ display: 'block', fontSize: 12, marginBottom: fields.length > 0 ? 8 : 0 }}
              >
                {description}
              </Text>
            )}

            {fields.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {fields.map((field) => (
                  <div key={field.key}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>
                      {field.label}
                    </Text>
                    {field.type === 'select' ? (
                      <Select
                        size="small"
                        style={{ width: '100%' }}
                        value={field.value as string || undefined}
                        options={field.options}
                        onChange={(v) => field.onChange?.(v)}
                        disabled={field.disabled}
                      />
                    ) : field.type === 'number' ? (
                      <InputNumber
                        size="small"
                        style={{ width: '100%' }}
                        value={field.value as number}
                        min={field.min}
                        max={field.max}
                        onChange={(v) => field.onChange?.(v ?? 0)}
                        disabled={field.disabled}
                      />
                    ) : field.type === 'password' ? (
                      <Input.Password
                        size="small"
                        value={field.value as string}
                        placeholder={field.placeholder}
                        onChange={(e) => field.onChange?.(e.target.value)}
                        disabled={field.disabled}
                      />
                    ) : (
                      <Input
                        size="small"
                        value={field.value as string}
                        placeholder={field.placeholder}
                        onChange={(e) => field.onChange?.(e.target.value)}
                        disabled={field.disabled}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {note && (
              <Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 6, fontStyle: 'italic' }}>
                {note}
              </Text>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default HermesModuleCard
