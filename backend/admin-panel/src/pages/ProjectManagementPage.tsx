import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Select,
  Button,
  Popconfirm,
  App,
  Tag,
  Modal,
  Form,
  Input,
  Drawer,
  Collapse,
  Space,
  Spin,
  Empty,
  Switch,
  Tooltip,
} from 'antd';
import {
  DeleteOutlined,
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  TeamOutlined,
  SettingOutlined,
  InboxOutlined,
  UndoOutlined,
  UserAddOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useApi } from '../hooks/useApi';
import SearchBar from '../components/SearchBar';
import type { Project, ProjectMember, CommonApp, VcsType, ProjectStatus } from '../types';
import { formatDate } from '../utils/cover';

const { TextArea } = Input;

const VCS_COLORS: Record<string, string> = {
  git: 'orange',
  svn: 'geekblue',
  none: 'default',
};

interface ProjectFormValues {
  name: string;
  description?: string;
  vcsType?: VcsType;
  repoUrl?: string;
  status?: ProjectStatus;
}

/** Feishu bitable feedback config keys we expose as plain form fields */
const FEEDBACK_STRING_FIELDS: { key: string; label: string }[] = [
  { key: 'appId', label: 'App ID' },
  { key: 'appSecret', label: 'App Secret' },
  { key: 'appToken', label: 'App Token' },
  { key: 'tableId', label: 'Table ID' },
  { key: 'bitableUrl', label: 'Bitable URL' },
];

