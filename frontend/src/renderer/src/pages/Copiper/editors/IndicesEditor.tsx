import React from 'react'
import { Select, Tooltip } from 'antd'
import type { ColDef } from '../../../types/copiper'

interface IndicesEditorProps {
  value: unknown
  colDef: ColDef
  onChange: (value: unknown) => void
  onBlur?: () => void
  autoFocus?: boolean
}

const IndicesEditor: React.FC<IndicesEditorProps> = ({ value, colDef, onChange, onBlur, autoFocus }) => {
  const srcTable = colDef.src || colDef.type.replace(/^indices\//, '')

  const parseValue = (): string[] => {
    if (!value) return []
    if (Array.isArray(value)) return value.map(String)
    return String(value).split('|').filter(Boolean)
  }

  return (
    <Tooltip title={`References: ${srcTable}`}>
      <Select
        mode="tags"
        size="small"
        autoFocus={autoFocus}
        defaultValue={parseValue()}
        style={{ width: '100%' }}
        placeholder={srcTable}
        tokenSeparators={['|']}
        onChange={(vals: string[]) => {
          onChange(vals.join('|'))
        }}
        onBlur={onBlur}
      />
    </Tooltip>
  )
}

export default IndicesEditor
