import React from 'react'
import { Input, Tooltip } from 'antd'
import type { ColDef } from '../../../types/copiper'

interface IndexStringEditorProps {
  value: unknown
  colDef: ColDef
  onChange: (value: unknown) => void
  onBlur?: () => void
  autoFocus?: boolean
}

const IndexStringEditor: React.FC<IndexStringEditorProps> = ({ value, colDef, onChange, onBlur, autoFocus }) => {
  const strVal = value != null ? String(value) : ''
  const srcTable = colDef.src || ''
  const tooltipText = srcTable
    ? `Index string: <${srcTable}>[IndexValue] syntax`
    : 'Index string: <SourceTable>[IndexValue] syntax'

  return (
    <Tooltip title={tooltipText}>
      <Input
        size="small"
        autoFocus={autoFocus}
        defaultValue={strVal}
        placeholder={srcTable ? `<${srcTable}>[...]` : 'istr...'}
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

export default IndexStringEditor
