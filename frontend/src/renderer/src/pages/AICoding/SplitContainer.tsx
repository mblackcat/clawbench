import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { Allotment } from 'allotment'
import type { AllotmentHandle } from 'allotment'
import 'allotment/dist/style.css'
import TabGroup from './TabGroup'
import { useAICodingStore } from '../../stores/useAICodingStore'
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

/**
 * Sizes are only usable when they line up with the pane count. Scale them to
 * the container's current extent — persisted pixel sizes from another window
 * width (or a pruned pane) would otherwise leave a blank strip until resize.
 */
function fitSizes(
  sizes: number[] | undefined,
  paneCount: number,
  containerSize: number
): number[] | undefined {
  if (!sizes || sizes.length !== paneCount) return undefined
  const total = sizes.reduce((a, b) => a + b, 0)
  if (!(total > 0) || !(containerSize > 0)) return undefined
  return sizes.map(s => (s / total) * containerSize)
}

/** After mount / route re-entry, re-apply sizes once the flex parent has a real box. */
function useAllotmentRemeasure(
  allotmentRef: React.RefObject<AllotmentHandle | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  sizesRef: React.RefObject<number[] | undefined>,
  paneCount: number,
  vertical: boolean,
  remountKey: string
): void {
  useEffect(() => {
    const remeasure = (): void => {
      const handle = allotmentRef.current
      const el = containerRef.current
      if (!handle || !el) return
      const extent = vertical ? el.clientHeight : el.clientWidth
      if (extent <= 0) return
      const sizes = fitSizes(sizesRef.current ?? undefined, paneCount, extent)
      if (sizes) {
        try {
          handle.resize(sizes)
          return
        } catch {
          // fall through to reset
        }
      }
      try {
        handle.reset()
      } catch {
        // allotment may not be ready yet
      }
    }
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(remeasure)
    })
    const t1 = window.setTimeout(remeasure, 50)
    const t2 = window.setTimeout(remeasure, 200)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
    // Only re-run on mount / structural change — not when onChange writes sizes
    // back into the store (that would loop resize → onChange → resize).
  }, [allotmentRef, containerRef, sizesRef, paneCount, vertical, remountKey])
}

const SplitContainer: React.FC<SplitContainerProps> = ({
  layout, gitPanelOpen, onToggleGitPanel, path = [],
}) => {
  const focusedPaneId = useAICodingStore(s => s.focusedPaneId)
  const moveTab = useAICodingStore(s => s.moveTab)
  const splitPane = useAICodingStore(s => s.splitPane)
  const setSplitSizes = useAICodingStore(s => s.setSplitSizes)

  const dragRef = useRef<{ sessionId: string; fromPaneId: string } | null>(null)
  const allotmentRef = useRef<AllotmentHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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

  // Key by structural fingerprint so Allotment remounts when children change.
  // Must run before the leaf early-return so hook order is stable.
  const structKey = useMemo(() => layoutFingerprint(layout), [layout])
  const layoutSizesRef = useRef<number[] | undefined>(undefined)
  layoutSizesRef.current = layout.type === 'split' ? layout.sizes : undefined
  const paneCount = layout.type === 'split' ? layout.children.length : 0
  const vertical = layout.type === 'split' && layout.direction === 'vertical'
  useAllotmentRemeasure(allotmentRef, containerRef, layoutSizesRef, paneCount, vertical, structKey)

  if (layout.type === 'leaf') {
    return (
      <div style={{ height: '100%', width: '100%', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
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
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ height: '100%', width: '100%', minHeight: 0, minWidth: 0 }}>
      <Allotment
        ref={allotmentRef}
        key={structKey}
        vertical={layout.direction === 'vertical'}
        defaultSizes={layout.sizes?.length === layout.children.length ? layout.sizes : undefined}
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
    </div>
  )
}

export default SplitContainer
