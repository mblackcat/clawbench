import React, { useEffect, useState } from 'react';
import { Typography, Spin } from 'antd';
import {
  UserOutlined,
  AppstoreOutlined,
  DownloadOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons';
import { useApi } from '../hooks/useApi';
import StatCard from '../components/StatCard';
import GlassCard from '../components/GlassCard';
import type { DashboardStats } from '../types';

const { Title, Text } = Typography;

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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
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
                  padding: '12px 24px',
                  borderRadius: 12,
                  background: 'var(--glass-surface-bg)',
                  textAlign: 'center',
                  minWidth: 120,
                }}
              >
                <Text strong style={{ fontSize: 24, display: 'block', marginBottom: 4 }}>
                  {count}
                </Text>
                <Text type="secondary" style={{ textTransform: 'capitalize', fontSize: 13 }}>
                  {type === 'ai-skill' ? 'AI Skill' : type}
                </Text>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Quick Actions */}
      <GlassCard className="" style={{ padding: 24 }}>
        <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 16 }}>
          Quick Actions
        </Text>
        <Text type="secondary">
          Use the sidebar to manage users and browse the app store.
        </Text>
      </GlassCard>
    </div>
  );
};

export default DashboardPage;
