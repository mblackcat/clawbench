import React, { useState, useEffect } from 'react'
import { Modal, Form, Input, Select, InputNumber, Radio, App } from 'antd'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import { useT } from '../../i18n'
import type { TerminalConnection } from '../../types/ai-terminal'

interface Props {
  open: boolean
  connection: TerminalConnection | null
  onClose: () => void
}

const EditConnectionModal: React.FC<Props> = ({ open, connection, onClose }) => {
  const [form] = Form.useForm()
  const { message } = App.useApp()
  const t = useT()
  const { createConnection, updateConnection } = useAITerminalStore()
  const [loading, setLoading] = useState(false)
  const [connType, setConnType] = useState<'ssh'>('ssh')

  useEffect(() => {
    if (open) {
      if (connection) {
        form.setFieldsValue({
          name: connection.name,
          host: connection.host,
          port: connection.port || 22,
          username: connection.username,
          authMethod: connection.authMethod || 'agent',
          privateKeyPath: connection.privateKeyPath,
          password: connection.password,
          startupCommand: connection.startupCommand
        })
      } else {
        form.resetFields()
        form.setFieldsValue({ port: 22, authMethod: 'agent' })
      }
    }
  }, [open, connection, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)

      const data = {
        name: values.name,
        type: 'ssh' as const,
        host: values.host,
        port: values.port || 22,
        username: values.username,
        authMethod: values.authMethod,
        privateKeyPath: values.authMethod === 'key' ? values.privateKeyPath : undefined,
        password: values.authMethod === 'password' ? values.password : undefined,
        startupCommand: values.startupCommand || undefined,
        fromSSHConfig: false
      }

      if (connection) {
        await updateConnection(connection.id, data)
        if (connection.fromSSHConfig) {
          message.info(t('terminal.sshConfigNote'))
        }
      } else {
        await createConnection(data)
      }

      message.success(connection ? t('terminal.connUpdated') : t('terminal.connCreated'))
      onClose()
    } catch {
      // validation error
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={connection ? t('terminal.editConnection') : t('terminal.newSSH')}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label={t('terminal.connName')} rules={[{ required: true, message: t('terminal.connNameRequired') }]}>
          <Input placeholder={t('terminal.connNamePlaceholder')} />
        </Form.Item>

        <Form.Item name="host" label={t('terminal.host')} rules={[{ required: true, message: t('terminal.hostRequired') }]}>
          <Input placeholder={t('terminal.hostPlaceholder')} />
        </Form.Item>

        <Form.Item name="port" label={t('terminal.port')}>
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item name="username" label={t('terminal.username')}>
          <Input placeholder={t('terminal.usernamePlaceholder')} />
        </Form.Item>

        <Form.Item name="authMethod" label={t('terminal.authMethod')}>
          <Radio.Group>
            <Radio value="agent">SSH Agent</Radio>
            <Radio value="key">{t('terminal.authKey')}</Radio>
            <Radio value="password">{t('terminal.authPassword')}</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          noStyle
          shouldUpdate={(prev, curr) => prev.authMethod !== curr.authMethod}
        >
          {({ getFieldValue }) => {
            const method = getFieldValue('authMethod')
            if (method === 'key') {
              return (
                <Form.Item name="privateKeyPath" label={t('terminal.privateKeyPath')}>
                  <Input placeholder={t('terminal.privateKeyPlaceholder')} />
                </Form.Item>
              )
            }
            if (method === 'password') {
              return (
                <Form.Item name="password" label={t('terminal.password')}>
                  <Input.Password />
                </Form.Item>
              )
            }
            return null
          }}
        </Form.Item>

        <Form.Item name="startupCommand" label={t('terminal.startupCommand')}>
          <Input placeholder={t('terminal.startupPlaceholder')} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default EditConnectionModal
