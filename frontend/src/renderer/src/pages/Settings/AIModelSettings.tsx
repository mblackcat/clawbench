import React, { useEffect, useState, useCallback, useMemo } from 'react'
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
  Tag,
  App,
  Typography,
  Checkbox,
  theme,
  Card
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ApiOutlined } from '@ant-design/icons'
import type { AIModelConfig } from '../../types/ipc'
import { useT } from '../../i18n'
import { ProviderIcon } from '../../components/ProviderIcons'

const { Text } = Typography

type ProviderKey = AIModelConfig['provider']

const PROVIDER_OPTIONS: { label: React.ReactNode; value: ProviderKey; rawLabel: string }[] = [
  { label: <><ProviderIcon provider="openai" size={14} style={{ marginRight: 6, position: 'relative', top: -1 }} />OpenAI</>, value: 'openai', rawLabel: 'OpenAI' },
  { label: <><ProviderIcon provider="openai-compatible" size={14} style={{ marginRight: 6, position: 'relative', top: -1 }} />OpenAI Compatible</>, value: 'openai-compatible', rawLabel: 'OpenAI Compatible' },
  { label: <><ProviderIcon provider="azure-openai" size={14} style={{ marginRight: 6, position: 'relative', top: -1 }} />Azure OpenAI</>, value: 'azure-openai', rawLabel: 'Azure OpenAI' },
  { label: <><ProviderIcon provider="google" size={14} style={{ marginRight: 6, position: 'relative', top: -1 }} />Google</>, value: 'google', rawLabel: 'Google' },
  { label: <><ProviderIcon provider="claude" size={14} style={{ marginRight: 6, position: 'relative', top: -1 }} />Claude</>, value: 'claude', rawLabel: 'Claude' },
  { label: <><ProviderIcon provider="anthropic-compatible" size={14} style={{ marginRight: 6, position: 'relative', top: -1 }} />Anthropic Compatible</>, value: 'anthropic-compatible', rawLabel: 'Anthropic Compatible' },
  { label: <><ProviderIcon provider="qwen" size={14} style={{ marginRight: 6, position: 'relative', top: -1 }} />Qwen</>, value: 'qwen', rawLabel: 'Qwen' },
  { label: <><ProviderIcon provider="doubao" size={14} style={{ marginRight: 6, position: 'relative', top: -1 }} />Doubao</>, value: 'doubao', rawLabel: 'Doubao' },
  { label: <><ProviderIcon provider="deepseek" size={14} style={{ marginRight: 6, position: 'relative', top: -1 }} />DeepSeek</>, value: 'deepseek', rawLabel: 'DeepSeek' },
  { label: <><ProviderIcon provider="kimi" size={14} style={{ marginRight: 6, position: 'relative', top: -1 }} />Kimi</>, value: 'kimi', rawLabel: 'Kimi' }
]

const DEFAULT_ENDPOINTS: Record<ProviderKey, string> = {
  openai: 'https://api.openai.com/v1',
  'openai-compatible': '',
  'azure-openai': '',
  google: 'https://generativelanguage.googleapis.com',
  claude: 'https://api.anthropic.com/v1',
  'anthropic-compatible': '',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  deepseek: 'https://api.deepseek.com/v1',
  kimi: 'https://api.moonshot.cn/v1'
}

