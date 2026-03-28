import React, { useState } from 'react'
import { Tag, Modal, Input, Button, Space, theme } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import type { ColDef } from '../../../types/copiper'

interface ListEditorProps {
  value: unknown
  colDef: ColDef
  onChange: (value: unknown) => void
  onBlur?: () => void
  autoFocus?: boolean
}

const parseListValue = (value: unknown): string[] => {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String)
  const str = String(value)
  if (!str) return []
  // Try JSON array
  try {
    const parsed = JSON.parse(str)
    if (Array.isArray(parsed)) return parsed.map(String)
  } catch {
    // Fallback: pipe-separated
  }
  return str.split('|').filter(Boolean)
}

const ListEditor: React.FC<ListEditorProps> = ({ value, colDef, onChange, onBlur }) => {
  const { token } = theme.useToken()
  const [modalOpen, setModalOpen] = useState(false)
  const [items, setItems] = useState<string[]>([])
  const [newItem, setNewItem] = useState('')

  const currentItems = parseListValue(value)
  const subType = colDef.type.replace(/^list:/, '') || colDef.j_type.replace(/^list:/, '')

  const handleOpen = () => {
    setItems(parseListValue(value))
    setNewItem('')
    setModalOpen(true)
  }

  const handleAdd = () => {
    const trimmed = newItem.trim()
    if (trimmed) {
      setItems([...items, trimmed])
      setNewItem('')
    }
  }

  const handleRemove = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const handleOk = () => {
    // Store as pipe-separated for compatibility
    onChange(items.join('|'))
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
        <Tag style={{ margin: 0 }}>{currentItems.length} 项</Tag>
        <EditOutlined style={{ color: token.colorPrimary, flexShrink: 0 }} />
      </div>
      <Modal
        title={`编辑列表 (${subType || 'items'})`}
        open={modalOpen}
        onOk={handleOk}
        onCancel={() => {
          setModalOpen(false)
          onBlur?.()
        }}
        width={480}
        destroyOnHidden
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 8px',
                borderRadius: 4,
                background: token.colorBgTextHover
              }}
            >
              <span style={{ flex: 1, fontSize: 13, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item}
              </span>
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleRemove(idx)}
              />
            </div>
          ))}
          <Space.Compact style={{ width: '100%' }}>
            <Input
              size="small"
              value={newItem}
              placeholder="Add item..."
              onChange={(e) => setNewItem(e.target.value)}
              onPressEnter={handleAdd}
            />
            <Button size="small" icon={<PlusOutlined />} onClick={handleAdd}>
              Add
            </Button>
          </Space.Compact>
        </div>
      </Modal>
    </>
  )
}

export default ListEditor
