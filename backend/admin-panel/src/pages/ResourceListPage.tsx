import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Table, Tag, Spin, Button, Space, Tooltip } from 'antd';
import {
  DownloadOutlined,
  PlayCircleOutlined,
  StarFilled,
  ReloadOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useApi } from '../hooks/useApi';
import SearchBar from '../components/SearchBar';
import ResourceCover from '../components/ResourceCover';
import TypeBadge from '../components/TypeBadge';
import type { ApplicationResponse, ApplicationType } from '../types';
import { TYPE_LABELS } from '../types';
import { formatDate, formatNumber } from '../utils/cover';

const TYPE_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'app', label: 'Apps' },
  { key: 'ai-skill', label: 'AI Skills' },
  { key: 'prompt', label: 'Prompts' },
  { key: 'link', label: 'Links' },
];

interface ResourceListPageProps {
  /** Lock the list to a single resource type and hide the type filter pills. */
  fixedType?: ApplicationType;
  /** Hide the page header (title + refresh) — for embedding inside another page's tabs. */
  hidePageHeader?: boolean;
}

const ResourceListPage: React.FC<ResourceListPageProps> = ({ fixedType, hidePageHeader }) => {
  const [apps, setApps] = useState<ApplicationResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const initialType = fixedType || searchParams.get('type') || 'all';
  const [activeType, setActiveType] = useState(initialType);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const { fetchApi } = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  useEffect(() => {
    if (fixedType) return; // locked to a single type
    const t = searchParams.get('type');
    if (t && t !== activeType) setActiveType(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadApps = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (activeType !== 'all') params.set('type', activeType);
      params.set('limit', String(isAdmin ? pageSize : 50));
      if (isAdmin) params.set('offset', String((page - 1) * pageSize));

      const endpoint = isAdmin
        ? `/api/v1/admin/applications?${params.toString()}`
        : `/api/v1/applications?${params.toString()}`;

      const res = await fetchApi<{
        success: boolean;
        data: { applications: ApplicationResponse[]; total: number };
      }>(endpoint);
      setApps(res.data.applications);
      setTotal(res.data.total);
    } catch {
      setApps([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, activeType, fetchApi, isAdmin, page, pageSize]);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  const setType = (key: string) => {
    setActiveType(key);
    setPage(1);
    if (isAdmin) {
      if (key === 'all') {
        searchParams.delete('type');
        setSearchParams(searchParams, { replace: true });
      } else {
        setSearchParams({ type: key }, { replace: true });
      }
    }
  };

  const goDetail = (app: ApplicationResponse) => {
    let prefix: string;
    if (!isAdmin) prefix = '/store/app';
    else if (fixedType === 'app') prefix = '/admin/apps';
    else prefix = '/admin/resources';
    navigate(`${prefix}/${app.applicationId}`);
  };

  const columns: ColumnsType<ApplicationResponse> = useMemo(
    () => [
      {
        title: 'Resource',
        key: 'name',
        ellipsis: true,
        render: (_: unknown, record) => (
          <div className="resource-name-cell">
            <ResourceCover app={record} />
            <div style={{ minWidth: 0 }}>
              <div className="name">
                {record.name}
                {record.featured && (
                  <span className="featured-pill" style={{ marginLeft: 8 }}>
                    <StarFilled style={{ fontSize: 10 }} /> Featured
                  </span>
                )}
              </div>
              <div className="desc">{record.description || 'No description'}</div>
            </div>
          </div>
        ),
      },
      {
        title: 'Type',
        dataIndex: 'type',
        key: 'type',
        width: 110,
        render: (type: ApplicationType) => <TypeBadge type={type} />,
      },
      {
        title: 'Version',
        dataIndex: 'version',
        key: 'version',
        width: 90,
        render: (v?: string) =>
          v ? (
            <span className="mono" style={{ fontSize: 12.5, color: 'var(--accent)' }}>
              v{v}
            </span>
          ) : (
            <span className="muted">—</span>
          ),
      },
      {
        title: 'Downloads',
        dataIndex: 'downloadCount',
        key: 'downloadCount',
        width: 100,
        align: 'right',
        render: (n: number) => (
          <Tooltip title="Downloads">
            <span>
              <DownloadOutlined style={{ marginRight: 4, opacity: 0.45, fontSize: 12 }} />
              {formatNumber(n)}
            </span>
          </Tooltip>
        ),
      },
      {
        title: 'Executions',
        dataIndex: 'executionCount',
        key: 'executionCount',
        width: 100,
        align: 'right',
        render: (n: number) => (
          <Tooltip title="Execution count">
            <span>
              <PlayCircleOutlined style={{ marginRight: 4, opacity: 0.45, fontSize: 12 }} />
              {formatNumber(n)}
            </span>
          </Tooltip>
        ),
      },
      {
        title: 'Status',
        dataIndex: 'published',
        key: 'published',
        width: 110,
        render: (published: boolean) => (
          <span>
            <span className={`status-dot ${published ? 'status-dot--on' : 'status-dot--off'}`} />
            {published ? 'Published' : 'Draft'}
          </span>
        ),
      },
      {
        title: 'Updated',
        dataIndex: 'updatedAt',
        key: 'updatedAt',
        width: 120,
        render: (ts: number) => <span className="muted">{formatDate(ts)}</span>,
      },
    ],
    []
  );

  // ── Public store catalog view ──────────────────────────
  if (!isAdmin) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Marketplace</h1>
            <p className="page-desc">
              Discover apps, AI skills, prompts, and links for ClawBench.
            </p>
          </div>
        </div>

        <div className="page-toolbar">
          <SearchBar
            value={search}
            onChange={(v) => setSearch(v)}
            placeholder="Search resources…"
          />
          <div className="type-pills">
            {TYPE_FILTERS.map((cat) => (
              <div
                key={cat.key}
                className={`type-pill ${activeType === cat.key ? 'active' : ''}`}
                onClick={() => setType(cat.key)}
              >
                {cat.label}
              </div>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
            <Spin size="large" />
          </div>
        ) : apps.length === 0 ? (
          <div className="empty-state panel">
            <AppstoreOutlined style={{ fontSize: 32 }} />
            <h3>No resources found</h3>
            <p>Try adjusting your search or filter.</p>
          </div>
        ) : (
          <div className="catalog-grid">
            {apps.map((app) => (
              <div
                key={app.applicationId}
                className="catalog-card"
                onClick={() => goDetail(app)}
              >
                <div className="catalog-card-cover">
                  <ResourceCover app={app} size="lg" />
                  <div style={{ position: 'absolute', top: 10, right: 10 }}>
                    <TypeBadge type={app.type} />
                  </div>
                  {app.featured && (
                    <div style={{ position: 'absolute', top: 10, left: 10 }}>
                      <span className="featured-pill">
                        <StarFilled style={{ fontSize: 10 }} /> Featured
                      </span>
                    </div>
                  )}
                </div>
                <div className="catalog-card-body">
                  <h3 className="catalog-card-title">{app.name}</h3>
                  <p className="catalog-card-desc">
                    {app.description || 'No description'}
                  </p>
                  <div className="catalog-card-meta">
                    <span>
                      <DownloadOutlined style={{ marginRight: 4 }} />
                      {formatNumber(app.downloadCount)}
                      {app.version && (
                        <span className="mono" style={{ marginLeft: 10 }}>
                          v{app.version}
                        </span>
                      )}
                    </span>
                    {app.category && <Tag style={{ margin: 0 }}>{app.category}</Tag>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Admin table view ───────────────────────────────────
  const adminTitle = fixedType ? `${TYPE_LABELS[fixedType] || fixedType}s` : 'Resources';
  return (
    <div>
      {!hidePageHeader && (
        <div className="page-header">
          <div>
            <h1>{adminTitle}</h1>
            <p className="page-desc">
              Manage marketplace resources — apps, AI skills, prompts, and links.
            </p>
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadApps}>
              Refresh
            </Button>
          </Space>
        </div>
      )}

      <div className="page-toolbar">
        <SearchBar
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search by name or description…"
        />
        {!fixedType && (
          <div className="type-pills">
            {TYPE_FILTERS.map((cat) => (
              <div
                key={cat.key}
                className={`type-pill ${activeType === cat.key ? 'active' : ''}`}
                onClick={() => setType(cat.key)}
              >
                {cat.label}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel console-table" style={{ overflow: 'hidden' }}>
        <Table
          columns={columns}
          dataSource={apps}
          rowKey="applicationId"
          loading={loading}
          onRow={(record) => ({
            onClick: () => goDetail(record),
          })}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: setPage,
            showTotal: (t) => `${t} resource${t === 1 ? '' : 's'}`,
            showSizeChanger: false,
          }}
          locale={{
            emptyText: (
              <div className="empty-state" style={{ padding: 40 }}>
                <AppstoreOutlined style={{ fontSize: 28 }} />
                <h3>No resources found</h3>
                <p>
                  {activeType !== 'all'
                    ? `No ${TYPE_LABELS[activeType] || activeType} resources match.`
                    : 'Try adjusting your search or filter.'}
                </p>
              </div>
            ),
          }}
        />
      </div>
    </div>
  );
};

export default ResourceListPage;
