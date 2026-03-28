import React from 'react'
import { Switch } from 'antd'
import type { ColDef } from '../../../types/copiper'

interface BoolEditorProps {
  value: unknown
  colDef: ColDef
  onChange: (value: unknown) => void
  onBlur?: () => void
  autoFocus?: boolean
}

const BoolEditor: React.FC<BoolEditorProps> = ({ value, onChange, onBlur }) => {
  const boolVal = value === true || value === 'true' || value === 1

  return (
    <Switch
      size="small"
      checked={boolVal}
      onChange={(checked) => {
        onChange(checked)
        onBlur?.()
      }}
    />
  )
}

export default BoolEditor
