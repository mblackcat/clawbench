import React, { useState } from 'react'
import { Input, Modal, Typography, theme } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import type { ColDef } from '../../../types/copiper'

const { Text } = Typography

interface KVEditorProps {
  value: unknown
  colDef: ColDef
  onChange: (value: unknown) => void
  onBlur?: () => void
  autoFocus?: boolean
}

/** Convert Python-style dict strings (single quotes) to valid JSON for display */
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
    // Try direct JSON parse first
    JSON.parse(str)
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    // Try converting Python-style single-quoted dict to JSON
    try {
      const jsonStr = str.replace(/'/g, '"')
      JSON.parse(jsonStr)
      return JSON.stringify(JSON.parse(jsonStr), null, 2)
    } catch {
      return str
    }
  }
}

const KVEditor: React.FC<KVEditorProps> = ({ value, onChange, onBlur }) => {
  const { token } = theme.useToken()
  const [modalOpen, setModalOpen] = useState(false)
  const [editText, setEditText] = useState('')

  const preview = value != null ? String(value) : '{}'
  const truncated = preview.length > 30 ? preview.slice(0, 30) + '...' : preview

  const handleOpen = () => {
    setEditText(toDisplayJson(value))
    setModalOpen(true)
  }

  const handleOk = () => {
    // Try to parse as JSON; if valid, store the original format
    try {
      const parsed = JSON.parse(editText)
      onChange(JSON.stringify(parsed))
    } catch {
      // Store as-is if not valid JSON
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
        <Text
          style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          code
        >
          {truncated}
        </Text>
        <EditOutlined style={{ color: token.colorPrimary, flexShrink: 0 }} />
      </div>
      <Modal
        title="编辑键值数据"
        open={modalOpen}
        onOk={handleOk}
        onCancel={() => {
          setModalOpen(false)
          onBlur?.()
        }}
        width={520}
        destroyOnHidden
      >
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

export default KVEditor
