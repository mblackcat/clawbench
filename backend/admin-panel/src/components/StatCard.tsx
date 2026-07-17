import React from 'react';

interface Props {
  value: string | number;
  label: string;
  icon?: React.ReactNode;
}

const StatCard: React.FC<Props> = ({ value, label, icon }) => {
  return (
    <div className="stat-card">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">{value}</div>
    </div>
  );
};

export default StatCard;
