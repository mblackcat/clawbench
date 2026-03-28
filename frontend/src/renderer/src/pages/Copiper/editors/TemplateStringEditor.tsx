import React from 'react'
import { Input, Tooltip } from 'antd'
import type { ColDef } from '../../../types/copiper'

interface TemplateStringEditorProps {
  value: unknown
  colDef: ColDef
  onChange: (value: unknown) => void
  onBlur?: () => void
  autoFocus?: boolean
}

const TemplateStringEditor: React.FC<TemplateStringEditorProps> = ({ value, onChange, onBlur, autoFocus }) => {
  const strVal = value != null ? String(value) : ''
  // Extract template variables like `{var_name}` for tooltip display
  const vars = strVal.match(/\{[^}]+\}/g) || []
  const tooltipText = vars.length > 0
    ? `Template variables: ${vars.join(', ')}`
    : 'Template string (use {variable} syntax)'

  return (
    <Tooltip title={tooltipText}>
      <Input
        size="small"
        autoFocus={autoFocus}
        defaultValue={strVal}
        placeholder="Template string..."
        onPressEnter={(e) => {
          onChange((e.target as HTMLInputElement).value)
          onBlur?.()
        }}
        onBlur={(e) => {
          onChange(e.target.value)
          onBlur?.()
        }}
      />
    </Tooltip>
  )
}

export default TemplateStringEditor
