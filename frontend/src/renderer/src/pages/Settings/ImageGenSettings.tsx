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
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ImageGenConfig } from '../../types/ipc'
import { useT } from '../../i18n'

const { Text } = Typography

const PROVIDER_PRESETS: Record<
  string,
  { label: string; endpoint: string; defaultModel?: string }
> = {
  'dall-e': {
    label: 'DALL-E (OpenAI)',
    endpoint: 'https://api.openai.com',
    defaultModel: 'dall-e-3',
  },
  'stable-diffusion': {
    label: 'Stable Diffusion (A1111)',
    endpoint: 'http://127.0.0.1:7860',
  },
  custom: {
    label: 'imageGen.providerCustom',
    endpoint: '',
  },
}

const SIZE_OPTIONS = [
  { label: '1024×1024', value: '1024x1024' },
  { label: 'imageGen.sizePortrait', value: '1024x1792' },
  { label: 'imageGen.sizeLandscape', value: '1792x1024' },
  { label: '512×512', value: '512x512' },
  { label: '256×256', value: '256x256' },
]

const ImageGenSettings: React.FC = () => {
  const { message } = App.useApp()
  const t = useT()
  const [configs, setConfigs] = useState<ImageGenConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<ImageGenConfig | null>(null)
  const [form] = Form.useForm()

  const loadConfigs = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.api.settings.getImageGenConfigs()
      setConfigs(data)
    } catch {
      // not available
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfigs()
  }, [loadConfigs])

  const handleAdd = () => {
    setEditingConfig(null)
    form.resetFields()
    form.setFieldsValue({
      provider: 'dall-e',
      endpoint: PROVIDER_PRESETS['dall-e'].endpoint,
      defaultModel: PROVIDER_PRESETS['dall-e'].defaultModel,
      defaultSize: '1024x1024',
      enabled: true,
    })
    setModalOpen(true)
  }

  const handleEdit = (record: ImageGenConfig) => {
    setEditingConfig(record)
    form.setFieldsValue({ ...record })
    setModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    try {
      await window.api.settings.deleteImageGenConfig(id)
      message.success(t('imageGen.deleted'))
      loadConfigs()
    } catch {
      message.error(t('imageGen.deleteFailed'))
    }
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const config = {
        id: editingConfig?.id || crypto.randomUUID(),
        ...values,
      }
      await window.api.settings.saveImageGenConfig(config)
      message.success(t('common.saved'))
      setModalOpen(false)
      loadConfigs()
    } catch {
      // validation error
    }
  }

  const handleProviderChange = (provider: string) => {
    const preset = PROVIDER_PRESETS[provider]
    if (preset) {
      form.setFieldsValue({
        endpoint: preset.endpoint,
        defaultModel: preset.defaultModel || '',
      })
    }
  }

  const resolveProviderLabel = (label: string) =>
    label.includes('.') ? t(label) : label

  const columns = [
    {
      title: t('aiModel.colName'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: t('imageGen.colProvider'),
      dataIndex: 'provider',
      key: 'provider',
      width: 160,
      render: (p: string) => {
        const preset = PROVIDER_PRESETS[p]
        const label = preset ? resolveProviderLabel(preset.label) : p
        return <Tag>{label}</Tag>
      },
    },
    {
      title: t('imageGen.colEndpoint'),
      dataIndex: 'endpoint',
      key: 'endpoint',
      ellipsis: true,
      render: (url: string) => (
        <Text style={{ fontSize: 12 }} copyable>
          {url || '-'}
        </Text>
      ),
    },
    {
      title: t('aiModel.colEnabled'),
      dataIndex: 'enabled',
      key: 'enabled',
      width: 60,
      render: (enabled: boolean) =>
        enabled ? <Tag color="green">{t('aiModel.yes')}</Tag> : <Tag>{t('aiModel.no')}</Tag>,
    },
    {
      title: t('aiModel.colActions'),
      key: 'actions',
      width: 100,
      render: (_: unknown, record: ImageGenConfig) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title={t('imageGen.confirmDelete')}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
        </Space>
      ),
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
          {t('imageGen.desc')}
        </Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          {t('imageGen.addConfig')}
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={configs}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="small"
      />

      <Modal
        title={editingConfig ? t('imageGen.editTitle') : t('imageGen.addTitle')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={520}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label={t('aiModel.colName')}
            rules={[{ required: true, message: t('aiModel.formNameRequired') }]}
          >
            <Input placeholder={t('imageGen.namePlaceholder')} />
          </Form.Item>
          <Form.Item
            name="provider"
            label={t('imageGen.colProvider')}
            rules={[{ required: true }]}
          >
            <Select
              options={Object.entries(PROVIDER_PRESETS).map(([key, val]) => ({
                label: resolveProviderLabel(val.label),
                value: key,
              }))}
              onChange={handleProviderChange}
            />
          </Form.Item>
          <Form.Item
            name="endpoint"
            label={t('imageGen.endpointLabel')}
            rules={[{ required: true, message: t('imageGen.endpointRequired') }]}
          >
            <Input placeholder="https://api.openai.com" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key">
            <Input.Password placeholder="sk-..." />
          </Form.Item>
          <Form.Item name="defaultModel" label={t('imageGen.defaultModel')}>
            <Input placeholder={t('imageGen.defaultModelPlaceholder')} />
          </Form.Item>
          <Form.Item name="defaultSize" label={t('imageGen.defaultSize')}>
            <Select
              options={SIZE_OPTIONS.map((opt) => ({
                label: resolveProviderLabel(opt.label),
                value: opt.value,
              }))}
            />
          </Form.Item>
          <Form.Item name="enabled" label={t('aiModel.formEnabled')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default ImageGenSettings
