import React from 'react'
import { Tag, Space, theme } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import type { OpenClawNode } from '../../types/openclaw'
import LobsterSVG from './LobsterSVG'
import { useT } from '../../i18n'

interface SubNodeCardProps {
  node: OpenClawNode
}

const SubNodeCard: React.FC<SubNodeCardProps> = ({ node }) => {
  const { token } = theme.useToken()
  const t = useT()

  const statusConfig = {
    running: { label: t('agents.statusRunning'), icon: <CheckCircleOutlined />, color: token.colorSuccess },
    stopped: { label: t('agents.statusStopped'), icon: <CloseCircleOutlined />, color: token.colorError },
    unknown: { label: t('agents.statusUnknown'), icon: <QuestionCircleOutlined />, color: token.colorTextQuaternary }
  }

  const st = statusConfig[node.status] ?? statusConfig.unknown
  const mainAgent = node.agents.find((a) => a.role === 'main')
  const lobsterState = mainAgent?.state ?? 'idle'

  return (
    <div
      style={{
        background: token.colorBgLayout,
        borderRadius: token.borderRadiusLG,
        padding: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 12
      }}
    >
      {/* Small lobster */}
      <div style={{ flexShrink: 0 }}>
        <LobsterSVG state={lobsterState} size={56} variant="sub" />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Tag color="default" style={{ margin: 0, fontSize: 11 }}>{node.hostname}</Tag>
          <Space size={4} style={{ color: st.color, fontSize: 12 }}>
            {st.icon}
            <span>{st.label}</span>
          </Space>
        </div>
        {node.defaultModel && (
          <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{node.defaultModel}</Tag>
        )}
      </div>
    </div>
  )
}

export default SubNodeCard
