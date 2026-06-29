import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { App as AntApp } from 'antd';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import DashboardPage from './pages/DashboardPage';
import UserManagementPage from './pages/UserManagementPage';
import AppStorePage from './pages/AppStorePage';
import AppDetailPage from './pages/AppDetailPage';
import { useApi } from './hooks/useApi';

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { getToken } = useApi();
  const token = getToken();
  if (!token) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
};

const AdminShell: React.FC = () => (
  <RequireAuth>
    <Layout admin>
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="users" element={<UserManagementPage />} />
        <Route path="store" element={<AppStorePage />} />
        <Route path="store/:appId" element={<AppDetailPage />} />
      </Routes>
    </Layout>
  </RequireAuth>
);

const StoreShell: React.FC = () => (
  <Layout admin={false}>
    <Routes>
      <Route index element={<AppStorePage />} />
      <Route path="app/:appId" element={<AppDetailPage />} />
    </Routes>
  </Layout>
);

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/admin/*" element={<AdminShell />} />
      <Route path="/store/*" element={<StoreShell />} />
      <Route path="*" element={<Navigate to="/store" replace />} />
    </Routes>
  );
};

export default App;
