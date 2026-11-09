import React, { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Switch, Table, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useApi } from '../hooks/useApi';
import { formatDate } from '../utils/cover';

/** 系统模型（后端不返回密钥，仅 hasApiKey） */
interface SystemModel {
  modelId: string;
  name: string;
  kind: 'chat' | 'image';
  apiFormat: 'openai' | 'gemini';
  endpoint: string;
  /** 默认（第一个）模型 */
  modelName: string;
  /** 一条配置可挂多个上游模型 id */
  modelNames: string[];
  hasApiKey: boolean;
  enabled: boolean;
  sortOrder: number;
  updatedAt: number;
}

interface FormValues {
  name: string;
  kind: SystemModel['kind'];
  apiFormat: SystemModel['apiFormat'];
  endpoint: string;
  modelNames: string[];
  apiKey?: string;
  enabled: boolean;
  sortOrder: number;
}

const KIND_OPTIONS = [
  { value: 'chat', label: 'Chat (LLM)' },
  // Listed to clients via GET /api/v1/ai/system-models?kind=image (no built-in proxy yet)
  { value: 'image', label: 'Image generation' },
];
const FORMAT_OPTIONS = [
  { value: 'openai', label: 'OpenAI compatible' },
  { value: 'gemini', label: 'Gemini' },
];

