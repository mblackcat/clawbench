import React from 'react'
import { Typography, Tag, Space, theme } from 'antd'
import Icon from '@ant-design/icons'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  TagOutlined,
  MessageOutlined
} from '@ant-design/icons'
import type { OpenClawNode } from '../../types/openclaw'
import { useT } from '../../i18n'

const BrainSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M13 3a5 5 0 0 1 4.36 2.56A4 4 0 0 1 20 9a4 4 0 0 1-1.19 2.83c.12.37.19.76.19 1.17a4 4 0 0 1-2 3.46V18a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-1.54A4 4 0 0 1 5 13c0-.41.07-.8.19-1.17A4 4 0 0 1 4 9a4 4 0 0 1 2.64-3.44A5 5 0 0 1 11 3c.7 0 1.38.14 2 .4A5 5 0 0 1 13 3z"/>
    <rect x="11" y="3" width="2" height="17" fill="rgba(0,0,0,0.18)" rx="1"/>
    <path fill="rgba(255,255,255,0.25)" d="M8 8.5C8.5 7.5 9.5 7 10.5 7.5M8 12c1-1 2-0.5 2.5.5M15.5 8.5C15 7.5 14 7 13 7.5M15.5 12c-1-1-2-0.5-2.5.5"/>
  </svg>
)
const BrainIcon = (props: any) => <Icon component={BrainSvg} {...props} />
const { Text } = Typography

interface NodeInfoPanelProps {
  node: OpenClawNode
  compact?: boolean
}

const NodeInfoPanel: React.FC<NodeInfoPanelProps> = ({ node, compact = false }) => {
  const { token } = theme.useToken()
  const t = useT()

  const statusConfig = {
    running: { label: t('agents.statusRunning'), icon: <CheckCircleOutlined />, color: token.colorSuccess },
    stopped: { label: t('agents.statusStopped'), icon: <CloseCircleOutlined />, color: token.colorError },
    unknown: { label: t('agents.statusUnknown'), icon: <QuestionCircleOutlined />, color: token.colorTextQuaternary }
  }

  const currentStatus = statusConfig[node.status] ?? statusConfig.unknown
  const cleanVersion = (v?: string) => (v || '').replace(/^v/, '')

  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <Space size={4} style={{ color: currentStatus.color }}>
          {currentStatus.icon}
          <span>{currentStatus.label}</span>
        </Space>
        {node.defaultModel && (
          <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{node.defaultModel}</Tag>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Version */}
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          <TagOutlined style={{ marginRight: 4 }} />{t('agents.version')}
        </Text>
        <Text style={{ fontSize: 14 }}>v{cleanVersion(node.version)}</Text>
      </div>

      {/* Status */}
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          {t('agents.runStatus')}
        </Text>
        <Space size={4} style={{ color: currentStatus.color, fontSize: 14 }}>
          {currentStatus.icon}
          <span>{currentStatus.label}</span>
        </Space>
      </div>

      {/* Default model */}
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          <BrainIcon style={{ marginRight: 4 }} />{t('agents.defaultModel')}
        </Text>
        {node.defaultModel ? (
          <Tag color="blue" style={{ margin: 0 }}>{node.defaultModel}</Tag>
        ) : (
          <Text type="secondary" style={{ fontSize: 13 }}>{t('agents.notConfigured')}</Text>
        )}
      </div>

      {/* Comm tools */}
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          <MessageOutlined style={{ marginRight: 4 }} />{t('agents.commTools')}
        </Text>
        {node.commTools.length > 0 ? (
          <Space size={4} wrap>
            {node.commTools.map((name) => (
              <Tag key={name} style={{ margin: 0 }}>{name}</Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary" style={{ fontSize: 13 }}>{t('agents.notConfigured')}</Text>
        )}
      </div>
    </div>
  )
}

export default NodeInfoPanel
