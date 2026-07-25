import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Tabs, Table, Tag, Tooltip, Button } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useApi } from '../hooks/useApi';
import type {
  CommonApp,
  CommonAppEvent,
  CommonAppExecutionError,
  CommonAppVersionHistory,
  CommonAppEventType,
} from '../types';
import { formatDateTime } from '../utils/cover';

interface AppStatsModalProps {
  app: CommonApp | null;
  onClose: () => void;
}

const PAGE_SIZE = 10;

interface EventsResponse {
  success: boolean;
  data: { appKey: string; type: string; items: any[]; total: number; limit: number; offset: number };
}

/**
 * Per-app statistics modal with four tabs (runs / downloads / errors / versions).
 * Each tab is an independently paginated list, newest-first. Failed runs surface
 * their error message via a warning tooltip for quick triage (the full error also
 * lives in the Errors tab).
 */
const AppStatsModal: React.FC<AppStatsModalProps> = ({ app, onClose }) => {
  const { fetchApi } = useApi();
  const [activeTab, setActiveTab] = useState<CommonAppEventType>('execution');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const loadPage = useCallback(
    async (type: CommonAppEventType, pageNum: number) => {
      if (!app) return;
      setLoading(true);
      try {
        const offset = (pageNum - 1) * PAGE_SIZE;
        const res = await fetchApi<EventsResponse>(
          `/api/v1/common-apps/${app.appKey}/events?type=${type}&limit=${PAGE_SIZE}&offset=${offset}`
        );
        setRows(res.data.items);
        setTotal(res.data.total);
      } catch {
        setRows([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [app, fetchApi]
  );

  useEffect(() => {
    if (app) {
      setActiveTab('execution');
      setPage(1);
    }
  }, [app]);

  useEffect(() => {
    if (app) loadPage(activeTab, page);
  }, [app, activeTab, page, loadPage]);

  const handleTabChange = (key: string) => {
    setActiveTab(key as CommonAppEventType);
    setPage(1);
  };

  const timeColumn = {
    title: 'Time',
    dataIndex: 'createdAt',
    key: 'createdAt',
    width: 180,
    render: (v: number) => formatDateTime(v),
  };

  const downloadColumns: ColumnsType<CommonAppEvent> = [
    timeColumn,
    { title: 'User', key: 'user', render: (_, r) => r.username || r.userId },
    {
      title: 'Version',
      dataIndex: 'version',
      key: 'version',
      width: 110,
      render: (v: string | null) => (v ? <Tag>{`v${v}`}</Tag> : '—'),
    },
    { title: 'Status', key: 'status', width: 110, render: () => <Tag color="green">Success</Tag> },
  ];

  const runColumns: ColumnsType<CommonAppEvent> = [
    timeColumn,
    { title: 'User', key: 'user', render: (_, r) => r.username || r.userId },
    {
      title: 'Version',
      dataIndex: 'version',
      key: 'version',
      width: 110,
      render: (v: string | null) => (v ? <Tag>{`v${v}`}</Tag> : '—'),
    },
    {
      title: 'Status',
      key: 'status',
      width: 140,
      render: (_, r) => {
        if (r.cancelled) {
          return <Tag color="default">Cancelled</Tag>;
        }
        if (r.success) {
          return <Tag color="green">Success</Tag>;
        }
        return (
          <Tooltip title={r.errorMessage || 'Run failed (no error message)'} styles={{ root: { maxWidth: 360 } }}>
            <Tag color="red" icon={<WarningOutlined />} style={{ cursor: 'help' }}>
              Failed
            </Tag>
          </Tooltip>
        );
      },
    },
  ];

  const errorColumns: ColumnsType<CommonAppExecutionError> = [
    timeColumn,
    { title: 'User', key: 'user', width: 140, render: (_, r) => r.username || r.userId },
    {
      title: 'Version',
      dataIndex: 'version',
      key: 'version',
      width: 90,
      render: (v: string | null) => (v ? <Tag>{`v${v}`}</Tag> : '—'),
    },
    {
      title: 'Error',
      dataIndex: 'message',
      key: 'message',
      render: (msg: string, r) =>
        r.details ? (
          <Tooltip
            title={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.details}</pre>}
            styles={{ root: { maxWidth: 480 } }}
          >
            <span style={{ cursor: 'help' }}>{msg}</span>
          </Tooltip>
        ) : (
          msg
        ),
    },
  ];

  const versionColumns: ColumnsType<CommonAppVersionHistory> = [
    timeColumn,
    {
      title: 'Version',
      dataIndex: 'version',
      key: 'version',
      width: 120,
      render: (v: string) => <Tag color="blue">{`v${v}`}</Tag>,
    },
    { title: 'Source', dataIndex: 'source', key: 'source', width: 110 },
    {
      title: 'Changed by',
      key: 'changedBy',
      render: (_, r) => r.changedByName || r.changedBy || '—',
    },
  ];

  const columnsByTab: Record<CommonAppEventType, ColumnsType<any>> = {
    download: downloadColumns,
    execution: runColumns,
    error: errorColumns,
    version: versionColumns,
  };

  const rowKeyByTab: Record<CommonAppEventType, string> = {
    download: 'eventId',
    execution: 'eventId',
    error: 'errorId',
    version: 'versionHistId',
  };

  const tabItems = [
    { key: 'execution', label: 'Runs' },
    { key: 'download', label: 'Downloads' },
    { key: 'error', label: 'Errors' },
    { key: 'version', label: 'Versions' },
  ];

  return (
    <Modal
      title={app ? `Stats — ${app.name}` : 'Stats'}
      open={!!app}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
      width={820}
      destroyOnClose
    >
      <Tabs activeKey={activeTab} onChange={handleTabChange} items={tabItems} />
      <Table
        size="small"
        loading={loading}
        columns={columnsByTab[activeTab]}
        dataSource={rows}
        rowKey={rowKeyByTab[activeTab]}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          onChange: setPage,
          showSizeChanger: false,
          showTotal: (t) => `${t} records`,
        }}
      />
    </Modal>
  );
};

export default AppStatsModal;