const AiModelsPage: React.FC = () => {
  const [models, setModels] = useState<SystemModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SystemModel | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keySecretConfigured, setKeySecretConfigured] = useState(true);
  const [form] = Form.useForm<FormValues>();
  const { fetchApi } = useApi();
  const { message } = App.useApp();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApi<{
        success: boolean;
        data: { models: SystemModel[]; keySecretConfigured?: boolean };
      }>('/api/v1/admin/ai-models');
      setModels(res.data.models);
      setKeySecretConfigured(res.data.keySecretConfigured !== false);
    } catch (err: any) {
      message.error(err.message || 'Failed to load models');
    } finally {
      setLoading(false);
    }
  }, [fetchApi, message]);

  useEffect(() => {
    load();
  }, [load]);

  const openEditor = (model: SystemModel | null) => {
    setEditing(model);
    form.resetFields();
    form.setFieldsValue(
      model
        ? { ...model, modelNames: model.modelNames?.length ? model.modelNames : [model.modelName], apiKey: undefined }
        : { kind: 'chat', apiFormat: 'openai', enabled: true, sortOrder: 0, endpoint: '' }
    );
    setOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const body: Record<string, unknown> = { ...values };
    // 编辑时留空 = 不修改密钥
    if (editing && !values.apiKey) delete body.apiKey;
    if (values.sortOrder === null || values.sortOrder === undefined) delete body.sortOrder;
    setSaving(true);
    try {
      await fetchApi(editing ? `/api/v1/admin/ai-models/${editing.modelId}` : '/api/v1/admin/ai-models', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      message.success(editing ? 'Model updated' : 'Model created');
      setOpen(false);
      load();
    } catch (err: any) {
      message.error(err.message || 'Failed to save model');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (model: SystemModel, enabled: boolean) => {
    try {
      await fetchApi(`/api/v1/admin/ai-models/${model.modelId}`, { method: 'PUT', body: JSON.stringify({ enabled }) });
      load();
    } catch (err: any) {
      message.error(err.message || 'Failed to update model');
    }
  };

  const handleDelete = async (model: SystemModel) => {
    try {
      await fetchApi(`/api/v1/admin/ai-models/${model.modelId}`, { method: 'DELETE' });
      message.success('Model deleted');
      load();
    } catch (err: any) {
      message.error(err.message || 'Failed to delete model');
    }
  };

  const columns: ColumnsType<SystemModel> = [
    { title: 'Name', dataIndex: 'name', key: 'name', render: (text: string) => <strong>{text}</strong> },
    {
      title: 'Kind',
      dataIndex: 'kind',
      key: 'kind',
      width: 110,
      render: (kind: string) => <Tag color={kind === 'image' ? 'magenta' : 'blue'}>{kind}</Tag>,
    },
    { title: 'Format', dataIndex: 'apiFormat', key: 'apiFormat', width: 100 },
    {
      title: 'Models',
      dataIndex: 'modelNames',
      key: 'modelNames',
      render: (names: string[] | undefined, record) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(names?.length ? names : [record.modelName]).map((n) => (
            <Tag key={n} style={{ marginInlineEnd: 0 }}>
              <code>{n}</code>
            </Tag>
          ))}
        </div>
      ),
    },
    {
      title: 'Endpoint',
      dataIndex: 'endpoint',
      key: 'endpoint',
      ellipsis: true,
      render: (t: string) => t || <span className="muted">default</span>,
    },
    {
      title: 'Key',
      dataIndex: 'hasApiKey',
      key: 'hasApiKey',
      width: 90,
      render: (has: boolean) => (has ? <Tag color="green">set</Tag> : <Tag color="red">missing</Tag>),
    },
    {
      title: 'Enabled',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 90,
      render: (enabled: boolean, record) => <Switch size="small" checked={enabled} onChange={(v) => handleToggle(record, v)} />,
    },
    { title: 'Order', dataIndex: 'sortOrder', key: 'sortOrder', width: 70 },
    {
      title: 'Updated',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 140,
      render: (ts: number) => <span className="muted">{formatDate(ts)}</span>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_: unknown, record) => (
        <>
          <Button type="text" icon={<EditOutlined />} onClick={() => openEditor(record)} />
          <Popconfirm
            title="Delete this model?"
            description="Clients will no longer see it in their model list."
            onConfirm={() => handleDelete(record)}
            okText="Delete"
            okType="danger"
            cancelText="Cancel"
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>AI Models</h1>
          <p className="page-desc">
            Team chat models offered to every signed-in client in the AI Chat builtin model list. Calls are proxied by the
            server; keys are encrypted at rest and never sent to clients.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<ReloadOutlined />} onClick={load}>
            Refresh
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)}>
            Add model
          </Button>
        </div>
      </div>

      {!keySecretConfigured && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="AI_KEY_SECRET is not configured on the server"
          description="API keys cannot be saved or used until AI_KEY_SECRET (>= 16 chars) is set in the backend environment. See backend/.env.example."
        />
      )}

      <div className="panel console-table" style={{ overflow: 'hidden' }}>
        <Table columns={columns} dataSource={models} rowKey="modelId" loading={loading} pagination={false} />
      </div>

      <Modal
        title={editing ? 'Edit model' : 'Add model'}
        open={open}
        onOk={handleSave}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        maskClosable={false}
        // Keep the form mounted so openEditor() can reset/fill it before the modal opens
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Display name" rules={[{ required: true, max: 100 }]}>
            <Input placeholder="e.g. Team GPT" />
          </Form.Item>
          <Form.Item name="kind" label="Kind" rules={[{ required: true }]}>
            <Select options={KIND_OPTIONS} />
          </Form.Item>
          <Form.Item name="apiFormat" label="API format" rules={[{ required: true }]}>
            <Select options={FORMAT_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="endpoint"
            label="Endpoint (base URL)"
            extra="Leave empty to use the provider default."
            rules={[{ pattern: /^(https?:\/\/.+)?$/i, message: 'Must be an http(s) URL' }, { max: 500 }]}
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item
            name="modelNames"
            label="Upstream model ids"
            extra="One config can expose several models sharing this endpoint and key. Press Enter (or paste comma-separated ids); the first is the default."
            rules={[
              { required: true, type: 'array', min: 1, message: 'At least one model id is required' },
              {
                validator: (_, v: string[] | undefined) =>
                  !v || (v.length <= 50 && v.every((x) => x.trim().length > 0 && x.length <= 200))
                    ? Promise.resolve()
                    : Promise.reject(new Error('Up to 50 ids, each 1-200 chars')),
              },
            ]}
            normalize={(v: string[] | undefined) => Array.from(new Set((v ?? []).map((x) => x.trim()).filter(Boolean)))}
          >
            <Select
              mode="tags"
              open={false}
              tokenSeparators={[',', '，', '\n', ' ']}
              placeholder="e.g. gpt-4o-mini, gpt-4o"
            />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label="API key"
            extra={editing ? (editing.hasApiKey ? 'Leave empty to keep the current key.' : 'No key set yet.') : undefined}
            rules={editing ? [] : [{ required: true, message: 'API key is required' }]}
          >
            <Input.Password autoComplete="new-password" placeholder={editing?.hasApiKey ? '••••••••' : ''} />
          </Form.Item>
          <div style={{ display: 'flex', gap: 24 }}>
            <Form.Item name="sortOrder" label="Order">
              <InputNumber precision={0} />
            </Form.Item>
            <Form.Item name="enabled" label="Enabled" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default AiModelsPage;
