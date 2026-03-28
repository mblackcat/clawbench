import React, { useState, useEffect, useCallback } from 'react'
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Space,
  Popconfirm,
  App,
  Tag,
  Typography,
  Card,
  theme,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  LinkOutlined,
  DisconnectOutlined,
  ApiOutlined,
} from '@ant-design/icons'
import { useT } from '../../i18n'

const { Text } = Typography

interface MCPServerConfig {
  id: string
  name: string
  transportType: 'stdio' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled: boolean
}

interface ServerStatus {
  id: string
  name: string
  connected: boolean
  toolCount: number
}

const MCPServerSettings: React.FC = () => {
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const t = useT()
  const [servers, setServers] = useState<MCPServerConfig[]>([])
  const [statusMap, setStatusMap] = useState<Map<string, ServerStatus>>(new Map())
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null)
  const [form] = Form.useForm()
  const [connecting, setConnecting] = useState<string | null>(null)

  const loadServers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.api.mcp.getServers()
      setServers(data)
      // Also get connection status
      const status = await window.api.mcp.getStatus()
      const map = new Map<string, ServerStatus>()
      for (const s of status) {
        map.set(s.id, s)
      }
      setStatusMap(map)
    } catch {
      // MCP not available
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadServers()
  }, [loadServers])

  const handleAdd = () => {
    setEditingServer(null)
    form.resetFields()
    form.setFieldsValue({ transportType: 'stdio', enabled: true })
    setModalOpen(true)
  }

  const handleEdit = (record: MCPServerConfig) => {
    setEditingServer(record)
    form.setFieldsValue({
      ...record,
      args: record.args?.join(' ') || '',
      envStr: record.env
        ? Object.entries(record.env)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')
        : '',
    })
    setModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    try {
      await window.api.mcp.deleteServer(id)
      message.success(t('mcp.deleted'))
      loadServers()
    } catch {
      message.error(t('mcp.deleteFailed'))
    }
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const config: MCPServerConfig = {
        id: editingServer?.id || crypto.randomUUID(),
        name: values.name,
        transportType: values.transportType,
        command: values.command || undefined,
        args: values.args ? values.args.split(/\s+/).filter(Boolean) : undefined,
        url: values.url || undefined,
        env: values.envStr
          ? Object.fromEntries(
              values.envStr
                .split('\n')
                .filter((l: string) => l.includes('='))
                .map((l: string) => {
                  const idx = l.indexOf('=')
                  return [l.substring(0, idx), l.substring(idx + 1)]
                })
            )
          : undefined,
        enabled: values.enabled ?? true,
      }
      await window.api.mcp.saveServer(config as any)
      message.success(t('mcp.saved'))
      setModalOpen(false)
      loadServers()
    } catch {
      // validation error
    }
  }

  const handleConnect = async (id: string) => {
    setConnecting(id)
    try {
      const result = await window.api.mcp.connect(id)
      message.success(t('mcp.connected', String(result.tools.length)))
      loadServers()
    } catch (err: any) {
      message.error(t('mcp.connectFailed', err.message || 'Unknown error'))
    } finally {
      setConnecting(null)
    }
  }

  const handleDisconnect = async (id: string) => {
    try {
      await window.api.mcp.disconnect(id)
      message.success(t('mcp.disconnected'))
      loadServers()
    } catch {
      message.error(t('mcp.disconnectFailed'))
    }
  }

  const transportType = Form.useWatch('transportType', form)

  const columns = [
    {
      title: t('mcp.colName'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: t('mcp.colTransport'),
      dataIndex: 'transportType',
      key: 'transportType',
      width: 110,
      render: (tp: string) => <Tag>{tp.toUpperCase()}</Tag>,
    },
    {
      title: t('mcp.colTarget'),
      key: 'target',
      ellipsis: true,
      render: (_: unknown, record: MCPServerConfig) => (
        <Text style={{ fontSize: 12 }} copyable>
          {record.transportType === 'stdio'
            ? `${record.command} ${(record.args || []).join(' ')}`
            : record.url || '-'}
        </Text>
      ),
    },
    {
      title: t('mcp.colStatus'),
      key: 'status',
      width: 120,
      render: (_: unknown, record: MCPServerConfig) => {
        const status = statusMap.get(record.id)
        if (status?.connected) {
          return (
            <Tag color="success" icon={<ApiOutlined />}>
              {t('mcp.statusConnected', String(status.toolCount))}
            </Tag>
          )
        }
        return <Tag>{t('mcp.statusDisconnected')}</Tag>
      },
    },
    {
      title: t('mcp.colEnabled'),
      dataIndex: 'enabled',
      key: 'enabled',
      width: 85,
      render: (enabled: boolean) =>
        enabled ? <Tag color="green">{t('mcp.yes')}</Tag> : <Tag>{t('mcp.no')}</Tag>,
    },
    {
      title: t('mcp.colActions'),
      key: 'actions',
      width: 180,
      render: (_: unknown, record: MCPServerConfig) => {
        const status = statusMap.get(record.id)
        return (
          <Space size={4}>
            {status?.connected ? (
              <Button
                type="link"
                size="small"
                icon={<DisconnectOutlined />}
                onClick={() => handleDisconnect(record.id)}
              >
                {t('mcp.disconnect')}
              </Button>
            ) : (
              <Button
                type="link"
                size="small"
                icon={<LinkOutlined />}
                loading={connecting === record.id}
                onClick={() => handleConnect(record.id)}
              >
                {t('mcp.connect')}
              </Button>
            )}
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
            <Popconfirm title={t('mcp.confirmDelete')} onConfirm={() => handleDelete(record.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  return (
    <div>
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('mcp.desc')}
        </Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          {t('mcp.addServer')}
        </Button>
      </div>

      <Card
        size="small"
        className="settings-table-card"
        style={{ borderRadius: token.borderRadiusLG, borderColor: token.colorPrimaryBorder, overflow: 'hidden' }}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          columns={columns}
          dataSource={servers}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
        />
      </Card>

      <Modal
        title={editingServer ? t('mcp.editServer') : t('mcp.addServerTitle')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={520}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label={t('mcp.formName')}
            rules={[{ required: true, message: t('mcp.formNameRequired') }]}
          >
            <Input placeholder={t('mcp.formNamePlaceholder')} />
          </Form.Item>
          <Form.Item
            name="transportType"
            label={t('mcp.formTransport')}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { label: t('mcp.formTransportStdio'), value: 'stdio' },
                { label: t('mcp.formTransportSSE'), value: 'sse' },
              ]}
            />
          </Form.Item>
          {transportType === 'stdio' && (
            <>
              <Form.Item
                name="command"
                label={t('mcp.formCommand')}
                rules={[{ required: true, message: t('mcp.formCommandRequired') }]}
              >
                <Input placeholder={t('mcp.formCommandPlaceholder')} />
              </Form.Item>
              <Form.Item name="args" label={t('mcp.formArgs')}>
                <Input placeholder={t('mcp.formArgsPlaceholder')} />
              </Form.Item>
              <Form.Item name="envStr" label={t('mcp.formEnv')}>
                <Input.TextArea
                  rows={3}
                  placeholder={"API_KEY=xxx\nDEBUG=true"}
                />
              </Form.Item>
            </>
          )}
          {transportType === 'sse' && (
            <Form.Item
              name="url"
              label={t('mcp.formUrl')}
              rules={[{ required: true, message: t('mcp.formUrlRequired') }]}
            >
              <Input placeholder={t('mcp.formUrlPlaceholder')} />
            </Form.Item>
          )}
          <Form.Item name="enabled" label={t('mcp.formEnabled')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default MCPServerSettings
