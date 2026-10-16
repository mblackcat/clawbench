import React, { useState, useEffect, useCallback } from 'react'
import { App, Button, Input, Typography, Divider, theme, Space } from 'antd'
import {
  UserOutlined,
  LockOutlined,
  MinusOutlined,
  CloseOutlined,
  BorderOutlined,
  BlockOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/useAuthStore'
import { localStorageManager } from '../../services/localStorageManager'
import { useT } from '../../i18n'
import appIcon from '../../../../../resources/icon.svg'

const { Title, Text } = Typography

const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const t = useT()
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const loading = useAuthStore((state) => state.loading)
  const feishuWaiting = useAuthStore((state) => state.feishuWaiting)
  const error = useAuthStore((state) => state.error)
  const loginWithFeishu = useAuthStore((state) => state.loginWithFeishu)
  const cancelFeishuLogin = useAuthStore((state) => state.cancelFeishuLogin)
  const loginWithPassword = useAuthStore((state) => state.loginWithPassword)
  const registerAndLogin = useAuthStore((state) => state.registerAndLogin)
  const loginWithLocalMode = useAuthStore((state) => state.loginWithLocalMode)
  const clearError = useAuthStore((state) => state.clearError)

  const [showPasswordLogin, setShowPasswordLogin] = useState(false)
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [enableAccountLogin, setEnableAccountLogin] = useState(true)
  // Default ON — env can still force off with VITE_ENABLE_LOCAL_MODE=false
  const [enableLocalMode, setEnableLocalMode] = useState(true)
  const [isMaximized, setIsMaximized] = useState(false)
  const { token: themeToken } = theme.useToken()

  const isMac = window.api.platform === 'darwin'
  const isWin = window.api.platform === 'win32'

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
      // Route through RootRedirect ("/") so it can gate first-time users on
      // hasCompletedSetup (setup wizard) and resolve lastRoute / app mode.
      navigate('/', { replace: true })
    }
  }, [loggedIn, navigate])

  useEffect(() => {
    if (error) {
      message.error(error)
      clearError()
    }
  }, [error, clearError])

  // Windows frameless window: the login page has no TopBar, so render controls here
  useEffect(() => {
    if (!isWin) return
    const syncMaximized = async (): Promise<void> => {
      setIsMaximized(await window.api.windowControl.isMaximized())
    }
    syncMaximized()
    window.addEventListener('resize', syncMaximized)
    return () => window.removeEventListener('resize', syncMaximized)
  }, [isWin])

  const handleWindowMinimize = useCallback(() => window.api.windowControl.minimize(), [])
  const handleWindowMaximize = useCallback(async () => {
    await window.api.windowControl.maximize()
    setIsMaximized(await window.api.windowControl.isMaximized())
  }, [])
  const handleWindowClose = useCallback(() => window.api.windowControl.close(), [])

  const handleFeishuLogin = async (): Promise<void> => {
    await loginWithFeishu()
  }

  const handleCancelFeishuLogin = async (): Promise<void> => {
    await cancelFeishuLogin()
  }

  const handleOpenModalLogin = (): void => {
    window.api.auth.openModalLogin().catch(() => {
      message.error(t('login.openInModalFailed'))
    })
  }

  const handleCopyAuthUrl = async (): Promise<void> => {
    try {
      const url = await window.api.auth.getAuthUrl()
      await navigator.clipboard.writeText(url)
      message.success(t('login.copyFeishuUrlSuccess'))
    } catch {
      message.error(t('login.copyFeishuUrlFailed'))
    }
  }

  const handlePasswordSubmit = async (): Promise<void> => {
    if (!username || !password) {
      message.error(t('login.needCredentials'))
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

  const feishuWaitingPanel = (
    <div style={{ marginTop: 12, textAlign: 'center' }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        {t('login.feishuWaitingHint')}
      </Text>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button block onClick={handleOpenModalLogin}>
          {t('login.openInModal')}
        </Button>
        <Button block onClick={handleCopyAuthUrl}>
          {t('login.copyFeishuUrl')}
        </Button>
        <Button block onClick={handleCancelFeishuLogin}>
          {t('login.cancelFeishu')}
        </Button>
      </Space>
    </div>
  )

  return (
    <div style={{ display: 'flex', minHeight: '100vh', position: 'relative' }}>
      {/* Drag strip for the frameless window (login has no TopBar) */}
      <div
        className="cb-topbar-drag"
        style={{
          position: 'absolute',
          top: 0,
          left: isMac ? 72 : 0,
          right: isWin ? 140 : 0,
          height: 38,
          zIndex: 90,
          WebkitAppRegion: 'drag'
        } as React.CSSProperties}
      />
      {isWin && (
        <div
          className="cb-topbar-nodrag"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            height: 38,
            WebkitAppRegion: 'no-drag'
          } as React.CSSProperties}
        >
          <button className="cb-win-btn" onClick={handleWindowMinimize} title={t('topbar.minimize')}>
            <MinusOutlined style={{ fontSize: 12 }} />
          </button>
          <button
            className="cb-win-btn"
            onClick={handleWindowMaximize}
            title={isMaximized ? t('topbar.restore') : t('topbar.maximize')}
          >
            {isMaximized ? <BlockOutlined style={{ fontSize: 12 }} /> : <BorderOutlined style={{ fontSize: 12 }} />}
          </button>
          <button className="cb-win-btn cb-win-btn-close" onClick={handleWindowClose} title={t('topbar.close')}>
            <CloseOutlined style={{ fontSize: 12 }} />
          </button>
        </div>
      )}

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
          // macOS: leave room for traffic lights
          paddingTop: isMac ? 60 : 48,
        }}
      >
        <img
          src={appIcon}
          alt={t('login.brandName')}
          style={{
            width: 88,
            height: 88,
            marginBottom: 24,
            borderRadius: 18,
            boxShadow: themeToken.boxShadowSecondary,
          }}
        />
        <Title level={1} style={{ color: '#fff', marginBottom: 8, marginTop: 0 }}>
          {t('login.brandName')}
        </Title>
        <Text style={{ color: 'rgba(255, 255, 255, 0.85)', fontSize: 16 }}>
          {t('login.appName')}
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
          paddingTop: 60,
        }}
      >
        <div style={{ width: 320, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
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
                {t('login.feishuLogin')}
              </Button>
              {feishuWaiting && feishuWaitingPanel}
              {enableAccountLogin && (
                <div style={{ marginTop: 16 }}>
                  <a
                    onClick={() => !feishuWaiting && setShowPasswordLogin(true)}
                    style={{
                      fontSize: 14,
                      pointerEvents: feishuWaiting ? 'none' : undefined,
                      opacity: feishuWaiting ? 0.45 : 1,
                    }}
                  >
                    {t('login.switchMethod')}
                  </a>
                </div>
              )}
              {enableLocalMode && (
                <div style={{ marginTop: enableAccountLogin ? 8 : 16 }}>
                  <Divider plain style={{ marginTop: 0 }}>{t('login.or')}</Divider>
                  <Button
                    block
                    size="large"
                    disabled={feishuWaiting}
                    onClick={loginWithLocalMode}
                  >
                    {t('login.localMode')}
                  </Button>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                    {t('login.localModeDesc')}
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
                placeholder={t('login.usernamePlaceholder')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onPressEnter={handlePasswordSubmit}
                style={{ marginBottom: 16 }}
                disabled={feishuWaiting}
              />
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder={t('login.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onPressEnter={handlePasswordSubmit}
                style={{ marginBottom: 16 }}
                disabled={feishuWaiting}
              />
              <Button
                type="primary"
                size="large"
                block
                loading={loading && !feishuWaiting}
                disabled={feishuWaiting}
                onClick={handlePasswordSubmit}
              >
                {isRegister ? t('login.register') : t('login.login')}
              </Button>
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                {isRegister ? (
                  <a onClick={() => setIsRegister(false)}>{t('login.hasAccountLogin')}</a>
                ) : (
                  <a onClick={() => setIsRegister(true)}>{t('login.noAccountRegister')}</a>
                )}
              </div>
              <Divider plain>{t('login.or')}</Divider>
              <Button
                block
                type="default"
                loading={loading && feishuWaiting}
                disabled={loading && !feishuWaiting}
                onClick={handleFeishuLogin}
              >
                {t('login.feishuLogin')}
              </Button>
              {feishuWaiting && feishuWaitingPanel}
              {enableLocalMode && (
                <Button
                  block
                  size="large"
                  style={{ marginTop: 12 }}
                  disabled={feishuWaiting}
                  onClick={loginWithLocalMode}
                >
                  {t('login.localMode')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default LoginPage
