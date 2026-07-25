import React from 'react';
import { Tag } from 'antd';
import { DownloadOutlined, PlayCircleOutlined, StarFilled } from '@ant-design/icons';
import ResourceCover from './ResourceCover';
import type { ApplicationResponse } from '../types';
import { formatNumber } from '../utils/cover';

interface Props {
  app: ApplicationResponse;
  onClick: () => void;
}

/**
 * Marketplace resource card shared across the dashboard's Apps / AI Skill /
 * Prompt / Link tabs. Renders icon, name (+ featured star), published status,
 * description, downloads, and runs (usage). ResourceCover picks the right
 * type icon / cover automatically.
 */
const MarketplaceAppCard: React.FC<Props> = ({ app, onClick }) => {
  return (
    <div
      className="app-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="app-card-head">
        <ResourceCover app={app} />
        <div className="app-card-titles">
          <div className="app-card-title">
            {app.name}
            {app.featured && (
              <StarFilled style={{ color: 'var(--warning, #faad14)', marginLeft: 6 }} />
            )}
          </div>
          <Tag color={app.published ? 'green' : 'default'}>
            {app.published ? 'Published' : 'Draft'}
          </Tag>
        </div>
      </div>

      <div className="app-card-desc">{app.description || 'No description'}</div>

      <div className="app-card-metrics">
        <span>
          <DownloadOutlined /> {formatNumber(app.downloadCount ?? 0)}
        </span>
        <span>
          <PlayCircleOutlined /> {formatNumber(app.executionCount ?? 0)}
        </span>
      </div>
    </div>
  );
};

export default MarketplaceAppCard;
