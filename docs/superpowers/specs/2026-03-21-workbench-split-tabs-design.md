# AI Workbench: Split Layout + Tab Restructure

## Summary

Restructure the AI Workbench top bar so that tool tags and history move into individual tab labels, fixed action buttons (new session, terminal) stay pinned left, and support arbitrary split pane layouts with independent tab groups per pane.

## Current State

`WorkbenchTopBar` renders a single flat bar:

```
[Tool Tag] [History] [+] [Terminal] [Chat|CLI] | [Tab1 ×] [Tab2 ×] | [$cost] [Git]
```

- Tool tag, history, new session, terminal, and Claude view mode toggle are fixed on the left
- Session tabs follow after a separator
- Only one session is visible at a time (no split)
- `AIWorkbenchPage` renders either `WorkbenchChatPanel` or `WorkbenchTerminalView` for the active session

## Design

### 1. Split Layout Data Model

A recursive tree stored in `useAIWorkbenchStore`:

```typescript
type SplitDirection = 'horizontal' | 'vertical'

interface SplitNode {
  type: 'split'
  direction: SplitDirection
  children: LayoutNode[]
  sizes?: number[] // allotment proportional sizes
}

interface LeafNode {
  type: 'leaf'
  id: string // unique pane ID (e.g. uuid)
  tabIds: string[] // session IDs in this tab group
  activeTabId: string | null
}

type LayoutNode = SplitNode | LeafNode
```

Store additions to `useAIWorkbenchStore`:

```typescript
// New state
splitLayout: LayoutNode // root of the layout tree
// New actions
setSplitLayout: (layout: LayoutNode) => void
splitPane: (paneId: string, direction: SplitDirection, newSessionId?: string) => void
closePane: (paneId: string) => void
moveTab: (fromPaneId: string, toPaneId: string, sessionId: string) => void
setPaneActiveTab: (paneId: string, sessionId: string) => void
addTabToPane: (paneId: string, sessionId: string) => void
removeTabFromPane: (paneId: string, sessionId: string) => void
```

Initial layout (no splits): a single leaf node containing all workspace sessions.

Layout is per-workspace scope. When `activeSessionId` changes, the layout reflects the workspace of that session.

Persist layout to `localStorage` keyed by workspace ID: `cb-workbench-layout-{workspaceId}`.

### 2. Tab Bar Restructure

Each pane's tab bar layout:

```
[+ New] [>_ Term] | [🔵 Fix auth ⏳ ×] [🟣 Refactor ⏳ ×] [Tab3...]   [$cost] [Git]
```

**Left fixed zone:**
- `[+]` — create new session (same tool type as most recent tab, or show picker if no tabs)
- `[>_]` — open workspace directory in native terminal

**Separator** (1px vertical divider)

**Tab zone** (scrollable horizontal):
- Each tab label: `[ToolIcon] [Title] [HistoryIcon] [CloseIcon]`
  - **ToolIcon**: Provider icon from `aiToolMeta.tsx` (`getAIToolIcon`)
  - **Title**: Session title or `#N` fallback, truncated with ellipsis
  - **HistoryIcon**: Small `HistoryOutlined` icon — click opens dropdown of native CLI sessions for that tool type (filtered to current workspace). Only shown for tools in `TOOLS_WITH_NATIVE_SESSIONS` set.
  - **CloseIcon**: `CloseOutlined` to close tab (with session cleanup)

**Right zone** (only in the "primary" / first pane):
- Cost display (if > 0)
- Git panel toggle
- Claude Chat/CLI toggle (when active tab is Claude)

### 3. Component Structure

```
AIWorkbenchPage
├── AIWorkbenchSidebar (unchanged)
├── SplitContainer (new — recursive)
│   ├── <Allotment> (for split nodes)
│   │   ├── <Allotment.Pane>
│   │   │   └── TabGroup (new)
│   │   │       ├── TabBar (new — replaces WorkbenchTopBar)
│   │   │       │   ├── FixedButtons ([+] [>_])
│   │   │       │   ├── Separator
│   │   │       │   └── TabList (scrollable tab labels)
│   │   │       └── SessionContent
│   │   │           ├── WorkbenchChatPanel (existing, minus top bar)
│   │   │           └── WorkbenchTerminalView (existing, minus top bar)
│   │   └── <Allotment.Pane>
│   │       └── TabGroup ...
│   └── (leaf nodes render TabGroup directly)
├── GitChangesPanel (unchanged — shared right panel)
└── Dialogs (unchanged)
```

