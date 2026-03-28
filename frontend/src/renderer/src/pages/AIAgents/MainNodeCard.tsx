import React, { useRef, useState, useEffect } from 'react'
import { Tag, theme } from 'antd'
import type { OpenClawNode } from '../../types/openclaw'
import AgentLobsterScene from './AgentLobsterScene'
import NodeInfoPanel from './NodeInfoPanel'
import { useT } from '../../i18n'

interface MainNodeCardProps {
  node: OpenClawNode
}

const MainNodeCard: React.FC<MainNodeCardProps> = ({ node }) => {
  const { token } = theme.useToken()
  const t = useT()
  const sceneContainerRef = useRef<HTMLDivElement>(null)
  const [sceneSize, setSceneSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = sceneContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSceneSize({ width: Math.floor(width), height: Math.floor(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      style={{
        background: token.colorBgLayout,
        borderRadius: token.borderRadiusLG,
        padding: 16,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}
    >
      {/* Node tag */}
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 3 }}>
        <Tag color={node.isLocal ? 'blue' : 'default'}>
          {node.isLocal ? t('agents.tagLocal') : node.hostname}
        </Tag>
      </div>

      {/* Main content: lobster scene + info panel */}
      <div style={{ display: 'flex', flex: 1, gap: 16, minHeight: 0 }}>
        {/* Left: Lobster scene */}
        <div
          ref={sceneContainerRef}
          style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}
        >
          {sceneSize.width > 0 && (
            <AgentLobsterScene
              agents={node.agents}
              containerWidth={sceneSize.width}
              containerHeight={sceneSize.height}
            />
          )}
        </div>

        {/* Right: Info panel */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minWidth: 0,
            paddingRight: 8
          }}
        >
          <NodeInfoPanel node={node} />
        </div>
      </div>
    </div>
  )
}

export default MainNodeCard
