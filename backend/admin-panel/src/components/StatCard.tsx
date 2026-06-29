import React from 'react';

interface Props {
  value: string | number;
  label: string;
  icon?: React.ReactNode;
}

const StatCard: React.FC<Props> = ({ value, label, icon }) => {
  return (
    <div className="ios-glass-surface ios-stat-card">
      {icon && <div style={{ fontSize: 24, opacity: 0.6, marginBottom: 4 }}>{icon}</div>}
      <div className="ios-stat-value">{value}</div>
      <div className="ios-stat-label">{label}</div>
    </div>
  );
};

export default StatCard;
