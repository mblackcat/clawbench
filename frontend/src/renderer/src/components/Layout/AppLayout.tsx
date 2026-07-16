import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Layout, Tooltip, theme as antTheme } from 'antd'
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import StatusBar from './StatusBar'
import ErrorLogDrawer from '../ErrorLogDrawer'
import OutputPanel from '../OutputPanel'
import SubAppDialog from '../SubAppDialog'
import WeatherEffect, { useWeatherEffect } from '../WeatherEffect'
import { useTaskStore } from '../../stores/useTaskStore'
import { useSubAppExecution } from '../../hooks/useSubAppExecution'
import { useAICodingStore } from '../../stores/useAICodingStore'
import { localStorageManager } from '../../services/localStorageManager'
import { useT } from '../../i18n'

const { Header, Sider, Content, Footer } = Layout

const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(() => localStorageManager.getSidebarCollapsed())
  const [errorLogOpen, setErrorLogOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  const activeTaskId = useTaskStore((state) => state.activeTaskId)
  const { token } = antTheme.useToken()
  const { weatherType, weatherVisible, toggleWeather, cycleWeather } = useWeatherEffect()
  const t = useT()

  // 初始化 subapp 执行监听
  useSubAppExecution()

  // 监听主进程系统日志
  useEffect(() => {
    const unsub = window.api.system.onLog((entry) => {
      useTaskStore.getState().addSystemLog(entry)
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

  const toggleErrorLog = useCallback(() => {
    setErrorLogOpen((prev) => !prev)
  }, [])

  return (
    <Layout className="cb-layout-root" style={{ minHeight: '100vh', height: '100vh' }}>
      <Header
        style={{
          padding: 0,
          height: 38,
          lineHeight: '38px',
          background: 'transparent'
        }}
      >
        <TopBar />
      </Header>

      <Layout style={{ flex: 1, overflow: 'hidden', background: 'transparent' }}>
        <Sider
          className="cb-sidebar"
          collapsed={collapsed}
          width={176}
          collapsedWidth={56}
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <Sidebar collapsed={collapsed} variant="main" />
            </div>
            <div
              style={{
                borderTop: `1px solid ${token.colorBorderSecondary}`,
                paddingTop: 4
              }}
            >
              <Sidebar collapsed={collapsed} variant="settings" />
            </div>
            <Tooltip title={collapsed ? t('common.expandSidebar') : ''} placement="right">
              <div
                onClick={() => {
                  const next = !collapsed
                  setCollapsed(next)
                  localStorageManager.saveSidebarCollapsed(next)
                }}
                style={{
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  gap: 10,
                  paddingInline: collapsed ? 0 : 24,
                  cursor: 'pointer',
                  color: token.colorTextSecondary,
                  fontSize: 14
                }}
              >
                {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                {!collapsed && (
                  <span>{t('common.collapseSidebar')}</span>
                )}
              </div>
            </Tooltip>
          </div>
        </Sider>

        <Layout style={{ display: 'flex', flexDirection: 'column', background: 'transparent', minHeight: 0, minWidth: 0 }}>
          <Content
            ref={contentRef}
            className="cb-content"
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              overflow: 'auto',
              padding: 0,
              // Flex column so full-height pages (AI Coding / Terminal / Chat)
              // receive a definite height and can measure panes/terminals
              // correctly after route re-entry.
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <Outlet />
          </Content>

          {activeTaskId && (
            <OutputPanel taskId={activeTaskId} />
          )}
        </Layout>
      </Layout>

      <Footer style={{ padding: 0 }}>
        <StatusBar
          onToggleErrorLog={toggleErrorLog}
          weatherVisible={weatherVisible}
          onToggleWeather={toggleWeather}
          onCycleWeather={cycleWeather}
          weatherType={weatherType}
        />
      </Footer>

      <WeatherEffect type={weatherType} visible={weatherVisible} />
      <ErrorLogDrawer open={errorLogOpen} onClose={() => setErrorLogOpen(false)} />
      <SubAppDialog />
    </Layout>
  )
}

export default AppLayout
