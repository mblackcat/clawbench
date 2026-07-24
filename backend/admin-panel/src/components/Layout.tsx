import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  AppstoreOutlined,
  ProjectOutlined,
  BlockOutlined,
  WalletOutlined,
  LogoutOutlined,
  HomeOutlined,
  SunOutlined,
  MoonOutlined,
} from '@ant-design/icons';
import { useApi } from '../hooks/useApi';
import { useTheme } from '../hooks/useTheme';

interface Props {
  admin: boolean;
  children: React.ReactNode;
}

const Layout: React.FC<Props> = ({ admin, children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, getMe } = useApi();
  const { theme: currentTheme, toggleTheme } = useTheme();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (admin) {
      getMe().then(setRole);
    }
  }, [admin, getMe]);

  const handleLogout = () => {
    logout();
    navigate('/admin/login');
  };

  const currentPath = location.pathname;

  if (!admin) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
        <header className="console-topbar">
          <div className="console-topbar-brand" onClick={() => navigate('/store')}>
            <img src="/admin/icon.svg" alt="ClawBench" />
            <span>ClawBench Marketplace</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              type="text"
              icon={currentTheme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggleTheme}
            />
            <Button type="text" icon={<HomeOutlined />} onClick={() => navigate('/store')}>
              Home
            </Button>
            <Button type="primary" onClick={() => navigate('/admin/login')}>
              Admin
            </Button>
          </div>
        </header>
        <main className="console-store-content">{children}</main>
      </div>
    );
  }

  const menuItems = [
    { key: '/admin/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
    // Management entries are admin-only; regular users see just the dashboard.
    ...(role === 'admin'
      ? [
          { key: '/admin/apps', icon: <AppstoreOutlined />, label: 'Apps' },
          { key: '/admin/common-apps', icon: <BlockOutlined />, label: 'Common Apps' },
          { key: '/admin/resources', icon: <WalletOutlined />, label: 'Resources' },
          { key: '/admin/projects', icon: <ProjectOutlined />, label: 'Projects' },
          { key: '/admin/users', icon: <UserOutlined />, label: 'Users' },
        ]
      : []),
  ];

  const isActive = (key: string) => {
    if (key === '/admin/resources') {
      return (
        currentPath.startsWith('/admin/resources') ||
        currentPath.startsWith('/admin/store')
      );
    }
    if (key === '/admin/dashboard') {
      return currentPath === '/admin' || currentPath.startsWith('/admin/dashboard');
    }
    return currentPath.startsWith(key);
  };

  return (
    <div className="console-layout">
      <aside className="console-sidebar">
        <div className="console-sidebar-brand">
          <img src="/admin/icon.svg" alt="ClawBench" />
          <div className="brand-text">
            <span className="brand-name">ClawBench</span>
            <span className="brand-sub">Admin Console</span>
          </div>
        </div>

        <nav className="console-sidebar-nav">
          {menuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`console-nav-item ${isActive(item.key) ? 'active' : ''}`}
              onClick={() => navigate(item.key)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="console-sidebar-footer">
          <button type="button" className="console-nav-item" onClick={toggleTheme}>
            {currentTheme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            {currentTheme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button type="button" className="console-nav-item" onClick={handleLogout}>
            <LogoutOutlined />
            Logout
          </button>
        </div>
      </aside>

      <div className="console-main">
        <main className="console-content">{children}</main>
      </div>
    </div>
  );
};

export default Layout;
