import React, { useEffect, useMemo } from 'react'
import { HashRouter } from 'react-router-dom'
import { ConfigProvider, App as AntApp, theme as antTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import AppRoutes from './routes'
import { useSettingsStore } from './stores/useSettingsStore'
import './types/ipc'

const FONT_FAMILY = "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif"

const lightTokens = {
  colorPrimary: '#4F8CFF',
  borderRadius: 8,
  borderRadiusLG: 12,
  borderRadiusSM: 6,
  colorBgLayout: '#F5F6F8',
  colorBgContainer: '#FFFFFF',
  colorBgElevated: '#FFFFFF',
  colorText: '#2E3038',
  colorTextSecondary: '#747A84',
  colorBorder: 'rgba(0, 0, 0, 0.08)',
  colorBorderSecondary: 'rgba(0, 0, 0, 0.05)',
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.04)',
  boxShadowSecondary: '0 1px 2px rgba(0, 0, 0, 0.03)',
  fontFamily: FONT_FAMILY,
  fontWeightStrong: 500,
}

const darkTokens = {
  colorPrimary: '#6BA1FF',
  borderRadius: 8,
  borderRadiusLG: 12,
  borderRadiusSM: 6,
  colorBgLayout: '#17171A',
  colorBgContainer: '#232326',
  colorBgElevated: '#2A2A2E',
  colorText: '#F0F0F3',
  colorTextSecondary: '#8B8D98',
  colorBorder: 'rgba(255, 255, 255, 0.08)',
  colorBorderSecondary: 'rgba(255, 255, 255, 0.05)',
  boxShadow: '0 2px 12px rgba(0, 0, 0, 0.30)',
  boxShadowSecondary: '0 1px 6px rgba(0, 0, 0, 0.25)',
  fontFamily: FONT_FAMILY,
  fontWeightStrong: 500,
}

const componentOverrides = {
  Button: {
    borderRadius: 8,
    borderRadiusLG: 10,
    borderRadiusSM: 6,
    paddingInline: 16,
    fontWeight: 400,
  },
  Menu: {
    itemBorderRadius: 8,
    itemMarginInline: 6,
    itemHeight: 38,
  },
  Input: {
    borderRadius: 8,
  },
  Select: {
    borderRadius: 8,
  },
  Modal: {
    borderRadiusLG: 12,
  },
  Drawer: {
    borderRadiusLG: 12,
  },
  Card: {
    borderRadiusLG: 12,
  },
  Table: {
    borderRadius: 8,
  },
  Tabs: {
    titleFontSize: 14,
  },
  Tag: {
    borderRadiusSM: 4,
  },
}

const App: React.FC = () => {
  const theme = useSettingsStore((state) => state.theme)
  const language = useSettingsStore((state) => state.language)
  const fetchSettings = useSettingsStore((state) => state.fetchSettings)

  useEffect(() => {
    fetchSettings()
  }, [])

  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
    document.body.style.background = theme === 'dark' ? '#17171A' : '#F5F6F8'
  }, [theme])

  const themeConfig = useMemo(
    () => ({
      algorithm: theme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
      token: theme === 'dark' ? darkTokens : lightTokens,
      components: componentOverrides,
    }),
    [theme]
  )

  const antLocale = language === 'en' ? enUS : zhCN

  return (
    <ConfigProvider locale={antLocale} theme={themeConfig}>
      <AntApp>
        <div data-theme={theme}>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </div>
      </AntApp>
    </ConfigProvider>
  )
}

export default App
