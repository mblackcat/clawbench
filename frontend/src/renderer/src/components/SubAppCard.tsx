import React from 'react'
import { Tag, Typography, Tooltip } from 'antd'
import { CaretRightOutlined } from '@ant-design/icons'
import type { SubAppManifest } from '../types/subapp'
import { AppIcon } from './AppIcon'
import { FolderCard } from './FolderCard'
import { useT } from '../i18n'

const { Text } = Typography

interface SubAppCardProps {
  manifest: SubAppManifest
  onRun: (appId: string) => void
  onDetail: (manifest: SubAppManifest) => void
}

const SubAppCard: React.FC<SubAppCardProps> = ({ manifest, onRun, onDetail }) => {
  const { id, name, version, description, icon } = manifest
  const t = useT()

  return (
    <FolderCard
      style={{ cursor: 'pointer' }}
      onClick={() => onDetail(manifest)}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 32,
          width: 'calc(100% - 74px)'
        }}
      >
        <AppIcon icon={icon} name={name} category={manifest.category} size={28} />
        <Tooltip title={name}>
          <Text strong ellipsis style={{ fontSize: 13, lineHeight: '20px' }}>
            {name}
          </Text>
        </Tooltip>
      </div>

      <div
        className="cb-card-desc"
        style={{
          fontSize: 12,
          lineHeight: '18px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          margin: '6px 0 6px 0'
        }}
      >
        {description || t('workbench.noDesc')}
      </div>

      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 8
        }}
      >
        <Tag className="card-ver" style={{ margin: 0, fontSize: 10, lineHeight: '16px', height: 18, padding: '0 5px' }}>
          v{version}
        </Tag>
        <Tooltip title={t('workbench.run')}>
          <button
            type="button"
            className="cb-round-action-btn cb-round-action-primary"
            onClick={(e) => {
              e.stopPropagation()
              onRun(id)
            }}
          >
            <CaretRightOutlined style={{ fontSize: 14, marginLeft: 2 }} />
          </button>
        </Tooltip>
      </div>
    </FolderCard>
  )
}

export default SubAppCard
