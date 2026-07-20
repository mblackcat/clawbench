import React, { useMemo } from 'react'
import { Select, Tooltip } from 'antd'
import { useCopiperStore } from '../../../stores/useCopiperStore'
import type { ColDef } from '../../../types/copiper'
import { getTableData } from '../../../types/copiper'

interface IndicesEditorProps {
  value: unknown
  colDef: ColDef
  onChange: (value: unknown) => void
  onBlur?: () => void
  autoFocus?: boolean
}

const IndicesEditor: React.FC<IndicesEditorProps> = ({ value, colDef, onChange, onBlur, autoFocus }) => {
  const activeDatabase = useCopiperStore((s) => s.activeDatabase)
  const referenceData = useCopiperStore((s) => s.referenceData)

  const srcTable = colDef.src ||
    colDef.type.replace(/^indices\//, '').replace(/^list:index\//, '')

  const selectOptions = useMemo(() => {
    if (!srcTable) return []
    let rows: Array<{ id: number | string; idx_name?: string }> = []
    const localTable = getTableData(activeDatabase, srcTable)
    if (localTable) {
      rows = localTable.rows
    } else if (referenceData[srcTable]) {
      rows = referenceData[srcTable]
    }
    return rows
      .map((r) => (r.idx_name != null ? String(r.idx_name) : String(r.id)))
      .filter(Boolean)
      .map((v) => ({ label: v, value: v }))
  }, [srcTable, activeDatabase, referenceData])

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
        options={selectOptions}
        onChange={(vals: string[]) => {
          onChange(vals.join('|'))
        }}
        onBlur={onBlur}
      />
    </Tooltip>
  )
}

export default IndicesEditor
