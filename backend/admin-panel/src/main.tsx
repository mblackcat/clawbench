/// <reference types="vite/client" />

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, theme as antTheme, App as AntApp } from 'antd';
import App from './App';
import { useTheme } from './hooks/useTheme';
import './styles/console.css';

const Root: React.FC = () => {
  const { theme: currentTheme } = useTheme();
  const isDark = currentTheme === 'dark';

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: {
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          borderRadius: 8,
          colorPrimary: '#0d9488',
          colorBgContainer: isDark ? '#18181b' : '#ffffff',
          colorBgElevated: isDark ? '#18181b' : '#ffffff',
          colorBorder: isDark ? '#27272a' : '#e4e4e7',
          colorText: isDark ? '#fafafa' : '#18181b',
          colorTextSecondary: isDark ? '#a1a1aa' : '#52525b',
        },
        components: {
          Table: {
            headerBg: isDark ? '#27272a' : '#f4f4f5',
            rowHoverBg: isDark ? '#1f1f23' : '#fafafa',
          },
          Menu: {
            darkItemBg: 'transparent',
            darkSubMenuItemBg: 'transparent',
          },
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
