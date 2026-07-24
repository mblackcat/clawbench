import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import DashboardPage from './pages/DashboardPage';
import UserManagementPage from './pages/UserManagementPage';
import ResourceListPage from './pages/ResourceListPage';
import ResourceDetailPage from './pages/ResourceDetailPage';
import ResourcesPage from './pages/ResourcesPage';
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
        {/* Apps — marketplace app-type resources (vexelbench-style management) */}
        <Route path="apps" element={<ResourceListPage fixedType="app" />} />
        <Route path="apps/:appId" element={<ResourceDetailPage />} />
        {/* Common Apps — builtin/common app registry (kill-switch, pin, order, config) */}
        <Route
          path="common-apps"
          element={
            <RequireAdmin>
              <CommonAppsPage />
            </RequireAdmin>
          }
        />
        {/* Resources — AI Skill / Prompt / Link, tabbed by type */}
        <Route path="resources" element={<ResourcesPage />} />
        <Route path="resources/:appId" element={<ResourceDetailPage />} />
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
