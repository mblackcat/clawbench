import React, { useState, useEffect } from 'react'
import { Modal, Form, Input, Select, App } from 'antd'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import { useT } from '../../i18n'
import type { QuickCommand } from '../../types/ai-terminal'
import { MONO_FONT_STACK } from '../../utils/mono-font'

const { TextArea } = Input

interface Props {
  open: boolean
  command: QuickCommand | null
  onClose: () => void
}

const EditQuickCommandModal: React.FC<Props> = ({ open, command, onClose }) => {
  const [form] = Form.useForm()
  const { message } = App.useApp()
  const t = useT()
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

      message.success(command ? t('terminal.cmdUpdated') : t('terminal.cmdCreated'))
      onClose()
    } catch {
      // validation error
    } finally {
      setLoading(false)
    }
  }

  const targetOptions = [
    { value: 'local', label: t('terminal.localTerminal') },
    ...connections.map(c => ({ value: c.id, label: c.name }))
  ]

  return (
    <Modal
      title={command ? t('terminal.editQuickCmd') : t('terminal.newQuickCmd')}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label={t('terminal.cmdName')} rules={[{ required: true, message: t('terminal.cmdNameRequired') }]}>
          <Input placeholder={t('terminal.cmdNamePlaceholder')} />
        </Form.Item>

        <Form.Item
          name="commands"
          label={t('terminal.cmdContent')}
          rules={[{ required: true, message: t('terminal.cmdContentRequired') }]}
          extra={t('terminal.cmdContentExtra')}
        >
          <TextArea
            rows={4}
            placeholder={'git pull origin main\nnpm install\nnpm run build\npm2 restart all'}
            style={{ fontFamily: MONO_FONT_STACK }}
          />
        </Form.Item>

        <Form.Item
          name="targets"
          label={t('terminal.cmdTargets')}
          extra={t('terminal.cmdTargetsExtra')}
        >
          <Select
            mode="multiple"
            allowClear
            placeholder={t('terminal.cmdTargetsPlaceholder')}
            options={targetOptions}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default EditQuickCommandModal
