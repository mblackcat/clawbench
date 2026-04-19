import React from 'react'
import { Input, InputNumber, Select, Typography } from 'antd'

const { Text } = Typography

export interface AgentConfigField {
  key: string
  label: React.ReactNode
  type: 'text' | 'password' | 'number' | 'select' | 'model-tags'
  placeholder?: string
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  value: string | number | string[]
  onChange?: (value: string | number | string[]) => void
  disabled?: boolean
  required?: boolean
  extra?: React.ReactNode
}

interface AgentConfigFieldsProps {
  fields: AgentConfigField[]
}

const AgentConfigFields: React.FC<AgentConfigFieldsProps> = ({ fields }) => {
  if (fields.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {fields.map((field) => (
        <div key={field.key}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>
            {field.label}
            {field.required && <span style={{ color: 'var(--ant-color-error)' }}> *</span>}
          </Text>
          {field.type === 'model-tags' ? (
            <Select
              mode="tags"
              size="small"
              style={{ width: '100%' }}
              disabled={field.disabled}
              value={field.value as string[]}
              placeholder={field.placeholder}
              options={field.options}
              tokenSeparators={[',']}
              onChange={(values: string[]) => field.onChange?.(values)}
            />
          ) : field.type === 'select' ? (
            <Select
              size="small"
              style={{ width: '100%' }}
              disabled={field.disabled}
              value={(field.value as string) || undefined}
              placeholder={field.placeholder}
              options={field.options}
              onChange={(value) => field.onChange?.(value)}
              showSearch
              optionFilterProp="label"
            />
          ) : field.type === 'number' ? (
            <InputNumber
              size="small"
              style={{ width: '100%' }}
              disabled={field.disabled}
              value={field.value as number}
              min={field.min}
              max={field.max}
              onChange={(value) => field.onChange?.(value ?? 0)}
            />
          ) : field.type === 'password' ? (
            <Input.Password
              size="small"
              disabled={field.disabled}
              value={field.value as string}
              placeholder={field.placeholder}
              onChange={(event) => field.onChange?.(event.target.value)}
            />
          ) : (
            <Input
              size="small"
              disabled={field.disabled}
              value={field.value as string}
              placeholder={field.placeholder}
              onChange={(event) => field.onChange?.(event.target.value)}
              suffix={field.extra}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export default AgentConfigFields
