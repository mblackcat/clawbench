import React, { useState, useEffect } from 'react'
import { Modal, Form, Input, Select, InputNumber, Button, App } from 'antd'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import { useT } from '../../i18n'
import type { DBConnection, DBConnectionType } from '../../types/ai-terminal'

interface Props {
  open: boolean
  connection: DBConnection | null
  onClose: () => void
}

const DB_TYPES: { value: DBConnectionType; label: string }[] = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mongodb', label: 'MongoDB' },
  { value: 'sqlite', label: 'SQLite' }
]

const DEFAULT_PORTS: Record<DBConnectionType, number> = {
  mysql: 3306,
  postgres: 5432,
  mongodb: 27017,
  sqlite: 0
}

const EditDBConnectionModal: React.FC<Props> = ({ open, connection, onClose }) => {
  const [form] = Form.useForm()
  const { message } = App.useApp()
  const t = useT()
  const { createDBConnection, updateDBConnection, testDBConnection } = useAITerminalStore()
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [dbType, setDbType] = useState<DBConnectionType>('mysql')

  useEffect(() => {
    if (open) {
      if (connection) {
        form.setFieldsValue({
          name: connection.name,
          type: connection.type,
          host: connection.host,
          port: connection.port,
          username: connection.username,
          password: connection.password,
          database: connection.database,
          filePath: connection.filePath
        })
        setDbType(connection.type)
      } else {
        form.resetFields()
        form.setFieldsValue({ type: 'mysql', port: 3306 })
        setDbType('mysql')
      }
    }
  }, [open, connection, form])

  const handleTypeChange = (type: DBConnectionType) => {
    setDbType(type)
    form.setFieldsValue({ port: DEFAULT_PORTS[type] })
  }

  const handleTest = async () => {
    try {
      const values = await form.validateFields()
      setTesting(true)
      const result = await testDBConnection({
        name: values.name,
        type: values.type,
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        database: values.database,
        filePath: values.filePath
      })
      if (result.success) {
        message.success(t('terminal.testSuccess'))
      } else {
        message.error(t('terminal.testFailed', result.error || ''))
      }
    } catch {
      // validation error
    } finally {
      setTesting(false)
    }
  }

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)

      const data = {
        name: values.name,
        type: values.type as DBConnectionType,
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        database: values.database,
        filePath: values.filePath
      }

      if (connection) {
        await updateDBConnection(connection.id, data)
      } else {
        await createDBConnection(data)
      }

      message.success(connection ? t('terminal.connUpdated') : t('terminal.connCreated'))
      onClose()
    } catch {
      // validation error
    } finally {
      setLoading(false)
    }
  }

  const isSqlite = dbType === 'sqlite'
  const isMongo = dbType === 'mongodb'

  return (
    <Modal
      title={connection ? t('terminal.editDBConn') : t('terminal.newDBConn')}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      destroyOnHidden
      footer={[
        <Button key="test" onClick={handleTest} loading={testing}>
          {t('terminal.testConnection')}
        </Button>,
        <Button key="cancel" onClick={onClose}>{t('common.cancel')}</Button>,
        <Button key="ok" type="primary" onClick={handleOk} loading={loading}>
          {t('common.confirm')}
        </Button>
      ]}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label={t('terminal.connName')} rules={[{ required: true, message: t('terminal.connNameRequired') }]}>
          <Input placeholder={t('terminal.connNameDBPlaceholder')} />
        </Form.Item>

        <Form.Item name="type" label={t('terminal.dbType')} rules={[{ required: true }]}>
          <Select options={DB_TYPES} onChange={handleTypeChange} />
        </Form.Item>

        {isSqlite ? (
          <Form.Item
            name="filePath"
            label={t('terminal.dbFilePath')}
            rules={[{ required: true, message: t('terminal.dbFilePathRequired') }]}
          >
            <Input placeholder={t('terminal.dbFilePathPlaceholder')} />
          </Form.Item>
        ) : (
          <>
            <Form.Item name="host" label={t('terminal.host')} rules={[{ required: true, message: t('terminal.hostRequired') }]}>
              <Input placeholder={isMongo ? 'mongodb://... 或 localhost' : '例如: localhost'} />
            </Form.Item>

            <Form.Item name="port" label={t('terminal.port')}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item name="username" label={t('terminal.username')}>
              <Input placeholder={dbType === 'mysql' ? 'root' : dbType === 'postgres' ? 'postgres' : ''} />
            </Form.Item>

            <Form.Item name="password" label={t('terminal.password')}>
              <Input.Password />
            </Form.Item>

            <Form.Item name="database" label={isMongo ? t('terminal.dbName') : t('terminal.database')}>
              <Input placeholder={isMongo ? 'test' : ''} />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  )
}

export default EditDBConnectionModal
