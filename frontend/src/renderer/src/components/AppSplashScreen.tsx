import React from 'react'
import { theme } from 'antd'
import appIcon from '../../../../resources/icon.svg'
import { useT } from '../i18n'
import './app-splash.css'

/**
 * Full-screen semi-transparent loading mask, styled after the empty-chat
 * "logo + slogan" look (see AIChat/WelcomeChatView.tsx). Use this as the
 * default placeholder whenever the UI has to wait on backend/IPC data
 * before it can decide what to render (e.g. initial settings/auth fetch
 * on app boot) instead of a bare spinner or letting the wrong route flash
 * on screen first.
 */
const AppSplashScreen: React.FC = () => {
  const { token } = theme.useToken()
  const t = useT()

  return (
    <div className="app-splash-mask">
      <div className="app-splash-backdrop" style={{ backgroundColor: token.colorBgLayout }} />
      <div className="app-splash-content">
        <div className="app-splash-header">
          <img src={appIcon} alt="ClawBench" className="app-splash-icon" />
          <span className="app-splash-slogan" style={{ color: token.colorTextSecondary }}>
            {t('app.splashSlogan')}
          </span>
        </div>
        <div className="app-splash-dots">
          <span style={{ backgroundColor: token.colorPrimary }} />
          <span style={{ backgroundColor: token.colorPrimary }} />
          <span style={{ backgroundColor: token.colorPrimary }} />
        </div>
      </div>
    </div>
  )
}

export default AppSplashScreen
