import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Spin,
  Button,
  Switch,
  App,
  Empty,
  List,
  Input,
  Tag,
  Space,
  Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined,
  StarOutlined,
  WarningOutlined,
  SaveOutlined,
  LinkOutlined,
  UserOutlined,
  CalendarOutlined,
  CloudUploadOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useApi } from '../hooks/useApi';
import InstallButton from '../components/InstallButton';
import ResourceCover from '../components/ResourceCover';
import TypeBadge from '../components/TypeBadge';
import type { ApplicationResponse, ExecutionErrorResponse } from '../types';
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatNumber,
  isAutoFavicon,
  faviconFromUrl,
} from '../utils/cover';

const ResourceDetailPage: React.FC = () => {
  const { appId } = useParams<{ appId: string }>();
  const [app, setApp] = useState<ApplicationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingFeatured, setTogglingFeatured] = useState(false);
  const [togglingPublished, setTogglingPublished] = useState(false);
  const [executionErrors, setExecutionErrors] = useState<ExecutionErrorResponse[]>([]);
  const [loadingErrors, setLoadingErrors] = useState(false);
  const [coverInput, setCoverInput] = useState('');
  const [savingCover, setSavingCover] = useState(false);
  const { fetchApi } = useApi();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  useEffect(() => {
    if (!appId) return;
    loadApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  useEffect(() => {
    if (!appId || !isAdmin) return;
    loadExecutionErrors(appId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, isAdmin]);

  const loadApp = async () => {
    setLoading(true);
    try {
      const res = await fetchApi<{ success: boolean; data: ApplicationResponse }>(
        `/api/v1/applications/${appId}`
      );
      setApp(res.data);
      const meta = res.data.metadata || {};
      setCoverInput(
        (typeof meta.coverUrl === 'string' && meta.coverUrl) ||
          (typeof meta.icon === 'string' && meta.icon) ||
          ''
      );
    } catch {
      setApp(null);
    } finally {
      setLoading(false);
    }
  };

  const loadExecutionErrors = async (id: string) => {
    setLoadingErrors(true);
    try {
      const res = await fetchApi<{
        success: boolean;
        data: { errors: ExecutionErrorResponse[]; total: number };
      }>(`/api/v1/admin/applications/${id}/execution-errors?limit=20`);
      setExecutionErrors(res.data.errors);
    } catch {
      setExecutionErrors([]);
    } finally {
      setLoadingErrors(false);
    }
  };

  const adminPatch = async (body: Record<string, unknown>) => {
    if (!app) return null;
    const res = await fetchApi<{ success: boolean; data: ApplicationResponse }>(
      `/api/v1/admin/applications/${app.applicationId}`,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      }
    );
    // Preserve versions from detail if admin update doesn't return them
    setApp((prev) =>
      prev
        ? {
            ...res.data,
            versions: res.data.versions ?? prev.versions,
            ownerName: res.data.ownerName ?? prev.ownerName,
          }
        : res.data
    );
    return res.data;
  };

  const handleToggleFeatured = async (next: boolean) => {
    if (!app) return;
    setTogglingFeatured(true);
    try {
      await adminPatch({ featured: next });
      message.success(next ? 'Marked as featured' : 'Removed featured');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setTogglingFeatured(false);
    }
  };

  const handleTogglePublished = async (next: boolean) => {
    if (!app) return;
    setTogglingPublished(true);
    try {
      await adminPatch({ published: next });
      message.success(next ? 'Published' : 'Unpublished');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setTogglingPublished(false);
    }
  };

  const handleSaveCover = async () => {
    if (!app) return;
    setSavingCover(true);
    try {
      const trimmed = coverInput.trim();
      // Empty cover: clear coverUrl; for links leave icon empty so favicon kicks in
      await adminPatch({
        metadata: {
          coverUrl: trimmed || '',
          // Keep icon in sync for link-type clients that only read icon
          icon: trimmed || '',
        },
      });
      message.success(trimmed ? 'Cover image saved' : 'Cover cleared (auto favicon for links)');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save cover');
    } finally {
      setSavingCover(false);
    }
  };

  const handleUseFavicon = () => {
    if (!app) return;
    const url = typeof app.metadata?.url === 'string' ? app.metadata.url : '';
    if (!url) {
      message.warning('This link has no URL in metadata');
      return;
    }
    const fav = faviconFromUrl(url);
    if (fav) setCoverInput(fav);
  };

  const goBack = () =>
    isAdmin ? navigate('/admin/resources') : navigate('/store');

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!app) {
    return (
      <div>
        <button type="button" className="back-link" onClick={goBack}>
          <ArrowLeftOutlined /> Back
        </button>
        <div className="empty-state panel">
          <h3>Resource not found</h3>
          <p>It may have been deleted or the ID is invalid.</p>
          <Button type="primary" onClick={goBack} style={{ marginTop: 16 }}>
            Back to list
          </Button>
        </div>
      </div>
    );
  }

  const autoFavicon = isAutoFavicon(app);
  const linkUrl = typeof app.metadata?.url === 'string' ? app.metadata.url : null;

  return (
    <div>
      <button type="button" className="back-link" onClick={goBack}>
        <ArrowLeftOutlined /> {isAdmin ? 'Back to resources' : 'Back to marketplace'}
      </button>

      {/* Header */}
      <div className="detail-header">
        <ResourceCover app={app} size="xl" />
        <div className="detail-header-info">
          <h1>{app.name}</h1>
          <p className="detail-desc">{app.description || 'No description provided.'}</p>
          <div className="detail-meta-row">
            <TypeBadge type={app.type} />
            {app.version && (
              <Tag color="processing" className="mono">
                v{app.version}
              </Tag>
            )}
            <Tag>
              <span className={`status-dot ${app.published ? 'status-dot--on' : 'status-dot--off'}`} />
              {app.published ? 'Published' : 'Draft'}
            </Tag>
            {app.featured && (
              <span className="featured-pill">
                <StarOutlined /> Featured
              </span>
            )}
            {app.category && <Tag>{app.category}</Tag>}
            {autoFavicon && (
              <Tooltip title="Cover auto-resolved from website favicon">
                <Tag>Auto favicon</Tag>
              </Tooltip>
            )}
          </div>
          <div style={{ marginTop: 14 }}>
            <InstallButton appId={app.applicationId} appName={app.name} size="middle" />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="detail-stats">
        <div className="detail-stat">
          <div className="label">Downloads</div>
          <div className="value">{formatNumber(app.downloadCount)}</div>
        </div>
        <div className="detail-stat">
          <div className="label">Executions</div>
          <div className="value">{formatNumber(app.executionCount)}</div>
        </div>
        <div className="detail-stat">
          <div className="label">Version</div>
          <div className="value" style={{ fontSize: 16 }}>
            {app.version ? `v${app.version}` : '—'}
          </div>
        </div>
        <div className="detail-stat">
          <div className="label">History</div>
          <div className="value">{formatNumber(app.versions?.length ?? 0)}</div>
        </div>
        <div className="detail-stat">
          <div className="label">Updated</div>
          <div className="value" style={{ fontSize: 14 }}>
            {formatDate(app.updatedAt)}
          </div>
        </div>
      </div>

      <div className="detail-sections">
        {/* Admin controls */}
        {isAdmin && (
          <div className="panel">
            <div className="panel-body">
              <h2 className="panel-title">Admin controls</h2>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 560, fontSize: 13.5 }}>Featured (推荐)</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      Highlight this resource in the client.
                    </div>
                  </div>
                  <Switch
                    checked={app.featured}
                    loading={togglingFeatured}
                    onChange={handleToggleFeatured}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 560, fontSize: 13.5 }}>Published</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      Visible in the public marketplace when on.
                    </div>
                  </div>
                  <Switch
                    checked={app.published}
                    loading={togglingPublished}
                    onChange={handleTogglePublished}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Cover image editor (admin) */}
        {isAdmin && (
          <div className="panel">
            <div className="panel-body">
              <h2 className="panel-title">Cover image</h2>
              <div className="cover-editor">
                <div className="cover-editor-preview">
                  <ResourceCover
                    app={{
                      ...app,
                      metadata: {
                        ...(app.metadata || {}),
                        coverUrl: coverInput.trim() || undefined,
                        icon: coverInput.trim() || undefined,
                      },
                    }}
                    size="lg"
                  />
                </div>
                <div className="cover-editor-fields">
                  <Input
                    value={coverInput}
                    onChange={(e) => setCoverInput(e.target.value)}
                    placeholder="https://example.com/cover.png"
                    allowClear
                  />
                  <div className="cover-editor-hint">
                    Set a cover image URL for apps, AI skills, prompts, and links.
                    {app.type === 'link' && (
                      <>
                        {' '}
                        Leave empty to auto-use the website favicon
                        {linkUrl ? (
                          <>
                            {' '}
                            (
                            <a href={linkUrl} target="_blank" rel="noreferrer">
                              {linkUrl}
                            </a>
                            ).
                          </>
                        ) : (
                          '.'
                        )}
                      </>
                    )}
                  </div>
                  <Space wrap>
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      loading={savingCover}
                      onClick={handleSaveCover}
                    >
                      Save cover
                    </Button>
                    {app.type === 'link' && (
                      <Button icon={<ReloadOutlined />} onClick={handleUseFavicon}>
                        Use favicon URL
                      </Button>
                    )}
                  </Space>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Details */}
        <div className="panel">
          <div className="panel-body">
            <h2 className="panel-title">Details</h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr',
                gap: '10px 16px',
                fontSize: 13.5,
              }}
            >
              <span className="muted">Type</span>
              <span>
                <TypeBadge type={app.type} />
              </span>
              <span className="muted">Version</span>
              <span className="mono">{app.version ? `v${app.version}` : 'No package yet'}</span>
              <span className="muted">
                <UserOutlined style={{ marginRight: 4 }} />
                Author
              </span>
              <span>{app.ownerName || app.ownerId}</span>
              <span className="muted">
                <CalendarOutlined style={{ marginRight: 4 }} />
                Created
              </span>
              <span>{formatDateTime(app.createdAt)}</span>
              <span className="muted">
                <CloudUploadOutlined style={{ marginRight: 4 }} />
                Updated
              </span>
              <span>{formatDateTime(app.updatedAt)}</span>
              {linkUrl && (
                <>
                  <span className="muted">
                    <LinkOutlined style={{ marginRight: 4 }} />
                    URL
                  </span>
                  <span>
                    <a href={linkUrl} target="_blank" rel="noreferrer">
                      {linkUrl}
                    </a>
                  </span>
                </>
              )}
              <span className="muted">ID</span>
              <span className="mono muted" style={{ fontSize: 12 }}>
                {app.applicationId}
              </span>
            </div>
          </div>
        </div>

        {/* Version history */}
        <div className="panel">
          <div className="panel-body">
            <h2 className="panel-title">Version history</h2>
            {app.versions && app.versions.length > 0 ? (
              <div>
                {app.versions.map((v) => (
                  <div key={v.versionId} className="version-row">
                    <div className="version-tag">v{v.version}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="version-meta">
                        {formatDateTime(v.publishedAt)}
                        {' · '}
                        {formatBytes(v.fileSize)}
                      </div>
                      {v.changelog && (
                        <div className="version-changelog">{v.changelog}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                description="No versions published yet"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </div>
        </div>

        {/* Execution errors — admin only */}
        {isAdmin && (
          <div className="panel">
            <div className="panel-body">
              <h2 className="panel-title">
                <WarningOutlined style={{ color: 'var(--danger)', marginRight: 8 }} />
                Execution errors
              </h2>
              {loadingErrors ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                  <Spin />
                </div>
              ) : executionErrors.length > 0 ? (
                <List
                  itemLayout="vertical"
                  dataSource={executionErrors}
                  renderItem={(err) => (
                    <List.Item key={err.errorId}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 4,
                          flexWrap: 'wrap',
                        }}
                      >
                        <strong style={{ fontSize: 13 }}>{err.username || err.userId}</strong>
                        {err.version && (
                          <Tag className="mono" style={{ margin: 0 }}>
                            v{err.version}
                          </Tag>
                        )}
                        <span className="muted" style={{ fontSize: 12 }}>
                          {formatDateTime(err.createdAt)}
                        </span>
                      </div>
                      <div style={{ color: 'var(--danger)', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                        {err.message}
                      </div>
                      {err.details && (
                        <pre
                          style={{
                            margin: '6px 0 0',
                            fontSize: 12,
                            color: 'var(--text-tertiary)',
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
                          }}
                        >
                          {err.details}
                        </pre>
                      )}
                    </List.Item>
                  )}
                />
              ) : (
                <Empty
                  description="No execution errors reported"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResourceDetailPage;
