import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Typography, Tag, Spin, Button, Descriptions, Timeline, Divider } from 'antd';
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  AppstoreOutlined,
  ThunderboltOutlined,
  MessageOutlined,
  UserOutlined,
  CalendarOutlined,
  TagOutlined,
} from '@ant-design/icons';
import { useApi } from '../hooks/useApi';
import InstallButton from '../components/InstallButton';
import GlassCard from '../components/GlassCard';
import type { ApplicationResponse } from '../types';

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
  const { fetchApi } = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  useEffect(() => {
    if (!appId) return;
    loadApp();
  }, [appId]);

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

  const goBack = () => isAdmin ? navigate('/admin/store') : navigate('/store');

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="ios-empty-state">
        <div className="ios-empty-state-icon"><AppstoreOutlined /></div>
        <h3>App Not Found</h3>
        <p>The app you're looking for doesn't exist or has been removed.</p>
        <Button type="primary" onClick={goBack} style={{ marginTop: 16 }}>
          Back to Store
        </Button>
      </div>
    );
  }

  const typeColor = TYPE_COLORS[app.type] || '#007AFF';

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Back button */}
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={goBack}
        style={{ marginBottom: 24, color: 'var(--text-secondary)' }}
      >
        {isAdmin ? 'Back to Admin' : 'Back to Store'}
      </Button>

      {/* Header */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 32, alignItems: 'flex-start' }}>
        <div
          className="ios-app-icon"
          style={{
            width: 80,
            height: 80,
            borderRadius: 20,
            fontSize: 32,
            background: `linear-gradient(135deg, ${typeColor}, ${typeColor}88)`,
            flexShrink: 0,
          }}
        >
          {TYPE_ICONS[app.type] || <AppstoreOutlined />}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <Title level={2} style={{ margin: 0, letterSpacing: '-0.02em' }}>
              {app.name}
            </Title>
            <span className="ios-category-badge">
              {app.type === 'ai-skill' ? 'AI Skill' : app.type}
            </span>
          </div>
          <Text type="secondary" style={{ fontSize: 15, display: 'block', marginBottom: 16 }}>
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

      {/* Details */}
      <GlassCard className="" style={{ padding: 24, marginBottom: 24 }}>
        <Title level={4} style={{ marginBottom: 16, letterSpacing: '-0.01em' }}>
          Details
        </Title>
        <Descriptions column={1} size="small" colon={false}>
          <Descriptions.Item label={<><TagOutlined style={{ marginRight: 6 }} />Type</>}>
            <Tag>{app.type}</Tag>
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
