import React from 'react';
import { Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

const SearchBar: React.FC<Props> = ({
  value,
  onChange,
  placeholder = 'Search...',
  style,
}) => {
  return (
    <Input
      allowClear
      prefix={<SearchOutlined style={{ color: 'var(--text-tertiary)' }} />}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ maxWidth: 320, ...style }}
    />
  );
};

export default SearchBar;
