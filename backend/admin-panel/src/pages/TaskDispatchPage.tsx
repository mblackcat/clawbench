import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { CopyOutlined, EyeOutlined, ReloadOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useApi } from '../hooks/useApi';
import { formatDate } from '../utils/cover';
import type {
  ApplicationResponse,
  DispatchedTaskExecution,
  DispatchedTaskItem,
  Project,
  UserResponse,
} from '../types';

const { Text } = Typography;

interface ManifestParam {
  name: string;
  type: 'string' | 'boolean' | 'number' | 'enum' | 'path' | 'text';
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
}

const EXECUTION_STATUS_COLOR: Record<string, string> = {
  RECEIVED: 'processing',
  WAITING_CONFIRM: 'warning',
  RUNNING: 'processing',
  SUCCESS: 'success',
  FAILED: 'error',
  CANCELLED: 'default',
  REJECTED: 'volcano',
  SKIPPED: 'default',
  ABANDONED: 'default',
  REVOKED: 'error',
  EXPIRED: 'default',
};

/**
 * Remote task dispatch (admin only): push "run app X@version with these
 * params" to all clients, one user, or a project's members, then follow each
 * machine's execution. See docs/REMOTE_TASK_DISPATCH.md for the trust model —
 * clients confirm every task by default.
 */
