import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Typography, Spin, Tag, Empty } from 'antd';
import {
  AppstoreOutlined,
  CodeOutlined,
  ThunderboltOutlined,
  MessageOutlined,
  DownloadOutlined,
  StarFilled,
} from '@ant-design/icons';
import { useApi } from '../hooks/useApi';
import SearchBar from '../components/SearchBar';
import GlassCard from '../components/GlassCard';
import InstallButton from '../components/InstallButton';
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

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'app', label: 'Apps' },
  { key: 'ai-skill', label: 'AI Skills' },
  { key: 'prompt', label: 'Prompts' },
];

const AppStorePage: React.FC = () => {
  const [apps, setApps] = useState<ApplicationResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState('all');
  const [stats, setStats] = useState({ total: 0, totalDownloads: 0 });
  const { fetchApi } = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  const loadApps = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (activeType !== 'all') params.set('type', activeType);
      params.set('limit', '50');

      // Admin uses the admin endpoint, store uses the public endpoint
      const endpoint = isAdmin
        ? `/api/v1/admin/applications?${params.toString()}`
        : `/api/v1/applications?${params.toString()}`;

      const res = await fetchApi<{ success: boolean; data: { applications: ApplicationResponse[]; total: number } }>(endpoint);
      setApps(res.data.applications);
      setStats({
        total: res.data.total,
        totalDownloads: res.data.applications.reduce((sum, a) => sum + (a.downloadCount || 0), 0),
      });
    } catch {
      // Show empty state
      setApps([]);
    } finally {
      setLoading(false);
    }
  }, [search, activeType, fetchApi, isAdmin]);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  const handleCardClick = (app: ApplicationResponse) => {
    const prefix = isAdmin ? '/admin/store' : '/store/app';
    navigate(`${prefix}/${app.applicationId}`);
  };

  return (
    <div className="ios-page-enter">
      {/* Hero Section */}
      <div className="ios-hero" style={{ marginBottom: 32 }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <Title level={1} style={{ color: '#FFFFFF', marginBottom: 8, letterSpacing: '-0.03em', fontSize: 40 }}>
            ClawBench App Store
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16 }}>
            Discover apps, AI skills, and prompts for your workflow
          </Text>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 24, position: 'relative', zIndex: 1 }}>
          <div className="ios-hero-stat">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <AppstoreOutlined style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }} />
              <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {stats.total}
              </Text>
            </div>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, letterSpacing: '0.02em' }}>Available</Text>
          </div>
          <div className="ios-hero-stat">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <DownloadOutlined style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }} />
              <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {stats.totalDownloads.toLocaleString()}
              </Text>
            </div>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, letterSpacing: '0.02em' }}>Downloads</Text>
          </div>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20, maxWidth: 500 }}>
        <SearchBar
          value={search}
          onChange={(v) => setSearch(v)}
          placeholder="Search apps, skills, and prompts..."
        />
      </div>

      {/* Category Filters */}
      <div className="ios-filter-pills" style={{ marginBottom: 24 }}>
        {CATEGORIES.map((cat) => (
          <div
            key={cat.key}
            className={`ios-filter-pill ${activeType === cat.key ? 'ios-filter-pill--active' : ''}`}
            onClick={() => setActiveType(cat.key)}
          >
            {cat.label}
          </div>
        ))}
      </div>

      {/* App Grid */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <Spin size="large" />
        </div>
      ) : apps.length === 0 ? (
        <div className="ios-empty-state" style={{ animation: 'pageSlideUp 0.4s var(--transition-spring) both' }}>
          <div className="ios-empty-state-icon">
            <AppstoreOutlined />
          </div>
          <h3>No apps found</h3>
          <p>Try adjusting your search or filter to find what you're looking for.</p>
        </div>
      ) : (
        <div className="ios-card-grid">
          {apps.map((app) => (
            <GlassCard key={app.applicationId} onClick={() => handleCardClick(app)}>
              {/* Card header — gradient banner with app icon */}
              <div style={{
                height: 130,
                background: `linear-gradient(135deg, ${TYPE_COLORS[app.type] || '#007AFF'}22 0%, ${TYPE_COLORS[app.type] || '#007AFF'}0A 50%, transparent 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}>
                {/* Subtle radial glow behind icon */}
                <div style={{
                  position: 'absolute',
                  width: 100,
                  height: 100,
                  borderRadius: '50%',
                  background: `radial-gradient(circle, ${TYPE_COLORS[app.type] || '#007AFF'}18, transparent 70%)`,
                }} />
                <div
                  className="ios-app-icon"
                  style={{
                    background: `linear-gradient(135deg, ${TYPE_COLORS[app.type] || '#007AFF'}, ${TYPE_COLORS[app.type] || '#007AFF'}99)`,
                    boxShadow: `0 4px 16px ${TYPE_COLORS[app.type] || '#007AFF'}40`,
                    position: 'relative',
                    zIndex: 1,
                  }}
                >
                  {TYPE_ICONS[app.type] || <CodeOutlined />}
                </div>
                <span
                  className="ios-category-badge"
                  style={{ position: 'absolute', top: 12, right: 12 }}
                >
                  {app.type === 'ai-skill' ? 'AI Skill' : app.type}
                </span>
                {app.featured && (
                  <span
                    title="Featured"
                    style={{
                      position: 'absolute',
                      top: 12,
                      left: 12,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: 'linear-gradient(135deg, #FF9500, #FF2D55)',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 600,
                      boxShadow: '0 2px 8px rgba(255,149,0,0.35)',
                    }}
                  >
                    <StarFilled style={{ fontSize: 10 }} /> Featured
                  </span>
                )}
              </div>

              {/* Card body */}
              <div className="ios-card-body">
                <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 4, letterSpacing: '-0.01em' }}>
                  {app.name}
                </Text>
                <Paragraph
                  type="secondary"
                  ellipsis={{ rows: 2 }}
                  style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.4 }}
                >
                  {app.description || 'No description'}
                </Paragraph>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <DownloadOutlined style={{ fontSize: 12, color: 'var(--text-tertiary)' }} />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {app.downloadCount || 0}
                    </Text>
                  </div>
                  {app.category && (
                    <Tag style={{ margin: 0, borderRadius: 6, fontSize: 11 }}>
                      {app.category}
                    </Tag>
                  )}
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
};

export default AppStorePage;
