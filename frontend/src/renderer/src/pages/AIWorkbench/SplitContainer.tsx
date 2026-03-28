import React, { useCallback, useMemo, useRef } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import TabGroup from './TabGroup'
import { useAIWorkbenchStore } from '../../stores/useAIWorkbenchStore'
import type { LayoutNode } from '../../types/split-layout'

/** Generate a structural fingerprint for keying Allotment so it remounts on structure changes */
function layoutFingerprint(node: LayoutNode): string {
  if (node.type === 'leaf') return node.id
  return `${node.direction}[${node.children.map(layoutFingerprint).join(',')}]`
}

interface SplitContainerProps {
  layout: LayoutNode
  gitPanelOpen?: boolean
  onToggleGitPanel?: () => void
  path?: number[]
}

const SplitContainer: React.FC<SplitContainerProps> = ({
  layout, gitPanelOpen, onToggleGitPanel, path = [],
}) => {
  const focusedPaneId = useAIWorkbenchStore(s => s.focusedPaneId)
  const moveTab = useAIWorkbenchStore(s => s.moveTab)
  const splitPane = useAIWorkbenchStore(s => s.splitPane)
  const setSplitSizes = useAIWorkbenchStore(s => s.setSplitSizes)

  const dragRef = useRef<{ sessionId: string; fromPaneId: string } | null>(null)

  const handleTabDragStart = useCallback((sessionId: string, paneId: string) => {
    dragRef.current = { sessionId, fromPaneId: paneId }
  }, [])

  const handleTabDrop = useCallback((toPaneId: string) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (drag.fromPaneId === toPaneId) return
    moveTab(drag.fromPaneId, toPaneId, drag.sessionId)
  }, [moveTab])

  const handleEdgeDrop = useCallback((paneId: string, edge: 'left' | 'right' | 'top' | 'bottom') => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null

    const direction = (edge === 'left' || edge === 'right') ? 'horizontal' : 'vertical'
    splitPane(paneId, direction, drag.sessionId)
  }, [splitPane])

  const handleSizeChange = useCallback((sizes: number[]) => {
    setSplitSizes(path, sizes)
  }, [path, setSplitSizes])

  if (layout.type === 'leaf') {
    return (
      <TabGroup
        paneId={layout.id}
        tabIds={layout.tabIds}
        activeTabId={layout.activeTabId}
        onTabDragStart={handleTabDragStart}
        onTabDrop={handleTabDrop}
        onEdgeDrop={handleEdgeDrop}
        gitPanelOpen={gitPanelOpen}
        onToggleGitPanel={onToggleGitPanel}
        isFocused={focusedPaneId === layout.id}
      />
    )
  }

  // Key by structural fingerprint so Allotment remounts when children change
  const structKey = useMemo(() => layoutFingerprint(layout), [layout])

  return (
    <Allotment
      key={structKey}
      vertical={layout.direction === 'vertical'}
      defaultSizes={layout.sizes}
      onChange={handleSizeChange}
    >
      {layout.children.map((child, idx) => (
        <Allotment.Pane key={child.type === 'leaf' ? child.id : `split-${idx}`} minSize={120}>
          <SplitContainer
            layout={child}
            gitPanelOpen={gitPanelOpen}
            onToggleGitPanel={onToggleGitPanel}
            path={[...path, idx]}
          />
        </Allotment.Pane>
      ))}
    </Allotment>
  )
}

export default SplitContainer
