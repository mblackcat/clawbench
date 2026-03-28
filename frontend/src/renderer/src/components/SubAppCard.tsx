import React from 'react'
import { Tag, Typography, Tooltip, theme } from 'antd'
import { PlayCircleOutlined } from '@ant-design/icons'
import type { SubAppManifest } from '../types/subapp'

const { Text } = Typography

interface SubAppCardProps {
  manifest: SubAppManifest
  onRun: (appId: string) => void
  onDetail: (manifest: SubAppManifest) => void
}

const SubAppCard: React.FC<SubAppCardProps> = ({ manifest, onRun, onDetail }) => {
  const { id, name, version } = manifest
  const { token } = theme.useToken()

  return (
    <div
      className="cb-glass-card"
      style={{
        cursor: 'pointer'
      }}
    >
      <div
        onClick={() => onDetail(manifest)}
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          flex: 1
        }}
      >
        <Tooltip title={name}>
          <Text strong ellipsis style={{ maxWidth: 160 }}>
            {name}
          </Text>
        </Tooltip>
        <Tag style={{ margin: 0, flexShrink: 0 }}>v{version}</Tag>
      </div>
      <div
        onClick={(e) => { e.stopPropagation(); onRun(id) }}
        style={{
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          color: token.colorPrimary,
          fontWeight: 500,
          fontSize: 13
        }}
      >
        <PlayCircleOutlined /> 运行
      </div>
    </div>
  )
}

export default SubAppCard
