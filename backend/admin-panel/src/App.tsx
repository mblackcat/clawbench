import React from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import DashboardPage from './pages/DashboardPage';
import UserManagementPage from './pages/UserManagementPage';
import ResourceListPage from './pages/ResourceListPage';
import ResourceDetailPage from './pages/ResourceDetailPage';
import { useApi } from './hooks/useApi';

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { getToken } = useApi();
  const token = getToken();
  if (!token) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
};

const StoreRedirect: React.FC = () => {
  const { appId } = useParams<{ appId: string }>();
  return <Navigate to={`/admin/resources/${appId}`} replace />;
};

const AdminShell: React.FC = () => (
  <RequireAuth>
    <Layout admin>
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="users" element={<UserManagementPage />} />
        {/* New resources routes */}
        <Route path="resources" element={<ResourceListPage />} />
        <Route path="resources/:appId" element={<ResourceDetailPage />} />
        {/* Legacy /admin/store redirects for bookmarks */}
        <Route path="store" element={<Navigate to="/admin/resources" replace />} />
        <Route path="store/:appId" element={<StoreRedirect />} />
      </Routes>
    </Layout>
  </RequireAuth>
);

const StoreShell: React.FC = () => (
  <Layout admin={false}>
    <Routes>
      <Route index element={<ResourceListPage />} />
      <Route path="app/:appId" element={<ResourceDetailPage />} />
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
      <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
    </Routes>
  );
};

export default App;
