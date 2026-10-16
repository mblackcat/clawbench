import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { ConfigProvider, Layout, Tooltip, theme as antTheme } from 'antd'
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { LogsBadgeIcon, useLogsIndicator } from './LogsIndicator'
import ErrorLogDrawer from '../ErrorLogDrawer'
import OutputPanel from '../OutputPanel'
import SubAppDialog from '../SubAppDialog'
import WeatherEffect from '../WeatherEffect'
import AttentionManager from '../AttentionManager'
import PythonEnvCheck from '../PythonEnvCheck'
import { useTaskStore } from '../../stores/useTaskStore'
import { useAutoWeather } from '../../stores/useWeatherStore'
import { useSubAppExecution } from '../../hooks/useSubAppExecution'
import { useAICodingStore } from '../../stores/useAICodingStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { localStorageManager } from '../../services/localStorageManager'
import {
  generalModeFallbackPath,
  isGeneralModePath,
  shouldShowLeftSider
} from '../../constants/app-mode'
import { getIslandThemeConfig } from '../../theme'
import { useT } from '../../i18n'

const { Header, Sider, Content } = Layout

/**
 * Key for the page-transition wrapper: the top-level route segment only, so
 * param / sub-route changes inside a module (e.g. /workbench/installed →
 * /workbench/library, /developer/edit/a → /developer/edit/b) don't remount
 * the page — only switching modules replays the entry animation.
 */
function pageTransitionKey(pathname: string): string {
  return pathname.split('/')[1] || 'root'
}