const ProjectManagementPage: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { fetchApi } = useApi();
  const { message } = App.useApp();

  // Create / edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<ProjectFormValues>();

  // Members drawer
  const [memberProject, setMemberProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'admin' | 'member'>('member');
  const [addingMember, setAddingMember] = useState(false);

  // App-config drawer
  const [configProject, setConfigProject] = useState<Project | null>(null);
  const [commonApps, setCommonApps] = useState<CommonApp[]>([]);
  const [configTexts, setConfigTexts] = useState<Record<string, string>>({});
  /** Project-level enable overrides (default true when missing). */
  const [projectEnabled, setProjectEnabled] = useState<Record<string, boolean>>({});
  const [configsLoading, setConfigsLoading] = useState(false);
  const [savingConfigKey, setSavingConfigKey] = useState<string | null>(null);
  const [togglingEnableKey, setTogglingEnableKey] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApi<{ success: boolean; data: { projects: Project[] } }>(
        '/api/v1/projects?status=all'
      );
      setProjects(res.data.projects);
    } catch (err: any) {
      message.error(err.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [fetchApi, message]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // ── Create / edit ─────────────────────────────────────

  const openCreate = () => {
    setEditingProject(null);
    form.resetFields();
    form.setFieldsValue({ vcsType: 'none' });
    setModalOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditingProject(project);
    form.setFieldsValue({
      name: project.name,
      description: project.description || '',
      vcsType: project.vcsType,
      repoUrl: project.repoUrl || '',
      status: project.status,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    let values: ProjectFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      if (editingProject) {
        await fetchApi(`/api/v1/projects/${editingProject.projectId}`, {
          method: 'PUT',
          body: JSON.stringify(values),
        });
        message.success('Project updated');
      } else {
        await fetchApi('/api/v1/projects', {
          method: 'POST',
          body: JSON.stringify({
            name: values.name,
            description: values.description,
            vcsType: values.vcsType,
            repoUrl: values.repoUrl,
          }),
        });
        message.success('Project created');
      }
      setModalOpen(false);
      loadProjects();
    } catch (err: any) {
      message.error(err.message || 'Failed to save project');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleArchive = async (project: Project) => {
    const nextStatus: ProjectStatus = project.status === 'active' ? 'archived' : 'active';
    try {
      await fetchApi(`/api/v1/projects/${project.projectId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus }),
      });
      message.success(nextStatus === 'archived' ? 'Project archived' : 'Project restored');
      loadProjects();
    } catch (err: any) {
      message.error(err.message || 'Failed to update project status');
    }
  };

  const handleDelete = async (projectId: string) => {
    try {
      await fetchApi(`/api/v1/projects/${projectId}`, { method: 'DELETE' });
      message.success('Project deleted');
      loadProjects();
    } catch (err: any) {
      message.error(err.message || 'Failed to delete project');
    }
  };

  // ── Members ───────────────────────────────────────────

  const loadMembers = useCallback(
    async (projectId: string) => {
      setMembersLoading(true);
      try {
        const res = await fetchApi<{ success: boolean; data: { members: ProjectMember[] } }>(
          `/api/v1/projects/${projectId}/members`
        );
        setMembers(res.data.members);
      } catch (err: any) {
        message.error(err.message || 'Failed to load members');
      } finally {
        setMembersLoading(false);
      }
    },
    [fetchApi, message]
  );

  const openMembers = (project: Project) => {
    setMemberProject(project);
    setMembers([]);
    setNewMemberName('');
    setNewMemberRole('member');
    loadMembers(project.projectId);
  };

  const handleAddMember = async () => {
    if (!memberProject) return;
    const username = newMemberName.trim();
    if (!username) {
      message.warning('Please enter a username');
      return;
    }
    setAddingMember(true);
    try {
      await fetchApi(`/api/v1/projects/${memberProject.projectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ username, role: newMemberRole }),
      });
      message.success('Member added');
      setNewMemberName('');
      loadMembers(memberProject.projectId);
      loadProjects();
    } catch (err: any) {
      message.error(err.message || 'Failed to add member');
    } finally {
      setAddingMember(false);
    }
  };

  const handleMemberRoleChange = async (userId: string, role: 'admin' | 'member') => {
    if (!memberProject) return;
    try {
      await fetchApi(`/api/v1/projects/${memberProject.projectId}/members/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      message.success('Member role updated');
      loadMembers(memberProject.projectId);
    } catch (err: any) {
      // e.g. 400 when demoting the last admin — surface the backend message
      message.error(err.message || 'Failed to update member role');
      loadMembers(memberProject.projectId);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!memberProject) return;
    try {
      await fetchApi(`/api/v1/projects/${memberProject.projectId}/members/${userId}`, {
        method: 'DELETE',
      });
      message.success('Member removed');
      loadMembers(memberProject.projectId);
      loadProjects();
    } catch (err: any) {
      message.error(err.message || 'Failed to remove member');
    }
  };

  // ── App configs ───────────────────────────────────────

  const openConfigs = async (project: Project) => {
    setConfigProject(project);
    setConfigTexts({});
    setProjectEnabled({});
    setConfigsLoading(true);
    try {
      const [appsRes, configsRes] = await Promise.all([
        fetchApi<{ success: boolean; data: { commonApps: CommonApp[] } }>('/api/v1/common-apps'),
        fetchApi<{
          success: boolean;
          data: { configs: Record<string, object>; enabled?: Record<string, boolean> };
        }>(`/api/v1/projects/${project.projectId}/app-configs`),
      ]);
      const apps = appsRes.data.commonApps;
      const overrides = configsRes.data.configs || {};
      const enabledMap = configsRes.data.enabled || {};
      setCommonApps(apps);
      const texts: Record<string, string> = {};
      const enabled: Record<string, boolean> = {};
      for (const app of apps) {
        // Existing project override wins; otherwise prefill with app default as template
        const initial = overrides[app.appKey] ?? app.config ?? {};
        texts[app.appKey] = JSON.stringify(initial, null, 2);
        // Default project enable = true when no override row
        enabled[app.appKey] = enabledMap[app.appKey] ?? true;
      }
      setConfigTexts(texts);
      setProjectEnabled(enabled);
    } catch (err: any) {
      message.error(err.message || 'Failed to load app configs');
    } finally {
      setConfigsLoading(false);
    }
  };

  const updateConfigText = (appKey: string, text: string) => {
    setConfigTexts((prev) => ({ ...prev, [appKey]: text }));
  };

  const parseConfigObject = (appKey: string): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(configTexts[appKey] || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };

  const updateFeedbackField = (appKey: string, field: string, value: string) => {
    const obj = parseConfigObject(appKey);
    obj[field] = value;
    updateConfigText(appKey, JSON.stringify(obj, null, 2));
  };

  const handleSaveConfig = async (appKey: string) => {
    if (!configProject) return;
    let config: unknown;
    try {
      config = JSON.parse(configTexts[appKey] || '{}');
    } catch {
      message.error('Invalid JSON — please fix the config before saving');
      return;
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      message.error('Config must be a JSON object');
      return;
    }
    setSavingConfigKey(appKey);
    try {
      await fetchApi(`/api/v1/projects/${configProject.projectId}/app-configs/${appKey}`, {
        method: 'PUT',
        body: JSON.stringify({
          config,
          enabled: projectEnabled[appKey] ?? true,
        }),
      });
      message.success('Config saved');
    } catch (err: any) {
      message.error(err.message || 'Failed to save config');
    } finally {
      setSavingConfigKey(null);
    }
  };

  const handleToggleProjectEnabled = async (app: CommonApp, next: boolean) => {
    if (!configProject) return;
    if (!app.enabled && next) {
      message.warning('App is globally disabled in Common Apps — cannot enable for this project');
      return;
    }
    const prev = projectEnabled[app.appKey] ?? true;
    setProjectEnabled((m) => ({ ...m, [app.appKey]: next }));
    setTogglingEnableKey(app.appKey);
    try {
      await fetchApi(`/api/v1/projects/${configProject.projectId}/app-configs/${app.appKey}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: next }),
      });
      message.success(`${app.name} ${next ? 'enabled' : 'disabled'} for this project`);
    } catch (err: any) {
      setProjectEnabled((m) => ({ ...m, [app.appKey]: prev }));
      message.error(err.message || 'Failed to update enable state');
    } finally {
      setTogglingEnableKey(null);
    }
  };

  // ── Tables ────────────────────────────────────────────

  const filteredProjects = search.trim()
    ? projects.filter((p) => {
        const q = search.trim().toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q)
        );
      })
    : projects;

  const columns: ColumnsType<Project> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text?: string | null) => text || <span className="muted">—</span>,
    },
    {
      title: 'VCS',
      dataIndex: 'vcsType',
      key: 'vcsType',
      width: 90,
      render: (vcs: VcsType) => <Tag color={VCS_COLORS[vcs] || 'default'}>{vcs || 'none'}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: ProjectStatus) => (
        <Tag color={status === 'active' ? 'green' : 'default'}>{status}</Tag>
      ),
    },
    {
      title: 'Members',
      dataIndex: 'memberCount',
      key: 'memberCount',
      width: 90,
      render: (n?: number) => <span className="muted">{n ?? 0}</span>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 130,
      render: (ts: number) => <span className="muted">{formatDate(ts)}</span>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 210,
      render: (_: unknown, record) => (
        <Space size={0}>
          <Button
            type="text"
            icon={<EditOutlined />}
            title="Edit"
            onClick={() => openEdit(record)}
          />
          <Button
            type="text"
            icon={<TeamOutlined />}
            title="Members"
            onClick={() => openMembers(record)}
          />
          <Button
            type="text"
            icon={<SettingOutlined />}
            title="App configs"
            onClick={() => openConfigs(record)}
          />
          <Button
            type="text"
            icon={record.status === 'active' ? <InboxOutlined /> : <UndoOutlined />}
            title={record.status === 'active' ? 'Archive' : 'Restore'}
            onClick={() => handleToggleArchive(record)}
          />
          <Popconfirm
            title="Delete this project?"
            description="This action cannot be undone."
            onConfirm={() => handleDelete(record.projectId)}
            okText="Delete"
            okType="danger"
            cancelText="Cancel"
          >
            <Button type="text" danger icon={<DeleteOutlined />} title="Delete" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const memberColumns: ColumnsType<ProjectMember> = [
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 130,
      render: (role: 'admin' | 'member', record) => (
        <Select
          value={role}
          onChange={(v: 'admin' | 'member') => handleMemberRoleChange(record.userId, v)}
          style={{ width: 110 }}
          options={[
            { value: 'member', label: 'Member' },
            { value: 'admin', label: 'Admin' },
          ]}
        />
      ),
    },
    {
      title: 'Joined',
      dataIndex: 'joinedAt',
      key: 'joinedAt',
      width: 120,
      render: (ts: number) => <span className="muted">{formatDate(ts)}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      render: (_: unknown, record) => (
        <Popconfirm
          title="Remove this member?"
          onConfirm={() => handleRemoveMember(record.userId)}
          okText="Remove"
          okType="danger"
          cancelText="Cancel"
        >
          <Button type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  const renderConfigPanel = (app: CommonApp) => {
    const isFeedback = app.appKey === 'feedback';
    const parsed = isFeedback ? parseConfigObject(app.appKey) : null;
    const projOn = projectEnabled[app.appKey] ?? true;
    const globallyOff = !app.enabled;
    return (
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'var(--ant-color-fill-quaternary, rgba(0,0,0,0.02))',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Enabled in this project</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {globallyOff
                ? 'Globally disabled in Common Apps — cannot enable here'
                : 'When off, clients in this project cannot run this builtin app'}
            </div>
          </div>
          <Tooltip
            title={
              globallyOff
                ? 'Turn on in Common Apps first'
                : projOn
                  ? 'Disable for this project'
                  : 'Enable for this project'
            }
          >
            <Switch
              checked={globallyOff ? false : projOn}
              disabled={globallyOff}
              loading={togglingEnableKey === app.appKey}
              onChange={(v) => handleToggleProjectEnabled(app, v)}
            />
          </Tooltip>
        </div>

        {isFeedback && parsed && (
          <div style={{ marginBottom: 12 }}>
            {FEEDBACK_STRING_FIELDS.map(({ key, label }) => (
              <div
                key={key}
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}
              >
                <span
                  className="muted"
                  style={{ width: 100, flexShrink: 0, fontSize: 12.5 }}
                >
                  {label}
                </span>
                <Input
                  size="small"
                  value={typeof parsed[key] === 'string' ? (parsed[key] as string) : ''}
                  onChange={(e) => updateFeedbackField(app.appKey, key, e.target.value)}
                  placeholder={label}
                />
              </div>
            ))}
            <div className="muted" style={{ fontSize: 12 }}>
              Edit `fields` mapping directly in the JSON below.
            </div>
          </div>
        )}
        <TextArea
          className="mono"
          rows={isFeedback ? 10 : 8}
          value={configTexts[app.appKey] ?? ''}
          onChange={(e) => updateConfigText(app.appKey, e.target.value)}
          style={{ fontSize: 12.5 }}
        />
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            loading={savingConfigKey === app.appKey}
            onClick={() => handleSaveConfig(app.appKey)}
          >
            Save override
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="page-desc">Manage projects, members and per-project app configs.</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadProjects}>
            Refresh
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            New Project
          </Button>
        </Space>
      </div>

      <div className="page-toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name or description…" />
      </div>

      <div className="panel console-table" style={{ overflow: 'hidden' }}>
        <Table
          columns={columns}
          dataSource={filteredProjects}
          rowKey="projectId"
          loading={loading}
          pagination={{
            pageSize: 20,
            showTotal: (t) => `${t} projects`,
            showSizeChanger: false,
          }}
          locale={{
            emptyText: (
              <div className="empty-state">
                <h3>No projects yet</h3>
                <p>Create your first project to get started.</p>
              </div>
            ),
          }}
        />
      </div>

      {/* Create / edit modal */}
      <Modal
        title={editingProject ? 'Edit Project' : 'New Project'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText={editingProject ? 'Save' : 'Create'}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Project name is required' }]}
          >
            <Input placeholder="Project name" maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={3} placeholder="Optional description" />
          </Form.Item>
          <Form.Item name="vcsType" label="VCS Type">
            <Select
              options={[
                { value: 'none', label: 'None' },
                { value: 'git', label: 'Git' },
                { value: 'svn', label: 'SVN' },
              ]}
            />
          </Form.Item>
          <Form.Item name="repoUrl" label="Repository URL">
            <Input placeholder="https://… or svn://…" />
          </Form.Item>
          {editingProject && (
            <Form.Item name="status" label="Status">
              <Select
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'archived', label: 'Archived' },
                ]}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* Members drawer */}
      <Drawer
        title={memberProject ? `Members — ${memberProject.name}` : 'Members'}
        open={!!memberProject}
        onClose={() => setMemberProject(null)}
        width={560}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Input
            placeholder="Username"
            value={newMemberName}
            onChange={(e) => setNewMemberName(e.target.value)}
            onPressEnter={handleAddMember}
            style={{ flex: 1 }}
          />
          <Select
            value={newMemberRole}
            onChange={setNewMemberRole}
            style={{ width: 110 }}
            options={[
              { value: 'member', label: 'Member' },
              { value: 'admin', label: 'Admin' },
            ]}
          />
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            loading={addingMember}
            onClick={handleAddMember}
          >
            Add
          </Button>
        </div>
        <Table
          columns={memberColumns}
          dataSource={members}
          rowKey="userId"
          loading={membersLoading}
          pagination={false}
          size="small"
          locale={{
            emptyText: (
              <div className="empty-state">
                <h3>No members</h3>
                <p>Add a member by username above.</p>
              </div>
            ),
          }}
        />
      </Drawer>

      {/* App configs drawer */}
      <Drawer
        title={configProject ? `App Configs — ${configProject.name}` : 'App Configs'}
        open={!!configProject}
        onClose={() => setConfigProject(null)}
        width={640}
      >
        {configsLoading ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <Spin />
          </div>
        ) : commonApps.length === 0 ? (
          <Empty description="No common apps available" />
        ) : (
          <Collapse
            defaultActiveKey={commonApps.some((a) => a.appKey === 'feedback') ? ['feedback'] : []}
            items={commonApps.map((app) => {
              const projOn = projectEnabled[app.appKey] ?? true;
              const effectiveOn = app.enabled && projOn;
              return {
                key: app.appKey,
                label: (
                  <Space>
                    <strong>{app.name}</strong>
                    <span className="muted mono" style={{ fontSize: 12 }}>
                      {app.appKey}
                    </span>
                    {!app.enabled ? (
                      <Tag color="default">globally off</Tag>
                    ) : !projOn ? (
                      <Tag color="orange">project off</Tag>
                    ) : (
                      <Tag color="green">on</Tag>
                    )}
                    {!effectiveOn && <Tag>not runnable</Tag>}
                  </Space>
                ),
                children: renderConfigPanel(app),
              };
            })}
          />
        )}
      </Drawer>
    </div>
  );
};

export default ProjectManagementPage;
