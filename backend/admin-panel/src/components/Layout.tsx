import React from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, Typography, theme } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  AppstoreOutlined,
  LogoutOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import { useApi } from '../hooks/useApi';

const { Sider, Content } = AntLayout;
const { Text } = Typography;

interface Props {
  admin: boolean;
  children: React.ReactNode;
}

const Layout: React.FC<Props> = ({ admin, children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useApi();
  const { token } = theme.useToken();

  const handleLogout = () => {
    logout();
    navigate('/admin/login');
  };

  const currentPath = location.pathname;

  if (!admin) {
    // Public store layout — minimal nav
    return (
      <AntLayout style={{ minHeight: '100vh', background: 'transparent' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 32px',
            backdropFilter: 'blur(20px) saturate(180%)',
            background: 'var(--glass-nav-bg)',
            borderBottom: '1px solid var(--glass-surface-border)',
            position: 'sticky',
            top: 0,
            zIndex: 100,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => navigate('/store')}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #007AFF, #AF52DE)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontWeight: 700,
                fontSize: 18,
              }}
            >
              C
            </div>
            <Text strong style={{ fontSize: 18, letterSpacing: '-0.02em', color: token.colorText }}>
              ClawBench Store
            </Text>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button type="text" icon={<HomeOutlined />} onClick={() => navigate('/store')}>
              Home
            </Button>
            <Button type="primary" onClick={() => navigate('/admin/login')}>
              Admin
            </Button>
          </div>
        </div>
        <Content style={{ padding: '32px', maxWidth: 1280, margin: '0 auto', width: '100%' }}>
          {children}
        </Content>
      </AntLayout>
    );
  }

  // Admin layout — sidebar + content
  const menuItems = [
    { key: '/admin/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
    { key: '/admin/users', icon: <UserOutlined />, label: 'Users' },
    { key: '/admin/store', icon: <AppstoreOutlined />, label: 'App Store' },
  ];

  return (
    <AntLayout style={{ minHeight: '100vh', background: 'transparent' }}>
      <Sider
        width={240}
        className="ios-glass-nav"
        style={{
          borderRight: '1px solid var(--glass-surface-border)',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
        }}
      >
        <div style={{ padding: '24px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: 'linear-gradient(135deg, #007AFF, #AF52DE)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 700,
              fontSize: 16,
            }}
          >
            C
          </div>
          <Text strong style={{ fontSize: 16, letterSpacing: '-0.01em', color: token.colorText }}>
            ClawBench Admin
          </Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[currentPath.startsWith('/admin/dashboard') ? '/admin/dashboard' : currentPath.startsWith('/admin/users') ? '/admin/users' : currentPath.startsWith('/admin/store') ? '/admin/store' : currentPath]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ background: 'transparent', borderInlineEnd: 'none', marginTop: 8 }}
          theme="dark"
        />
        <div style={{ position: 'absolute', bottom: 24, left: 20, right: 20 }}>
          <Button
            type="text"
            icon={<LogoutOutlined />}
            onClick={handleLogout}
            style={{ width: '100%', color: token.colorTextSecondary }}
          >
            Logout
          </Button>
        </div>
      </Sider>
      <AntLayout style={{ marginLeft: 240, background: 'transparent' }}>
        <Content style={{ padding: '32px 40px', minHeight: '100vh' }}>
          {children}
        </Content>
      </AntLayout>
    </AntLayout>
  );
};

export default Layout;
