import React, { useState } from 'react'
import { Input, InputNumber } from 'antd'
import type { ColDef } from '../../../types/copiper'

interface NumberEditorProps {
  value: unknown
  colDef: ColDef
  onChange: (value: unknown) => void
  onBlur?: () => void
  autoFocus?: boolean
}

const NumberEditor: React.FC<NumberEditorProps> = ({ value, colDef, onChange, onBlur, autoFocus }) => {
  const isInt = colDef.type === 'int' || colDef.j_type === 'int'
  const strVal = value != null ? String(value) : ''
  const isHex = strVal.startsWith('0x') || strVal.startsWith('0X')

  // For hex integers, use a plain Input to preserve the 0x prefix
  const [hexMode] = useState(isInt && isHex)

  if (hexMode) {
    return (
      <Input
        size="small"
        autoFocus={autoFocus}
        defaultValue={strVal}
        onPressEnter={(e) => {
          const raw = (e.target as HTMLInputElement).value
          const parsed = parseInt(raw, 16)
          onChange(isNaN(parsed) ? raw : raw)
          onBlur?.()
        }}
        onBlur={(e) => {
          const raw = e.target.value
          onChange(raw)
          onBlur?.()
        }}
      />
    )
  }

  const numVal = value != null ? Number(value) : undefined

  return (
    <InputNumber
      size="small"
      autoFocus={autoFocus}
      defaultValue={numVal}
      precision={isInt ? 0 : undefined}
      style={{ width: '100%' }}
      onPressEnter={() => onBlur?.()}
      onBlur={(e) => {
        const raw = e.target.value
        if (raw === '' || raw == null) {
          onChange(colDef.default_v ?? (isInt ? 0 : 0.0))
        } else {
          onChange(isInt ? parseInt(raw, 10) : parseFloat(raw))
        }
        onBlur?.()
      }}
    />
  )
}

export default NumberEditor
