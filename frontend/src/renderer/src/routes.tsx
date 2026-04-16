import React, { Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Spin } from 'antd'
import AppLayout from './components/Layout/AppLayout'
import RequireAuth from './components/RequireAuth'
import LoginPage from './pages/Login/LoginPage'
import InstalledAppsPage from './pages/Apps/InstalledAppsPage'
import AppLibraryPage from './pages/Apps/AppLibraryPage'
import AppDetailPage from './pages/Apps/AppDetailPage'

// Lazy-loaded pages: deferred until the user navigates to them
const AIChatPage = React.lazy(() => import('./pages/AIChat/AIChatPage'))
const AppEditor = React.lazy(() => import('./pages/Developer/AppEditor'))
const CodeEditor = React.lazy(() => import('./pages/Developer/CodeEditor'))
const AppPublisher = React.lazy(() => import('./pages/Developer/AppPublisher'))
const AIAgentsPage = React.lazy(() => import('./pages/AIAgents/AIAgentsPage'))
const OpenClawPage = React.lazy(() => import('./pages/OpenClaw/OpenClawPage'))
const HermesPage = React.lazy(() => import('./pages/Hermes/HermesPage'))
const LocalEnvPage = React.lazy(() => import('./pages/LocalEnv/LocalEnvPage'))
const AIWorkbenchPage = React.lazy(() => import('./pages/AIWorkbench/AIWorkbenchPage'))
const AITerminalPage = React.lazy(() => import('./pages/AITerminal/AITerminalPage'))
const SettingsPage = React.lazy(() => import('./pages/Settings/SettingsPage'))
const SkillEditor = React.lazy(() => import('./pages/Developer/SkillEditor'))
const PromptEditor = React.lazy(() => import('./pages/Developer/PromptEditor'))
const MyContributionsPage = React.lazy(() => import('./pages/Apps/MyContributionsPage'))

const LazyFallback: React.FC = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
    <Spin />
  </div>
)

const AppRoutes: React.FC = () => {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to={localStorage.getItem('lastRoute') || '/ai-chat'} replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/apps/installed" element={<InstalledAppsPage />} />
          <Route path="/apps/library" element={<AppLibraryPage />} />
          <Route path="/apps/detail/:appId" element={<AppDetailPage />} />
          <Route path="/copiper" element={<Navigate to="/apps/installed" replace />} />
          <Route path="/ai-chat" element={<AIChatPage />} />
          <Route path="/developer/new" element={<AppEditor />} />
          <Route path="/developer/code/:appId" element={<CodeEditor />} />
          <Route path="/developer/publish" element={<AppPublisher />} />
          <Route path="/developer/new-skill" element={<SkillEditor />} />
          <Route path="/developer/new-prompt" element={<PromptEditor />} />
          <Route path="/apps/my-contributions" element={<MyContributionsPage />} />
          <Route path="/ai-agents" element={<AIAgentsPage />} />
          <Route path="/ai-agents/openclaw" element={<OpenClawPage />} />
          <Route path="/ai-agents/hermes" element={<HermesPage />} />
          <Route path="/openclaw" element={<Navigate to="/ai-agents/openclaw" replace />} />
          <Route path="/local-env" element={<LocalEnvPage />} />
          <Route path="/ai-workbench" element={<AIWorkbenchPage />} />
          <Route path="/ai-terminal" element={<AITerminalPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default AppRoutes
