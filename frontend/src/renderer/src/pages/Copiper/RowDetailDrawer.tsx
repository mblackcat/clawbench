import React, { useMemo } from 'react'
import { Drawer, Form, Typography, Divider, theme } from 'antd'
import { useCopiperStore } from '../../stores/useCopiperStore'
import type { ColDef } from '../../types/copiper'
import StringEditor from './editors/StringEditor'
import NumberEditor from './editors/NumberEditor'
import BoolEditor from './editors/BoolEditor'
import EnumEditor from './editors/EnumEditor'
import IndexEditor from './editors/IndexEditor'
import IndicesEditor from './editors/IndicesEditor'
import KVEditor from './editors/KVEditor'
import CKVEditor from './editors/CKVEditor'
import TemplateStringEditor from './editors/TemplateStringEditor'
import IndexStringEditor from './editors/IndexStringEditor'
import ListEditor from './editors/ListEditor'
import DateTimeEditor from './editors/DateTimeEditor'

const { Text } = Typography

interface RowDetailDrawerProps {
  open: boolean
  rowIndex: number | null
  onClose: () => void
}

/** Group columns by c_type for organized display */
const groupColumns = (columns: ColDef[]): Record<string, ColDef[]> => {
  const groups: Record<string, ColDef[]> = {}
  const sorted = [...columns].sort((a, b) => a.c_index - b.c_index)
  for (const col of sorted) {
    const group = col.c_type || 'data'
    if (!groups[group]) groups[group] = []
    groups[group].push(col)
  }
  return groups
}

const groupLabels: Record<string, string> = {
  data: 'Data Fields',
  sup: 'Supplementary Fields',
  rdesc: 'Description Fields'
}

const getEditorForColumn = (
  col: ColDef,
  value: unknown,
  onChange: (value: unknown) => void
): React.ReactNode => {
  const type = col.type || ''
  const jType = col.j_type || ''
  const props = { value, colDef: col, onChange, autoFocus: false }

  if (col.options) return <EnumEditor {...props} />
  if (type === 'bool' || jType === 'bool') return <BoolEditor {...props} />
  if (type === 'int' || type === 'float' || jType === 'int' || jType === 'float')
    return <NumberEditor {...props} />
  if (type.startsWith('index/') || jType === 'index') return <IndexEditor {...props} />
  if (type.startsWith('indices/') || jType === 'indices') return <IndicesEditor {...props} />
  if (type.startsWith('ckv:') || jType.startsWith('ckv')) return <CKVEditor {...props} />
  if (type.startsWith('kv:') || jType.startsWith('kv') || type === 'dict' || jType === 'dict')
    return <KVEditor {...props} />
  if (type.startsWith('list:') || jType.startsWith('list')) return <ListEditor {...props} />
  if (type === 'tstr' || jType === 'tstr') return <TemplateStringEditor {...props} />
  if (type === 'istr' || jType === 'istr') return <IndexStringEditor {...props} />
  if (type === 'utc_time' || jType === 'utc_time') return <DateTimeEditor {...props} />

  return <StringEditor {...props} />
}

const RowDetailDrawer: React.FC<RowDetailDrawerProps> = ({ open, rowIndex, onClose }) => {
  const { token } = theme.useToken()

  const activeDatabase = useCopiperStore((s) => s.activeDatabase)
  const activeTableName = useCopiperStore((s) => s.activeTableName)
  const updateCell = useCopiperStore((s) => s.updateCell)

  const tableData = useMemo(() => {
    if (!activeDatabase || !activeTableName) return null
    return activeDatabase[activeTableName] ?? null
  }, [activeDatabase, activeTableName])

  const row = useMemo(() => {
    if (!tableData || rowIndex == null || rowIndex < 0 || rowIndex >= tableData.rows.length) return null
    return tableData.rows[rowIndex]
  }, [tableData, rowIndex])

  const groupedColumns = useMemo(() => {
    if (!tableData) return {}
    return groupColumns(tableData.columns)
  }, [tableData])

  if (!row || rowIndex == null) {
    return (
      <Drawer title="行详情" open={open} onClose={onClose} width={480}>
        <Text type="secondary">未选择行</Text>
      </Drawer>
    )
  }

  return (
    <Drawer
      title={`第 ${rowIndex + 1} 行 (id: ${row.id})`}
      open={open}
      onClose={onClose}
      width={520}
      destroyOnHidden
    >
      <Form layout="vertical">
        {Object.entries(groupedColumns).map(([groupKey, cols]) => (
          <div key={groupKey}>
            <Divider orientation="left" style={{ marginTop: 8, marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {groupLabels[groupKey] || groupKey}
              </Text>
            </Divider>
            {cols.map((col) => (
              <Form.Item
                key={col.id || col.name}
                label={
                  <span>
                    {col.rname || col.name}
                    {col.rname && col.rname !== col.name && (
                      <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>
                        ({col.name})
                      </Text>
                    )}
                    {col.req_or_opt === 'required' && (
                      <span style={{ color: token.colorError, marginLeft: 4 }}>*</span>
                    )}
                  </span>
                }
                style={{ marginBottom: 12 }}
                extra={col.rdesc ? <Text type="secondary" style={{ fontSize: 11 }}>{col.rdesc}</Text> : undefined}
              >
                {getEditorForColumn(col, row[col.name], (value) => {
                  updateCell(rowIndex, col.name, value)
                })}
              </Form.Item>
            ))}
          </div>
        ))}
      </Form>
    </Drawer>
  )
}

export default RowDetailDrawer
