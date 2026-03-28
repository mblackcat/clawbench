# AI Workbench Split Layout + Tab Restructure — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the AI Workbench so that each session tab shows its own tool icon + history + close button, fixed [+] and [>_] buttons are pinned left of tabs, and sessions can be arranged in arbitrary split pane layouts.

**Architecture:** A recursive `LayoutNode` tree (split or leaf) stored in Zustand drives a `SplitContainer` component that uses `allotment` for resizable nested panes. Each leaf pane renders a `TabGroup` with its own tab bar and active session content. Drag-and-drop (HTML5 API) and right-click context menus enable splitting and moving tabs between panes.

**Tech Stack:** React 18, TypeScript, Zustand, allotment, @ant-design/icons, Ant Design v5, existing @dnd-kit (for reference but using HTML5 drag for tabs)

**Spec:** `docs/superpowers/specs/2026-03-21-workbench-split-tabs-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `frontend/src/renderer/src/types/split-layout.ts` | `LayoutNode`, `SplitNode`, `LeafNode` type definitions + tree utility functions |
| Create | `frontend/src/renderer/src/pages/AIWorkbench/SplitContainer.tsx` | Recursive renderer: SplitNode → `<Allotment>`, LeafNode → `<TabGroup>` |
| Create | `frontend/src/renderer/src/pages/AIWorkbench/TabGroup.tsx` | Pane component: tab bar (fixed buttons + scrollable tabs) + session content |
| Create | `frontend/src/renderer/src/pages/AIWorkbench/PaneTabBar.tsx` | Tab bar UI: [+][>_] | [tabs...] with drag, right-click, history dropdown |
| Modify | `frontend/src/renderer/src/stores/useAIWorkbenchStore.ts` | Add `splitLayouts`, `focusedPaneId`, and layout mutation actions |
| Modify | `frontend/src/renderer/src/pages/AIWorkbench/AIWorkbenchPage.tsx` | Replace single-session rendering with `<SplitContainer>` |
| Modify | `frontend/src/renderer/src/pages/AIWorkbench/WorkbenchChatPanel.tsx` | Remove `<WorkbenchTopBar>` usage (tab bar now external) |
| Modify | `frontend/src/renderer/src/pages/AIWorkbench/WorkbenchTerminalView.tsx` | Remove `<WorkbenchTopBar>` usage (tab bar now external) |
| Delete | `frontend/src/renderer/src/pages/AIWorkbench/WorkbenchTopBar.tsx` | Replaced by `PaneTabBar` |

---

## Chunk 1: Foundation — Types + Store

### Task 1: Install allotment

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install allotment**

```bash
cd frontend && npm install allotment
```

- [ ] **Step 2: Verify installation**

```bash
cd frontend && node -e "require('allotment')" && echo "OK"
```

- [ ] **Step 3: Commit**

```bash
cd frontend && git add package.json package-lock.json && git commit -m "chore: install allotment for split pane layout"
```

---

### Task 2: Create split layout types and tree utilities

**Files:**
- Create: `frontend/src/renderer/src/types/split-layout.ts`

- [ ] **Step 1: Create the type definitions and utility functions**

```typescript
// frontend/src/renderer/src/types/split-layout.ts

export type SplitDirection = 'horizontal' | 'vertical'

export interface SplitNode {
  type: 'split'
  direction: SplitDirection
  children: LayoutNode[]
  sizes?: number[]
}

export interface LeafNode {
  type: 'leaf'
  id: string
  tabIds: string[]       // session IDs
  activeTabId: string | null
}

export type LayoutNode = SplitNode | LeafNode

// ── Tree utilities ──

let _paneCounter = 0
export function genPaneId(): string {
  return `pane-${Date.now()}-${++_paneCounter}`
}

/** Create a default single-pane layout */
export function createDefaultLayout(sessionIds: string[]): LeafNode {
  return {
    type: 'leaf',
    id: genPaneId(),
    tabIds: [...sessionIds],
    activeTabId: sessionIds[0] || null,
  }
}

/** Find a leaf node by pane ID */
export function findLeaf(node: LayoutNode, paneId: string): LeafNode | null {
  if (node.type === 'leaf') return node.id === paneId ? node : null
  for (const child of node.children) {
    const found = findLeaf(child, paneId)
    if (found) return found
  }
  return null
}

/** Find which leaf contains a given session ID */
export function findLeafBySessionId(node: LayoutNode, sessionId: string): LeafNode | null {
  if (node.type === 'leaf') return node.tabIds.includes(sessionId) ? node : null
  for (const child of node.children) {
    const found = findLeafBySessionId(child, sessionId)
    if (found) return found
  }
  return null
}

/** Collect all leaf nodes */
export function collectLeaves(node: LayoutNode): LeafNode[] {
  if (node.type === 'leaf') return [node]
  return node.children.flatMap(collectLeaves)
}

/** Deep-clone and replace a leaf node by ID with a new node */
export function replaceNode(root: LayoutNode, paneId: string, replacement: LayoutNode): LayoutNode {
  if (root.type === 'leaf') {
    return root.id === paneId ? replacement : root
  }
  return {
    ...root,
    children: root.children.map(child => replaceNode(child, paneId, replacement)),
  }
}

/** Remove a leaf from the tree by pane ID, collapsing single-child splits */
export function removeLeaf(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.type === 'leaf') {
    return root.id === paneId ? null : root
  }
  const newChildren = root.children
    .map(child => removeLeaf(child, paneId))
    .filter((c): c is LayoutNode => c !== null)
  if (newChildren.length === 0) return null
  if (newChildren.length === 1) return newChildren[0]
  return { ...root, children: newChildren }
}

/**
 * Update a leaf node in-place (immutably).
 * Returns a new tree with the leaf replaced by updater result.
 */
