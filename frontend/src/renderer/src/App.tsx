import React, { useEffect, useMemo } from 'react'
import { HashRouter } from 'react-router-dom'
import { ConfigProvider, App as AntApp, theme as antTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import AppRoutes from './routes'
import { useSettingsStore } from './stores/useSettingsStore'
import './types/ipc'

/**
 * App UI face: Inter for Latin, then system UI / CJK stacks.
 * Inter is loaded via @fontsource in main.tsx (weights 300/400/500).
 * Light UI uses Regular (400) for readability; dark keeps Light (300) so
 * bright-on-dark text does not look optically heavy. Strong text is one step up.
 */
const FONT_FAMILY =
  "'Inter', 'Segoe UI Variable Text', 'Segoe UI Variable', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif"

const lightTokens = {
  colorPrimary: '#4F8CFF',
  borderRadius: 8,
  borderRadiusLG: 12,
  borderRadiusSM: 6,
  colorBgLayout: '#F5F6F8',
  colorBgContainer: '#FFFFFF',
  colorBgElevated: '#FFFFFF',
  // Near-black slate — high contrast on light surfaces (also drives caret-color)
  colorText: '#1F2329',
  colorTextSecondary: '#5C6370',
  colorTextTertiary: '#8B929E',
  colorTextQuaternary: '#A8AEB8',
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
  // Slightly softer than pure near-white — reduces optical "bold" on dark surfaces
  colorText: '#DDDEE3',
  colorTextSecondary: '#A0A3AD',
  colorTextTertiary: '#787B86',
  colorTextQuaternary: '#5C5E68',
  colorLink: '#6BA8FF',
  colorLinkHover: '#8FBEFF',
  colorLinkActive: '#5A9AEE',
  colorBorder: 'rgba(255, 255, 255, 0.08)',
  colorBorderSecondary: 'rgba(255, 255, 255, 0.05)',
  boxShadow: '0 2px 12px rgba(0, 0, 0, 0.30)',
  boxShadowSecondary: '0 1px 6px rgba(0, 0, 0, 0.25)',
  fontFamily: FONT_FAMILY,
  fontWeightStrong: 400,
}

const componentOverrides = {
  Button: {
    borderRadius: 8,
    borderRadiusLG: 10,
    borderRadiusSM: 6,
    paddingInline: 16,
    // Theme CSS sets real body weight per light/dark; avoid forcing 300 here.
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
    // Keep caret (text insertion cursor) aligned with primary text color —
    // light-mode inputs otherwise inherit a washed-out caret that vanishes.
    document.body.style.caretColor = theme === 'dark' ? '#DDDEE3' : '#1F2329'
  }, [theme])

  const themeConfig = useMemo(
    () => ({
      algorithm: theme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
      token: theme === 'dark' ? darkTokens : lightTokens,
      components: {
        ...componentOverrides,
        Tag: {
          borderRadiusSM: 4,
          ...(theme === 'dark'
            ? {
                defaultBg: 'rgba(255, 255, 255, 0.08)',
                defaultColor: '#C9CCD4',
              }
            : {
                defaultBg: 'rgba(0, 0, 0, 0.04)',
                defaultColor: '#5C6370',
              }),
        },
      },
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
