import React, { useState } from 'react';
import {
  AppstoreOutlined,
  ThunderboltOutlined,
  MessageOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import type { ApplicationResponse, ApplicationType } from '../types';
import { resolveCoverUrl, typeColor } from '../utils/cover';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  app: <AppstoreOutlined />,
  'ai-skill': <ThunderboltOutlined />,
  prompt: <MessageOutlined />,
  link: <LinkOutlined />,
};

interface Props {
  app: Pick<ApplicationResponse, 'type' | 'metadata' | 'name'>;
  size?: 'sm' | 'lg' | 'xl';
  className?: string;
}

const ResourceCover: React.FC<Props> = ({ app, size = 'sm', className = '' }) => {
  const [imgError, setImgError] = useState(false);
  const coverUrl = resolveCoverUrl(app);
  const sizeClass = size === 'xl' ? 'resource-cover--xl' : size === 'lg' ? 'resource-cover--lg' : '';
  const color = typeColor(app.type as ApplicationType);

  if (coverUrl && !imgError) {
    return (
      <div className={`resource-cover ${sizeClass} ${className}`.trim()} title={app.name}>
        <img src={coverUrl} alt="" onError={() => setImgError(true)} />
      </div>
    );
  }

  return (
    <div
      className={`resource-cover ${sizeClass} ${className}`.trim()}
      title={app.name}
      style={{
        background: `linear-gradient(135deg, ${color}, ${color}99)`,
        border: 'none',
      }}
    >
      {TYPE_ICONS[app.type] || <AppstoreOutlined />}
    </div>
  );
};

export default ResourceCover;
