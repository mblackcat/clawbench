import React, { useState, useEffect } from 'react'
import { Modal, Form, Input, Select, App } from 'antd'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import type { QuickCommand } from '../../types/ai-terminal'

const { TextArea } = Input

interface Props {
  open: boolean
  command: QuickCommand | null
  onClose: () => void
}

const EditQuickCommandModal: React.FC<Props> = ({ open, command, onClose }) => {
  const [form] = Form.useForm()
  const { message } = App.useApp()
  const { saveQuickCommand, connections } = useAITerminalStore()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      if (command) {
        form.setFieldsValue({
          name: command.name,
          commands: command.commands,
          targets: command.targets
        })
      } else {
        form.resetFields()
        form.setFieldsValue({ targets: [] })
      }
    }
  }, [open, command, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)

      await saveQuickCommand({
        id: command?.id,
        name: values.name,
        commands: values.commands,
        targets: values.targets || []
      })

      message.success(command ? '命令已更新' : '命令已创建')
      onClose()
    } catch {
      // validation error
    } finally {
      setLoading(false)
    }
  }

  const targetOptions = [
    { value: 'local', label: '本地终端' },
    ...connections.map(c => ({ value: c.id, label: c.name }))
  ]

  return (
    <Modal
      title={command ? '编辑快捷命令' : '新建快捷命令'}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label="命令名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="例如: 部署生产" />
        </Form.Item>

        <Form.Item
          name="commands"
          label="命令内容"
          rules={[{ required: true, message: '请输入命令' }]}
          extra="多条命令用换行分隔，将按顺序执行"
        >
          <TextArea
            rows={4}
            placeholder={'git pull origin main\nnpm install\nnpm run build\npm2 restart all'}
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>

        <Form.Item
          name="targets"
          label="适用目标"
          extra="不选则对所有连接可用"
        >
          <Select
            mode="multiple"
            allowClear
            placeholder="默认所有连接"
            options={targetOptions}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default EditQuickCommandModal
