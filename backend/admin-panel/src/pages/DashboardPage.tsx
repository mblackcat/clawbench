import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spin, Select, Space, Tabs, Button } from 'antd';
import {
  UserOutlined,
  AppstoreOutlined,
  WarningOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useApi } from '../hooks/useApi';
import StatCard from '../components/StatCard';
import TypeStatCard from '../components/TypeStatCard';
import MarketplaceAppCard from '../components/MarketplaceAppCard';
import type { DashboardStats, ApplicationResponse, ApplicationType } from '../types';
import { formatNumber } from '../utils/cover';

/** The four marketplace resource types shown as stat cards + tabs. */
const TYPE_CARDS: { type: ApplicationType; label: string; tab: string }[] = [
  { type: 'app', label: 'Apps', tab: 'Marketplace Apps' },
  { type: 'ai-skill', label: 'AI Skills', tab: 'AI Skills' },
  { type: 'prompt', label: 'AI Prompts', tab: 'AI Prompts' },
  { type: 'link', label: 'Links', tab: 'Links' },
];

const TAB_TYPES = TYPE_CARDS.map((c) => c.type);

/** Professional groupings — mirrors the AppEditor category list. */
const CATEGORY_OPTIONS = [
  { label: 'Development', value: 'development' },
  { label: 'DevOps', value: 'devops' },
  { label: 'Data & Analytics', value: 'data' },
  { label: 'Automation', value: 'automation' },
  { label: 'Productivity', value: 'productivity' },
  { label: 'Utilities', value: 'utilities' },
  { label: 'Security', value: 'security' },
  { label: 'Testing', value: 'testing' },
  { label: 'Monitoring', value: 'monitoring' },
  { label: 'Communication', value: 'communication' },
  { label: 'Documentation', value: 'documentation' },
  { label: 'Design', value: 'design' },
  { label: 'AI & ML', value: 'ai-ml' },
  { label: 'Other', value: 'other' },
];

/**
 * Admin dashboard: headline metrics (users + per-type count/downloads/runs +
 * errors), followed by a tabbed marketplace card grid covering all four
 * resource types (app / ai-skill / prompt / link).
 */
