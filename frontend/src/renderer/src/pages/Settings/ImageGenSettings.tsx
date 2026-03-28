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
    label: '自定义 (OpenAI 兼容)',
    endpoint: '',
  },
}

const SIZE_OPTIONS = [
  { label: '1024×1024', value: '1024x1024' },
  { label: '1024×1792 (竖)', value: '1024x1792' },
  { label: '1792×1024 (横)', value: '1792x1024' },
  { label: '512×512', value: '512x512' },
  { label: '256×256', value: '256x256' },
]

const ImageGenSettings: React.FC = () => {
  const { message } = App.useApp()
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
      message.success('已删除')
      loadConfigs()
    } catch {
      message.error('删除失败')
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
      message.success('已保存')
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

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '服务商',
      dataIndex: 'provider',
      key: 'provider',
      width: 160,
      render: (p: string) => (
        <Tag>{PROVIDER_PRESETS[p]?.label || p}</Tag>
      ),
    },
    {
      title: '端点',
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
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 60,
      render: (enabled: boolean) =>
        enabled ? <Tag color="green">是</Tag> : <Tag>否</Tag>,
    },
    {
      title: '操作',
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
            title="确定删除？"
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
          配置图片生成服务（DALL-E、Stable Diffusion 等），为 AI 对话提供文生图和图生图能力
        </Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          添加配置
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
        title={editingConfig ? '编辑图片生成配置' : '添加图片生成配置'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={520}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="例如：DALL-E 3" />
          </Form.Item>
          <Form.Item
            name="provider"
            label="服务商"
            rules={[{ required: true }]}
          >
            <Select
              options={Object.entries(PROVIDER_PRESETS).map(([key, val]) => ({
                label: val.label,
                value: key,
              }))}
              onChange={handleProviderChange}
            />
          </Form.Item>
          <Form.Item
            name="endpoint"
            label="API 端点"
            rules={[{ required: true, message: '请输入端点地址' }]}
          >
            <Input placeholder="https://api.openai.com" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key">
            <Input.Password placeholder="sk-..." />
          </Form.Item>
          <Form.Item name="defaultModel" label="默认模型">
            <Input placeholder="例如：dall-e-3" />
          </Form.Item>
          <Form.Item name="defaultSize" label="默认尺寸">
            <Select options={SIZE_OPTIONS} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default ImageGenSettings
