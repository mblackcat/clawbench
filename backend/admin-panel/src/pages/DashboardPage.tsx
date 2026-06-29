import React, { useEffect, useState } from 'react';
import { Typography, Spin } from 'antd';
import {
  UserOutlined,
  AppstoreOutlined,
  DownloadOutlined,
  CloudUploadOutlined,
  ThunderboltOutlined,
  MessageOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { useApi } from '../hooks/useApi';
import StatCard from '../components/StatCard';
import GlassCard from '../components/GlassCard';
import type { DashboardStats } from '../types';

const { Title, Text } = Typography;

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

const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { fetchApi } = useApi();

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      const res = await fetchApi<{ success: boolean; data: DashboardStats }>('/api/v1/admin/stats');
      setStats(res.data);
    } catch {
      // Will show error state
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="ios-page-enter" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="ios-page-enter">
      <Title level={3} style={{ marginBottom: 24, letterSpacing: '-0.02em' }}>
        Dashboard
      </Title>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        <StatCard value={stats?.totalUsers ?? 0} label="Total Users" icon={<UserOutlined />} />
        <StatCard value={stats?.totalApplications ?? 0} label="Total Apps" icon={<AppstoreOutlined />} />
        <StatCard value={stats?.publishedApplications ?? 0} label="Published" icon={<CloudUploadOutlined />} />
        <StatCard value={stats?.totalDownloads ?? 0} label="Downloads" icon={<DownloadOutlined />} />
      </div>

      {/* App Distribution by Type */}
      {stats?.applicationByType && Object.keys(stats.applicationByType).length > 0 && (
        <GlassCard className="" style={{ padding: 24, marginBottom: 24 }}>
          <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 16 }}>
            Applications by Type
          </Text>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {Object.entries(stats.applicationByType).map(([type, count]) => (
              <div
                key={type}
                style={{
                  padding: '16px 24px',
                  borderRadius: 16,
                  background: 'var(--glass-surface-bg)',
                  border: '1px solid var(--glass-surface-border)',
                  textAlign: 'center',
                  minWidth: 140,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Type color accent at top */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: '20%',
                    right: '20%',
                    height: 2,
                    borderRadius: '0 0 2px 2px',
                    background: TYPE_COLORS[type] || 'var(--ios-accent)',
                    opacity: 0.6,
                  }}
                />
                <div style={{ fontSize: 22, marginBottom: 8, color: TYPE_COLORS[type] || 'var(--ios-accent)', opacity: 0.8 }}>
                  {TYPE_ICONS[type] || <CodeOutlined />}
                </div>
                <Text strong style={{ fontSize: 28, display: 'block', marginBottom: 2, letterSpacing: '-0.02em' }}>
                  {count}
                </Text>
                <Text type="secondary" style={{ textTransform: 'capitalize', fontSize: 12, letterSpacing: '0.03em' }}>
                  {type === 'ai-skill' ? 'AI Skill' : type}
                </Text>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Quick Actions */}
      <GlassCard className="" style={{ padding: 24 }}>
        <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>
          Quick Actions
        </Text>
        <Text type="secondary" style={{ lineHeight: 1.6 }}>
          Use the sidebar to manage users and browse the app store. All changes are reflected in real time across the platform.
        </Text>
      </GlassCard>
    </div>
  );
};

export default DashboardPage;
