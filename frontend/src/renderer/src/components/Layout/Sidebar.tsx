import React, { useEffect, useMemo } from 'react'
import { Badge, Menu } from 'antd'
import {
  LaptopOutlined,
  CodeOutlined
} from '@ant-design/icons'
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

const withMenuDot = (label: string, showDot: boolean) =>
  showDot ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span>{label}</span>
      <Badge status="error" />
    </span>
  ) : (
    label
  )

const Sidebar: React.FC<SidebarProps> = ({ collapsed }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { moduleVisibility } = useSettingsStore()
  const t = useT()
  const attentionItems = useAttentionStore((s) => s.items)

  const dots = useMemo(() => {
    const has = (source: 'workbench' | 'ai-chat' | 'ai-coding') =>
      attentionItems.some((i) => i.source === source)
    return {
      workbench: has('workbench'),
      aiChat: has('ai-chat'),
      aiCoding: has('ai-coding')
    }
  }, [attentionItems])

  const allItems: (NonNullable<MenuProps['items']>[number] & { moduleKey?: string })[] = [
    {
      key: '/workbench',
      icon: (
        <Badge dot={dots.workbench} offset={[2, 0]}>
          <WorkbenchIcon />
        </Badge>
      ),
      label: withMenuDot(t('menu.workbench'), dots.workbench && !collapsed)
    },
    {
      key: '/ai-chat',
      icon: (
        <Badge dot={dots.aiChat} offset={[2, 0]}>
          <AIChatIcon />
        </Badge>
      ),
      label: withMenuDot(t('menu.aiChat'), dots.aiChat && !collapsed),
      moduleKey: 'aiChat'
    },
    {
      key: '/ai-coding',
      icon: (
        <Badge dot={dots.aiCoding} offset={[2, 0]}>
          <AICodingIcon />
        </Badge>
      ),
      label: withMenuDot(t('menu.aiCoding'), dots.aiCoding && !collapsed),
      moduleKey: 'aiCoding'
    },
    {
      key: '/ai-terminal',
      icon: <CodeOutlined />,
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
      icon: <LaptopOutlined />,
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
