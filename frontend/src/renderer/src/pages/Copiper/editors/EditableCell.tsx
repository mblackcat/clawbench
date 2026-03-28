import React, { useState, useRef, useCallback } from 'react'
import { Tag, Typography, theme } from 'antd'
import type { ColDef, RowData } from '../../../types/copiper'
import StringEditor from './StringEditor'
import NumberEditor from './NumberEditor'
import BoolEditor from './BoolEditor'
import EnumEditor from './EnumEditor'
import IndexEditor from './IndexEditor'
import IndicesEditor from './IndicesEditor'
import KVEditor from './KVEditor'
import CKVEditor from './CKVEditor'
import TemplateStringEditor from './TemplateStringEditor'
import IndexStringEditor from './IndexStringEditor'
import ListEditor from './ListEditor'
import DateTimeEditor from './DateTimeEditor'

const { Text } = Typography

export interface EditableCellProps extends React.HTMLAttributes<HTMLElement> {
  record?: RowData
  rowIndex?: number
  colDef?: ColDef
  editing?: boolean
  onSave?: (rowIndex: number, colName: string, value: unknown) => void
  children?: React.ReactNode
}

/** Determine which editor to use based on the column type string */
const getEditorType = (colDef: ColDef): string => {
  const type = colDef.type || ''
  const jType = colDef.j_type || ''

  // Check if there are enum options
  if (colDef.options) return 'enum'

  if (type === 'bool' || jType === 'bool') return 'bool'
  if (type === 'int' || jType === 'int') return 'number'
  if (type === 'float' || jType === 'float') return 'number'
  if (type.startsWith('index/') || jType === 'index') return 'index'
  if (type.startsWith('indices/') || jType === 'indices') return 'indices'
  if (type.startsWith('ckv:') || jType.startsWith('ckv')) return 'ckv'
  if (type.startsWith('kv:') || jType.startsWith('kv')) return 'kv'
  if (type.startsWith('list:') || jType.startsWith('list')) return 'list'
  if (type === 'tstr' || jType === 'tstr') return 'tstr'
  if (type === 'istr' || jType === 'istr') return 'istr'
  if (type === 'utc_time' || jType === 'utc_time') return 'datetime'
  if (type === 'dict' || jType === 'dict') return 'kv'
  if (type === 'str' || jType === 'str') return 'string'

  return 'string'
}

/** Format display value based on column type */
const formatDisplayValue = (value: unknown, colDef: ColDef): React.ReactNode => {
  if (value == null || value === '') {
    return <Text type="secondary" style={{ fontSize: 12 }}>-</Text>
  }

  const editorType = getEditorType(colDef)

  switch (editorType) {
    case 'bool': {
      const boolVal = value === true || value === 'true' || value === 1
      return <Tag color={boolVal ? 'green' : 'default'}>{boolVal ? 'true' : 'false'}</Tag>
    }
    case 'kv':
    case 'ckv':
    case 'dict': {
      const str = String(value)
      const truncated = str.length > 30 ? str.slice(0, 30) + '...' : str
      return <Text code style={{ fontSize: 11 }}>{truncated}</Text>
    }
    case 'list': {
      let count = 0
      if (Array.isArray(value)) {
        count = value.length
      } else {
        const str = String(value)
        count = str ? str.split('|').filter(Boolean).length : 0
      }
      return <Tag>{count} items</Tag>
    }
    case 'datetime': {
      const num = Number(value)
      if (!isNaN(num) && num > 0) {
        const d = new Date(num * 1000)
        return <Text style={{ fontSize: 12 }}>{d.toLocaleString()}</Text>
      }
      return <Text style={{ fontSize: 12 }}>{String(value)}</Text>
    }
    default:
      return <Text style={{ fontSize: 12 }}>{String(value)}</Text>
  }
}

/** Whether this editor type uses a modal/popup (so we don't wrap with click-to-edit) */
const isModalEditor = (editorType: string): boolean => {
  return editorType === 'kv' || editorType === 'ckv' || editorType === 'list'
}

const EditableCell: React.FC<EditableCellProps> = ({
  record,
  rowIndex,
  colDef,
  editing,
  onSave,
  children,
  ...restProps
}) => {
  const { token } = theme.useToken()
  const [isEditing, setIsEditing] = useState(false)
  const cellRef = useRef<HTMLDivElement>(null)

  const handleSave = useCallback(
    (value: unknown) => {
      if (onSave && rowIndex != null && colDef) {
        onSave(rowIndex, colDef.name, value)
      }
    },
    [onSave, rowIndex, colDef]
  )

  const handleBlur = useCallback(() => {
    setIsEditing(false)
  }, [])

  // Non-editable cell (no colDef = system column like selection)
  if (!colDef || !editing || rowIndex == null || !record) {
    return <td {...restProps}>{children}</td>
  }

  const editorType = getEditorType(colDef)
  const cellValue = record[colDef.name]
  const usesModal = isModalEditor(editorType)

  // Modal-based editors are always rendered inline (they open their own modal)
  if (usesModal) {
    const editorProps = {
      value: cellValue,
      colDef,
      onChange: handleSave,
      onBlur: handleBlur,
      autoFocus: false
    }

    return (
      <td {...restProps}>
        <div style={{ padding: '4px 0' }}>
          {editorType === 'kv' && <KVEditor {...editorProps} />}
          {editorType === 'ckv' && <CKVEditor {...editorProps} />}
          {editorType === 'list' && <ListEditor {...editorProps} />}
        </div>
      </td>
    )
  }

  // Click-to-edit cell
  if (isEditing) {
    const editorProps = {
      value: cellValue,
      colDef,
      onChange: handleSave,
      onBlur: handleBlur,
      autoFocus: true
    }

    let editor: React.ReactNode
    switch (editorType) {
      case 'number':
        editor = <NumberEditor {...editorProps} />
        break
      case 'bool':
        editor = <BoolEditor {...editorProps} />
        break
      case 'enum':
        editor = <EnumEditor {...editorProps} />
        break
      case 'index':
        editor = <IndexEditor {...editorProps} />
        break
      case 'indices':
        editor = <IndicesEditor {...editorProps} />
        break
      case 'tstr':
        editor = <TemplateStringEditor {...editorProps} />
        break
      case 'istr':
        editor = <IndexStringEditor {...editorProps} />
        break
      case 'datetime':
        editor = <DateTimeEditor {...editorProps} />
        break
      default:
        editor = <StringEditor {...editorProps} />
    }

    return (
      <td {...restProps}>
        <div ref={cellRef}>{editor}</div>
      </td>
    )
  }

  // Display mode — click to edit
  return (
    <td {...restProps}>
      <div
        onClick={() => setIsEditing(true)}
        style={{
          cursor: 'pointer',
          padding: '4px 0',
          minHeight: 22,
          borderRadius: 2,
          transition: 'background 0.15s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = token.colorBgTextHover
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        {formatDisplayValue(cellValue, colDef)}
      </div>
    </td>
  )
}

export default EditableCell
