/**
 * 项目导航栏 — 工作台首页置顶第一行，Chrome 收藏夹样式。
 *
 * 顺序、分组、标题、图标全部由后端项目配置决定；分组渲染成文件夹，
 * 点击展开下拉。任何条目点击都走系统默认浏览器打开，并上报点击次数。
 */

import React, { useMemo, useState } from 'react'
import { Dropdown, Tooltip, theme, Typography } from 'antd'
import { FolderOutlined, LinkOutlined, DownOutlined } from '@ant-design/icons'
import type { NavGroup, NavLink } from '../types/api'
import { useProjectNavStore } from '../stores/useProjectNavStore'
import { openExternalLink } from '../utils/markdown-links'
import { useT } from '../i18n'

const { Text } = Typography

/** 图标加载失败时回退到通用链接图标 */
const NavIcon: React.FC<{
  src?: string | null
  fallback: React.ReactNode
  size?: number
}> = ({ src, fallback, size = 16 }) => {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return <span style={{ fontSize: size - 2, lineHeight: 1 }}>{fallback}</span>
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: 3, objectFit: 'contain', flexShrink: 0 }}
      onError={() => setFailed(true)}
    />
  )
}

interface ItemProps {
  title: string
  icon: React.ReactNode
  onClick: () => void
  /** 分组项右侧展示折叠箭头 */
  suffix?: React.ReactNode
  tooltip?: string
}

const BarItem: React.FC<ItemProps> = ({ title, icon, onClick, suffix, tooltip }) => {
  const { token } = theme.useToken()

  const content = (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 180,
        padding: '4px 10px',
        borderRadius: token.borderRadiusSM,
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorder}`,
        boxShadow: token.boxShadowSecondary,
        cursor: 'pointer'
      }}
    >
      {icon}
      <Text
        style={{
          fontSize: 13,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {title}
      </Text>
      {suffix}
    </div>
  )

  return tooltip ? <Tooltip title={tooltip}>{content}</Tooltip> : content
}

const NavBookmarkBar: React.FC = () => {
  const { token } = theme.useToken()
  const t = useT()
  const groups = useProjectNavStore((s) => s.groups)
  const links = useProjectNavStore((s) => s.links)
  const recordClick = useProjectNavStore((s) => s.recordClick)

  /** 按分组归类，顶层链接单独一组 */
  const { topLevel, linksByGroup } = useMemo(() => {
    const byGroup = new Map<string, NavLink[]>()
    const top: NavLink[] = []
    for (const link of links) {
      if (link.groupId) {
        const list = byGroup.get(link.groupId)
        if (list) {
          list.push(link)
        } else {
          byGroup.set(link.groupId, [link])
        }
      } else {
        top.push(link)
      }
    }
    return { topLevel: top, linksByGroup: byGroup }
  }, [links])

  const handleOpen = (link: NavLink): void => {
    recordClick(link.linkId)
    openExternalLink(link.url)
  }

  /** 只展示有内容的分组，避免出现点开是空的文件夹 */
  const visibleGroups = useMemo(
    () => groups.filter((g) => (linksByGroup.get(g.groupId)?.length ?? 0) > 0),
    [groups, linksByGroup]
  )

  if (topLevel.length === 0 && visibleGroups.length === 0) {
    return null
  }

  const renderGroup = (group: NavGroup): React.ReactNode => {
    const groupLinks = linksByGroup.get(group.groupId) ?? []
    return (
      <Dropdown
        key={group.groupId}
        trigger={['click']}
        menu={{
          items: groupLinks.map((link) => ({
            key: link.linkId,
            icon: <NavIcon src={link.icon} fallback={<LinkOutlined />} size={16} />,
            label: (
              <span style={{ maxWidth: 240, display: 'inline-block' }} title={link.url}>
                {link.title}
              </span>
            ),
            onClick: () => handleOpen(link)
          }))
        }}
      >
        <div>
          <BarItem
            title={group.title}
            icon={<NavIcon src={group.icon} fallback={<FolderOutlined />} size={16} />}
            suffix={<DownOutlined style={{ fontSize: 9, color: token.colorTextQuaternary }} />}
            onClick={() => {
              /* 点击由 Dropdown 接管 */
            }}
            tooltip={t('nav.folderTooltip', String(groupLinks.length))}
          />
        </div>
      </Dropdown>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        padding: '6px 10px',
        marginBottom: 16,
        borderRadius: token.borderRadius,
        background: token.colorFillQuaternary,
        border: `1px solid ${token.colorBorderSecondary}`
      }}
    >
      {topLevel.map((link) => (
        <BarItem
          key={link.linkId}
          title={link.title}
          icon={<NavIcon src={link.icon} fallback={<LinkOutlined />} size={16} />}
          onClick={() => handleOpen(link)}
          tooltip={link.url}
        />
      ))}
      {visibleGroups.map(renderGroup)}
    </div>
  )
}

export default NavBookmarkBar
