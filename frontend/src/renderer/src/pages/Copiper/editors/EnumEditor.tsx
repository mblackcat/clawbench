import React from 'react'
import { Select } from 'antd'
import type { ColDef } from '../../../types/copiper'

interface EnumEditorProps {
  value: unknown
  colDef: ColDef
  onChange: (value: unknown) => void
  onBlur?: () => void
  autoFocus?: boolean
}

const EnumEditor: React.FC<EnumEditorProps> = ({ value, colDef, onChange, onBlur, autoFocus }) => {
  const parseOptions = (): string[] => {
    if (!colDef.options) return []
    if (Array.isArray(colDef.options)) return colDef.options
    return colDef.options.split('|').map((s) => s.trim()).filter(Boolean)
  }

  const options = parseOptions()
  const isOptional = colDef.req_or_opt === 'optional'

  const selectOptions = [
    ...(isOptional ? [{ label: '(空)', value: '' }] : []),
    ...options.map((opt) => ({ label: opt, value: opt }))
  ]

  return (
    <Select
      size="small"
      autoFocus={autoFocus}
      defaultValue={value != null ? String(value) : undefined}
      options={selectOptions}
      style={{ width: '100%' }}
      onChange={(val) => {
        onChange(val)
        onBlur?.()
      }}
      onBlur={onBlur}
    />
  )
}

export default EnumEditor
