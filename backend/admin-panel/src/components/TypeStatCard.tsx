import React from 'react';
import {
  AppstoreOutlined,
  ThunderboltOutlined,
  MessageOutlined,
  LinkOutlined,
  DownloadOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import type { ApplicationType } from '../types';
import { formatNumber } from '../utils/cover';

/** Per-type icon — mirrors the map in ResourceCover / DashboardPage. */
const TYPE_ICONS: Record<string, React.ReactNode> = {
  app: <AppstoreOutlined />,
  'ai-skill': <ThunderboltOutlined />,
  prompt: <MessageOutlined />,
  link: <LinkOutlined />,
};

interface Props {
  type: ApplicationType;
  label: string;
  /** Number of resources of this type */
  count: number;
  /** Total downloads for this type */
  downloads: number;
  /** Total runs (executions) for this type */
  runs: number;
}

/**
 * Triple-metric stat card for one resource type: count | downloads | runs.
 * Used on the dashboard for app / ai-skill / prompt / link.
 */
const TypeStatCard: React.FC<Props> = ({ type, label, count, downloads, runs }) => {
  const metrics = [
    { icon: TYPE_ICONS[type] ?? <AppstoreOutlined />, value: count, caption: 'Count' },
    { icon: <DownloadOutlined />, value: downloads, caption: 'Downloads' },
    { icon: <PlayCircleOutlined />, value: runs, caption: 'Runs' },
  ];

  return (
    <div className={`stat-card type-stat-card type-stat-card--${type}`}>
      <div className="type-stat-head">
        <span className="type-stat-head-icon">{TYPE_ICONS[type] ?? <AppstoreOutlined />}</span>
        <span className="type-stat-head-label">{label}</span>
      </div>
      <div className="type-stat-metrics">
        {metrics.map((m) => (
          <div className="type-stat-cell" key={m.caption}>
            <span className="type-stat-cell-icon">{m.icon}</span>
            <span className="type-stat-cell-value">{formatNumber(m.value)}</span>
            <span className="type-stat-cell-caption">{m.caption}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TypeStatCard;