export function updateLeaf(
  root: LayoutNode,
  paneId: string,
  updater: (leaf: LeafNode) => LeafNode
): LayoutNode {
  if (root.type === 'leaf') {
    return root.id === paneId ? updater(root) : root
  }
  return {
    ...root,
    children: root.children.map(child => updateLeaf(child, paneId, updater)),
  }
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd frontend && npx tsc --noEmit src/renderer/src/types/split-layout.ts 2>&1 | head -20
```

If tsc can't resolve the file alone, run the full typecheck:

```bash
cd frontend && npm run typecheck 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/renderer/src/types/split-layout.ts && git commit -m "feat: add split layout types and tree utilities"
```

---

### Task 3: Add split layout state to the Zustand store

**Files:**
- Modify: `frontend/src/renderer/src/stores/useAIWorkbenchStore.ts`

This task adds the layout state and actions to the existing store. The layout is keyed per workspace ID.

- [ ] **Step 1: Add imports at the top of useAIWorkbenchStore.ts**

Add after the existing type imports (line ~7):

```typescript
import type { LayoutNode, LeafNode, SplitDirection } from '../types/split-layout'
import {
  genPaneId, createDefaultLayout, findLeaf, findLeafBySessionId,
  collectLeaves, replaceNode, removeLeaf, updateLeaf
} from '../types/split-layout'
```

- [ ] **Step 2: Add new state fields to the interface**

Add these fields to `AIWorkbenchState` interface (after `sessionPendingQuestions`):

```typescript
  // Split layout state (keyed by workspace ID)
  splitLayouts: Record<string, LayoutNode>
  focusedPaneId: string | null
  // Layout actions
  getOrCreateLayout: (workspaceId: string) => LayoutNode
  splitPane: (workspaceId: string, paneId: string, direction: SplitDirection, sessionId?: string) => void
  closePane: (workspaceId: string, paneId: string) => void
  moveTab: (workspaceId: string, fromPaneId: string, toPaneId: string, sessionId: string) => void
  setPaneActiveTab: (workspaceId: string, paneId: string, sessionId: string) => void
  addTabToPane: (workspaceId: string, paneId: string, sessionId: string) => void
  removeTabFromPane: (workspaceId: string, paneId: string, sessionId: string) => void
  setFocusedPane: (paneId: string) => void
  setSplitSizes: (workspaceId: string, path: number[], sizes: number[]) => void
```

- [ ] **Step 3: Add initial state values**

Add in the `create()` initializer (after `sessionPendingQuestions: {}`):

```typescript
  splitLayouts: {},
  focusedPaneId: null,
```

- [ ] **Step 4: Implement the layout actions**

Add these implementations after the `answerQuestion` action:

```typescript
  getOrCreateLayout: (workspaceId) => {
    const { splitLayouts, sessions } = get()
    if (splitLayouts[workspaceId]) return splitLayouts[workspaceId]
    const wsSessions = sessions.filter(s => s.workspaceId === workspaceId)
    const layout = createDefaultLayout(wsSessions.map(s => s.id))
    set(s => ({ splitLayouts: { ...s.splitLayouts, [workspaceId]: layout } }))
    return layout
  },

  splitPane: (workspaceId, paneId, direction, sessionId) => {
    const { splitLayouts, sessions } = get()
    const root = splitLayouts[workspaceId]
    if (!root) return
    const leaf = findLeaf(root, paneId)
    if (!leaf) return

    const newLeaf: LeafNode = {
      type: 'leaf',
      id: genPaneId(),
      tabIds: sessionId ? [sessionId] : [],
      activeTabId: sessionId || null,
    }

    // If splitting with an existing tab from this pane, remove it from source
    let updatedOriginal = leaf
    if (sessionId && leaf.tabIds.includes(sessionId)) {
      const newTabIds = leaf.tabIds.filter(id => id !== sessionId)
      updatedOriginal = {
        ...leaf,
        tabIds: newTabIds,
        activeTabId: newTabIds[0] || null,
      }
    }

    const splitNode: LayoutNode = {
      type: 'split',
      direction,
      children: [updatedOriginal, newLeaf],
    }

    const newRoot = replaceNode(root, paneId, splitNode)
    set(s => ({ splitLayouts: { ...s.splitLayouts, [workspaceId]: newRoot }, focusedPaneId: newLeaf.id }))
    _persistLayout(workspaceId, newRoot)
  },

  closePane: (workspaceId, paneId) => {
    const { splitLayouts } = get()
    const root = splitLayouts[workspaceId]
    if (!root) return
    const newRoot = removeLeaf(root, paneId)
    if (!newRoot) {
      // All panes closed — reset to empty leaf
      const empty = createDefaultLayout([])
      set(s => ({ splitLayouts: { ...s.splitLayouts, [workspaceId]: empty }, focusedPaneId: empty.id }))
      _persistLayout(workspaceId, empty)
      return
    }
    // Focus the first remaining leaf
    const leaves = collectLeaves(newRoot)
    set(s => ({
      splitLayouts: { ...s.splitLayouts, [workspaceId]: newRoot },
      focusedPaneId: leaves[0]?.id || null,
    }))
    _persistLayout(workspaceId, newRoot)
  },

  moveTab: (workspaceId, fromPaneId, toPaneId, sessionId) => {
    const { splitLayouts } = get()
    let root = splitLayouts[workspaceId]
    if (!root) return

    // Remove from source pane
    const fromLeaf = findLeaf(root, fromPaneId)
    if (!fromLeaf || !fromLeaf.tabIds.includes(sessionId)) return
    const newFromTabs = fromLeaf.tabIds.filter(id => id !== sessionId)
    root = updateLeaf(root, fromPaneId, leaf => ({
      ...leaf,
      tabIds: newFromTabs,
      activeTabId: leaf.activeTabId === sessionId ? (newFromTabs[0] || null) : leaf.activeTabId,
    }))

    // Add to target pane
    root = updateLeaf(root, toPaneId, leaf => ({
      ...leaf,
      tabIds: [...leaf.tabIds, sessionId],
      activeTabId: sessionId,
    }))

    // If source pane is empty, remove it
    if (newFromTabs.length === 0) {
      root = removeLeaf(root, fromPaneId) || createDefaultLayout([])
    }

    set(s => ({ splitLayouts: { ...s.splitLayouts, [workspaceId]: root }, focusedPaneId: toPaneId }))
    _persistLayout(workspaceId, root)
  },

  setPaneActiveTab: (workspaceId, paneId, sessionId) => {
    const { splitLayouts } = get()
    const root = splitLayouts[workspaceId]
    if (!root) return
    const newRoot = updateLeaf(root, paneId, leaf => ({ ...leaf, activeTabId: sessionId }))
    set(s => ({ splitLayouts: { ...s.splitLayouts, [workspaceId]: newRoot }, activeSessionId: sessionId, focusedPaneId: paneId }))
    _persistLayout(workspaceId, newRoot)
  },

  addTabToPane: (workspaceId, paneId, sessionId) => {
    const { splitLayouts } = get()
    const root = splitLayouts[workspaceId]
    if (!root) return
    const newRoot = updateLeaf(root, paneId, leaf => ({
      ...leaf,
      tabIds: leaf.tabIds.includes(sessionId) ? leaf.tabIds : [...leaf.tabIds, sessionId],
      activeTabId: sessionId,
    }))
    set(s => ({ splitLayouts: { ...s.splitLayouts, [workspaceId]: newRoot }, activeSessionId: sessionId, focusedPaneId: paneId }))
    _persistLayout(workspaceId, newRoot)
  },

  removeTabFromPane: (workspaceId, paneId, sessionId) => {
    const { splitLayouts } = get()
    let root = splitLayouts[workspaceId]
    if (!root) return

    const leaf = findLeaf(root, paneId)
    if (!leaf) return
    const newTabs = leaf.tabIds.filter(id => id !== sessionId)

    if (newTabs.length === 0) {
      // Pane is empty, remove it
      root = removeLeaf(root, paneId) || createDefaultLayout([])
    } else {
      root = updateLeaf(root, paneId, l => ({
        ...l,
        tabIds: newTabs,
        activeTabId: l.activeTabId === sessionId ? (newTabs[0] || null) : l.activeTabId,
      }))
    }

    set(s => ({ splitLayouts: { ...s.splitLayouts, [workspaceId]: root } }))
    _persistLayout(workspaceId, root)
  },

  setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),

  setSplitSizes: (workspaceId, path, sizes) => {
    const { splitLayouts } = get()
    const root = splitLayouts[workspaceId]
    if (!root) return
    // Navigate path to find the split node and update its sizes
    const newRoot = _updateSplitSizes(root, path, sizes)
    set(s => ({ splitLayouts: { ...s.splitLayouts, [workspaceId]: newRoot } }))
    _persistLayout(workspaceId, newRoot)
  },