const AIModelSettings: React.FC = () => {
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const t = useT()
  const [models, setModels] = useState<AIModelConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<AIModelConfig | null>(null)
  const [testing, setTesting] = useState(false)
  const [currentProvider, setCurrentProvider] = useState<ProviderKey>('openai')
  const [form] = Form.useForm()

  const capabilityOptions = useMemo(() => [
    { label: t('aiModel.imageGen'), value: 'image-gen' },
    { label: t('aiModel.toolUse'), value: 'tool-use' }
  ], [t])

  const loadModels = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.api.settings.getAiModels()
      setModels(data)
    } catch {
      message.error(t('aiModel.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadModels()
  }, [loadModels])

  const handleAdd = (): void => {
    setEditingModel(null)
    setCurrentProvider('openai')
    form.resetFields()
    form.setFieldsValue({
      provider: 'openai',
      endpoint: DEFAULT_ENDPOINTS.openai,
      enabled: true,
      models: [],
      capabilities: []
    })
    setModalOpen(true)
  }

  const handleEdit = (record: AIModelConfig): void => {
    setEditingModel(record)
    setCurrentProvider(record.provider)
    form.setFieldsValue({
      name: record.name,
      provider: record.provider,
      endpoint: record.endpoint,
      apiKey: record.apiKey,
      apiVersion: record.apiVersion,
      models: record.models,
      enabled: record.enabled,
      capabilities: record.capabilities || []
    })
    setModalOpen(true)
  }

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await window.api.settings.deleteAiModel(id)
      message.success(t('aiModel.deleted'))
      loadModels()
    } catch {
      message.error(t('aiModel.deleteFailed'))
    }
  }

  const handleProviderChange = (provider: ProviderKey): void => {
    setCurrentProvider(provider)
    const endpoint = DEFAULT_ENDPOINTS[provider]
    form.setFieldsValue({ endpoint })
    if (provider === 'azure-openai') {
      form.setFieldsValue({ apiVersion: '2025-04-01-preview' })
    } else {
      form.setFieldsValue({ apiVersion: undefined })
    }
  }

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    try {
      const values = form.getFieldsValue()
      const result = await window.api.settings.testAiModel({
        provider: values.provider,
        endpoint: values.endpoint,
        apiKey: values.apiKey || '',
        configId: editingModel?.id
      })
      if (result.success) {
        message.success(result.message)
      } else {
        message.error(result.message)
      }
    } catch {
      message.error(t('aiModel.testFailed'))
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      const config: Partial<AIModelConfig> = {
        ...values
      }
      if (editingModel) {
        config.id = editingModel.id
      }
      await window.api.settings.saveAiModel(config)
      message.success(editingModel ? t('aiModel.updated') : t('aiModel.added'))
      setModalOpen(false)
      loadModels()
    } catch {
      // validation error, ignore
    }
  }

  const columns = [
    {
      title: t('aiModel.colName'),
      dataIndex: 'name',
      key: 'name',
      width: 220,
      render: (name: string) => <Text strong>{name}</Text>
    },
    {
      title: t('aiModel.colProvider'),
      dataIndex: 'provider',
      key: 'provider',
      width: 160,
      render: (provider: string) => {
        const opt = PROVIDER_OPTIONS.find((p) => p.value === provider)
        return <Tag icon={<ProviderIcon provider={provider} size={14} style={{ marginRight: 4, position: 'relative', top: -1 }} />}>{opt?.rawLabel || provider}</Tag>
      }
    },
    {
      title: t('aiModel.colModels'),
      dataIndex: 'models',
      key: 'models',
      width: 160,
      render: (models: string[]) => (
        <Space size={[0, 4]} wrap>
          {models.map((m) => (
            <Tag key={m} color="blue">
              {m}
            </Tag>
          ))}
        </Space>
      )
    },
    {
      title: t('aiModel.colCapabilities'),
      dataIndex: 'capabilities',
      key: 'capabilities',
      width: 160,
      render: (caps: string[] | undefined) => (
        <Space size={[0, 4]} wrap>
          {(caps || []).includes('image-gen') && (
            <Tag color="magenta">{t('aiModel.imageGen')}</Tag>
          )}
          {(caps || []).includes('tool-use') && (
            <Tag color="geekblue">{t('aiModel.toolUse')}</Tag>
          )}
        </Space>
      )
    },
    {
      title: t('aiModel.colEnabled'),
      dataIndex: 'enabled',
      key: 'enabled',
      width: 60,
      render: (enabled: boolean) =>
        enabled ? <Tag color="green">{t('aiModel.yes')}</Tag> : <Tag>{t('aiModel.no')}</Tag>
    },
    {
      title: t('aiModel.colActions'),
      key: 'actions',
      width: 100,
      render: (_: unknown, record: AIModelConfig) => (
        <Space size={4}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Popconfirm
            title={t('aiModel.confirmDelete')}
            onConfirm={() => handleDelete(record.id)}
            okText={t('common.delete')}
            cancelText={t('common.cancel')}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('aiModel.desc')}
        </Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          {t('aiModel.addModel')}
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
          dataSource={models}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
          locale={{ emptyText: t('aiModel.emptyText') }}
        />
      </Card>

      <Modal
        title={editingModel ? t('aiModel.editModel') : t('aiModel.addModelTitle')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        width={520}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label={t('aiModel.formName')}
            rules={[{ required: true, message: t('aiModel.formNameRequired') }]}
          >
            <Input placeholder={t('aiModel.formNamePlaceholder')} />
          </Form.Item>

          <Form.Item
            name="provider"
            label={t('aiModel.formProvider')}
            rules={[{ required: true, message: t('aiModel.formProviderRequired') }]}
          >
            <Select options={PROVIDER_OPTIONS} onChange={handleProviderChange} />
          </Form.Item>

          <Form.Item
            name="endpoint"
            label={t('aiModel.formEndpoint')}
            rules={[{ required: true, message: t('aiModel.formEndpointRequired') }]}
          >
            <Input placeholder={currentProvider === 'azure-openai' ? 'https://your-resource.openai.azure.com' : 'https://api.openai.com/v1'} />
          </Form.Item>

          {currentProvider === 'azure-openai' && (
            <Form.Item
              name="apiVersion"
              label={t('aiModel.formApiVersion')}
              rules={[{ required: true, message: t('aiModel.formApiVersionRequired') }]}
            >
              <Input placeholder="2025-04-01-preview" />
            </Form.Item>
          )}

          <Form.Item
            name="apiKey"
            label={t('aiModel.formApiKey')}
            rules={[{ required: !editingModel, message: t('aiModel.formApiKeyRequired') }]}
          >
            <Input.Password placeholder={editingModel ? t('aiModel.formApiKeyPlaceholder') : t('aiModel.formApiKeyRequired')} />
          </Form.Item>

          <Form.Item name="models" label={t('aiModel.formModels')}>
            <Select
              mode="tags"
              placeholder={t('aiModel.formModelsPlaceholder')}
              tokenSeparators={[',']}
            />
          </Form.Item>

          <Form.Item name="capabilities" label={t('aiModel.formCapabilities')}>
            <Checkbox.Group options={capabilityOptions} />
          </Form.Item>

          <Form.Item name="enabled" label={t('aiModel.formEnabled')} valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item>
            <Button icon={<ApiOutlined />} loading={testing} onClick={handleTest}>
              {t('aiModel.testConnection')}
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default AIModelSettings
