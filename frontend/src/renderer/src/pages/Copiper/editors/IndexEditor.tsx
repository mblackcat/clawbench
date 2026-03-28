import React from 'react'
import { Input, Tooltip } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import type { ColDef } from '../../../types/copiper'

interface IndexEditorProps {
  value: unknown
  colDef: ColDef
  onChange: (value: unknown) => void
  onBlur?: () => void
  autoFocus?: boolean
}

const IndexEditor: React.FC<IndexEditorProps> = ({ value, colDef, onChange, onBlur, autoFocus }) => {
  const srcTable = colDef.src || colDef.type.replace(/^index\//, '')

  return (
    <Tooltip title={`References: ${srcTable}`}>
      <Input
        size="small"
        autoFocus={autoFocus}
        defaultValue={value != null ? String(value) : ''}
        placeholder={srcTable}
        suffix={<LinkOutlined style={{ opacity: 0.45 }} />}
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

export default IndexEditor