const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(() => localStorageManager.getSidebarCollapsed())
  const [errorLogOpen, setErrorLogOpen] = useState(false)
  const errorLogOpenRef = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  const activeTaskId = useTaskStore((state) => state.activeTaskId)
  const appMode = useSettingsStore((state) => state.appMode)
  const currentTheme = useSettingsStore((state) => state.theme)
  const showSider = shouldShowLeftSider(appMode)
  const { token } = antTheme.useToken()
  const logsIndicator = useLogsIndicator()
  const t = useT()

  // Content island gets its own antd theme (page surface inside the shell frame)
  const islandThemeConfig = useMemo(() => getIslandThemeConfig(currentTheme), [currentTheme])

  // 初始化 subapp 执行监听
  useSubAppExecution()

  // Hourly auto weather (50% chance, 5–15 min) — scheduled once for the shell
  useAutoWeather()

  // 监听主进程系统日志
  useEffect(() => {
    const unsub = window.api.system.onLog((entry) => {
      useTaskStore.getState().addSystemLog(entry)
      // Logs that arrive while the drawer is open are read immediately
      if (errorLogOpenRef.current) {
        useTaskStore.getState().markLogsRead()
      }
    })
    return unsub
  }, [])

  // 全局初始化 IM 监听（与页面无关，保证顶栏状态随时同步）
  useEffect(() => {
    const store = useAICodingStore.getState()
    store.fetchIMConfig()
    store.fetchIMStatus()
    const cleanup = store.initListeners()
    return cleanup
  }, [])

  // Reset residual scroll from the previous route. A non-zero scrollLeft on
  // `.cb-content` after navigating back into full-height modules (AI Coding /
  // Terminal) looks exactly like a broken width until the window is resized.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    if (el.scrollLeft !== 0 || el.scrollTop !== 0) {
      el.scrollLeft = 0
      el.scrollTop = 0
    }
  }, [location.pathname])

  // General-mode safety net: if the user lands on a route that isn't a live
  // center surface (e.g. a stale lastRoute), redirect to the workbench.
  // Because isGeneralModePath is AI-inclusive, real product routes are never
  // redirected — only genuinely unknown paths.
  useEffect(() => {
    if (appMode !== 'general') return
    if (!isGeneralModePath(location.pathname)) {
      navigate(generalModeFallbackPath(), { replace: true })
    }
  }, [appMode, location.pathname, navigate])

  // Opening the log drawer acknowledges the transient error alert + unread logs
  useEffect(() => {
    errorLogOpenRef.current = errorLogOpen
    if (errorLogOpen) {
      useTaskStore.getState().dismissErrorAlert()
      useTaskStore.getState().markLogsRead()
    }
  }, [errorLogOpen])

  const toggleErrorLog = useCallback(() => {
    setErrorLogOpen((prev) => !prev)
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      localStorageManager.saveSidebarCollapsed(next)
      return next
    })
  }, [])

  const bottomBtnStyle = (marginBottom: number): React.CSSProperties => ({
    justifyContent: collapsed ? 'center' : 'flex-start',
    paddingInline: collapsed ? 0 : 20,
    margin: collapsed ? `0 6px ${marginBottom}px` : `0 8px ${marginBottom}px`
  })

  return (
    <Layout className="cb-layout-root" style={{ minHeight: '100vh', height: '100vh', overflow: 'hidden' }}>
      <Header
        style={{
          padding: 0,
          height: 40,
          lineHeight: '40px',
          background: 'transparent'
        }}
      >
        <TopBar showLogsEntry={!showSider} onToggleLogs={toggleErrorLog} />
      </Header>

      <Layout style={{ flex: 1, overflow: 'hidden', background: 'transparent' }}>
        {showSider && (
          <Sider
            className="cb-sidebar"
            collapsed={collapsed}
            width={176}
            collapsedWidth={56}
            style={{ background: 'transparent', position: 'relative', zIndex: 5 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'visible' }}>
                <Sidebar collapsed={collapsed} />
              </div>
              <div className="cb-sidebar-bottom-divider" />
              <Tooltip title={collapsed ? t('common.expandSidebar') : ''} placement="right">
                <div
                  role="button"
                  tabIndex={0}
                  className="cb-sidebar-bottom-btn cb-press"
                  onClick={toggleCollapsed}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') toggleCollapsed()
                  }}
                  style={bottomBtnStyle(4)}
                >
                  {collapsed ? (
                    <MenuUnfoldOutlined style={{ fontSize: 16 }} />
                  ) : (
                    <MenuFoldOutlined style={{ fontSize: 16 }} />
                  )}
                  {!collapsed && <span>{t('common.collapseSidebar')}</span>}
                </div>
              </Tooltip>
              {/* Logs entry (former StatusBar log icon + merged notification badge) */}
              <Tooltip title={collapsed ? t('statusbar.logs') : ''} placement="right">
                <div
                  role="button"
                  tabIndex={0}
                  className={`cb-sidebar-bottom-btn cb-press ${logsIndicator.hasAlert ? 'has-alert' : ''}`}
                  onClick={toggleErrorLog}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') toggleErrorLog()
                  }}
                  style={
                    {
                      ...bottomBtnStyle(8),
                      '--cb-alert-color': token.colorError,
                      '--cb-alert-hover-bg': token.colorErrorBg
                    } as React.CSSProperties
                  }
                >
                  <LogsBadgeIcon state={logsIndicator} offset={collapsed ? [-2, 2] : [6, -2]} />
                  {!collapsed && <span>{t('statusbar.logs')}</span>}
                </div>
              </Tooltip>
            </div>
          </Sider>
        )}

        <Layout
          style={{
            flex: 1,
            height: '100%',
            minHeight: 0,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'transparent',
            padding: showSider ? '0 8px 8px 0' : '0 8px 8px 8px',
            overflow: 'hidden',
            position: 'relative',
            zIndex: 1
          }}
        >
          <div className="cb-content-island">
            <ConfigProvider theme={islandThemeConfig}>
              <Content
                ref={contentRef}
                className="cb-content"
                style={{
                  flex: 1,
                  height: '100%',
                  width: '100%',
                  minHeight: 0,
                  minWidth: 0,
                  overflowX: 'hidden',
                  overflowY: 'auto',
                  padding: 0,
                  // Flex column so full-height pages (AI Coding / Terminal / Chat)
                  // receive a definite height and can measure panes/terminals
                  // correctly after route re-entry.
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                <div
                  key={pageTransitionKey(location.pathname)}
                  className="cb-page-transition"
                  style={{
                    flex: 1,
                    width: '100%',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column'
                  }}
                >
                  <Outlet />
                </div>
              </Content>

              {activeTaskId && <OutputPanel taskId={activeTaskId} />}
            </ConfigProvider>
          </div>
        </Layout>
      </Layout>

      <WeatherEffect />
      <ErrorLogDrawer open={errorLogOpen} onClose={() => setErrorLogOpen(false)} />
      <SubAppDialog />
      <AttentionManager />
      <PythonEnvCheck />
    </Layout>
  )
}

export default AppLayout
