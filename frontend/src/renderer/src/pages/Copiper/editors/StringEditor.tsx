import React from 'react'
import { Input } from 'antd'
import type { ColDef } from '../../../types/copiper'

interface StringEditorProps {
  value: unknown
  colDef: ColDef
  onChange: (value: unknown) => void
  onBlur?: () => void
  autoFocus?: boolean
}

const StringEditor: React.FC<StringEditorProps> = ({ value, onChange, onBlur, autoFocus }) => {
  return (
    <Input
      size="small"
      autoFocus={autoFocus}
      defaultValue={value != null ? String(value) : ''}
      onPressEnter={(e) => {
        onChange((e.target as HTMLInputElement).value)
        onBlur?.()
      }}
      onBlur={(e) => {
        onChange(e.target.value)
        onBlur?.()
      }}
    />
  )
}

export default StringEditor
