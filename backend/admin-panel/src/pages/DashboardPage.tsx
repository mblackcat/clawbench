import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spin, Button } from 'antd';
import {
  UserOutlined,
  AppstoreOutlined,
  DownloadOutlined,
  CloudUploadOutlined,
  ThunderboltOutlined,
  MessageOutlined,
  LinkOutlined,
  CodeOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useApi } from '../hooks/useApi';
import StatCard from '../components/StatCard';
import type { DashboardStats } from '../types';
import { TYPE_LABELS } from '../types';
import { formatNumber } from '../utils/cover';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  app: <AppstoreOutlined />,
  'ai-skill': <ThunderboltOutlined />,
  prompt: <MessageOutlined />,
  link: <LinkOutlined />,
};

const TYPE_COLORS: Record<string, string> = {
  app: 'var(--type-app)',
  'ai-skill': 'var(--type-skill)',
  prompt: 'var(--type-prompt)',
  link: 'var(--type-link)',
};

const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { fetchApi } = useApi();
  const navigate = useNavigate();

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      const res = await fetchApi<{ success: boolean; data: DashboardStats }>(
        '/api/v1/admin/stats'
      );
      setStats(res.data);
    } catch {
      // empty
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  const byType = stats?.applicationByType || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-desc">Platform overview — users, resources, and marketplace activity.</p>
        </div>
        <Button type="primary" onClick={() => navigate('/admin/resources')}>
          Manage resources <ArrowRightOutlined />
        </Button>
      </div>

      <div className="stat-grid">
        <StatCard
          value={formatNumber(stats?.totalUsers ?? 0)}
          label="Users"
          icon={<UserOutlined />}
        />
        <StatCard
          value={formatNumber(stats?.totalApplications ?? 0)}
          label="Resources"
          icon={<AppstoreOutlined />}
        />
        <StatCard
          value={formatNumber(stats?.publishedApplications ?? 0)}
          label="Published"
          icon={<CloudUploadOutlined />}
        />
        <StatCard
          value={formatNumber(stats?.totalDownloads ?? 0)}
          label="Downloads"
          icon={<DownloadOutlined />}
        />
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-body">
          <h2 className="panel-title">Resources by type</h2>
          {Object.keys(byType).length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              No resources yet.
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Object.entries(byType).map(([type, count]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => navigate(`/admin/resources?type=${encodeURIComponent(type)}`)}
                  style={{
                    minWidth: 132,
                    padding: '14px 18px',
                    borderRadius: 10,
                    background: 'var(--bg-muted)',
                    border: '1px solid var(--border)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  <div
                    style={{
                      fontSize: 18,
                      color: TYPE_COLORS[type] || 'var(--accent)',
                      marginBottom: 8,
                    }}
                  >
                    {TYPE_ICONS[type] || <CodeOutlined />}
                  </div>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 650,
                      letterSpacing: '-0.02em',
                      color: 'var(--text)',
                    }}
                  >
                    {count}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-tertiary)',
                      marginTop: 2,
                    }}
                  >
                    {TYPE_LABELS[type] || type}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-body">
          <h2 className="panel-title">Quick actions</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button onClick={() => navigate('/admin/resources')}>Browse all resources</Button>
            <Button onClick={() => navigate('/admin/resources?type=link')}>View links</Button>
            <Button onClick={() => navigate('/admin/users')}>Manage users</Button>
            <Button onClick={() => window.open('/store', '_blank')}>Open public marketplace</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
