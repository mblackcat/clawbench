import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import DashboardPage from './pages/DashboardPage';
import UserManagementPage from './pages/UserManagementPage';
import ResourceListPage from './pages/ResourceListPage';
import ResourceDetailPage from './pages/ResourceDetailPage';
import CommonAppsPage from './pages/CommonAppsPage';
import ProjectManagementPage from './pages/ProjectManagementPage';
import { useApi } from './hooks/useApi';

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { getToken } = useApi();
  const token = getToken();
  if (!token) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
};

// Gate sensitive admin CRUD routes to global admins. While the role is loading
// we render nothing; non-admins are bounced to the dashboard.
const RequireAdmin: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { getMe } = useApi();
  const [role, setRole] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    getMe()
      .then(setRole)
      .finally(() => setReady(true));
  }, [getMe]);
  if (!ready) return null;
  if (role !== 'admin') return <Navigate to="/admin/dashboard" replace />;
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
        {/* App Manage — card-based management of common/builtin apps (内置 + 用户) */}
        <Route
          path="apps"
          element={
            <RequireAdmin>
              <CommonAppsPage />
            </RequireAdmin>
          }
        />
        {/* Common apps have no detail page; redirect stale links to marketplace detail */}
        <Route path="apps/:appId" element={<StoreRedirect />} />
        <Route path="common-apps" element={<Navigate to="/admin/apps" replace />} />
        {/* Marketplace detail pages (linked from the dashboard listing) */}
        <Route path="resources/:appId" element={<ResourceDetailPage />} />
        {/* Legacy list/store routes now fold into the dashboard */}
        <Route path="resources" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="store" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="store/:appId" element={<StoreRedirect />} />
        {/* Projects — multi-tenant projects + members + per-project app configs */}
        <Route
          path="projects"
          element={
            <RequireAdmin>
              <ProjectManagementPage />
            </RequireAdmin>
          }
        />
        {/* Users — admin-only (unchanged) */}
        <Route path="users" element={<UserManagementPage />} />
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
