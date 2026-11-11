import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSessionRowMenuItems } from '../AICodingSidebar'
import { useAICodingStore } from '../../../stores/useAICodingStore'
import type { LeafNode } from '../../../types/split-layout'

describe('AICoding session context menu & tab auto-closing', () => {
  beforeEach(() => {
    localStorage.clear()
    useAICodingStore.setState({
      sessions: [],
      globalLayout: null,
      activeSessionId: null,
      focusedPaneId: null
    })
  })

  it('builds context menu items with delete option and danger styling', () => {
    const onTogglePin = vi.fn()
    const onArchive = vi.fn()
    const onDelete = vi.fn()

    const items = createSessionRowMenuItems({
      isPinned: false,
      onTogglePin,
      onArchive,
      onDelete,
      pinLabel: '置顶',
      unpinLabel: '取消置顶',
      archiveLabel: '归档',
      deleteLabel: '删除会话'
    })

    expect(items).toHaveLength(5)
    expect(items[0]).toMatchObject({ key: 'pin', label: '置顶' })
    expect(items[1]).toMatchObject({ type: 'divider' })
    expect(items[2]).toMatchObject({ key: 'archive', label: '归档' })
    expect(items[3]).toMatchObject({ type: 'divider' })
    expect(items[4]).toMatchObject({ key: 'delete', label: '删除会话', danger: true })

    // Verify click triggers
    const deleteItem = items[4] as { onClick?: () => void }
    deleteItem.onClick?.()
    expect(onDelete).toHaveBeenCalledTimes(1)

    const archiveItem = items[2] as { onClick?: () => void }
    archiveItem.onClick?.()
    expect(onArchive).toHaveBeenCalledTimes(1)
  })

  it('closeSessionTabs closes the tab and switches activeSessionId to the next tab', async () => {
    const paneId = 'pane-test-1'
    const leaf: LeafNode = {
      type: 'leaf',
      id: paneId,
      tabIds: ['sess-1', 'sess-2'],
      activeTabId: 'sess-1'
    }

    useAICodingStore.setState({
      globalLayout: leaf,
      activeSessionId: 'sess-1',
      focusedPaneId: paneId
    })

    // Auto-close sess-1
    await useAICodingStore.getState().closeSessionTabs('sess-1')

    const state = useAICodingStore.getState()
    const updatedLeaf = state.globalLayout as LeafNode
    expect(updatedLeaf.type).toBe('leaf')
    expect(updatedLeaf.tabIds).toEqual(['sess-2'])
    expect(updatedLeaf.activeTabId).toBe('sess-2')
    expect(state.activeSessionId).toBe('sess-2')
  })

  it('closeSessionTabs handles closing the last tab in the layout', async () => {
    const paneId = 'pane-test-single'
    const leaf: LeafNode = {
      type: 'leaf',
      id: paneId,
      tabIds: ['sess-only'],
      activeTabId: 'sess-only'
    }

    useAICodingStore.setState({
      globalLayout: leaf,
      activeSessionId: 'sess-only',
      focusedPaneId: paneId
    })

    await useAICodingStore.getState().closeSessionTabs('sess-only')

    const state = useAICodingStore.getState()
    const updatedLeaf = state.globalLayout as LeafNode
    expect(updatedLeaf.tabIds).toEqual([])
    expect(updatedLeaf.activeTabId).toBeNull()
    expect(state.activeSessionId).toBeNull()
  })
})
