import React, { useState, useCallback, useRef } from 'react'
import { theme } from 'antd'
import type { OpenClawAgent, LobsterAnimationState } from '../../types/openclaw'
import LobsterSVG from './LobsterSVG'

interface AgentLobsterSceneProps {
  agents: OpenClawAgent[]
  containerWidth: number
  containerHeight: number
}

const SCRATCH_DURATION_MS = 1800
const DIVIDER_W = 1
const SUB_GAP = 8
const SUB_PADDING = 12

const AgentLobsterScene: React.FC<AgentLobsterSceneProps> = ({
  agents,
  containerWidth,
  containerHeight
}) => {
  const { token } = theme.useToken()
  const mainAgent = agents.find((a) => a.role === 'main')
  const subAgents = agents.filter((a) => a.role === 'sub')
  const hasSubAgents = subAgents.length > 0

  const [scratching, setScratching] = useState(false)
  const scratchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scratchingSubId, setScratchingSubId] = useState<string | null>(null)
  const subScratchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMainClick = useCallback(() => {
    if (mainAgent?.state !== 'idle') return
    if (scratching) return
    setScratching(true)
    if (scratchTimer.current) clearTimeout(scratchTimer.current)
    scratchTimer.current = setTimeout(() => setScratching(false), SCRATCH_DURATION_MS)
  }, [mainAgent?.state, scratching])

  const handleSubClick = useCallback((id: string, state: string) => {
    if (state !== 'idle') return
    if (scratchingSubId === id) return
    setScratchingSubId(id)
    if (subScratchTimer.current) clearTimeout(subScratchTimer.current)
    subScratchTimer.current = setTimeout(() => setScratchingSubId(null), SCRATCH_DURATION_MS)
  }, [scratchingSubId])

  if (!mainAgent) return null

  const displayState: LobsterAnimationState =
    scratching && mainAgent.state === 'idle' ? 'scratching' : mainAgent.state

  // ── Horizontal split layout ──────────────────────────────────────────────
  // Main section: 1/3 width | Divider | Sub section: 2/3 width
  const mainSectionW = hasSubAgents ? Math.floor(containerWidth / 2) : containerWidth
  const subSectionW = containerWidth - mainSectionW - DIVIDER_W

  const mainSize = hasSubAgents
    ? Math.min(mainSectionW * 0.82, containerHeight * 0.78)
    : Math.min(containerWidth * 0.6, containerHeight * 0.85)

  const subSize = Math.round(mainSize * 0.5)

  // Per-row capacity in the sub section
  const cellW = subSize + SUB_GAP
  const perRow = Math.max(1, Math.floor((subSectionW - SUB_PADDING) / cellW))
  const maxVisible = perRow * 2
  const hiddenCount = Math.max(0, subAgents.length - maxVisible)
  // If overflow, sacrifice the last slot for the "+N" badge
  const sliceEnd = hiddenCount > 0 ? maxVisible - 1 : maxVisible
  const visibleSubs = subAgents.slice(0, sliceEnd)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'hidden'
      }}
    >
      {/* ── Main agent ── */}
      <div
        style={{
          width: mainSectionW,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%'
        }}
      >
        <div
          style={{ cursor: mainAgent.state === 'idle' ? 'pointer' : 'default' }}
          onClick={handleMainClick}
          title={mainAgent.state === 'idle' ? '点我！' : undefined}
        >
          <LobsterSVG state={displayState} size={mainSize} variant="main" />
        </div>
      </div>

      {/* ── Vertical divider ── */}
      {hasSubAgents && (
        <div
          style={{
            width: DIVIDER_W,
            alignSelf: 'stretch',
            margin: '16px 0',
            background: token.colorBorderSecondary,
            flexShrink: 0,
            borderRadius: 1
          }}
        />
      )}

      {/* ── Sub-agents grid ── */}
      {hasSubAgents && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexWrap: 'wrap',
            alignContent: 'center',
            alignItems: 'center',
            gap: SUB_GAP,
            padding: `0 ${SUB_PADDING}px`,
            height: '100%',
            overflow: 'hidden'
          }}
        >
          {visibleSubs.map((agent) => {
            const subState: LobsterAnimationState =
              scratchingSubId === agent.id && agent.state === 'idle' ? 'scratching' : agent.state
            return (
              <div
                key={agent.id}
                style={{ opacity: 0.85, cursor: agent.state === 'idle' ? 'pointer' : 'default' }}
                onClick={() => handleSubClick(agent.id, agent.state)}
                title={agent.state === 'idle' ? '点我！' : undefined}
              >
                <LobsterSVG state={subState} size={subSize} variant="sub" />
              </div>
            )
          })}

          {/* "+N more" badge */}
          {hiddenCount > 0 && (
            <div
              title={`还有 ${hiddenCount} 个子 Agent`}
              style={{
                width: subSize,
                height: subSize,
                borderRadius: '50%',
                background: token.colorFillSecondary,
                border: `1.5px dashed ${token.colorBorderSecondary}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: token.colorTextTertiary,
                fontSize: Math.max(11, subSize * 0.2),
                fontWeight: 600,
                lineHeight: 1.2,
                userSelect: 'none',
                flexShrink: 0
              }}
            >
              <span>+{hiddenCount}</span>
              <span style={{ fontSize: Math.max(9, subSize * 0.14), fontWeight: 400 }}>more</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AgentLobsterScene