const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Per-type marketplace listing cache (loaded lazily as tabs are opened).
  const [appsByType, setAppsByType] = useState<Record<string, ApplicationResponse[]>>({});
  const [loadingByType, setLoadingByType] = useState<Record<string, boolean>>({});
  const loadedRef = useRef<Set<string>>(new Set());

  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('downloads');

  const [searchParams, setSearchParams] = useSearchParams();
  const initial = searchParams.get('type');
  const initialTab =
    initial && (TAB_TYPES as string[]).includes(initial) ? initial : 'app';
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  const { fetchApi } = useApi();
  const navigate = useNavigate();

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetchApi<{ success: boolean; data: DashboardStats }>(
        '/api/v1/admin/stats'
      );
      setStats(res.data);
    } catch {
      // handled globally
    } finally {
      setStatsLoading(false);
    }
  }, [fetchApi]);

  const loadApps = useCallback(
    async (type: string) => {
      setLoadingByType((prev) => ({ ...prev, [type]: true }));
      try {
        const res = await fetchApi<{
          success: boolean;
          data: { applications: ApplicationResponse[]; total: number };
        }>(`/api/v1/admin/applications?type=${type}&limit=100&offset=0`);
        setAppsByType((prev) => ({ ...prev, [type]: res.data.applications }));
      } catch {
        setAppsByType((prev) => ({ ...prev, [type]: [] }));
      } finally {
        setLoadingByType((prev) => ({ ...prev, [type]: false }));
      }
    },
    [fetchApi]
  );

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Sync active tab with ?type= deep links.
  useEffect(() => {
    const t = searchParams.get('type');
    if (t && (TAB_TYPES as string[]).includes(t) && t !== activeTab) {
      setActiveTab(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Lazy-load each type once on first visit.
  useEffect(() => {
    if (loadedRef.current.has(activeTab)) return;
    loadedRef.current.add(activeTab);
    loadApps(activeTab);
  }, [activeTab, loadApps]);

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    setSearchParams({ type: key }, { replace: true });
  };

  // Client-side filter + sort, per type (shared filter state across tabs).
  const filteredByType = useMemo(() => {
    const out: Record<string, ApplicationResponse[]> = {};
    for (const c of TYPE_CARDS) {
      let list = (appsByType[c.type] || []).slice();
      if (categoryFilter !== 'all') {
        list = list.filter((a) => a.category === categoryFilter);
      }
      if (statusFilter === 'published') {
        list = list.filter((a) => a.published);
      } else if (statusFilter === 'draft') {
        list = list.filter((a) => !a.published);
      } else if (statusFilter === 'featured') {
        list = list.filter((a) => a.featured);
      }
      list.sort((a, b) =>
        sortBy === 'runs'
          ? (b.executionCount ?? 0) - (a.executionCount ?? 0)
          : (b.downloadCount ?? 0) - (a.downloadCount ?? 0)
      );
      out[c.type] = list;
    }
    return out;
  }, [appsByType, categoryFilter, statusFilter, sortBy]);

  const renderGrid = (type: string) => {
    const loading = !!loadingByType[type];
    const list = filteredByType[type] || [];
    const tabLabel =
      TYPE_CARDS.find((c) => c.type === type)?.tab.toLowerCase() || 'resources';

    if (loading && list.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      );
    }
    if (list.length === 0) {
      return (
        <div className="empty-state" style={{ padding: 40 }}>
          <AppstoreOutlined style={{ fontSize: 28 }} />
          <h3>No {tabLabel} match the current filters</h3>
        </div>
      );
    }
    return (
      <div className="app-card-grid" style={{ marginTop: 0 }}>
        {list.map((app) => (
          <MarketplaceAppCard
            key={app.applicationId}
            app={app}
            onClick={() => navigate(`/admin/resources/${app.applicationId}`)}
          />
        ))}
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-desc">
            Platform overview — users, per-type resources, and marketplace activity.
          </p>
        </div>
        <Button type="primary" onClick={() => navigate('/admin/apps')}>
          Manage apps <ArrowRightOutlined />
        </Button>
      </div>

      {statsLoading ? (
        <div className="panel" style={{ padding: 48, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : (
        <div className="stat-grid">
          <StatCard
            label="Users"
            value={formatNumber(stats?.totalUsers ?? 0)}
            icon={<UserOutlined />}
          />
          {TYPE_CARDS.map((c) => (
            <TypeStatCard
              key={c.type}
              type={c.type}
              label={c.label}
              count={stats?.applicationByType[c.type] ?? 0}
              downloads={stats?.downloadsByType[c.type] ?? 0}
              runs={stats?.executionsByType[c.type] ?? 0}
            />
          ))}
          <StatCard
            label="Errors"
            value={formatNumber(stats?.totalErrors ?? 0)}
            icon={<WarningOutlined />}
          />
        </div>
      )}

      <div className="panel" style={{ overflow: 'hidden', marginTop: 20 }}>
        <div
          className="panel-body"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <h2 className="panel-title" style={{ margin: 0 }}>
            Marketplace
          </h2>
          <Space size={12} wrap>
            <Select
              value={categoryFilter}
              onChange={setCategoryFilter}
              style={{ width: 180 }}
              options={[{ label: 'All groups', value: 'all' }, ...CATEGORY_OPTIONS]}
            />
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ width: 150 }}
              options={[
                { label: 'All statuses', value: 'all' },
                { label: 'Published', value: 'published' },
                { label: 'Draft', value: 'draft' },
                { label: 'Featured', value: 'featured' },
              ]}
            />
            <Select
              value={sortBy}
              onChange={setSortBy}
              style={{ width: 170 }}
              options={[
                { label: 'Sort: Downloads', value: 'downloads' },
                { label: 'Sort: Runs', value: 'runs' },
              ]}
            />
          </Space>
        </div>

        <div className="panel-body" style={{ paddingTop: 0 }}>
          <Tabs
            activeKey={activeTab}
            onChange={handleTabChange}
            items={TYPE_CARDS.map((c) => ({ key: c.type, label: c.tab }))}
            tabBarStyle={{ marginBottom: 16 }}
          />
          {renderGrid(activeTab)}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