```

- [ ] **Step 5: Add layout persistence helpers (outside the store, same file)**

Add before the `useAIWorkbenchStore.subscribe(...)` block at the bottom of the file:

```typescript
// ── Split layout persistence ──
const LAYOUT_KEY_PREFIX = 'cb-workbench-layout-'

function _persistLayout(workspaceId: string, layout: LayoutNode): void {
  try {
    localStorage.setItem(LAYOUT_KEY_PREFIX + workspaceId, JSON.stringify(layout))
  } catch { /* storage full */ }
}

function _loadPersistedLayout(workspaceId: string): LayoutNode | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY_PREFIX + workspaceId)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function _updateSplitSizes(node: LayoutNode, path: number[], sizes: number[]): LayoutNode {
  if (path.length === 0 && node.type === 'split') {
    return { ...node, sizes }
  }
  if (node.type === 'split' && path.length > 0) {
    const [idx, ...rest] = path
    return {
      ...node,
      children: node.children.map((child, i) =>
        i === idx ? _updateSplitSizes(child, rest, sizes) : child
      ),
    }
  }
  return node
}
```

- [ ] **Step 6: Update `getOrCreateLayout` to load persisted layouts**

Replace the `getOrCreateLayout` implementation with:

```typescript
  getOrCreateLayout: (workspaceId) => {
    const { splitLayouts, sessions } = get()
    if (splitLayouts[workspaceId]) return splitLayouts[workspaceId]
    // Try loading from localStorage
    const persisted = _loadPersistedLayout(workspaceId)
    if (persisted) {
      set(s => ({ splitLayouts: { ...s.splitLayouts, [workspaceId]: persisted } }))
      return persisted
    }
    const wsSessions = sessions.filter(s => s.workspaceId === workspaceId)
    const layout = createDefaultLayout(wsSessions.map(s => s.id))
    set(s => ({ splitLayouts: { ...s.splitLayouts, [workspaceId]: layout } }))
    return layout
  },
```

- [ ] **Step 7: Run typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | tail -20
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/renderer/src/stores/useAIWorkbenchStore.ts && git commit -m "feat: add split layout state and actions to workbench store"
```

---

## Chunk 2: UI Components — PaneTabBar, TabGroup, SplitContainer

### Task 4: Create PaneTabBar component

**Files:**
- Create: `frontend/src/renderer/src/pages/AIWorkbench/PaneTabBar.tsx`

This replaces `WorkbenchTopBar`. Layout: `[+][>_] | [Tab1][Tab2]...   [$cost][Git]`

- [ ] **Step 1: Create PaneTabBar.tsx**

