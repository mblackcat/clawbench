import React from 'react'
import { Tag, Typography, theme, Tooltip, Space } from 'antd'
import {
  DownloadOutlined,
  StarOutlined,
  UserOutlined,
  TagOutlined,
  LinkOutlined,
  CloudDownloadOutlined
} from '@ant-design/icons'
import type { CommunitySkill } from '../../types/openclaw'
import { useT } from '../../i18n'

const { Text } = Typography

interface CommunitySkillCardProps {
  skill: CommunitySkill
}

const formatCount = (n: number) => {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

const CommunitySkillCard: React.FC<CommunitySkillCardProps> = ({ skill }) => {
  const { token } = theme.useToken()
  const t = useT()

  return (
    <div
      className="cb-glass-card"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>

        {/* Row 1: Title + install action */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <Text strong style={{ fontSize: 14, lineHeight: '20px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {skill.name}
          </Text>
        </div>

        {/* Row 2: Meta — category, version, author */}
        <Space size={4} wrap style={{ rowGap: 4 }}>
          {skill.category && (
            <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
              <TagOutlined style={{ marginRight: 2 }} />{skill.category}
            </Tag>
          )}
          {(skill.tags || []).slice(0, 2).map((tag) => (
            <Tag key={tag} style={{ margin: 0, fontSize: 11 }}>{tag}</Tag>
          ))}
          {skill.version && (
            <Tag style={{ margin: 0, fontSize: 11 }}>v{skill.version}</Tag>
          )}
          {skill.author && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              <UserOutlined style={{ marginRight: 3 }} />{skill.author}
            </Text>
          )}
        </Space>

        {/* Row 3: Description */}
        <Tooltip title={skill.description}>
          <Text
            type="secondary"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              fontSize: 12,
              lineHeight: '18px',
              minHeight: 36
            }}
          >
            {skill.description || t('agents.noDescription')}
          </Text>
        </Tooltip>

        {/* Row 4: Detail link */}
        {skill.detailUrl && (
          <Text
            style={{ fontSize: 12, color: token.colorPrimary, cursor: 'pointer' }}
            onClick={() => window.open(skill.detailUrl)}
          >
            <LinkOutlined style={{ marginRight: 4 }} />{t('agents.viewDetail')}
          </Text>
        )}
      </div>

      {/* Footer: stats */}
      <div
        style={{
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 14
        }}
      >
        <Tooltip title={t('agents.totalInstalls')}>
          <Text type="secondary" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
            <CloudDownloadOutlined />
            {formatCount(skill.installsAllTime)}
          </Text>
        </Tooltip>
        <Tooltip title={t('agents.downloads')}>
          <Text type="secondary" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
            <DownloadOutlined />
            {formatCount(skill.downloads)}
          </Text>
        </Tooltip>
        <Tooltip title={t('agents.stars')}>
          <Text type="secondary" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
            <StarOutlined />
            {formatCount(skill.stars)}
          </Text>
        </Tooltip>
      </div>
    </div>
  )
}

export default CommunitySkillCard

