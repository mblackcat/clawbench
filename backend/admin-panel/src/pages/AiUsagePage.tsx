import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, DatePicker, Segmented, Select, Table, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { useApi } from '../hooks/useApi';
import { formatDate } from '../utils/cover';

/** 用量审计：只有元数据，不含 prompt / 内容 */
interface SummaryRow {
  userId: string;
  username: string | null;
  calls: number;
  errors: number;
  systemCalls: number;
  personalCalls: number;
  outputCount: number;
  inputTokens: number;
  outputTokens: number;
  lastUsedAt: number;
}

interface UsageLog {
  logId: string;
  userId: string;
  username: string | null;
  source: 'system' | 'personal';
  modelName: string;
  kind: 'chat' | 'image';
  scene: string;
  status: 'success' | 'error';
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  outputCount: number | null;
  errorCode: string | null;
  createdAt: number;
}

const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString());

const AiUsagePage: React.FC = () => {
  const [view, setView] = useState<'summary' | 'logs'>('summary');
  const [source, setSource] = useState<string | undefined>();
  const [kind, setKind] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [userId, setUserId] = useState<string | undefined>();
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 20;
  const { fetchApi } = useApi();
  const { message } = App.useApp();

  const filterQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (source) params.set('source', source);
    if (kind) params.set('kind', kind);
    if (range?.[0]) params.set('from', String(range[0].startOf('day').valueOf()));
    if (range?.[1]) params.set('to', String(range[1].endOf('day').valueOf() + 1));
    return params;
  }, [source, kind, range]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'summary') {
        const res = await fetchApi<{ success: boolean; data: { rows: SummaryRow[] } }>(
          `/api/v1/admin/ai-usage/summary?${filterQuery.toString()}`
        );
        setSummary(res.data.rows);
      } else {
        const params = new URLSearchParams(filterQuery);
        if (userId) params.set('userId', userId);
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));
        const res = await fetchApi<{ success: boolean; data: { items: UsageLog[]; total: number } }>(
          `/api/v1/admin/ai-usage?${params.toString()}`
        );
        setLogs(res.data.items);
        setTotal(res.data.total);
      }
    } catch (err: any) {
      message.error(err.message || 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  }, [view, filterQuery, userId, page, fetchApi, message]);

  useEffect(() => {
    load();
  }, [load]);

  const summaryColumns: ColumnsType<SummaryRow> = [
    {
      title: 'User',
      dataIndex: 'username',
      key: 'username',
      render: (name: string | null, r) => (
        <Button
          type="link"
          style={{ padding: 0 }}
          onClick={() => {
            setUserId(r.userId);
            setPage(1);
            setView('logs');
          }}
        >
          {name || r.userId.slice(0, 8)}
        </Button>
      ),
    },
    { title: 'Calls', dataIndex: 'calls', key: 'calls', width: 90, render: fmtNum },
    { title: 'System', dataIndex: 'systemCalls', key: 'systemCalls', width: 90, render: fmtNum },
    { title: 'Personal', dataIndex: 'personalCalls', key: 'personalCalls', width: 90, render: fmtNum },
    {
      title: 'Errors',
      dataIndex: 'errors',
      key: 'errors',
      width: 80,
      render: (n: number) => (n ? <Tag color="red">{n}</Tag> : <span className="muted">0</span>),
    },
    { title: 'Outputs', dataIndex: 'outputCount', key: 'outputCount', width: 90, render: fmtNum },
    { title: 'Input tokens', dataIndex: 'inputTokens', key: 'inputTokens', width: 120, render: fmtNum },
    { title: 'Output tokens', dataIndex: 'outputTokens', key: 'outputTokens', width: 120, render: fmtNum },
    {
      title: 'Last used',
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      width: 140,
      render: (ts: number) => <span className="muted">{formatDate(ts)}</span>,
    },
  ];

  const logColumns: ColumnsType<UsageLog> = [
    {
      title: 'Time',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (ts: number) => <span className="muted">{new Date(ts).toLocaleString()}</span>,
    },
    { title: 'User', dataIndex: 'username', key: 'username', width: 120, render: (n: string | null, r) => n || r.userId.slice(0, 8) },
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      width: 90,
      render: (s: string) => <Tag color={s === 'system' ? 'blue' : 'default'}>{s}</Tag>,
    },
    { title: 'Kind', dataIndex: 'kind', key: 'kind', width: 70 },
    { title: 'Model', dataIndex: 'modelName', key: 'modelName', ellipsis: true, render: (t: string) => <code>{t}</code> },
    { title: 'Scene', dataIndex: 'scene', key: 'scene', width: 120 },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (s: string, r) =>
        s === 'success' ? <Tag color="green">ok</Tag> : <Tag color="red">{r.errorCode || 'error'}</Tag>,
    },
    {
      title: 'Duration',
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 90,
      render: (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`),
    },
    {
      title: 'Tokens in/out',
      key: 'tokens',
      width: 120,
      render: (_: unknown, r) => `${fmtNum(r.inputTokens)} / ${fmtNum(r.outputTokens)}`,
    },
    { title: 'Outputs', dataIndex: 'outputCount', key: 'outputCount', width: 80, render: fmtNum },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>AI Usage</h1>
          <p className="page-desc">Per-user model usage and audit log. Metadata only — prompts and content are never stored here.</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={load}>
          Refresh
        </Button>
      </div>

      <div className="page-toolbar" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Segmented
          value={view}
          onChange={(v) => {
            setView(v as 'summary' | 'logs');
            setPage(1);
          }}
          options={[
            { value: 'summary', label: 'By user' },
            { value: 'logs', label: 'Audit log' },
          ]}
        />
        <Select
          allowClear
          placeholder="Source"
          style={{ width: 130 }}
          value={source}
          onChange={(v) => {
            setSource(v);
            setPage(1);
          }}
          options={[
            { value: 'system', label: 'System' },
            { value: 'personal', label: 'Personal' },
          ]}
        />
        <Select
          allowClear
          placeholder="Kind"
          style={{ width: 120 }}
          value={kind}
          onChange={(v) => {
            setKind(v);
            setPage(1);
          }}
          options={[
            { value: 'chat', label: 'Chat' },
            { value: 'image', label: 'Image' },
          ]}
        />
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => {
            setRange(v as [Dayjs | null, Dayjs | null] | null);
            setPage(1);
          }}
        />
        {view === 'logs' && userId && (
          <Tag
            closable
            onClose={() => {
              setUserId(undefined);
              setPage(1);
            }}
          >
            User: {logs[0]?.username || summary.find((s) => s.userId === userId)?.username || userId.slice(0, 8)}
          </Tag>
        )}
      </div>

      <div className="panel console-table" style={{ overflow: 'hidden' }}>
        {view === 'summary' ? (
          <Table columns={summaryColumns} dataSource={summary} rowKey="userId" loading={loading} pagination={false} />
        ) : (
          <Table
            columns={logColumns}
            dataSource={logs}
            rowKey="logId"
            loading={loading}
            pagination={{
              current: page,
              pageSize,
              total,
              onChange: setPage,
              showTotal: (t) => `${t} calls`,
              showSizeChanger: false,
            }}
          />
        )}
      </div>
    </div>
  );
};

export default AiUsagePage;
