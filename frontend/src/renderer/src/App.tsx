import React, { useEffect, useMemo } from 'react'
import { HashRouter } from 'react-router-dom'
import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import AppRoutes from './routes'
import { useSettingsStore } from './stores/useSettingsStore'
import ViewTransitionBridge from './motion/ViewTransitionBridge'
import {
  PALETTE_FRAME_BG,
  darkTokens,
  getBaseTheme,
  getShellThemeConfig,
  isDarkTheme,
  lightTokens,
  resolvePalette
} from './theme'
import './types/ipc'

const App: React.FC = () => {
  const theme = useSettingsStore((state) => state.theme)
  const language = useSettingsStore((state) => state.language)
  const fetchSettings = useSettingsStore((state) => state.fetchSettings)

  useEffect(() => {
    fetchSettings()
  }, [])

  // data-theme = base (light/dark) for CSS; data-palette = stored theme name
  const baseTheme = getBaseTheme(theme)
  const dark = isDarkTheme(theme)

  useEffect(() => {
    document.body.setAttribute('data-theme', baseTheme)
    document.body.setAttribute('data-palette', theme)
    // Match the outer frame so route switches never flash a different color
    document.body.style.background = PALETTE_FRAME_BG[resolvePalette(theme)]
    // Keep caret (text insertion cursor) aligned with primary text color —
    // light-mode inputs otherwise inherit a washed-out caret that vanishes.
    document.body.style.caretColor = dark ? darkTokens.colorText : lightTokens.colorText
  }, [theme, baseTheme, dark])

  const themeConfig = useMemo(() => getShellThemeConfig(theme), [theme])

  const antLocale = language === 'en' ? enUS : zhCN

  return (
    <ConfigProvider locale={antLocale} theme={themeConfig}>
      <AntApp>
        <div data-theme={baseTheme} data-palette={theme} style={{ height: '100%' }}>
          <HashRouter>
            <ViewTransitionBridge />
            <AppRoutes />
          </HashRouter>
        </div>
      </AntApp>
    </ConfigProvider>
  )
}

export default App
