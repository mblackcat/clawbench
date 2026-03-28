import React, { useState, useEffect } from 'react'
import { Modal, Form, Input, InputNumber, Switch, Select, Typography, App, theme } from 'antd'
import { useCopiperStore } from '../../stores/useCopiperStore'
import type { TableInfo } from '../../types/copiper'

const { Text } = Typography

interface TableInfoEditorProps {
  open: boolean
  onClose: () => void
}

const TableInfoEditor: React.FC<TableInfoEditorProps> = ({ open, onClose }) => {
  const { token } = theme.useToken()
  const { message } = App.useApp()

  const activeTableName = useCopiperStore((s) => s.activeTableName)
  const tableInfos = useCopiperStore((s) => s.tableInfos)

  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  // Find the matching TableInfo for the active table
  const currentInfo = tableInfos.find(
    (info) => info.ptb === activeTableName
  )

  useEffect(() => {
    if (open && currentInfo) {
      form.setFieldsValue({
        db_key: currentInfo.db_key,
        rel_dir: currentInfo.rel_dir,
        ptb: currentInfo.ptb,
        sheet_name: currentInfo.sheet_name,
        from: currentInfo.from,
        to: currentInfo.to,
        src_list: currentInfo.src_list?.join(', ') || '',
        use_jdb: currentInfo.use_jdb,
        auto_divide_num: currentInfo.auto_divide_num,
        desc: currentInfo.desc || ''
      })
    } else if (open) {
      form.setFieldsValue({
        db_key: '',
        rel_dir: '',
        ptb: activeTableName || '',
        sheet_name: activeTableName || '',
        from: 'idx_name',
        to: 'id',
        src_list: '',
        use_jdb: true,
        auto_divide_num: 0,
        desc: ''
      })
    }
  }, [open, currentInfo, activeTableName, form])

  const handleSave = async () => {
    try {
      const values = await form.validateFields()

      const info: Partial<TableInfo> = {
        ...currentInfo,
        db_key: values.db_key,
        rel_dir: values.rel_dir,
        ptb: values.ptb,
        sheet_name: values.sheet_name,
        from: values.from,
        to: values.to,
        src_list: values.src_list
          ? values.src_list.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [],
        use_jdb: values.use_jdb,
        auto_divide_num: values.auto_divide_num ?? 0,
        desc: values.desc
      }

      setSaving(true)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (window.api as any).copiper.saveTableInfos([info as TableInfo])
        message.success('Table info saved')
        onClose()
      } catch (err) {
        message.error('Failed to save: ' + (err instanceof Error ? err.message : String(err)))
      } finally {
        setSaving(false)
      }
    } catch {
      // Validation failed
    }
  }

  return (
    <Modal
      title={`表信息: ${activeTableName || '(无)'}`}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      okText="保存"
      okButtonProps={{ loading: saving }}
      width={560}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" size="small">
        <Form.Item name="db_key" label="DB Key">
          <Input placeholder="{rel_dir}_{db_name}_{tb_name}" />
        </Form.Item>

        <Form.Item name="rel_dir" label="Relative Directory">
          <Input placeholder="e.g. basic" />
        </Form.Item>

        <Form.Item name="ptb" label="Table Name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>

        <Form.Item name="sheet_name" label="Sheet Name">
          <Input placeholder="Excel sheet name" />
        </Form.Item>

        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="from" label="From Column" style={{ flex: 1 }}>
            <Input placeholder="idx_name" />
          </Form.Item>
          <Form.Item name="to" label="To Column" style={{ flex: 1 }}>
            <Input placeholder="id" />
          </Form.Item>
        </div>

        <Form.Item name="src_list" label="Source Tables" extra="Comma-separated list of source table names">
          <Input placeholder="TableA, TableB" />
        </Form.Item>

        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="use_jdb" label="Use JDB" valuePropName="checked" style={{ flex: 1 }}>
            <Switch />
          </Form.Item>
          <Form.Item name="auto_divide_num" label="Auto Divide Num" style={{ flex: 1 }}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </div>

        <Form.Item name="desc" label="Description">
          <Input.TextArea rows={3} placeholder="Table description..." />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default TableInfoEditor