**New components:**
- `SplitContainer` — recursively renders `LayoutNode` tree. Split nodes become `<Allotment>`, leaf nodes become `<TabGroup>`.
- `TabGroup` — renders tab bar + active session content for a single pane.
- `PaneTabBar` — the new tab bar replacing `WorkbenchTopBar`. Fixed buttons left, tabs right.

**Modified components:**
- `WorkbenchChatPanel` — remove `WorkbenchTopBar` rendering (tab bar now external)
- `WorkbenchTerminalView` — remove `WorkbenchTopBar` rendering
- `AIWorkbenchPage` — replace single-session rendering with `SplitContainer`

**Deleted components:**
- `WorkbenchTopBar` — replaced by `PaneTabBar` inside `TabGroup`

### 4. Split Interactions

**Drag tab to pane edge:**
- Use HTML5 drag/drop (tabs are draggable)
- Drop zones: top/bottom/left/right edges of each pane (20% edge detection)
- Visual indicator: highlight strip on the drop edge
- On drop: call `splitPane(targetPaneId, direction)` to create new split, move tab from source to new pane

**Right-click tab context menu:**
- "Split Right" — `splitPane(paneId, 'horizontal')`
- "Split Down" — `splitPane(paneId, 'vertical')`
- "Close" — close tab
- "Close Others" — close all other tabs in this pane

**Drag tab between panes (move):**
- Drag from one pane's tab bar, drop on another pane's tab bar area
- Calls `moveTab(fromPaneId, toPaneId, sessionId)`

**Close last tab in pane:**
- Pane is removed, parent split node collapses
- If parent split has only one child left, it replaces the split node with that child (flatten)

### 5. Store Logic Details

**`splitPane(paneId, direction, newSessionId?)`:**
1. Find the leaf node with `id === paneId`
2. Replace it with a split node: `{ type: 'split', direction, children: [originalLeaf, newLeaf] }`
3. If `newSessionId` provided, new leaf contains `[newSessionId]`; otherwise move the dragged tab

**`closePane(paneId)`:**
1. Remove the leaf from the tree
2. If parent split has 1 child, replace parent with that child
3. If tree becomes empty, reset to single leaf

**`moveTab(from, to, sessionId)`:**
1. Remove `sessionId` from `from` pane's `tabIds`
2. Add to `to` pane's `tabIds`
3. If `from` pane is now empty, call `closePane(from)`

**New session creation:**
- When `[+]` is clicked in a pane, the new session is added to that pane's `tabIds`
- Update: `handleNewSessionFromPanel` now receives the `paneId` to know which pane to add to

### 6. Session ↔ Pane Mapping

- A session can only be in one pane at a time
- When sidebar session is clicked: find which pane contains that session, activate it. If not in any pane, add to the currently focused pane.
- "Focused pane" tracked via click/interaction — stored as `focusedPaneId` in store

### 7. Dependencies

**New package:**
- `allotment` — split pane layout (npm install allotment)

**Existing packages used:**
- `@ant-design/icons` — tab icons
- HTML5 Drag and Drop API — tab dragging (no new dep needed)

### 8. Migration

- Default layout for existing users: single leaf node with all workspace sessions
- `WorkbenchTopBar` code will be refactored into `PaneTabBar`, not deleted outright (to preserve git history readability)
- Sidebar session click behavior unchanged: selects the session, pane focuses automatically

### 9. Edge Cases

- **Empty workspace (no sessions):** Show empty placeholder in single leaf pane
- **All panes closed:** Reset to single empty leaf
- **Session deleted externally (via sidebar):** Remove from whichever pane contains it; collapse pane if empty
- **Workspace switch:** Load that workspace's persisted layout from localStorage, or default single leaf
- **Very deep nesting:** No artificial limit, but practically 3-4 levels should be sufficient. Allotment handles nested splits natively.
