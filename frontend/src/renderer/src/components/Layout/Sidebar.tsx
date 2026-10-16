import React, { useEffect, useMemo } from 'react'
import { Menu, theme } from 'antd'
import Icon from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import type { MenuProps } from 'antd'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useAttentionStore } from '../../stores/useAttentionStore'
import { useT } from '../../i18n'
import {
  WorkbenchIcon,
  AIChatIcon,
  AICodingIcon,
  AITerminalIcon,
  LocalEnvIcon,
  CopiperIcon
} from '../icons/MenuIcons'

interface SidebarProps {
  collapsed: boolean
}

// OpenClaw SVG icon — monochrome, follows theme via currentColor
const OpenClawSvg = () => (
  <svg viewBox="0 0 120 120" width="1em" height="1em" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z"/>
    <path d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z"/>
    <path d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z"/>
    <path d="M45 15 Q35 5 30 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none"/>
    <path d="M75 15 Q85 5 90 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none"/>
    <circle cx="45" cy="35" r="6" fill="var(--openclaw-eye, #050810)"/>
    <circle cx="75" cy="35" r="6" fill="var(--openclaw-eye, #050810)"/>
  </svg>
)
const OpenClawIcon = (props: any) => <Icon component={OpenClawSvg} {...props} />

interface BadgeColors {
  bg: string
  fg: string
  ring: string
}

/** Icon with a top-left badge: numeric count when > 0, else an optional dot. */
const withTopLeftBadge = (
  icon: React.ReactNode,
  colors: BadgeColors,
  showDot: boolean,
  count = 0
): React.ReactNode => (
  <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
    {icon}
    {count > 0 ? (
      <span
        className="cb-sidebar-badge"
        style={{
          position: 'absolute',
          top: -4,
          left: -7,
          minWidth: 15,
          height: 15,
          padding: '0 3.5px',
          borderRadius: 8,
          background: colors.bg,
          color: colors.fg,
          fontSize: 10,
          fontWeight: 600,
          lineHeight: '15px',
          textAlign: 'center',
          boxShadow: `0 0 0 1px ${colors.ring}`,
          zIndex: 10
        }}
      >
        {count > 99 ? '99+' : count}
      </span>
    ) : showDot ? (
      <span
        className="cb-sidebar-badge"
        style={{
          position: 'absolute',
          top: -2,
          left: -3,
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: colors.bg,
          boxShadow: `0 0 0 1px ${colors.ring}`,
          zIndex: 10
        }}
      />
    ) : null}
  </span>
)

const Sidebar: React.FC<SidebarProps> = ({ collapsed }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { moduleVisibility } = useSettingsStore()
  const t = useT()
  const { token } = theme.useToken()
  const attentionItems = useAttentionStore((s) => s.items)

  const counts = useMemo(() => {
    const count = (source: 'workbench' | 'ai-chat' | 'ai-coding'): number =>
      attentionItems.filter((i) => i.source === source).length
    return {
      workbench: count('workbench'),
      aiChat: count('ai-chat'),
      aiCoding: count('ai-coding')
    }
  }, [attentionItems])

  const badgeColors: BadgeColors = {
    bg: token.colorError,
    fg: token.colorTextLightSolid,
    ring: token.colorBgLayout
  }

  const allItems: (NonNullable<MenuProps['items']>[number] & { moduleKey?: string })[] = [
    {
      key: '/workbench',
      icon: withTopLeftBadge(<WorkbenchIcon />, badgeColors, counts.workbench > 0),
      label: t('menu.workbench')
    },
    {
      key: '/ai-chat',
      icon: withTopLeftBadge(<AIChatIcon />, badgeColors, counts.aiChat > 0),
      label: t('menu.aiChat'),
      moduleKey: 'aiChat'
    },
    {
      key: '/ai-coding',
      // AI Coding shows how many sessions are waiting on the user
      icon: withTopLeftBadge(<AICodingIcon />, badgeColors, false, counts.aiCoding),
      label: t('menu.aiCoding'),
      moduleKey: 'aiCoding'
    },
    {
      key: '/ai-terminal',
      icon: <AITerminalIcon />,
      label: t('menu.aiTerminal'),
      moduleKey: 'aiTerminal'
    },
    {
      key: '/ai-agents',
      icon: <OpenClawIcon />,
      label: t('menu.aiAgents'),
      moduleKey: 'aiAgents'
    },
    {
      key: '/local-env',
      icon: <LocalEnvIcon />,
      label: t('menu.localEnv'),
      moduleKey: 'localEnv'
    },
    {
      key: '/copiper',
      icon: <CopiperIcon />,
      label: t('menu.copiper'),
      moduleKey: 'copiper'
    }
  ]

  const menuItems: MenuProps['items'] = allItems
    .filter((item) => {
      if (!item.moduleKey) return true
      return moduleVisibility[item.moduleKey as keyof typeof moduleVisibility]
    })
    .map(({ moduleKey: _moduleKey, ...rest }) => rest)

  const selectedKey =
    allItems
      .map((item) => item?.key as string)
      .find((key) => location.pathname.startsWith(key)) ?? '/ai-chat'

  // Persist the active top-level route on every navigation (not just menu clicks)
  useEffect(() => {
    if (selectedKey && selectedKey !== '/') {
      // Store the actual pathname so routes like /workbench/installed restore correctly
      const route = selectedKey === '/workbench' ? '/workbench/installed' : selectedKey
      localStorage.setItem('lastRoute', route)
    }
  }, [selectedKey])

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === '/workbench') {
      navigate('/workbench/installed')
    } else {
      navigate(key)
    }
  }

  return (
    <Menu
      mode="inline"
      selectedKeys={[selectedKey]}
      items={menuItems}
      onClick={handleMenuClick}
      inlineCollapsed={collapsed}
      style={{ height: '100%', borderRight: 0 }}
    />
  )
}

export default Sidebar
