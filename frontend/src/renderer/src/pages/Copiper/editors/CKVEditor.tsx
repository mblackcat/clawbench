import React, { useState } from 'react'
import { Input, Modal, Typography, theme } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import type { ColDef } from '../../../types/copiper'

const { Text } = Typography

interface CKVEditorProps {
  value: unknown
  colDef: ColDef
  onChange: (value: unknown) => void
  onBlur?: () => void
  autoFocus?: boolean
}

/** Extract class name from ckv:ClassName type string */
const getClassName = (colDef: ColDef): string => {
  const match = colDef.type.match(/^ckv:(.+)$/)
  return match ? match[1] : colDef.j_type.replace(/^ckv:?/, '') || 'Object'
}

const toDisplayJson = (raw: unknown): string => {
  if (raw == null || raw === '') return '{}'
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw, null, 2)
    } catch {
      return String(raw)
    }
  }
  const str = String(raw)
  try {
    JSON.parse(str)
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    try {
      const jsonStr = str.replace(/'/g, '"')
      JSON.parse(jsonStr)
      return JSON.stringify(JSON.parse(jsonStr), null, 2)
    } catch {
      return str
    }
  }
}

const CKVEditor: React.FC<CKVEditorProps> = ({ value, colDef, onChange, onBlur }) => {
  const { token } = theme.useToken()
  const [modalOpen, setModalOpen] = useState(false)
  const [editText, setEditText] = useState('')

  const className = getClassName(colDef)
  const preview = value != null ? String(value) : '{}'
  const truncated = preview.length > 25 ? preview.slice(0, 25) + '...' : preview

  const handleOpen = () => {
    setEditText(toDisplayJson(value))
    setModalOpen(true)
  }

  const handleOk = () => {
    try {
      const parsed = JSON.parse(editText)
      onChange(JSON.stringify(parsed))
    } catch {
      onChange(editText)
    }
    setModalOpen(false)
    onBlur?.()
  }

  return (
    <>
      <div
        onClick={handleOpen}
        style={{
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          minWidth: 0
        }}
      >
        <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>[{className}]</Text>
        <Text
          style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          code
        >
          {truncated}
        </Text>
        <EditOutlined style={{ color: token.colorPrimary, flexShrink: 0 }} />
      </div>
      <Modal
        title={`编辑 ${className} 数据`}
        open={modalOpen}
        onOk={handleOk}
        onCancel={() => {
          setModalOpen(false)
          onBlur?.()
        }}
        width={520}
        destroyOnHidden
      >
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">Class: <Text code>{className}</Text></Text>
        </div>
        <Input.TextArea
          autoFocus
          rows={12}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>
    </>
  )
}

export default CKVEditor
