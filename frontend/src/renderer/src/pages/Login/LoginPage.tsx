import React, { useState, useEffect } from 'react'
import { App, Button, Input, Typography, Divider, theme } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/useAuthStore'
import { localStorageManager } from '../../services/localStorageManager'

const { Title, Text } = Typography

const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const loading = useAuthStore((state) => state.loading)
  const error = useAuthStore((state) => state.error)
  const loginWithFeishu = useAuthStore((state) => state.loginWithFeishu)
  const loginWithPassword = useAuthStore((state) => state.loginWithPassword)
  const registerAndLogin = useAuthStore((state) => state.registerAndLogin)
  const loginWithLocalMode = useAuthStore((state) => state.loginWithLocalMode)
  const clearError = useAuthStore((state) => state.clearError)

  const [showPasswordLogin, setShowPasswordLogin] = useState(false)
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [enableAccountLogin, setEnableAccountLogin] = useState(true)
  const [enableLocalMode, setEnableLocalMode] = useState(false)
  const { token: themeToken } = theme.useToken()

  // 初始化：读取环境配置 + 恢复本地登录偏好
  useEffect(() => {
    window.api.settings.getEnvConfig().then((config) => {
      setEnableAccountLogin(config.enableAccountLogin)
      setEnableLocalMode(config.enableLocalMode)

      if (!config.enableAccountLogin) return

      const savedMethod = localStorageManager.getLoginMethod()
      if (savedMethod === 'password') {
        setShowPasswordLogin(true)
        const creds = localStorageManager.getSavedCredentials()
        if (creds) {
          setUsername(creds.username)
          setPassword(creds.password)
        }
      }
    })
  }, [])

  useEffect(() => {
    if (loggedIn) {
      const lastRoute = localStorage.getItem('lastRoute') || '/apps/installed'
      navigate(lastRoute)
    }
  }, [loggedIn, navigate])

  useEffect(() => {
    if (error) {
      message.error(error)
      clearError()
    }
  }, [error, clearError])

  const handleFeishuLogin = async (): Promise<void> => {
    await loginWithFeishu()
  }

  const handlePasswordSubmit = async (): Promise<void> => {
    if (!username || !password) {
      message.error('请输入用户名和密码')
      return
    }
    try {
      if (isRegister) {
        await registerAndLogin(username, password)
      } else {
        await loginWithPassword(username, password)
      }
    } catch {
      // error is handled by the store
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Left half - branding */}
      <div
        style={{
          flex: 1,
          background: 'linear-gradient(135deg, #2c3b4d 0%, #1b2632 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 48,
        }}
      >
        <Title level={1} style={{ color: '#fff', marginBottom: 8 }}>
          ClawBench
        </Title>
        <Text style={{ color: 'rgba(255, 255, 255, 0.85)', fontSize: 16 }}>
          ClawBench 桌面应用
        </Text>
      </div>

      {/* Right half - login controls */}
      <div
        style={{
          flex: 1,
          background: themeToken.colorBgContainer,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 48,
        }}
      >
        <div style={{ width: 320 }}>
          {!showPasswordLogin ? (
            /* Default view: Feishu login */
            <div style={{ textAlign: 'center' }}>
              <Button
                type="primary"
                size="large"
                block
                loading={loading}
                onClick={handleFeishuLogin}
              >
                飞书登录
              </Button>
              {enableAccountLogin && (
                <div style={{ marginTop: 16 }}>
                  <a
                    onClick={() => setShowPasswordLogin(true)}
                    style={{ fontSize: 14 }}
                  >
                    切换登录方式
                  </a>
                </div>
              )}
              {enableLocalMode && (
                <div style={{ marginTop: enableAccountLogin ? 8 : 16 }}>
                  <Divider plain style={{ marginTop: 0 }}>或</Divider>
                  <Button
                    block
                    size="large"
                    onClick={loginWithLocalMode}
                  >
                    本地模式
                  </Button>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                    无需登录，仅限本地功能
                  </Text>
                </div>
              )}
            </div>
          ) : (
            /* Password login view */
            <div>
              <Input
                size="large"
                prefix={<UserOutlined />}
                placeholder="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onPressEnter={handlePasswordSubmit}
                style={{ marginBottom: 16 }}
              />
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onPressEnter={handlePasswordSubmit}
                style={{ marginBottom: 16 }}
              />
              <Button
                type="primary"
                size="large"
                block
                loading={loading}
                onClick={handlePasswordSubmit}
              >
                {isRegister ? '注册' : '登录'}
              </Button>
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                {isRegister ? (
                  <a onClick={() => setIsRegister(false)}>已有账号？登录</a>
                ) : (
                  <a onClick={() => setIsRegister(true)}>没有账号？注册</a>
                )}
              </div>
              <Divider plain>或</Divider>
              <Button
                block
                type="default"
                loading={loading}
                onClick={handleFeishuLogin}
              >
                飞书登录
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default LoginPage
