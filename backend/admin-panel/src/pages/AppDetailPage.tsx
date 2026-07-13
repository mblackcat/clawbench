import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Typography, Tag, Spin, Button, Descriptions, Timeline, Switch, App, Empty, List } from 'antd';
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  AppstoreOutlined,
  ThunderboltOutlined,
  MessageOutlined,
  UserOutlined,
  CalendarOutlined,
  TagOutlined,
  StarOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useApi } from '../hooks/useApi';
import InstallButton from '../components/InstallButton';
import GlassCard from '../components/GlassCard';
import type { ApplicationResponse, ExecutionErrorResponse } from '../types';

const { Title, Text, Paragraph } = Typography;

const TYPE_ICONS: Record<string, React.ReactNode> = {
  app: <AppstoreOutlined />,
  'ai-skill': <ThunderboltOutlined />,
  prompt: <MessageOutlined />,
};

const TYPE_COLORS: Record<string, string> = {
  app: '#007AFF',
  'ai-skill': '#AF52DE',
  prompt: '#34C759',
};

const AppDetailPage: React.FC = () => {
  const { appId } = useParams<{ appId: string }>();
  const [app, setApp] = useState<ApplicationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingFeatured, setTogglingFeatured] = useState(false);
  const [executionErrors, setExecutionErrors] = useState<ExecutionErrorResponse[]>([]);
  const [loadingErrors, setLoadingErrors] = useState(false);
  const { fetchApi } = useApi();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  useEffect(() => {
    if (!appId) return;
    loadApp();
  }, [appId]);

  // Admin-only: execution error logs are never fetched (or rendered) on the
  // public /store page — this call only fires once the admin view has an appId.
  useEffect(() => {
    if (!appId || !isAdmin) return;
    loadExecutionErrors(appId);
  }, [appId, isAdmin]);

  const loadApp = async () => {
    setLoading(true);
    try {
      const res = await fetchApi<{ success: boolean; data: ApplicationResponse }>(
        `/api/v1/applications/${appId}`
      );
      setApp(res.data);
    } catch {
      // Handle error
    } finally {
      setLoading(false);
    }
  };

  const loadExecutionErrors = async (id: string) => {
    setLoadingErrors(true);
    try {
      const res = await fetchApi<{ success: boolean; data: { errors: ExecutionErrorResponse[]; total: number } }>(
        `/api/v1/admin/applications/${id}/execution-errors?limit=20`
      );
      setExecutionErrors(res.data.errors);
    } catch {
      // Non-admin or network error — leave the list empty, section renders its empty state.
    } finally {
      setLoadingErrors(false);
    }
  };

  /** Admin: toggle the featured (推荐) flag via the admin PUT endpoint. */
  const handleToggleFeatured = async (next: boolean) => {
    if (!app) return;
    setTogglingFeatured(true);
    try {
      const res = await fetchApi<{ success: boolean; data: ApplicationResponse }>(
        `/api/v1/admin/applications/${app.applicationId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ featured: next }),
        }
      );
      setApp(res.data);
      message.success(next ? 'Marked as featured' : 'Removed featured');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setTogglingFeatured(false);
    }
  };

  const goBack = () => isAdmin ? navigate('/admin/store') : navigate('/store');

  if (loading) {
    return (
      <div className="ios-page-enter" style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="ios-empty-state" style={{ animation: 'pageSlideUp 0.4s var(--transition-spring) both' }}>
        <div className="ios-empty-state-icon"><AppstoreOutlined /></div>
        <h3>App Not Found</h3>
        <p>The app you're looking for doesn't exist or has been removed.</p>
        <Button type="primary" onClick={goBack} style={{ marginTop: 16, borderRadius: 10 }}>
          Back to Store
        </Button>
      </div>
    );
  }

  const typeColor = TYPE_COLORS[app.type] || '#007AFF';

  return (
    <div className="ios-page-enter" style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Back button */}
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={goBack}
        style={{ marginBottom: 24, color: 'var(--text-secondary)', borderRadius: 10 }}
      >
        {isAdmin ? 'Back to Admin' : 'Back to Store'}
      </Button>

      {/* Header — elevated glass card */}
      <div className="ios-glass-elevated" style={{ padding: 32, marginBottom: 24, display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div
          className="ios-app-icon"
          style={{
            width: 80,
            height: 80,
            borderRadius: 20,
            fontSize: 32,
            background: `linear-gradient(135deg, ${typeColor}, ${typeColor}99)`,
            boxShadow: `0 8px 24px ${typeColor}40`,
            flexShrink: 0,
          }}
        >
          {TYPE_ICONS[app.type] || <AppstoreOutlined />}
        </div>
        <div style={{ flex: 1, position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <Title level={2} style={{ margin: 0, letterSpacing: '-0.02em' }}>
              {app.name}
            </Title>
            <span className="ios-category-badge">
              {app.type === 'ai-skill' ? 'AI Skill' : app.type}
            </span>
          </div>
          <Text type="secondary" style={{ fontSize: 15, display: 'block', marginBottom: 20, lineHeight: 1.5 }}>
            {app.description || 'No description provided.'}
          </Text>
          <InstallButton appId={app.applicationId} appName={app.name} size="large" />
        </div>
      </div>

      {/* Stats */}
      <GlassCard className="" style={{ padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, textAlign: 'center' }}>
          <div>
            <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Downloads</Text>
            <Text strong style={{ fontSize: 24, display: 'block', marginTop: 4 }}>
              {app.downloadCount?.toLocaleString() || 0}
            </Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Version</Text>
            <Text strong style={{ fontSize: 16, display: 'block', marginTop: 4 }}>
              {app.version ? `v${app.version}` : '—'}
            </Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Executions</Text>
            <Text strong style={{ fontSize: 24, display: 'block', marginTop: 4 }}>
              {app.executionCount?.toLocaleString() || 0}
            </Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Category</Text>
            <Text strong style={{ fontSize: 16, display: 'block', marginTop: 4 }}>
              {app.category || 'Uncategorized'}
            </Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</Text>
            <Tag color={app.published ? 'green' : 'default'} style={{ marginTop: 4 }}>
              {app.published ? 'Published' : 'Unpublished'}
            </Tag>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Updated</Text>
            <Text strong style={{ fontSize: 14, display: 'block', marginTop: 4 }}>
              {new Date(app.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
          </div>
        </div>
      </GlassCard>

      {/* Admin controls — featured (推荐) toggle. Surfaced in admin view only. */}
      {isAdmin && (
        <GlassCard className="" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <StarOutlined style={{ fontSize: 18, color: '#FF9500' }} />
              <div>
                <Text strong style={{ fontSize: 15 }}>Featured (推荐)</Text>
                <Text type="secondary" style={{ display: 'block', fontSize: 13 }}>
                  Mark this app as recommended. Surfaced in future client releases.
                </Text>
              </div>
            </div>
            <Switch
              checked={app.featured}
              loading={togglingFeatured}
              onChange={handleToggleFeatured}
            />
          </div>
        </GlassCard>
      )}

      {/* Details */}
      <GlassCard className="" style={{ padding: 24, marginBottom: 24 }}>
        <Title level={4} style={{ marginBottom: 16, letterSpacing: '-0.01em' }}>
          Details
        </Title>
        <Descriptions column={1} size="small" colon={false}>
          <Descriptions.Item label={<><TagOutlined style={{ marginRight: 6 }} />Type</>}>
            <Tag>{app.type}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label={<><TagOutlined style={{ marginRight: 6 }} />Version</>}>
            {app.version ? `v${app.version}` : 'Unpublished'}
          </Descriptions.Item>
          <Descriptions.Item label={<><UserOutlined style={{ marginRight: 6 }} />Author</>}>
            {app.ownerName || app.ownerId}
          </Descriptions.Item>
          <Descriptions.Item label={<><CalendarOutlined style={{ marginRight: 6 }} />Created</>}>
            {new Date(app.createdAt).toLocaleDateString('en-US', {
              year: 'numeric', month: 'long', day: 'numeric',
            })}
          </Descriptions.Item>
        </Descriptions>
      </GlassCard>

      {/* Version History — visible to everyone, mirrors the desktop client's update-history view */}
      <GlassCard className="" style={{ padding: 24, marginBottom: 24 }}>
        <Title level={4} style={{ marginBottom: 16, letterSpacing: '-0.01em' }}>
          Version History
        </Title>
        {app.versions && app.versions.length > 0 ? (
          <Timeline
            items={app.versions.map((v) => ({
              key: v.versionId,
              children: (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text strong>v{v.version}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(v.publishedAt).toLocaleString('en-US', {
                        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {(v.fileSize / 1024 / 1024).toFixed(2)} MB
                    </Text>
                  </div>
                  {v.changelog && (
                    <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 13 }}>
                      {v.changelog}
                    </Text>
                  )}
                </div>
              ),
            }))}
          />
        ) : (
          <Empty description="No versions published yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </GlassCard>

      {/* Execution Errors — admin-only. Never fetched or rendered on the public /store page. */}
      {isAdmin && (
        <GlassCard className="" style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <WarningOutlined style={{ fontSize: 18, color: '#FF3B30' }} />
            <Title level={4} style={{ margin: 0, letterSpacing: '-0.01em' }}>
              Execution Errors
            </Title>
          </div>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <Text strong>{err.username || err.userId}</Text>
                    {err.version && <Tag style={{ margin: 0 }}>v{err.version}</Tag>}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(err.createdAt).toLocaleString('en-US', {
                        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </Text>
                  </div>
                  <Text type="danger" style={{ display: 'block', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                    {err.message}
                  </Text>
                  {err.details && (
                    <Text
                      type="secondary"
                      style={{ display: 'block', fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}
                    >
                      {err.details}
                    </Text>
                  )}
                </List.Item>
              )}
            />
          ) : (
            <Empty description="No execution errors reported" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </GlassCard>
      )}

      {/* Install CTA */}
      <div
        className="ios-glass-elevated"
        style={{
          padding: 32,
          textAlign: 'center',
          marginTop: 8,
        }}
      >
        <Title level={4} style={{ marginBottom: 8 }}>
          Ready to get started?
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
          Install {app.name} and start using it in your ClawBench workspace.
        </Text>
        <InstallButton appId={app.applicationId} appName={app.name} size="large" />
      </div>
    </div>
  );
};

export default AppDetailPage;