```tsx
// frontend/src/renderer/src/pages/AIWorkbench/PaneTabBar.tsx
import React, { useState, useMemo, useCallback } from 'react'
import { Button, Dropdown, Spin, Tooltip, Typography, theme } from 'antd'
import {
  PlusOutlined, CodeOutlined, HistoryOutlined, CloseOutlined,
  DollarOutlined, BranchesOutlined, MessageOutlined
} from '@ant-design/icons'
import { getAIToolIcon, AI_TOOL_NAMES } from './aiToolMeta'
import type { AIToolType, AIWorkbenchSession, ClaudeViewMode } from '../../types/ai-workbench'

const { Text } = Typography

const TOOLS_WITH_NATIVE_SESSIONS: Set<AIToolType> = new Set(['claude', 'codex', 'gemini'])

interface NativeSession {
  sessionId: string
  title: string
  modifiedAt: number
  sizeBytes?: number
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface PaneTabBarProps {
  paneId: string
  tabs: AIWorkbenchSession[]
  activeTabId: string | null
  workingDir: string
  onSelectTab: (sessionId: string) => void
  onCloseTab: (sessionId: string) => void
  onNewSession: () => void
  onResumeNativeSession?: (toolType: AIToolType, nativeSessionId: string, title?: string) => void
  /** Tab drag events */
  onTabDragStart?: (sessionId: string, paneId: string) => void
  onTabDrop?: (paneId: string) => void
  /** Right-click split */
  onSplitRight?: (sessionId: string) => void
  onSplitDown?: (sessionId: string) => void
  /** Claude view mode */
  claudeViewMode?: ClaudeViewMode
  onClaudeViewModeChange?: (mode: ClaudeViewMode) => void
  /** Git panel */
  gitPanelOpen?: boolean
  onToggleGitPanel?: () => void
  /** Whether this pane is focused */
  isFocused?: boolean
}

const PaneTabBar: React.FC<PaneTabBarProps> = ({
  paneId, tabs, activeTabId, workingDir,
  onSelectTab, onCloseTab, onNewSession, onResumeNativeSession,
  onTabDragStart, onTabDrop,
  onSplitRight, onSplitDown,
  claudeViewMode, onClaudeViewModeChange,
  gitPanelOpen, onToggleGitPanel,
  isFocused,
}) => {
  const { token } = theme.useToken()
  const activeSession = useMemo(() => tabs.find(t => t.id === activeTabId), [tabs, activeTabId])
  const activeToolType = activeSession?.toolType

  // Native session history for the active tab's tool type
  const [nativeSessions, setNativeSessions] = useState<NativeSession[]>([])
  const [loadingNative, setLoadingNative] = useState(false)
  const supportsNativeSessions = activeToolType ? TOOLS_WITH_NATIVE_SESSIONS.has(activeToolType) : false

  const fetchNativeSessions = useCallback(async (toolType: AIToolType) => {
    if (!workingDir) return
    setLoadingNative(true)
    try {
      const sessions = await window.api.aiWorkbench.listNativeSessions(workingDir, toolType)
      setNativeSessions(sessions || [])
    } catch { setNativeSessions([]) }
    finally { setLoadingNative(false) }
  }, [workingDir])

  const historyItems = useMemo(() => {
    if (nativeSessions.length === 0) return []
    const loadedIds = new Set(tabs.filter(s => s.toolSessionId).map(s => s.toolSessionId))
    return nativeSessions
      .filter(ns => !loadedIds.has(ns.sessionId))
      .map(ns => {
        const time = formatRelativeTime(ns.modifiedAt)
        const size = ns.sizeBytes ? ` · ${formatSize(ns.sizeBytes)}` : ''
        return {
          key: ns.sessionId,
          label: (
            <span title={ns.title} style={{ display: 'block', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ns.title}  ({time}{size})
            </span>
          ),
        }
      })
  }, [nativeSessions, tabs])

  // Drag-and-drop: allow dropping tabs onto this tab bar
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-pane-tab')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    onTabDrop?.(paneId)
  }, [paneId, onTabDrop])

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 0,
        height: 38,
        borderBottom: `1px solid ${isFocused ? token.colorPrimary : token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        overflow: 'hidden',
        flexShrink: 0,
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Fixed buttons: [+] [>_] */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 4px 0 8px', flexShrink: 0 }}>
        <Tooltip title="新建会话">
          <Button type="text" size="small" icon={<PlusOutlined />} onClick={onNewSession} />
        </Tooltip>
        <Tooltip title="在终端中打开">
          <Button
            type="text" size="small" icon={<CodeOutlined />}
            onClick={() => workingDir && window.api.aiWorkbench.openTerminal(workingDir).catch(() => {})}
          />
        </Tooltip>
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: token.colorBorderSecondary, flexShrink: 0 }} />

      {/* Scrollable tab area */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 0,
        overflow: 'hidden', minWidth: 0,
        overflowX: 'auto',
        scrollbarWidth: 'none', // Firefox
      }}>
        {tabs.map((session, idx) => {
          const isActive = session.id === activeTabId
          const icon = getAIToolIcon(session.toolType, 12)
          const title = session.title || `#${idx + 1}`

          const tabContextMenu = [
            { key: 'split-right', label: '向右拆分', onClick: () => onSplitRight?.(session.id) },
            { key: 'split-down', label: '向下拆分', onClick: () => onSplitDown?.(session.id) },
            { type: 'divider' as const },
            { key: 'close', label: '关闭', onClick: () => onCloseTab(session.id) },
            { key: 'close-others', label: '关闭其他', onClick: () => {
              tabs.forEach(t => { if (t.id !== session.id) onCloseTab(t.id) })
            }},
          ]

          return (
            <Dropdown key={session.id} menu={{ items: tabContextMenu }} trigger={['contextMenu']}>
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-pane-tab', JSON.stringify({ sessionId: session.id, paneId }))
                  e.dataTransfer.effectAllowed = 'move'
                  onTabDragStart?.(session.id, paneId)
                }}
                onClick={() => onSelectTab(session.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '0 8px', height: 37,
                  cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                  borderBottom: isActive ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
                  color: isActive ? token.colorText : token.colorTextSecondary,
                  background: isActive ? token.colorBgContainer : 'transparent',
                  fontSize: 12, flexShrink: 0,
                  transition: 'border-color 0.2s, color 0.2s',
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget.style.background = token.colorFillQuaternary) }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget.style.background = 'transparent') }}
              >
                {/* Tool icon */}
                {icon && <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>}

                {/* Title */}
                <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }} title={title}>
                  {title}
                </span>

                {/* History dropdown (per-tab, only for supported tools) */}
                {TOOLS_WITH_NATIVE_SESSIONS.has(session.toolType) && (
                  <Dropdown
                    menu={{
                      items: loadingNative
                        ? [{ key: 'loading', label: <Spin size="small" />, disabled: true }]
                        : historyItems.length > 0
                          ? historyItems
                          : [{ key: 'empty', label: '无历史会话', disabled: true }],
                      onClick: ({ key }) => {
                        const ns = nativeSessions.find(s => s.sessionId === key)
                        onResumeNativeSession?.(session.toolType, key, ns?.title)
                      },
                      style: { maxHeight: 'min(400px, 60vh)', overflowY: 'auto' },
                    }}
                    trigger={['click']}
                    placement="bottomLeft"
                    onOpenChange={(open) => open && fetchNativeSessions(session.toolType)}
                  >
                    <span
                      role="button"
                      style={{ display: 'inline-flex', alignItems: 'center', padding: 2, borderRadius: 4, cursor: 'pointer' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <HistoryOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />
                    </span>
                  </Dropdown>
                )}

                {/* Close button */}
                <span
                  role="button"
                  style={{ display: 'inline-flex', alignItems: 'center', padding: 2, borderRadius: 4, cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); onCloseTab(session.id) }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <CloseOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />
                </span>
              </div>
            </Dropdown>
          )
        })}
      </div>

      {/* Right zone: cost, Claude toggle, git */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', flexShrink: 0 }}>
        {activeSession?.costUsd !== undefined && activeSession.costUsd > 0 && (
          <Text style={{ fontSize: 11, color: token.colorTextSecondary }}>
            <DollarOutlined /> {activeSession.costUsd.toFixed(4)}
          </Text>
        )}

        {/* Claude Chat/CLI toggle */}
        {activeToolType === 'claude' && claudeViewMode && onClaudeViewModeChange && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', borderRadius: 8,
            background: token.colorFillTertiary, padding: 2, flexShrink: 0,
          }}>
            {(['chat', 'cli'] as ClaudeViewMode[]).map((m) => {
              const active = claudeViewMode === m
              return (
                <div
                  key={m}
                  role="button"
                  onClick={() => onClaudeViewModeChange(m)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    padding: '2px 8px', fontSize: 11, cursor: 'pointer',
                    borderRadius: 6, border: 'none',
                    background: active ? token.colorPrimary : 'transparent',
                    color: active ? '#fff' : token.colorTextSecondary,
                    fontWeight: active ? 500 : 400,
                    userSelect: 'none', whiteSpace: 'nowrap',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  {m === 'chat' ? <MessageOutlined style={{ fontSize: 10 }} /> : <CodeOutlined style={{ fontSize: 10 }} />}
                  {m === 'chat' ? 'Chat' : 'CLI'}
                </div>
              )
            })}
          </div>
        )}

        {onToggleGitPanel && (
          <Tooltip title="Changes">
            <Button
              type="text" size="small" icon={<BranchesOutlined />}
              onClick={onToggleGitPanel}
              style={{
                color: gitPanelOpen ? token.colorPrimary : token.colorTextSecondary,
                background: gitPanelOpen ? token.colorPrimaryBg : undefined,
              }}
            />
          </Tooltip>
        )}
      </div>
    </div>
  )
}

