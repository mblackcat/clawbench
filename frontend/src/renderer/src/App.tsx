import React, { useEffect, useMemo } from 'react'
import { HashRouter } from 'react-router-dom'
import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import AppRoutes from './routes'
import { useSettingsStore } from './stores/useSettingsStore'
import ViewTransitionBridge from './motion/ViewTransitionBridge'
import { applyThemeToDom, getBaseTheme, getShellThemeConfig, resolvePalette } from './theme'
import { applyFontSizeToDom } from './constants/font-size'
import './types/ipc'

const App: React.FC = () => {
  const theme = useSettingsStore((state) => state.theme)
  const language = useSettingsStore((state) => state.language)
  const fontSize = useSettingsStore((state) => state.fontSize)
  const fetchSettings = useSettingsStore((state) => state.fetchSettings)

  useEffect(() => {
    fetchSettings()
  }, [])

  // data-theme = base (light/dark) for CSS; data-palette = resolved palette
  const baseTheme = getBaseTheme(theme)
  const palette = resolvePalette(theme)
  const largeFont = fontSize === 'large'

  useEffect(() => {
    // data-theme / data-palette, frame background, caret and --cb-primary* accents
    applyThemeToDom(theme)
  }, [theme])

  useEffect(() => {
    applyFontSizeToDom(fontSize)
  }, [fontSize])

  const themeConfig = useMemo(() => getShellThemeConfig(theme, { largeFont }), [theme, largeFont])

  const antLocale = language === 'en' ? enUS : zhCN

  return (
    <ConfigProvider locale={antLocale} theme={themeConfig}>
      <AntApp>
        <div data-theme={baseTheme} data-palette={palette} data-font-size={fontSize} style={{ height: '100%' }}>
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
