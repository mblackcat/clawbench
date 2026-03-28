import React, { useState, useCallback, useEffect } from 'react'
import { Layout, theme as antTheme } from 'antd'
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import StatusBar from './StatusBar'
import ErrorLogDrawer from '../ErrorLogDrawer'
import OutputPanel from '../OutputPanel'
import SubAppDialog from '../SubAppDialog'
import WeatherEffect, { useWeatherEffect } from '../WeatherEffect'
import { useTaskStore } from '../../stores/useTaskStore'
import { useSubAppExecution } from '../../hooks/useSubAppExecution'
import { useAIWorkbenchStore } from '../../stores/useAIWorkbenchStore'
import { localStorageManager } from '../../services/localStorageManager'

const { Header, Sider, Content, Footer } = Layout

const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(() => localStorageManager.getSidebarCollapsed())
  const [errorLogOpen, setErrorLogOpen] = useState(false)

  const activeTaskId = useTaskStore((state) => state.activeTaskId)
  const { token } = antTheme.useToken()
  const { weatherType, weatherVisible, toggleWeather, cycleWeather } = useWeatherEffect()

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
    const store = useAIWorkbenchStore.getState()
    store.fetchIMConfig()
    store.fetchIMStatus()
    const cleanup = store.initListeners()
    return cleanup
  }, [])

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
              <Sidebar collapsed={collapsed} />
            </div>
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
                justifyContent: 'center',
                cursor: 'pointer',
                borderTop: `1px solid ${token.colorBorderSecondary}`,
                color: token.colorTextSecondary
              }}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </div>
          </div>
        </Sider>

        <Layout style={{ display: 'flex', flexDirection: 'column', background: 'transparent' }}>
          <Content
            className="cb-content"
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 0
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
