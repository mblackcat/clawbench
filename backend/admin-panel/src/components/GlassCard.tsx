import React from 'react';

interface Props {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
  hoverable?: boolean;
}

const GlassCard: React.FC<Props> = ({ children, className = '', onClick, style, hoverable = true }) => {
  return (
    <div
      className={`ios-glass-surface ${hoverable ? 'ios-app-card' : ''} ${className}`}
      onClick={onClick}
      style={{ ...style, cursor: onClick ? 'pointer' : undefined }}
    >
      {children}
    </div>
  );
};

export default GlassCard;
