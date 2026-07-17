import React from 'react';
import { TYPE_LABELS, type ApplicationType } from '../types';

interface Props {
  type: ApplicationType | string;
}

const TypeBadge: React.FC<Props> = ({ type }) => {
  const cls =
    type === 'app' || type === 'ai-skill' || type === 'prompt' || type === 'link'
      ? `type-badge type-badge--${type}`
      : 'type-badge type-badge--app';
  return <span className={cls}>{TYPE_LABELS[type] || type}</span>;
};

export default TypeBadge;