export default PaneTabBar
```

- [ ] **Step 2: Run typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/renderer/src/pages/AIWorkbench/PaneTabBar.tsx && git commit -m "feat: create PaneTabBar component with inline tool icons and history"
```

---

### Task 5: Create TabGroup component

**Files:**
- Create: `frontend/src/renderer/src/pages/AIWorkbench/TabGroup.tsx`

Renders a single pane: PaneTabBar + active session content (chat or terminal).

- [ ] **Step 1: Create TabGroup.tsx**

```tsx
// frontend/src/renderer/src/pages/AIWorkbench/TabGroup.tsx
import React, { useMemo, useCallback, useRef } from 'react'
import { Typography, theme } from 'antd'
import { MessageOutlined } from '@ant-design/icons'
import PaneTabBar from './PaneTabBar'
import WorkbenchChatPanel from './WorkbenchChatPanel'
import WorkbenchTerminalView from './WorkbenchTerminalView'
import { useAIWorkbenchStore } from '../../stores/useAIWorkbenchStore'
import { useT } from '../../i18n'
import type { AIToolType, ClaudeViewMode } from '../../types/ai-workbench'

const { Text } = Typography

interface TabGroupProps {
  paneId: string
  tabIds: string[]
  activeTabId: string | null
  workspaceId: string
  /** Drag callbacks (managed by SplitContainer) */
  onTabDragStart?: (sessionId: string, paneId: string) => void
  onTabDrop?: (paneId: string) => void
  /** Edge drop for splitting */
  onEdgeDrop?: (paneId: string, edge: 'left' | 'right' | 'top' | 'bottom') => void
  /** Git panel */
  gitPanelOpen?: boolean
  onToggleGitPanel?: () => void
  isFocused?: boolean
}

const EDGE_THRESHOLD = 0.2 // 20% of pane width/height

const TabGroup: React.FC<TabGroupProps> = ({
  paneId, tabIds, activeTabId, workspaceId,
  onTabDragStart, onTabDrop, onEdgeDrop,
  gitPanelOpen, onToggleGitPanel,
  isFocused,
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const {
    sessions, workspaces,
    claudeViewModes, setClaudeViewMode,
    setPaneActiveTab, removeTabFromPane, addTabToPane,
    createSession, updateSession, setFocusedPane, fetchAll, setActiveSession,
    deleteSession,
  } = useAIWorkbenchStore()

  const workspace = useMemo(() => workspaces.find(w => w.id === workspaceId), [workspaces, workspaceId])
  const workingDir = workspace?.workingDir || ''

  const tabs = useMemo(
    () => tabIds.map(id => sessions.find(s => s.id === id)).filter(Boolean) as typeof sessions,
    [tabIds, sessions]
  )

  const activeSession = useMemo(() => tabs.find(s => s.id === activeTabId), [tabs, activeTabId])

  const claudeViewMode: ClaudeViewMode = useMemo(() => {
    if (!activeTabId) return 'chat'
    return claudeViewModes[activeTabId] || (localStorage.getItem('cb-claude-view-mode') as ClaudeViewMode) || 'chat'
  }, [activeTabId, claudeViewModes])

  const handleClaudeViewModeChange = useCallback(async (mode: ClaudeViewMode) => {
    if (!activeTabId) return
    const session = sessions.find(s => s.id === activeTabId)
    if (session && session.status !== 'closed' && session.status !== 'completed' && session.status !== 'error') {
      try { await window.api.aiWorkbench.stopSession(activeTabId) } catch { /* */ }
    }
    setClaudeViewMode(activeTabId, mode)
  }, [activeTabId, sessions, setClaudeViewMode])

  const handleSelectTab = useCallback((sessionId: string) => {
    setPaneActiveTab(workspaceId, paneId, sessionId)
    setFocusedPane(paneId)
  }, [workspaceId, paneId, setPaneActiveTab, setFocusedPane])

  const handleCloseTab = useCallback(async (sessionId: string) => {
    removeTabFromPane(workspaceId, paneId, sessionId)
    // Don't delete the session — just remove from this pane
    // Session can be reopened from sidebar
  }, [workspaceId, paneId, removeTabFromPane])

  const handleNewSession = useCallback(async () => {
    // Use the most recent tab's tool type, or default to 'claude'
    const toolType: AIToolType = activeSession?.toolType || tabs[tabs.length - 1]?.toolType || 'claude'
    try {
      const session = await createSession(workspaceId, toolType, 'local')
      await fetchAll()
      addTabToPane(workspaceId, paneId, session.id)
      setActiveSession(session.id)
    } catch { /* */ }
  }, [activeSession, tabs, workspaceId, paneId, createSession, fetchAll, addTabToPane, setActiveSession])

  const handleResumeNativeSession = useCallback(async (toolType: AIToolType, nativeSessionId: string, title?: string) => {
    try {
      const session = await createSession(workspaceId, toolType, 'local')
      await updateSession(session.id, { toolSessionId: nativeSessionId, ...(title ? { title } : {}) })
      await fetchAll()
      addTabToPane(workspaceId, paneId, session.id)
      setActiveSession(session.id)
    } catch { /* */ }
  }, [workspaceId, paneId, createSession, updateSession, fetchAll, addTabToPane, setActiveSession])

  // Edge drop detection
  const contentRef = useRef<HTMLDivElement>(null)
  const [dropEdge, setDropEdge] = React.useState<'left' | 'right' | 'top' | 'bottom' | null>(null)

  const handleContentDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-pane-tab')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const rect = contentRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    if (x < EDGE_THRESHOLD) setDropEdge('left')
    else if (x > 1 - EDGE_THRESHOLD) setDropEdge('right')
    else if (y < EDGE_THRESHOLD) setDropEdge('top')
    else if (y > 1 - EDGE_THRESHOLD) setDropEdge('bottom')
    else setDropEdge(null)
  }, [])

  const handleContentDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (dropEdge) {
      onEdgeDrop?.(paneId, dropEdge)
    } else {
      onTabDrop?.(paneId)
    }
    setDropEdge(null)
  }, [dropEdge, paneId, onEdgeDrop, onTabDrop])

  const handleContentDragLeave = useCallback(() => setDropEdge(null), [])

  const handleSplitRight = useCallback((sessionId: string) => {
    useAIWorkbenchStore.getState().splitPane(workspaceId, paneId, 'horizontal', sessionId)
  }, [workspaceId, paneId])

  const handleSplitDown = useCallback((sessionId: string) => {
    useAIWorkbenchStore.getState().splitPane(workspaceId, paneId, 'vertical', sessionId)
  }, [workspaceId, paneId])

  // Focus this pane on click
  const handlePaneClick = useCallback(() => {
    setFocusedPane(paneId)
    if (activeTabId) setActiveSession(activeTabId)
  }, [paneId, activeTabId, setFocusedPane, setActiveSession])

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      onClick={handlePaneClick}
    >
      <PaneTabBar
        paneId={paneId}
        tabs={tabs}
        activeTabId={activeTabId}
        workingDir={workingDir}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewSession={handleNewSession}
        onResumeNativeSession={handleResumeNativeSession}
        onTabDragStart={onTabDragStart}
        onTabDrop={onTabDrop}
        onSplitRight={handleSplitRight}
        onSplitDown={handleSplitDown}
        claudeViewMode={activeSession?.toolType === 'claude' ? claudeViewMode : undefined}
        onClaudeViewModeChange={activeSession?.toolType === 'claude' ? handleClaudeViewModeChange : undefined}
        gitPanelOpen={gitPanelOpen}
        onToggleGitPanel={onToggleGitPanel}
        isFocused={isFocused}
      />

      {/* Session content with edge-drop overlay */}
      <div
        ref={contentRef}
        style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
        onDragOver={handleContentDragOver}
        onDrop={handleContentDrop}
        onDragLeave={handleContentDragLeave}
      >
        {/* Drop edge indicator */}
        {dropEdge && (
          <div style={{
            position: 'absolute', zIndex: 100, pointerEvents: 'none',
            background: `${token.colorPrimary}22`,
            border: `2px solid ${token.colorPrimary}`,
            borderRadius: 4,
            ...(dropEdge === 'left' ? { left: 0, top: 0, bottom: 0, width: '50%' } :
              dropEdge === 'right' ? { right: 0, top: 0, bottom: 0, width: '50%' } :
              dropEdge === 'top' ? { left: 0, top: 0, right: 0, height: '50%' } :
              { left: 0, bottom: 0, right: 0, height: '50%' }),
          }} />
        )}

        {activeTabId && activeSession ? (
          activeSession.toolType === 'claude' && claudeViewMode === 'chat' ? (
            <WorkbenchChatPanel
              sessionId={activeTabId}
              onNewSession={handleNewSession}
              onCloseSession={handleCloseTab}
            />
          ) : (
            <WorkbenchTerminalView
              key={activeTabId}
              sessionId={activeTabId}
              onNewSession={handleNewSession}
              onCloseSession={handleCloseTab}
              claudeViewMode={activeSession.toolType === 'claude' ? claudeViewMode : undefined}
              onClaudeViewModeChange={activeSession.toolType === 'claude' ? handleClaudeViewModeChange : undefined}
            />
          )
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 12, color: token.colorTextQuaternary, height: '100%',
          }}>
            <MessageOutlined style={{ fontSize: 36 }} />
            <Text style={{ color: token.colorTextQuaternary, fontSize: 13 }}>
              {t('coding.emptyPlaceholder')}
            </Text>
          </div>
        )}
      </div>
    </div>
  )
}

export default TabGroup
```

