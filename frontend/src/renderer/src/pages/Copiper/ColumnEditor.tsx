import React, { useState, useMemo } from 'react'
import { Modal, Table, Input, Select, Button, Space, App, theme, Typography } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useCopiperStore } from '../../stores/useCopiperStore'
import type { ColDef } from '../../types/copiper'

const { Text } = Typography

interface ColumnEditorProps {
  open: boolean
  onClose: () => void
}

const typeOptions = [
  'str', 'int', 'float', 'bool',
  'index/', 'indices/', 'kv:', 'ckv:',
  'tstr', 'istr', 'list:', 'utc_time', 'dict'
].map((t) => ({ label: t, value: t }))

const cTypeOptions = [
  { label: 'data', value: 'data' },
  { label: 'sup', value: 'sup' },
  { label: 'rdesc', value: 'rdesc' }
]

const reqOptOptions = [
  { label: '必填', value: 'required' },
  { label: '可选', value: 'optional' }
]

const ColumnEditor: React.FC<ColumnEditorProps> = ({ open, onClose }) => {
  const { token } = theme.useToken()
  const { message } = App.useApp()

  const activeDatabase = useCopiperStore((s) => s.activeDatabase)
  const activeTableName = useCopiperStore((s) => s.activeTableName)
  const updateCell = useCopiperStore((s) => s.updateCell)

  const [localColumns, setLocalColumns] = useState<ColDef[]>([])
  const [initialized, setInitialized] = useState(false)

  // Sync local state when opening
  const tableData = useMemo(() => {
    if (!activeDatabase || !activeTableName) return null
    return activeDatabase[activeTableName] ?? null
  }, [activeDatabase, activeTableName])

  if (open && !initialized && tableData) {
    setLocalColumns([...tableData.columns].sort((a, b) => a.c_index - b.c_index))
    setInitialized(true)
  }
  if (!open && initialized) {
    setInitialized(false)
  }

  const handleFieldChange = (index: number, field: keyof ColDef, value: unknown) => {
    setLocalColumns((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }

  const handleAddColumn = () => {
    const maxIndex = localColumns.reduce((max, c) => Math.max(max, c.c_index), 0)
    const newCol: ColDef = {
      id: `col_${Date.now()}`,
      name: `new_field_${localColumns.length + 1}`,
      rname: `新字段 ${localColumns.length + 1}`,
      type: 'str',
      j_type: 'str',
      req_or_opt: 'optional',
      c_type: 'data',
      c_index: maxIndex + 1,
      src: ''
    }
    setLocalColumns([...localColumns, newCol])
  }

  const handleDeleteColumn = (index: number) => {
    setLocalColumns((prev) => prev.filter((_, i) => i !== index))
  }

  const handleOk = () => {
    if (!activeDatabase || !activeTableName) return

    // Validate: each column must have a unique non-empty name
    const names = localColumns.map((c) => c.name)
    const uniqueNames = new Set(names)
    if (names.some((n) => !n.trim())) {
      message.error('字段名不能为空')
      return
    }
    if (uniqueNames.size !== names.length) {
      message.error('字段名不能重复')
      return
    }

    // Apply changes: replace columns in the active table
    // Use updateCell pattern -- since the store manages activeDatabase immutably,
    // we construct the updated table and set it via internal state
    const table = activeDatabase[activeTableName]
    if (!table) return

    // Rebuild: we rely on the store being updated externally via IPC in production;
    // for now, directly modify the columns array through the existing store.
    // This is a simplified approach -- the real implementation would call
    // window.api.copiper.updateColumns or similar.
    // For now, we update the in-memory database:
    const newDb = {
      ...activeDatabase,
      [activeTableName]: {
        ...table,
        columns: localColumns
      }
    }
    // Force store update through a workaround (set dirty)
    useCopiperStore.setState({
      activeDatabase: newDb,
      dirty: true
    })

    message.success('列配置已更新')
    onClose()
  }

  const tableColumns = [
    {
      title: '字段名',
      dataIndex: 'name',
      key: 'name',
      width: 130,
      render: (_: unknown, _record: ColDef, index: number) => (
        <Input
          size="small"
          value={localColumns[index]?.name}
          onChange={(e) => handleFieldChange(index, 'name', e.target.value)}
        />
      )
    },
    {
      title: '显示名',
      dataIndex: 'rname',
      key: 'rname',
      width: 130,
      render: (_: unknown, _record: ColDef, index: number) => (
        <Input
          size="small"
          value={localColumns[index]?.rname}
          onChange={(e) => handleFieldChange(index, 'rname', e.target.value)}
        />
      )
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 140,
      render: (_: unknown, _record: ColDef, index: number) => (
        <Input
          size="small"
          value={localColumns[index]?.type}
          placeholder="str"
          onChange={(e) => handleFieldChange(index, 'type', e.target.value)}
        />
      )
    },
    {
      title: '必填',
      dataIndex: 'req_or_opt',
      key: 'req_or_opt',
      width: 110,
      render: (_: unknown, _record: ColDef, index: number) => (
        <Select
          size="small"
          value={localColumns[index]?.req_or_opt}
          options={reqOptOptions}
          style={{ width: '100%' }}
          onChange={(val) => handleFieldChange(index, 'req_or_opt', val)}
        />
      )
    },
    {
      title: '分类',
      dataIndex: 'c_type',
      key: 'c_type',
      width: 100,
      render: (_: unknown, _record: ColDef, index: number) => (
        <Select
          size="small"
          value={localColumns[index]?.c_type}
          options={cTypeOptions}
          style={{ width: '100%' }}
          onChange={(val) => handleFieldChange(index, 'c_type', val)}
        />
      )
    },
    {
      title: '数据源',
      dataIndex: 'src',
      key: 'src',
      width: 120,
      render: (_: unknown, record: ColDef, index: number) => {
        const showSrc = record.type?.startsWith('index/') || record.type?.startsWith('indices/')
        return showSrc ? (
          <Input
            size="small"
            value={localColumns[index]?.src}
            placeholder="表名"
            onChange={(e) => handleFieldChange(index, 'src', e.target.value)}
          />
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>-</Text>
        )
      }
    },
    {
      title: '选项',
      dataIndex: 'options',
      key: 'options',
      width: 130,
      render: (_: unknown, _record: ColDef, index: number) => (
        <Input
          size="small"
          value={
            localColumns[index]?.options
              ? Array.isArray(localColumns[index].options)
                ? (localColumns[index].options as string[]).join('|')
                : String(localColumns[index].options)
              : ''
          }
          placeholder="选项1|选项2|..."
          onChange={(e) => handleFieldChange(index, 'options', e.target.value)}
        />
      )
    },
    {
      title: '',
      key: 'actions',
      width: 50,
      render: (_: unknown, _record: ColDef, index: number) => (
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleDeleteColumn(index)}
        />
      )
    }
  ]

  return (
    <Modal
      title="列管理"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="确定"
      cancelText="取消"
      width={960}
      destroyOnHidden
    >
      <div style={{ marginBottom: 12 }}>
        <Button size="small" icon={<PlusOutlined />} onClick={handleAddColumn}>
          添加列
        </Button>
      </div>
      <Table
        columns={tableColumns}
        dataSource={localColumns}
        rowKey={(record) => record.id || record.name}
        size="small"
        pagination={false}
        scroll={{ y: 400 }}
      />
    </Modal>
  )
}

export default ColumnEditor
