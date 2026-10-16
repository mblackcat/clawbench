import React, { useCallback, useEffect, useState } from 'react';
import {
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  theme,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  FolderOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useApi } from '../hooks/useApi';
import type { NavGroup, NavLink, Project } from '../types';

/**
 * Per-project navigation editor.
 *
 * Mirrors what the client workbench shows: a Chrome-bookmarks-style bar where
 * groups render as folders and ungrouped links sit at the top level. Ordering
 * is adjusted with up/down controls and persisted through PUT /nav/order.
 */

interface Props {
  project: Project | null;
  onClose: () => void;
}

interface LinkFormValues {
  url: string;
  title?: string;
  icon?: string;
  groupId?: string | null;
}

interface GroupFormValues {
  title: string;
  icon?: string;
}

/** Sentinel for the "no group" option — antd Select treats null awkwardly */
const TOP_LEVEL = '__top__';

const ProjectNavDrawer: React.FC<Props> = ({ project, onClose }) => {
  const { fetchApi } = useApi();
  const { message } = App.useApp();
  const { token } = theme.useToken();

  const [groups, setGroups] = useState<NavGroup[]>([]);
  const [links, setLinks] = useState<NavLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<NavLink | null>(null);
  const [linkForm] = Form.useForm<LinkFormValues>();

  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<NavGroup | null>(null);
  const [groupForm] = Form.useForm<GroupFormValues>();

  const projectId = project?.projectId;

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetchApi<{
        success: boolean;
        data: { groups: NavGroup[]; links: NavLink[] };
      }>(`/api/v1/projects/${projectId}/nav`);
      setGroups(res.data.groups);
      setLinks(res.data.links);
    } catch (err: any) {
      message.error(err.message || 'Failed to load navigation');
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchApi, message]);

  useEffect(() => {
    if (projectId) {
      load();
    } else {
      setGroups([]);
      setLinks([]);
    }
  }, [projectId, load]);

  /** Links belonging to a container, in current display order */
  const linksIn = (groupId: string | null): NavLink[] =>
    links
      .filter((l) => (l.groupId ?? null) === groupId)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);

  /**
   * Flatten to the payload PUT /nav/order expects: every link, grouped by
   * container, in the order it should render.
   */
  const buildLinkOrderPayload = (source: NavLink[]): { linkId: string; groupId: string | null }[] => {
    const byContainer = (groupId: string | null) =>
      source
        .filter((l) => (l.groupId ?? null) === groupId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((l) => ({ linkId: l.linkId, groupId }));

    return [
      ...byContainer(null),
      ...groups.flatMap((g) => byContainer(g.groupId)),
    ];
  };

  const persistOrder = async (
    nextGroups: NavGroup[] | null,
    nextLinks: NavLink[] | null
  ): Promise<void> => {
    if (!projectId) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (nextGroups) body.groups = nextGroups.map((g) => g.groupId);
      if (nextLinks) body.links = buildLinkOrderPayload(nextLinks);
      const res = await fetchApi<{
        success: boolean;
        data: { groups: NavGroup[]; links: NavLink[] };
      }>(`/api/v1/projects/${projectId}/nav/order`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setGroups(res.data.groups);
      setLinks(res.data.links);
    } catch (err: any) {
      message.error(err.message || 'Failed to save order');
      load();
    } finally {
      setBusy(false);
    }
  };

  const moveGroup = (groupId: string, delta: number) => {
    const ordered = groups.slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((g) => g.groupId === groupId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= ordered.length) return;
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved);
    const renumbered = ordered.map((g, i) => ({ ...g, sortOrder: i }));
    setGroups(renumbered);
    persistOrder(renumbered, null);
  };

  const moveLink = (link: NavLink, delta: number) => {
    const container = link.groupId ?? null;
    const siblings = linksIn(container);
    const index = siblings.findIndex((l) => l.linkId === link.linkId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= siblings.length) return;
    const [moved] = siblings.splice(index, 1);
    siblings.splice(target, 0, moved);

    const renumbered = new Map(siblings.map((l, i) => [l.linkId, i]));
    const next = links.map((l) =>
      renumbered.has(l.linkId) ? { ...l, sortOrder: renumbered.get(l.linkId)! } : l
    );
    setLinks(next);
    persistOrder(null, next);
  };

  // ── Link create / edit ────────────────────────────────

  const openCreateLink = (groupId: string | null) => {
    setEditingLink(null);
    linkForm.resetFields();
    linkForm.setFieldsValue({ groupId: groupId ?? TOP_LEVEL });
    setLinkModalOpen(true);
  };

  const openEditLink = (link: NavLink) => {
    setEditingLink(link);
    linkForm.setFieldsValue({
      url: link.url,
      title: link.title,
      icon: link.icon || '',
      groupId: link.groupId ?? TOP_LEVEL,
    });
    setLinkModalOpen(true);
  };

  const submitLink = async () => {
    if (!projectId) return;
    let values: LinkFormValues;
    try {
      values = await linkForm.validateFields();
    } catch {
      return;
    }
    const groupId = !values.groupId || values.groupId === TOP_LEVEL ? null : values.groupId;
    // Empty title / icon are sent through so the backend re-fetches them from the URL
    const body = {
      url: values.url,
      title: values.title?.trim() || '',
      icon: values.icon?.trim() || '',
      groupId,
    };
    setBusy(true);
    try {
      if (editingLink) {
        await fetchApi(`/api/v1/projects/${projectId}/nav/links/${editingLink.linkId}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        message.success('Link updated');
      } else {
        await fetchApi(`/api/v1/projects/${projectId}/nav/links`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        message.success('Link added');
      }
      setLinkModalOpen(false);
      await load();
    } catch (err: any) {
      message.error(err.message || 'Failed to save link');
    } finally {
      setBusy(false);
    }
  };

  const deleteLink = async (linkId: string) => {
    if (!projectId) return;
    try {
      await fetchApi(`/api/v1/projects/${projectId}/nav/links/${linkId}`, { method: 'DELETE' });
      message.success('Link deleted');
      await load();
    } catch (err: any) {
      message.error(err.message || 'Failed to delete link');
    }
  };

  const refreshLinkMetadata = async (linkId: string) => {
    if (!projectId) return;
    setBusy(true);
    try {
      await fetchApi(`/api/v1/projects/${projectId}/nav/links/${linkId}/refresh-metadata`, {
        method: 'POST',
      });
      message.success('Title and icon re-fetched');
      await load();
    } catch (err: any) {
      message.error(err.message || 'Failed to re-fetch metadata');
    } finally {
      setBusy(false);
    }
  };

  // ── Group create / edit ───────────────────────────────

  const openCreateGroup = () => {
    setEditingGroup(null);
    groupForm.resetFields();
    setGroupModalOpen(true);
  };

  const openEditGroup = (group: NavGroup) => {
    setEditingGroup(group);
    groupForm.setFieldsValue({ title: group.title, icon: group.icon || '' });
    setGroupModalOpen(true);
  };

  const submitGroup = async () => {
    if (!projectId) return;
    let values: GroupFormValues;
    try {
      values = await groupForm.validateFields();
    } catch {
      return;
    }
    const body = { title: values.title.trim(), icon: values.icon?.trim() || '' };
    setBusy(true);
    try {
      if (editingGroup) {
        await fetchApi(`/api/v1/projects/${projectId}/nav/groups/${editingGroup.groupId}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        message.success('Group updated');
      } else {
        await fetchApi(`/api/v1/projects/${projectId}/nav/groups`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        message.success('Group added');
      }
      setGroupModalOpen(false);
      await load();
    } catch (err: any) {
      message.error(err.message || 'Failed to save group');
    } finally {
      setBusy(false);
    }
  };

  const deleteGroup = async (groupId: string) => {
    if (!projectId) return;
    try {
      await fetchApi(`/api/v1/projects/${projectId}/nav/groups/${groupId}`, { method: 'DELETE' });
      message.success('Group deleted — its links moved to the top level');
      await load();
    } catch (err: any) {
      message.error(err.message || 'Failed to delete group');
    }
  };

  // ── Render ────────────────────────────────────────────

  const groupOptions = [
    { value: TOP_LEVEL, label: 'No group (top level)' },
    ...groups
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => ({ value: g.groupId, label: g.title })),
  ];

  const renderLinkRow = (link: NavLink, index: number, total: number) => (
    <div
      key={link.linkId}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 6,
        background: token.colorFillQuaternary,
        marginBottom: 6,
      }}
    >
      {link.icon ? (
        <img
          src={link.icon}
          alt=""
          width={16}
          height={16}
          style={{ borderRadius: 3, flexShrink: 0 }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
      ) : (
        <LinkOutlined style={{ fontSize: 14, flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 13 }}>{link.title}</div>
        <div className="muted mono" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
          {link.url}
        </div>
      </div>
      <Tooltip title="Client click count">
        <Tag style={{ marginInlineEnd: 0 }}>{link.clickCount}</Tag>
      </Tooltip>
      <Space size={0}>
        <Button
          type="text"
          size="small"
          icon={<ArrowUpOutlined />}
          disabled={index === 0 || busy}
          onClick={() => moveLink(link, -1)}
        />
        <Button
          type="text"
          size="small"
          icon={<ArrowDownOutlined />}
          disabled={index === total - 1 || busy}
          onClick={() => moveLink(link, 1)}
        />
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          title="Re-fetch title & icon from the URL"
          disabled={busy}
          onClick={() => refreshLinkMetadata(link.linkId)}
        />
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          onClick={() => openEditLink(link)}
        />
        <Popconfirm
          title="Delete this link?"
          onConfirm={() => deleteLink(link.linkId)}
          okText="Delete"
          okType="danger"
          cancelText="Cancel"
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    </div>
  );

  const topLevelLinks = linksIn(null);
  const orderedGroups = groups.slice().sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <>
      <Drawer
        title={project ? `Navigation — ${project.name}` : 'Navigation'}
        open={!!project}
        onClose={onClose}
        width={640}
        extra={
          <Space>
            <Button icon={<FolderAddOutlined />} onClick={openCreateGroup}>
              New Group
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreateLink(null)}>
              New Link
            </Button>
          </Space>
        }
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <Spin />
          </div>
        ) : (
          <div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              Shown as the pinned first row of the client workbench. Groups render as folders;
              leave title or icon blank and the server fetches them from the URL.
            </p>

            {/* Top level */}
            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <strong style={{ fontSize: 13 }}>Top level</strong>
                <Button
                  size="small"
                  type="link"
                  icon={<PlusOutlined />}
                  onClick={() => openCreateLink(null)}
                >
                  Add link
                </Button>
              </div>
              {topLevelLinks.length === 0 ? (
                <div className="muted" style={{ fontSize: 12.5, padding: '4px 8px' }}>
                  No ungrouped links.
                </div>
              ) : (
                topLevelLinks.map((link, i) => renderLinkRow(link, i, topLevelLinks.length))
              )}
            </div>

            {/* Groups */}
            {orderedGroups.length === 0 && topLevelLinks.length === 0 && (
              <Empty description="No navigation entries yet" />
            )}
            {orderedGroups.map((group, gi) => {
              const groupLinks = linksIn(group.groupId);
              return (
                <div key={group.groupId} style={{ marginBottom: 20 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 8,
                      paddingBottom: 6,
                      borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    }}
                  >
                    {group.icon ? (
                      <img src={group.icon} alt="" width={16} height={16} style={{ borderRadius: 3 }} />
                    ) : (
                      <FolderOutlined />
                    )}
                    <strong style={{ fontSize: 13, flex: 1 }}>{group.title}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {groupLinks.length} link{groupLinks.length === 1 ? '' : 's'}
                    </span>
                    <Space size={0}>
                      <Button
                        type="text"
                        size="small"
                        icon={<ArrowUpOutlined />}
                        disabled={gi === 0 || busy}
                        onClick={() => moveGroup(group.groupId, -1)}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<ArrowDownOutlined />}
                        disabled={gi === orderedGroups.length - 1 || busy}
                        onClick={() => moveGroup(group.groupId, 1)}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        title="Add link to this group"
                        onClick={() => openCreateLink(group.groupId)}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => openEditGroup(group)}
                      />
                      <Popconfirm
                        title="Delete this group?"
                        description="Links inside move to the top level."
                        onConfirm={() => deleteGroup(group.groupId)}
                        okText="Delete"
                        okType="danger"
                        cancelText="Cancel"
                      >
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  </div>
                  {groupLinks.length === 0 ? (
                    <div className="muted" style={{ fontSize: 12.5, padding: '4px 8px' }}>
                      Empty group.
                    </div>
                  ) : (
                    groupLinks.map((link, i) => renderLinkRow(link, i, groupLinks.length))
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Drawer>

      {/* Link modal */}
      <Modal
        title={editingLink ? 'Edit Link' : 'New Link'}
        open={linkModalOpen}
        onOk={submitLink}
        onCancel={() => setLinkModalOpen(false)}
        okText={editingLink ? 'Save' : 'Add'}
        confirmLoading={busy}
        destroyOnClose
      >
        <Form form={linkForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="url"
            label="URL"
            rules={[{ required: true, message: 'URL is required' }]}
          >
            <Input placeholder="https://example.com" maxLength={2000} />
          </Form.Item>
          <Form.Item
            name="title"
            label="Title"
            extra="Leave blank to fetch the page title automatically"
          >
            <Input placeholder="Auto-detected from the URL" maxLength={100} />
          </Form.Item>
          <Form.Item
            name="icon"
            label="Icon URL"
            extra="Leave blank to fetch the site favicon automatically"
          >
            <Input placeholder="Auto-detected from the URL" maxLength={2000} />
          </Form.Item>
          <Form.Item name="groupId" label="Group">
            <Select options={groupOptions} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Group modal */}
      <Modal
        title={editingGroup ? 'Edit Group' : 'New Group'}
        open={groupModalOpen}
        onOk={submitGroup}
        onCancel={() => setGroupModalOpen(false)}
        okText={editingGroup ? 'Save' : 'Add'}
        confirmLoading={busy}
        destroyOnClose
      >
        <Form form={groupForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="title"
            label="Title"
            rules={[{ required: true, message: 'Group title is required' }]}
          >
            <Input placeholder="Group name" maxLength={100} />
          </Form.Item>
          <Form.Item name="icon" label="Icon URL" extra="Optional — defaults to a folder icon">
            <Input placeholder="https://…/icon.png" maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default ProjectNavDrawer;
