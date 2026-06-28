import React from 'react';
import { SearchOutlined } from '@ant-design/icons';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const SearchBar: React.FC<Props> = ({ value, onChange, placeholder = 'Search...' }) => {
  return (
    <div className="ios-search-bar" style={{ position: 'relative' }}>
      <SearchOutlined
        style={{
          position: 'absolute',
          left: 16,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 18,
          color: 'var(--text-tertiary)',
          zIndex: 1,
        }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
};

export default SearchBar;