- [ ] **Step 2: Run typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/renderer/src/pages/AIWorkbench/TabGroup.tsx && git commit -m "feat: create TabGroup component for split pane tab management"
```

---

### Task 6: Create SplitContainer component

**Files:**
- Create: `frontend/src/renderer/src/pages/AIWorkbench/SplitContainer.tsx`

Recursively renders the layout tree. Split nodes → `<Allotment>`, leaf nodes → `<TabGroup>`.

- [ ] **Step 1: Create SplitContainer.tsx**

```tsx
// frontend/src/renderer/src/pages/AIWorkbench/SplitContainer.tsx
import React, { useCallback, useRef } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import TabGroup from './TabGroup'
import { useAIWorkbenchStore } from '../../stores/useAIWorkbenchStore'
import type { LayoutNode } from '../../types/split-layout'
import { findLeafBySessionId, collectLeaves } from '../../types/split-layout'

interface SplitContainerProps {
  workspaceId: string
  layout: LayoutNode
  gitPanelOpen?: boolean
  onToggleGitPanel?: () => void
  /** Path from root for setSplitSizes (indices into children arrays) */
  path?: number[]
}

const SplitContainer: React.FC<SplitContainerProps> = ({
  workspaceId, layout, gitPanelOpen, onToggleGitPanel, path = [],
}) => {
  const focusedPaneId = useAIWorkbenchStore(s => s.focusedPaneId)
  const { moveTab, splitPane, setSplitSizes, addTabToPane } = useAIWorkbenchStore()

  // Track the currently dragged tab info
  const dragRef = useRef<{ sessionId: string; fromPaneId: string } | null>(null)

  const handleTabDragStart = useCallback((sessionId: string, paneId: string) => {
    dragRef.current = { sessionId, fromPaneId: paneId }
  }, [])

  const handleTabDrop = useCallback((toPaneId: string) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (drag.fromPaneId === toPaneId) return
    moveTab(workspaceId, drag.fromPaneId, toPaneId, drag.sessionId)
  }, [workspaceId, moveTab])

  const handleEdgeDrop = useCallback((paneId: string, edge: 'left' | 'right' | 'top' | 'bottom') => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null

    const direction = (edge === 'left' || edge === 'right') ? 'horizontal' : 'vertical'
    splitPane(workspaceId, paneId, direction, drag.sessionId)
  }, [workspaceId, splitPane])

  const handleSizeChange = useCallback((sizes: number[]) => {
    setSplitSizes(workspaceId, path, sizes)
  }, [workspaceId, path, setSplitSizes])

  if (layout.type === 'leaf') {
    return (
      <TabGroup
        paneId={layout.id}
        tabIds={layout.tabIds}
        activeTabId={layout.activeTabId}
        workspaceId={workspaceId}
        onTabDragStart={handleTabDragStart}
        onTabDrop={handleTabDrop}
        onEdgeDrop={handleEdgeDrop}
        gitPanelOpen={gitPanelOpen}
        onToggleGitPanel={onToggleGitPanel}
        isFocused={focusedPaneId === layout.id}
      />
    )
  }

  // Split node
  return (
    <Allotment
      vertical={layout.direction === 'vertical'}
      defaultSizes={layout.sizes}
      onChange={handleSizeChange}
    >
      {layout.children.map((child, idx) => (
        <Allotment.Pane key={child.type === 'leaf' ? child.id : `split-${idx}`} minSize={120}>
          <SplitContainer
            workspaceId={workspaceId}
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
```

- [ ] **Step 2: Run typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/renderer/src/pages/AIWorkbench/SplitContainer.tsx && git commit -m "feat: create SplitContainer for recursive split pane rendering"
```

---

## Chunk 3: Integration — Wire Up + Remove Old TopBar

### Task 7: Remove WorkbenchTopBar from WorkbenchChatPanel and WorkbenchTerminalView

**Files:**
- Modify: `frontend/src/renderer/src/pages/AIWorkbench/WorkbenchChatPanel.tsx`
- Modify: `frontend/src/renderer/src/pages/AIWorkbench/WorkbenchTerminalView.tsx`

The tab bar is now rendered externally by `TabGroup`, so these components should only render their content (message list + input, or terminal).

- [ ] **Step 1: Modify WorkbenchChatPanel.tsx**

Remove the `WorkbenchTopBar` import and its rendering. Remove props that were only needed for the top bar (`claudeViewMode`, `onClaudeViewModeChange`, `gitPanelOpen`, `onToggleGitPanel`). The component keeps `onNewSession` and `onCloseSession` for internal use.

In `WorkbenchChatPanel.tsx`:

1. Remove the import: `import WorkbenchTopBar from './WorkbenchTopBar'`
2. Remove unused imports: `import type { ClaudeViewMode } from '../../types/ai-workbench'` (if only used for props)
3. Remove from props interface: `claudeViewMode`, `onClaudeViewModeChange`, `gitPanelOpen`, `onToggleGitPanel`
4. Remove from destructured props in the component function
5. Remove the `workspaceSessions` memo (no longer needed for tabs)
6. Remove the `handleSwitchSession` callback
7. Remove the `handleResumeNativeSession` callback
8. Remove the `<WorkbenchTopBar ... />` JSX block from the return

The component should now just render:

```tsx
return (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
    <WorkbenchMessageList
      messages={messages}
      isStreaming={isStreaming}
      streamingBlocks={streamingBlocks}
      hasExistingSession={!!session?.toolSessionId && messages.length === 0}
      sessionId={sessionId}
    />
    <WorkbenchInput
      sessionId={sessionId}
      toolType={session.toolType}
      isStreaming={isStreaming}
      mode={mode}
      hasPendingQuestion={hasPendingQuestion}
      workingDir={workspace?.workingDir}
      costUsd={session.costUsd}
      messageCount={messages.length}
      onSend={handleSend}
      onModeChange={handleModeChange}
      onInterrupt={handleInterrupt}
      onStop={handleStop}
    />
  </div>
)
```

- [ ] **Step 2: Modify WorkbenchTerminalView.tsx**

1. Remove the import: `import WorkbenchTopBar from './WorkbenchTopBar'`
2. Remove from props interface: `claudeViewMode`, `onClaudeViewModeChange`, `gitPanelOpen`, `onToggleGitPanel`
3. Remove from destructured props
4. Remove `workspaceSessions` memo
5. Remove `handleSwitchSession` callback
6. Remove `handleResumeNativeSession` callback
7. Remove the `<WorkbenchTopBar ... />` JSX from the return

The component should now just render:

```tsx
return (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflow: 'hidden',
        padding: '4px 0 0 4px',
        background: '#1e1e1e',
      }}
    />
  </div>
)
```

- [ ] **Step 3: Run typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | tail -20
```

Fix any type errors from callers still passing removed props (will be fixed in Task 8).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/renderer/src/pages/AIWorkbench/WorkbenchChatPanel.tsx frontend/src/renderer/src/pages/AIWorkbench/WorkbenchTerminalView.tsx && git commit -m "refactor: remove WorkbenchTopBar from chat panel and terminal view"
```

---

### Task 8: Rewrite AIWorkbenchPage to use SplitContainer

**Files:**
- Modify: `frontend/src/renderer/src/pages/AIWorkbench/AIWorkbenchPage.tsx`

Replace the single-session rendering logic with `<SplitContainer>`.

- [ ] **Step 1: Rewrite AIWorkbenchPage.tsx**

Key changes:
1. Remove imports for `WorkbenchChatPanel`, `WorkbenchTerminalView` (now handled inside TabGroup)
2. Add import for `SplitContainer`
3. Determine the active workspace from `activeSessionId`
4. Use `getOrCreateLayout` to get the layout for the active workspace
5. Render `<SplitContainer>` instead of the conditional chat/terminal rendering
6. Keep sidebar, git panel, and dialogs unchanged
7. When a new session is created, add it to the focused pane instead of just setting `activeSessionId`

The new render section replaces lines ~192-226:

```tsx
import SplitContainer from './SplitContainer'
// Remove: import WorkbenchChatPanel from './WorkbenchChatPanel'
// Remove: import WorkbenchTerminalView from './WorkbenchTerminalView'
// Remove: import type { AIToolType, ClaudeViewMode } from '../../types/ai-workbench'
import type { AIToolType } from '../../types/ai-workbench'
```

Remove from store destructuring: `claudeViewModes`, `setClaudeViewMode` (now handled in TabGroup).

Remove: `activeClaudeViewMode` memo, `handleClaudeViewModeChange` callback.

Add to store destructuring: `getOrCreateLayout`, `addTabToPane`, `focusedPaneId`.

Compute `activeWorkspaceId`:

```tsx
const activeWorkspaceId = useMemo(() => {
  if (!activeSession) return null
  return activeSession.workspaceId
}, [activeSession])

const layout = useMemo(() => {
  if (!activeWorkspaceId) return null
  return getOrCreateLayout(activeWorkspaceId)
}, [activeWorkspaceId, getOrCreateLayout])
```

Update `handleNewSessionFromPanel` to add to focused pane:

```tsx
const handleNewSessionFromPanel = useCallback(async () => {
  const currentSession = sessions.find(s => s.id === activeSessionId)
  if (!currentSession) return
  try {
    const session = await window.api.aiWorkbench.createSession(
      currentSession.workspaceId, currentSession.toolType, 'local'
    )
    await fetchAll()
    // Add to focused pane or first pane
    const wsLayout = getOrCreateLayout(currentSession.workspaceId)
    const targetPaneId = focusedPaneId || (wsLayout.type === 'leaf' ? wsLayout.id : null)
    if (targetPaneId) {
      addTabToPane(currentSession.workspaceId, targetPaneId, session.id)
    }
    setActiveSession(session.id)
  } catch {
    message.error(t('coding.createSessionFailed'))
  }
}, [sessions, activeSessionId, fetchAll, message, setActiveSession, t, getOrCreateLayout, focusedPaneId, addTabToPane])
```

New main content area render:

```tsx
<div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
  {activeWorkspaceId && layout ? (
    <SplitContainer
      workspaceId={activeWorkspaceId}
      layout={layout}
      gitPanelOpen={gitPanelOpen}
      onToggleGitPanel={toggleGitPanel}
    />
  ) : (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 12, color: token.colorTextQuaternary
    }}>
      <MessageOutlined style={{ fontSize: 48 }} />
      <Text style={{ color: token.colorTextQuaternary, fontSize: 14 }}>
        {t('coding.emptyPlaceholder')}
      </Text>
    </div>
  )}
</div>
```

- [ ] **Step 2: Update sidebar session click to add to focused pane**

When a session is clicked in the sidebar, ensure it appears in a pane. Modify `handleSelectSession`:

```tsx
const handleSelectSession = useCallback((sessionId: string) => {
  setActiveSession(sessionId)
  // Find the session's workspace and ensure it's in a pane
  const session = sessions.find(s => s.id === sessionId)
  if (!session) return
  const wsLayout = getOrCreateLayout(session.workspaceId)
  const { findLeafBySessionId } = require('../../types/split-layout')
  const existingLeaf = findLeafBySessionId(wsLayout, sessionId)
  if (!existingLeaf) {
    // Not in any pane — add to focused pane or first leaf
    const { collectLeaves } = require('../../types/split-layout')
    const targetPaneId = focusedPaneId || collectLeaves(wsLayout)[0]?.id
    if (targetPaneId) {
      addTabToPane(session.workspaceId, targetPaneId, sessionId)
    }
  }
}, [setActiveSession, sessions, getOrCreateLayout, focusedPaneId, addTabToPane])
```

(Note: use static imports instead of require — add `findLeafBySessionId` and `collectLeaves` imports at top of file.)

- [ ] **Step 3: Run typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | tail -20
```

- [ ] **Step 4: Run dev server to verify rendering**

```bash
cd frontend && npm run dev
```

Visually verify:
- Single pane shows tabs with tool icons + history + close
- [+] and [>_] buttons are on the left
- Right-click tab shows "Split Right" / "Split Down"
- Splitting creates resizable panes with allotment

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderer/src/pages/AIWorkbench/AIWorkbenchPage.tsx && git commit -m "feat: integrate SplitContainer into AIWorkbenchPage"
```

---

### Task 9: Delete WorkbenchTopBar.tsx

**Files:**
- Delete: `frontend/src/renderer/src/pages/AIWorkbench/WorkbenchTopBar.tsx`

- [ ] **Step 1: Verify no remaining imports of WorkbenchTopBar**

```bash
cd frontend && grep -r "WorkbenchTopBar" src/ --include="*.tsx" --include="*.ts"
```

Should return zero results (after Tasks 7-8 removed all references).

- [ ] **Step 2: Delete the file**

```bash
rm frontend/src/renderer/src/pages/AIWorkbench/WorkbenchTopBar.tsx
```

- [ ] **Step 3: Run typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add -u frontend/src/renderer/src/pages/AIWorkbench/WorkbenchTopBar.tsx && git commit -m "refactor: remove deprecated WorkbenchTopBar component"
```

---

### Task 10: Ensure new sessions created from sidebar/dialog land in the correct pane

**Files:**
- Modify: `frontend/src/renderer/src/pages/AIWorkbench/AIWorkbenchPage.tsx`

- [ ] **Step 1: Update handleCreateSession (from new session dialog)**

Ensure sessions created via the dialog are added to the focused pane:

```tsx
const handleCreateSession = useCallback(
  async (toolType: AIToolType) => {
    if (!newSessionWorkspaceId) return
    try {
      const session = await window.api.aiWorkbench.createSession(
        newSessionWorkspaceId, toolType, 'local'
      )
      setNewSessionOpen(false)
      await fetchAll()
      // Add to focused pane
      const wsLayout = getOrCreateLayout(newSessionWorkspaceId)
      const targetPaneId = focusedPaneId || collectLeaves(wsLayout)[0]?.id
      if (targetPaneId) {
        addTabToPane(newSessionWorkspaceId, targetPaneId, session.id)
      }
      setActiveSession(session.id)
    } catch {
      message.error(t('coding.createSessionFailed'))
    }
  },
  [newSessionWorkspaceId, fetchAll, message, setActiveSession, getOrCreateLayout, focusedPaneId, addTabToPane]
)
```

- [ ] **Step 2: Run typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/renderer/src/pages/AIWorkbench/AIWorkbenchPage.tsx && git commit -m "fix: ensure new sessions land in the correct pane"
```

---

### Task 11: Final integration test and cleanup

- [ ] **Step 1: Run full typecheck**

```bash
cd frontend && npm run typecheck
```

- [ ] **Step 2: Run lint**

```bash
cd frontend && npm run lint
```

Fix any lint warnings.

- [ ] **Step 3: Run dev server and test all interactions**

```bash
cd frontend && npm run dev
```

Test checklist:
1. Single pane: tabs show tool icon + title + history + close
2. [+] and [>_] are pinned left of tabs
3. Right-click tab → "Split Right" creates horizontal split
4. Right-click tab → "Split Down" creates vertical split
5. Drag tab to another pane's edge creates split
6. Drag tab to another pane's tab bar moves the tab
7. Close last tab in a split pane collapses the pane
8. Sidebar session click focuses existing pane or adds to focused pane
9. Git panel toggle works
10. Claude Chat/CLI toggle works
11. Session history dropdown works per tab
12. Layout persists after page refresh (localStorage)

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: address integration issues in split tab layout"
```

- [ ] **Step 5: Push to all remotes**

```bash
git remote | xargs -I {} git push {}
```
