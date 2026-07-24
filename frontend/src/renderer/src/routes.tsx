import React, { Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Spin } from 'antd'
import AppLayout from './components/Layout/AppLayout'
import RequireAuth from './components/RequireAuth'
import SessionGuard from './components/SessionGuard'
import AppSplashScreen from './components/AppSplashScreen'
import LoginPage from './pages/Login/LoginPage'
import InstalledAppsPage from './pages/Workbench/InstalledAppsPage'
import AppLibraryPage from './pages/Workbench/AppLibraryPage'
import AppDetailPage from './pages/Workbench/AppDetailPage'
import { useSettingsStore } from './stores/useSettingsStore'
import { resolveDefaultRoute } from './constants/app-mode'

// Lazy-loaded pages: deferred until the user navigates to them
const AIChatPage = React.lazy(() => import('./pages/AIChat/AIChatPage'))
const AppEditor = React.lazy(() => import('./pages/Developer/AppEditor'))
const CodeEditor = React.lazy(() => import('./pages/Developer/CodeEditor'))
const AppPublisher = React.lazy(() => import('./pages/Developer/AppPublisher'))
const AIAgentsPage = React.lazy(() => import('./pages/AIAgents/AIAgentsPage'))
const OpenClawPage = React.lazy(() => import('./pages/OpenClaw/OpenClawPage'))
const HermesPage = React.lazy(() => import('./pages/Hermes/HermesPage'))
const LocalEnvPage = React.lazy(() => import('./pages/LocalEnv/LocalEnvPage'))
const AICodingPage = React.lazy(() => import('./pages/AICoding/AICodingPage'))
const AITerminalPage = React.lazy(() => import('./pages/AITerminal/AITerminalPage'))
const CopiperPage = React.lazy(() => import('./pages/Copiper/CopiperPage'))
const SettingsPage = React.lazy(() => import('./pages/Settings/SettingsPage'))
const SkillEditor = React.lazy(() => import('./pages/Developer/SkillEditor'))
const PromptEditor = React.lazy(() => import('./pages/Developer/PromptEditor'))
const LinkEditor = React.lazy(() => import('./pages/Developer/LinkEditor'))
const SkillDetailView = React.lazy(() => import('./pages/Developer/SkillDetailView'))
const MyContributionsPage = React.lazy(() => import('./pages/Workbench/MyContributionsPage'))
const SetupWizard = React.lazy(() => import('./pages/Setup/SetupWizard'))

const LazyFallback: React.FC = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
    <Spin />
  </div>
)

// Backward-compat: the Apps module was renamed to Workbench. Redirect any
// legacy /apps/* path (incl. persisted lastRoute) to its /workbench/* equivalent.
const AppsRedirect: React.FC = () => {
  const location = useLocation()
  const to = location.pathname.replace(/^\/apps/, '/workbench') + location.search
  return <Navigate to={to} replace />
}

// Root redirect that checks setup status
const RootRedirect: React.FC = () => {
  const { hasCompletedSetup, loading, appMode } = useSettingsStore()
  if (loading) return <AppSplashScreen />
  if (!hasCompletedSetup) return <Navigate to="/setup" replace />
  return <Navigate to={resolveDefaultRoute(localStorage.getItem('lastRoute'), appMode)} replace />
}

const AppRoutes: React.FC = () => {
  return (
    <SessionGuard>
      <Suspense fallback={<LazyFallback />}>
        <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<RequireAuth><SetupWizard /></RequireAuth>} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/workbench/installed" element={<InstalledAppsPage />} />
          <Route path="/workbench/library" element={<AppLibraryPage />} />
          <Route path="/workbench/detail/:appId" element={<AppDetailPage />} />
          <Route path="/workbench/skill-detail/:appId" element={<SkillDetailView />} />
          <Route path="/copiper" element={<CopiperPage />} />
          <Route path="/ai-chat" element={<AIChatPage />} />
          <Route path="/developer/new" element={<AppEditor />} />
          <Route path="/developer/code/:appId" element={<CodeEditor />} />
          <Route path="/developer/publish" element={<AppPublisher />} />
          <Route path="/developer/new-skill" element={<SkillEditor />} />
          <Route path="/developer/new-prompt" element={<PromptEditor />} />
          <Route path="/developer/new-link" element={<LinkEditor />} />
          <Route path="/workbench/my-contributions" element={<MyContributionsPage />} />
          <Route path="/ai-agents" element={<AIAgentsPage />} />
          <Route path="/ai-agents/openclaw" element={<OpenClawPage />} />
          <Route path="/ai-agents/hermes" element={<HermesPage />} />
          <Route path="/openclaw" element={<Navigate to="/ai-agents/openclaw" replace />} />
          <Route path="/local-env" element={<LocalEnvPage />} />
          <Route path="/ai-coding" element={<AICodingPage />} />
          <Route path="/ai-workbench" element={<Navigate to="/ai-coding" replace />} />
          <Route path="/ai-terminal" element={<AITerminalPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/apps" element={<Navigate to="/workbench/installed" replace />} />
          <Route path="/apps/*" element={<AppsRedirect />} />
        </Route>
        </Routes>
      </Suspense>
    </SessionGuard>
  )
}

export default AppRoutes
