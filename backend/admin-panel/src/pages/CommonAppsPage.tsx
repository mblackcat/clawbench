import React, { useEffect, useState, useCallback } from 'react';
import {
  Button,
  App,
  Switch,
  Modal,
  Form,
  Input,
  Space,
  Tag,
  Tooltip,
  Empty,
  Spin,
  Popconfirm,
} from 'antd';
import {
  ReloadOutlined,
  EditOutlined,
  BarChartOutlined,
  HolderOutlined,
  DownloadOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useApi } from '../hooks/useApi';
import type { CommonApp } from '../types';
import { formatDateTime, formatNumber } from '../utils/cover';
import AppStatsModal from '../components/AppStatsModal';

const { TextArea } = Input;

interface CommonAppFormValues {
  appKey?: string;
  name?: string;
  description?: string;
  version?: string;
  pinned?: boolean;
  configText?: string;
}

const CommonAppsPage: React.FC = () => {
  const [apps, setApps] = useState<CommonApp[]>([]);
  const [loading, setLoading] = useState(true);
  const { fetchApi } = useApi();
  const { message } = App.useApp();

  const [editingApp, setEditingApp] = useState<CommonApp | null>(null);
  /** 'create' | 'edit' | null (null = modal closed). */
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<CommonAppFormValues>();

  // Stats / error-log modal state
  const [statsApp, setStatsApp] = useState<CommonApp | null>(null);

  // Native HTML5 drag-and-drop reorder state
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const loadApps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApi<{ success: boolean; data: { commonApps: CommonApp[] } }>(
        '/api/v1/common-apps'
      );
      setApps([...res.data.commonApps].sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (err: any) {
      message.error(err.message || 'Failed to load apps');
    } finally {
      setLoading(false);
    }
  }, [fetchApi, message]);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  const updateApp = useCallback(
    async (appKey: string, patch: Record<string, unknown>) => {
      await fetchApi(`/api/v1/common-apps/${appKey}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
    },
    [fetchApi]
  );

  const createApp = useCallback(
    async (payload: Record<string, unknown>) => {
      await fetchApi('/api/v1/common-apps', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    [fetchApi]
  );

  const deleteApp = useCallback(
    async (appKey: string) => {
      await fetchApi(`/api/v1/common-apps/${appKey}`, { method: 'DELETE' });
    },
    [fetchApi]
  );

  const handleToggleEnabled = async (record: CommonApp, enabled: boolean) => {
    setApps((prev) => prev.map((a) => (a.appKey === record.appKey ? { ...a, enabled } : a)));
    try {
      await updateApp(record.appKey, { enabled });
      message.success(`${record.name} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err: any) {
      message.error(err.message || 'Failed to update app');
      loadApps();
    }
  };

  const openEdit = (record: CommonApp) => {
    setEditingApp(record);
    setModalMode('edit');
    form.setFieldsValue({
      appKey: record.appKey,
      name: record.name,
      description: record.description || '',
      version: record.version || '',
      pinned: record.pinned,
      configText: JSON.stringify(record.config ?? {}, null, 2),
    });
  };

  const openCreate = () => {
    setEditingApp(null);
    setModalMode('create');
    form.resetFields();
    form.setFieldsValue({
      appKey: '',
      name: '',
      description: '',
      version: '',
      pinned: false,
      configText: '{}',
    });
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingApp(null);
  };

  const handleDelete = async (record: CommonApp) => {
    try {
      await deleteApp(record.appKey);
      message.success(`Deleted ${record.name}`);
      loadApps();
    } catch (err: any) {
      message.error(err.message || 'Failed to delete app');
    }
  };

  const handleSubmit = async () => {
    let values: CommonAppFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    let config: unknown;
    try {
      config = JSON.parse(values.configText || '{}');
    } catch {
      message.error('Invalid JSON — please fix the config before saving');
      return;
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      message.error('Config must be a JSON object');
      return;
    }
    setSaving(true);
    try {
      if (modalMode === 'create') {
        const appKey = (values.appKey || '').trim();
        if (!appKey) {
          message.error('App Key is required');
          return;
        }
        await createApp({
          appKey,
          name: values.name,
          description: values.description,
          version: values.version?.trim() ? values.version.trim() : undefined,
          pinned: !!values.pinned,
          builtin: false,
          enabled: true,
          sortOrder: apps.length,
          config,
        });
        message.success('App created');
      } else if (editingApp) {
        await updateApp(editingApp.appKey, {
          name: values.name,
          description: values.description,
          version: values.version?.trim() ? values.version.trim() : null,
          pinned: values.pinned,
          config,
        });
        message.success('App updated');
      }
      closeModal();
      loadApps();
    } catch (err: any) {
      message.error(err.message || 'Failed to save app');
    } finally {
      setSaving(false);
    }
  };

  const openStats = (record: CommonApp) => setStatsApp(record);

  // Persist a new visual ordering: assign sortOrder = array index and PUT any
  // app whose index differs from its previously stored sortOrder.
  const persistOrder = async (previous: CommonApp[], ordered: CommonApp[]) => {
    const prevOrder = new Map(previous.map((a) => [a.appKey, a.sortOrder]));
    const changed = ordered.filter((a, idx) => prevOrder.get(a.appKey) !== idx);
    if (changed.length === 0) return;
    try {
      await Promise.all(changed.map((a) => updateApp(a.appKey, { sortOrder: ordered.indexOf(a) })));
      message.success('Order saved');
    } catch (err: any) {
      message.error(err.message || 'Failed to reorder apps');
      loadApps();
    }
  };

  const handleDrop = async (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) {
      setDragKey(null);
      setOverKey(null);
      return;
    }
    const from = apps.findIndex((a) => a.appKey === dragKey);
    const to = apps.findIndex((a) => a.appKey === targetKey);
    if (from < 0 || to < 0) return;
    const previous = apps;
    const next = [...apps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const reindexed = next.map((a, idx) => ({ ...a, sortOrder: idx }));
    setApps(reindexed);
    setDragKey(null);
    setOverKey(null);
    await persistOrder(previous, reindexed);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Common Apps</h1>
          <p className="page-desc">
            内置与通用应用管理 — 拖动卡片调整在客户端收藏栏的顺序，开关控制是否生效。
          </p>
        </div>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            New
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadApps}>
            Refresh
          </Button>
        </Space>
      </div>

      {loading ? (
        <div className="panel" style={{ padding: 48, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : apps.length === 0 ? (
        <div className="panel" style={{ padding: 40 }}>
          <Empty description="No apps yet" />
        </div>
      ) : (
        <div className="app-card-grid">
          {apps.map((app) => (
            <div
              key={app.appKey}
              className={`app-card${overKey === app.appKey ? ' app-card--over' : ''}${
                dragKey === app.appKey ? ' app-card--dragging' : ''
              }${!app.enabled ? ' app-card--disabled' : ''}`}
              draggable
              onDragStart={() => setDragKey(app.appKey)}
              onDragEnd={() => {
                setDragKey(null);
                setOverKey(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (overKey !== app.appKey) setOverKey(app.appKey);
              }}
              onDrop={() => handleDrop(app.appKey)}
            >
              <div className="app-card-head">
                <HolderOutlined className="app-card-handle" />
                <div className="app-card-titles">
                  <div className="app-card-title">{app.name}</div>
                  <div className="app-card-subtitle">
                    <span className="mono">{app.appKey}</span>
                    {app.builtin ? (
                      <Tag color="geekblue" style={{ marginInlineStart: 6 }}>
                        内置
                      </Tag>
                    ) : (
                      <Tag style={{ marginInlineStart: 6 }}>用户</Tag>
                    )}
                  </div>
                </div>
                <span className="app-card-version">{app.version ? `v${app.version}` : '—'}</span>
              </div>

              <div className="app-card-desc">
                {app.description || <span className="muted">No description</span>}
              </div>

              <div className="app-card-metrics">
                <Tooltip title="Downloads / installs">
                  <span>
                    <DownloadOutlined /> {formatNumber(app.downloadCount)}
                  </span>
                </Tooltip>
                <Tooltip title="Runs">
                  <span>
                    <PlayCircleOutlined /> {formatNumber(app.executionCount)}
                  </span>
                </Tooltip>
                <span className="muted">Updated {formatDateTime(app.updatedAt)}</span>
              </div>

              <div className="app-card-footer">
                <Tooltip title={app.enabled ? 'Enabled' : 'Disabled'}>
                  <Switch
                    checked={app.enabled}
                    size="small"
                    onChange={(checked) => handleToggleEnabled(app, checked)}
                  />
                </Tooltip>
                <Space>
                  <Button size="small" icon={<BarChartOutlined />} onClick={() => openStats(app)}>
                    Stats
                  </Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(app)}>
                    Edit
                  </Button>
                  <Popconfirm
                    title="Delete this common app?"
                    description="Cascades its events, errors, version history, and project configs."
                    onConfirm={() => handleDelete(app)}
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit detail modal */}
      <Modal
        title={
          modalMode === 'create'
            ? 'New common app'
            : editingApp
              ? `Edit — ${editingApp.name}`
              : 'Edit app'
        }
        open={modalMode !== null}
        onCancel={closeModal}
        onOk={handleSubmit}
        confirmLoading={saving}
        okText="Save"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="appKey"
            label="App Key"
            rules={modalMode === 'create' ? [{ required: true, message: 'App Key is required' }] : []}
            tooltip="Stable identifier (e.g. 'my-builtin'). The desktop builtin app id is 'com.clawbench.builtin.<appKey>'."
          >
            <Input maxLength={64} className="mono" disabled={modalMode === 'edit'} />
          </Form.Item>
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={2} />
          </Form.Item>
          <Space size="large" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Form.Item name="version" label="Version" style={{ flex: 1, marginBottom: 0 }}>
              <Input placeholder="1.0.0" />
            </Form.Item>
            <Form.Item
              name="pinned"
              label="Pin to top"
              valuePropName="checked"
              tooltip="Pinned apps appear in the top section of the client favorites bar"
              style={{ marginBottom: 0 }}
            >
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item
            name="configText"
            label="Config (JSON)"
            rules={[
              {
                validator: (_, value: string) => {
                  if (!value || !value.trim()) return Promise.resolve();
                  try {
                    const parsed = JSON.parse(value);
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                      return Promise.reject(new Error('Config must be a JSON object'));
                    }
                    return Promise.resolve();
                  } catch {
                    return Promise.reject(new Error('Invalid JSON'));
                  }
                },
              },
            ]}
          >
            <TextArea className="mono" rows={10} style={{ fontSize: 12.5 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Stats + tabbed event log modal */}
      <AppStatsModal app={statsApp} onClose={() => setStatsApp(null)} />
    </div>
  );
};

export default CommonAppsPage;