const TaskDispatchPage: React.FC = () => {
  const { fetchApi } = useApi();
  const { message } = App.useApp();
  const { token } = theme.useToken();

  const [tasks, setTasks] = useState<DispatchedTaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [apps, setApps] = useState<ApplicationResponse[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [selectedApp, setSelectedApp] = useState<ApplicationResponse | null>(null);
  const [paramDefs, setParamDefs] = useState<ManifestParam[]>([]);
  const [confirmBeforeRun, setConfirmBeforeRun] = useState(false);
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [form] = Form.useForm();
  const formValues = Form.useWatch([], form);

  const [execOpen, setExecOpen] = useState(false);
  const [execTask, setExecTask] = useState<DispatchedTaskItem | null>(null);
  const [executions, setExecutions] = useState<DispatchedTaskExecution[]>([]);
  const [loadingExecs, setLoadingExecs] = useState(false);

  const [logOpen, setLogOpen] = useState(false);
  const [logText, setLogText] = useState('');
  const [logMachine, setLogMachine] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApi<{
        success: boolean;
        data: { tasks: DispatchedTaskItem[]; total: number };
      }>(`/api/v1/admin/tasks?page=${page}&pageSize=${pageSize}`);
      setTasks(res.data.tasks || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load dispatched tasks');
    } finally {
      setLoading(false);
    }
  }, [fetchApi, message, page, pageSize]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const loadFormData = useCallback(async () => {
    setLoadingApps(true);
    try {
      const res = await fetchApi<{ success: boolean; data: { applications: ApplicationResponse[] } }>(
        '/api/v1/admin/applications?type=app&limit=100'
      );
      setApps((res.data.applications || []).filter((a) => a.dispatchable && a.published && a.type === 'app'));
    } catch {
      setApps([]);
    } finally {
      setLoadingApps(false);
    }
    try {
      const res = await fetchApi<{ success: boolean; data: { users: UserResponse[] } }>(
        '/api/v1/admin/users?limit=100'
      );
      setUsers(res.data.users || []);
    } catch {
      setUsers([]);
    }
    try {
      const res = await fetchApi<{ success: boolean; data: { projects: Project[] } }>('/api/v1/projects');
      setProjects(res.data.projects || []);
    } catch {
      setProjects([]);
    }
  }, [fetchApi]);

  const openDispatch = () => {
    void loadFormData();
    form.resetFields();
    setSelectedApp(null);
    setParamDefs([]);
    setConfirmBeforeRun(false);
    form.setFieldsValue({ targetScope: 'ALL', autoInstall: false, forceConfirm: false, expiresInHours: 24 });
    setDispatchOpen(true);
  };

  const loadParams = async (appId: string, version?: string) => {
    try {
      const q = version ? `?version=${encodeURIComponent(version)}` : '';
      const res = await fetchApi<{
        success: boolean;
        data: { version: string; confirmBeforeRun: boolean; params: ManifestParam[] };
      }>(`/api/v1/admin/tasks/app-manifest/${encodeURIComponent(appId)}${q}`);
      const defs = Array.isArray(res.data.params) ? res.data.params : [];
      setParamDefs(defs);
      setConfirmBeforeRun(Boolean(res.data.confirmBeforeRun));
      const initial: Record<string, unknown> = {};
      defs.forEach((p) => {
        if (p.default !== undefined) initial[p.name] = p.default;
      });
      form.setFieldsValue({ presetParams: initial });
    } catch (err) {
      setParamDefs([]);
      message.error(err instanceof Error ? err.message : 'Failed to read app parameters');
    }
  };

  const handleAppChange = async (appId: string) => {
    try {
      const res = await fetchApi<{ success: boolean; data: ApplicationResponse }>(
        `/api/v1/applications/${encodeURIComponent(appId)}`
      );
      setSelectedApp(res.data);
      const latest = res.data.version || res.data.versions?.[0]?.version || '';
      form.setFieldsValue({ appVersion: latest || undefined });
      await loadParams(appId, latest || undefined);
    } catch {
      setSelectedApp(apps.find((a) => a.applicationId === appId) || null);
      await loadParams(appId);
    }
  };

  // Mirrors the server-side prediction. Clients in the default always-confirm
  // mode (and any install/upgrade) ask regardless.
  const willConfirm = useMemo(() => {
    if (!formValues) return false;
    if (formValues.forceConfirm || confirmBeforeRun) return true;
    const preset = (formValues.presetParams || {}) as Record<string, unknown>;
    const missing = paramDefs.some((p) => p.required && (preset[p.name] === undefined || preset[p.name] === null || preset[p.name] === ''));
    const sensitive = paramDefs.some((p) => (p.type === 'path' || p.type === 'text') && preset[p.name] !== undefined);
    return missing || sensitive;
  }, [formValues, paramDefs, confirmBeforeRun]);

  const submitDispatch = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setDispatching(true);
    try {
      // Drop unset optional params so the server sees only what the admin chose
      const preset: Record<string, unknown> = {};
      for (const [k, v] of Object.entries((values.presetParams || {}) as Record<string, unknown>)) {
        if (v !== undefined && v !== null && v !== '') preset[k] = v;
      }
      await fetchApi('/api/v1/admin/tasks/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          appId: values.appId,
          appVersion: values.appVersion,
          presetParams: preset,
          targetScope: values.targetScope,
          targetId: values.targetScope === 'ALL' ? undefined : values.targetId,
          forceConfirm: Boolean(values.forceConfirm),
          autoInstall: Boolean(values.autoInstall),
          reason: values.reason,
          expiresInHours: Number(values.expiresInHours) || 24,
        }),
      });
      message.success('Task dispatched');
      setDispatchOpen(false);
      loadTasks();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to dispatch task');
    } finally {
      setDispatching(false);
    }
  };

  const revoke = async (taskId: string) => {
    setRevokingId(taskId);
    try {
      await fetchApi(`/api/v1/admin/tasks/${encodeURIComponent(taskId)}/revoke`, { method: 'POST' });
      message.success('Task revoked');
      loadTasks();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to revoke task');
    } finally {
      setRevokingId(null);
    }
  };

  const openExecutions = async (task: DispatchedTaskItem) => {
    setExecTask(task);
    setExecOpen(true);
    setLoadingExecs(true);
    try {
      const res = await fetchApi<{ success: boolean; data: DispatchedTaskExecution[] }>(
        `/api/v1/admin/tasks/${encodeURIComponent(task.taskId)}/executions`
      );
      setExecutions(res.data || []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load executions');
      setExecutions([]);
    } finally {
      setLoadingExecs(false);
    }
  };

  const userName = (id: string | null) => users.find((u) => u.userId === id)?.username;
  const projectName = (id: string | null) => projects.find((p) => p.projectId === id)?.name;

  const columns: ColumnsType<DispatchedTaskItem> = [
    {
      title: 'Task',
      dataIndex: 'taskId',
      key: 'taskId',
      width: 150,
      render: (id: string) => (
        <Tooltip title={id}>
          <Text code copyable={{ text: id }}>
            {id.slice(0, 13)}…
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'Application',
      key: 'app',
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 550 }}>{r.appName || r.appId}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            v{r.appVersion}
          </Text>
        </div>
      ),
    },
    {
      title: 'Scope',
      key: 'scope',
      width: 160,
      render: (_, r) => {
        if (r.targetScope === 'ALL') return <Tag color="blue">ALL</Tag>;
        if (r.targetScope === 'USER') return <Tag color="geekblue">User: {userName(r.targetId) || r.targetId?.slice(0, 8)}</Tag>;
        return <Tag color="cyan">Project: {projectName(r.targetId) || r.targetId?.slice(0, 8)}</Tag>;
      },
    },
    {
      title: 'Reason',
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: true,
      render: (reason: string | null) => reason || <Text type="secondary">—</Text>,
    },
    {
      title: 'By',
      key: 'by',
      render: (_, r) => r.dispatchedByName || r.dispatchedBy?.slice(0, 8),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (st: string) => (
        <Tag color={st === 'ACTIVE' ? 'success' : st === 'REVOKED' ? 'error' : 'default'}>{st}</Tag>
      ),
    },
    {
      title: 'Executions',
      key: 'counts',
      render: (_, r) => {
        const entries = Object.entries(r.executionCounts || {});
        if (entries.length === 0) return <Text type="secondary">0</Text>;
        return (
          <Space wrap size={[4, 4]}>
            {entries.map(([s, n]) => (
              <Tag key={s} color={EXECUTION_STATUS_COLOR[s] || 'default'}>
                {s}: {n}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (ts: number) => formatDate(ts),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 190,
      render: (_, r) => (
        <Space size={8}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openExecutions(r)}>
            Executions
          </Button>
          {r.status === 'ACTIVE' && (
            <Popconfirm
              title="Revoke task"
              description="Clients that have not started it yet will drop it."
              onConfirm={() => revoke(r.taskId)}
              okText="Revoke"
            >
              <Button size="small" danger icon={<StopOutlined />} loading={revokingId === r.taskId}>
                Revoke
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const execColumns: ColumnsType<DispatchedTaskExecution> = [
    {
      title: 'Machine',
      dataIndex: 'machineId',
      key: 'machineId',
      width: 130,
      render: (m: string) => (
        <Tooltip title={m}>
          <Text code copyable={{ text: m }}>
            {m.slice(0, 8)}…
          </Text>
        </Tooltip>
      ),
    },
    { title: 'User', key: 'user', render: (_, r) => r.username || r.userId },
    {
      title: 'Status',
      key: 'status',
      width: 150,
      render: (_, r) => (
        <Tooltip title={r.summary || undefined}>
          <Tag color={EXECUTION_STATUS_COLOR[r.status] || 'default'}>{r.status}</Tag>
          {r.reasonCode && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {r.reasonCode}
            </Text>
          )}
        </Tooltip>
      ),
    },
    {
      title: 'Duration',
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 90,
      render: (ms: number | null) => (ms != null ? `${(ms / 1000).toFixed(1)}s` : '—'),
    },
    {
      title: 'Exit',
      dataIndex: 'exitCode',
      key: 'exitCode',
      width: 60,
      render: (c: number | null) => (c != null ? c : '—'),
    },
    {
      title: 'Finished',
      dataIndex: 'completedAt',
      key: 'completedAt',
      width: 120,
      render: (ts: number | null) => (ts ? formatDate(ts) : '—'),
    },
    {
      title: 'Log',
      key: 'log',
      width: 90,
      render: (_, r) => (
        <Button
          size="small"
          disabled={!r.logExcerpt}
          onClick={() => {
            setLogMachine(r.machineId);
            setLogText(r.logExcerpt || '');
            setLogOpen(true);
          }}
        >
          View
        </Button>
      ),
    },
  ];

  const renderParamField = (p: ManifestParam) => {
    const name = ['presetParams', p.name];
    const common = { key: p.name, name, label: p.label || p.name, extra: p.description };
    if (p.type === 'boolean') {
      return (
        <Form.Item {...common} valuePropName="checked">
          <Switch />
        </Form.Item>
      );
    }
    if (p.type === 'number') {
      return (
        <Form.Item {...common}>
          <InputNumber style={{ width: '100%' }} />
        </Form.Item>
      );
    }
    if (p.type === 'enum' && p.options?.length) {
      return (
        <Form.Item {...common}>
          <Select allowClear options={p.options.map((o) => ({ label: o, value: o }))} />
        </Form.Item>
      );
    }
    if (p.type === 'text') {
      return (
        <Form.Item {...common}>
          <Input.TextArea rows={2} />
        </Form.Item>
      );
    }
    return (
      <Form.Item {...common}>
        <Input />
      </Form.Item>
    );
  };

  const targetScope = formValues?.targetScope || 'ALL';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>Task Dispatch</h1>
          <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 13 }}>
            Ask desktop clients to run a dispatchable app. Clients confirm each task unless the user opted into silent
            execution.
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadTasks} loading={loading}>
            Refresh
          </Button>
          <Button type="primary" icon={<SendOutlined />} onClick={openDispatch}>
            Dispatch Task
          </Button>
        </Space>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <Table
          rowKey="taskId"
          columns={columns}
          dataSource={tasks}
          loading={loading}
          scroll={{ x: 1000 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </div>

      <Drawer
        title="Dispatch Remote Task"
        open={dispatchOpen}
        onClose={() => setDispatchOpen(false)}
        width={560}
        destroyOnHidden
        extra={
          <Button type="primary" icon={<SendOutlined />} loading={dispatching} onClick={submitDispatch}>
            Dispatch
          </Button>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="appId"
            label="Application"
            rules={[{ required: true, message: 'Select a dispatchable application' }]}
            extra="Only published apps with “Dispatchable” enabled (app detail page) are listed."
          >
            <Select
              placeholder="Select application"
              loading={loadingApps}
              showSearch
              optionFilterProp="label"
              onChange={handleAppChange}
              options={apps.map((a) => ({ label: `${a.name} (${a.applicationId})`, value: a.applicationId }))}
            />
          </Form.Item>

          {selectedApp && (
            <Form.Item name="appVersion" label="Version" rules={[{ required: true, message: 'Select a version' }]}>
              <Select
                onChange={(v: string) => loadParams(selectedApp.applicationId, v)}
                options={(selectedApp.versions || []).map((v) => ({
                  label: `v${v.version} (${formatDate(v.publishedAt)})`,
                  value: v.version,
                }))}
              />
            </Form.Item>
          )}

          {paramDefs.length > 0 && (
            <div
              style={{
                background: token.colorFillQuaternary,
                padding: '12px 14px',
                borderRadius: token.borderRadiusLG,
                marginBottom: 20,
              }}
            >
              <Text strong style={{ display: 'block', marginBottom: 12 }}>
                Preset Parameters
              </Text>
              {paramDefs.map(renderParamField)}
            </div>
          )}

          <Form.Item name="targetScope" label="Target" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="ALL">All clients</Radio>
              <Radio value="USER">A user</Radio>
              <Radio value="PROJECT">A project</Radio>
            </Radio.Group>
          </Form.Item>

          {targetScope === 'USER' && (
            <Form.Item name="targetId" label="Target user" rules={[{ required: true, message: 'Select a user' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={users.map((u) => ({ label: `${u.username} (${u.email || u.userId})`, value: u.userId }))}
              />
            </Form.Item>
          )}

          {targetScope === 'PROJECT' && (
            <Form.Item name="targetId" label="Target project" rules={[{ required: true, message: 'Select a project' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={projects.map((p) => ({ label: p.name, value: p.projectId }))}
              />
            </Form.Item>
          )}

          <Form.Item
            name="reason"
            label="Reason"
            rules={[{ required: true, message: 'Explain why this runs' }, { max: 500 }]}
            extra="Shown to users in the confirmation dialog."
          >
            <Input.TextArea rows={2} />
          </Form.Item>

          <Space size={24} wrap style={{ display: 'flex', marginBottom: 16 }}>
            <Form.Item
              name="autoInstall"
              valuePropName="checked"
              label="Install / upgrade if needed"
              tooltip="Clients always ask the user before installing"
              style={{ marginBottom: 0 }}
            >
              <Switch />
            </Form.Item>
            <Form.Item name="forceConfirm" valuePropName="checked" label="Force confirmation" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
            <Form.Item name="expiresInHours" label="Valid for (hours)" style={{ marginBottom: 0 }}>
              <InputNumber min={1} max={168} style={{ width: 90 }} />
            </Form.Item>
          </Space>

          <Alert
            type={willConfirm ? 'warning' : 'info'}
            showIcon
            message={willConfirm ? 'Every client will ask the user to confirm' : 'Clients ask by default'}
            description={
              willConfirm
                ? 'Forced confirmation, confirm_before_run, a missing required parameter or a preset path/text parameter requires explicit user confirmation.'
                : 'Only clients whose user enabled silent execution will run it without a prompt (with a notification); everyone else confirms.'
            }
          />
        </Form>
      </Drawer>

      <Drawer
        title={
          <span>
            Executions
            {execTask && (
              <Text code style={{ marginLeft: 8, fontSize: 13 }}>
                {execTask.taskId}
              </Text>
            )}
          </span>
        }
        open={execOpen}
        onClose={() => setExecOpen(false)}
        width={820}
        extra={
          execTask && (
            <Button size="small" icon={<ReloadOutlined />} loading={loadingExecs} onClick={() => openExecutions(execTask)}>
              Refresh
            </Button>
          )
        }
      >
        <Table
          rowKey="executionId"
          columns={execColumns}
          dataSource={executions}
          loading={loadingExecs}
          pagination={{ pageSize: 15 }}
        />
      </Drawer>

      <Modal
        title={`Log excerpt: ${logMachine}`}
        open={logOpen}
        onCancel={() => setLogOpen(false)}
        width={760}
        footer={[
          <Button
            key="copy"
            icon={<CopyOutlined />}
            onClick={() => {
              void navigator.clipboard.writeText(logText);
              message.success('Copied');
            }}
          >
            Copy
          </Button>,
          <Button key="close" type="primary" onClick={() => setLogOpen(false)}>
            Close
          </Button>,
        ]}
      >
        <pre
          style={{
            background: token.colorFillTertiary,
            color: token.colorText,
            padding: 14,
            borderRadius: token.borderRadius,
            fontSize: 12,
            maxHeight: 480,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            margin: 0,
          }}
        >
          {logText}
        </pre>
      </Modal>
    </div>
  );
};

export default TaskDispatchPage;
