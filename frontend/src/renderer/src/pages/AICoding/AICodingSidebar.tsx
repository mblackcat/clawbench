import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { Dropdown, Input, App, Button, theme, Tooltip, Spin, Tag, Badge } from 'antd'
import type { MenuProps } from 'antd'
import {
  EllipsisOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
  HistoryOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  HolderOutlined,
  VerticalAlignTopOutlined,
  AppstoreOutlined,
  ClockCircleOutlined, FolderAddOutlined } from '@ant-design/icons'
import AICodingSearchModal from './AICodingSearchModal'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AI_TOOL_NAMES, AI_TOOL_SHORT_NAMES, AI_TOOL_TAG_COLORS, AI_TOOL_TAG_STYLE, getAIToolIcon, TOOLS_WITH_NATIVE_SESSIONS } from './aiToolMeta'
import { useT } from '../../i18n'
import { useAICodingStore } from '../../stores/useAICodingStore'
import { useAttentionStore, dismissCodingTarget } from '../../stores/useAttentionStore'
import { useVcsSelectionStore } from '../../stores/useVcsSelectionStore'
import { MONO_FONT_STACK } from '../../utils/mono-font'
import type { AICodingSession, AICodingWorkspace, AIToolType } from '../../types/ai-coding'
import type { VcsType } from '../../types/ipc'

interface AICodingSidebarProps {
  onNewWorkspace: () => void
  onNewSession: (workspaceId: string) => void
  onSelectSession: (sessionId: string) => void
  onSelectWorkspace: (workspaceId: string) => void
  onOpenNewChat?: () => void
  onNativeSessionsChange?: (map: Record<string, NativeSessionState>) => void
}

const NATIVE_HISTORY_PAGE_SIZE = 5
/** Max workspace avatars shown in the collapsed rail before an overflow "..." appears. */
const COLLAPSED_RAIL_MAX = 10

/** First character of a workspace title, for the collapsed-rail avatar. */
const firstLetterOf = (title?: string): string => {
  const ch = Array.from((title || '').trim())[0]
  return ch ? ch.toUpperCase() : '?'
}

const WORKSPACE_COLLAPSE_STORAGE_KEY = 'cb-workbench-collapsed-workspaces'
/** Background re-scan of native CLI history while a workspace is expanded. */
const NATIVE_SESSION_POLL_MS = 12_000
/** Parallel git/svn diff-stat processes per sidebar refresh. */
const DIFF_STAT_CONCURRENCY = 3
/** Let the first paint / session open settle before the initial VCS sweep. */
const DIFF_STAT_INITIAL_DELAY_MS = 1_500
/** Faster scan while opened sessions still lack a toolSessionId (e.g. fresh Grok). */
const NATIVE_SESSION_POLL_UNLINKED_MS = 3_000
/** Allow small clock skew when matching a new native session to an opened one. */
export const NATIVE_LINK_CLOCK_SKEW_MS = 2_000

export interface SidebarNativeSession {
  sessionId: string
  title: string
  modifiedAt: number
  sizeBytes?: number
  toolType: AIToolType
}

interface NativeSessionState {
  sessions: SidebarNativeSession[]
  loading: boolean
  loaded: boolean
  workingDir: string
}

export interface SidebarSessionRow {
  key: string
  toolType: AIToolType
  title: string
  modifiedAt: number
  nativeSessionId?: string
  openedSessionId?: string
}

export interface NativeSessionLink {
  sessionId: string
  toolSessionId: string
  title?: string
}

/** Helper to test if two session titles refer to the same conversation. */
export function sessionTitlesMatch(titleA?: string, titleB?: string): boolean {
  if (!titleA || !titleB) return false
  const normA = titleA.trim().replace(/…$/, '')
  const normB = titleB.trim().replace(/…$/, '')
  if (!normA || !normB) return false
  return normA === normB || normA.startsWith(normB) || normB.startsWith(normA)
}

/**
 * Placeholder titles a session may carry before it has a real one: every tool
 * id plus its display / short names (covers all tools, incl. legacy ones).
 */
const GENERIC_TOOL_TITLES: ReadonlySet<string> = new Set(
  [
    ...Object.keys(AI_TOOL_NAMES),
    ...Object.values(AI_TOOL_NAMES),
    ...Object.values(AI_TOOL_SHORT_NAMES),
    'claude code', 'codex cli', 'gemini cli', 'grok cli', 'antigravity cli', 'agy',
    'opencode', 'trae cli', 'qoder cli', 'qodercli', 'kimi code', 'mimo code', 'qwen code'
  ].map((name) => name.toLowerCase())
)

/** Check if a title looks like an auto-generated placeholder rather than meaningful user/prompt content. */
export function isGenericTitle(title?: string): boolean {
  if (!title) return true
  const trimmed = title.trim()
  if (GENERIC_TOOL_TITLES.has(trimmed.toLowerCase())) return true
  if (/^(?:Session|Chat)\s+[0-9a-f]{8}/i.test(trimmed)) return true
  if (/(?:session|会话|chat)$/i.test(trimmed)) return true
  return false
}
function loadCollapsedWorkspaceIds(): Set<string> {
  try {
    const raw = localStorage.getItem(WORKSPACE_COLLAPSE_STORAGE_KEY)
    const ids = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function persistCollapsedWorkspaceIds(ids: Set<string>): void {
  try {
    localStorage.setItem(WORKSPACE_COLLAPSE_STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // ignore storage failures
  }
}

const GROUP_COLLAPSE_STORAGE_KEY = 'cb-workbench-collapsed-groups'

function loadCollapsedGroupIds(): Set<string> {
  try {
    const raw = localStorage.getItem(GROUP_COLLAPSE_STORAGE_KEY)
    const ids = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function persistCollapsedGroupIds(ids: Set<string>): void {
  try {
    localStorage.setItem(GROUP_COLLAPSE_STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // ignore storage failures
  }
}

const RECENTS_COLLAPSE_STORAGE_KEY = 'cb-workbench-collapsed-recents'

function loadRecentsCollapsed(): boolean {
  try {
    return localStorage.getItem(RECENTS_COLLAPSE_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function persistRecentsCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(RECENTS_COLLAPSE_STORAGE_KEY, String(collapsed))
  } catch {
    // ignore storage failures
  }
}

const ARCHIVED_SESSIONS_STORAGE_KEY = 'cb-workbench-archived-sessions'

/**
 * Conversation keys archived (hidden) from the sidebar history list.
 *
 * Persisted in localStorage so archived rows stay hidden across restarts. The
 * native CLI session id is the stable identifier here — local ClawBench
 * sessions are held in RAM only and do not survive a restart, so an archive flag
 * can't ride on the session object. A row counts as archived when either its
 * native key or its opened-session key is in the set (the opened key covers a
 * freshly-launched session before it links to a native id, and keeps it hidden
 * once that link is established).
 */
function loadArchivedSessionKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(ARCHIVED_SESSIONS_STORAGE_KEY)
    const keys = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

function persistArchivedSessionKeys(keys: Set<string>): void {
  try {
    localStorage.setItem(ARCHIVED_SESSIONS_STORAGE_KEY, JSON.stringify([...keys]))
  } catch {
    // ignore storage failures
  }
}

function nativeArchiveKey(toolType: AIToolType, nativeSessionId: string): string {
  return `native:${toolType}:${nativeSessionId}`
}

function openedArchiveKey(openedSessionId: string): string {
  return `opened:${openedSessionId}`
}

function isSessionRowArchived(row: SidebarSessionRow, archived: Set<string>): boolean {
  if (row.nativeSessionId && archived.has(nativeArchiveKey(row.toolType, row.nativeSessionId))) return true
  if (row.openedSessionId && archived.has(openedArchiveKey(row.openedSessionId))) return true
  return false
}

export function createSessionRowMenuItems(options: {
  isPinned: boolean
  onTogglePin: () => void
  onArchive: () => void
  onDelete: () => void
  pinLabel: string
  unpinLabel: string
  archiveLabel: string
  deleteLabel: string
}): NonNullable<MenuProps['items']> {
  return [
    {
      key: 'pin',
      label: options.isPinned ? options.unpinLabel : options.pinLabel,
      onClick: options.onTogglePin
    },
    { type: 'divider' },
    { key: 'archive', label: options.archiveLabel, onClick: options.onArchive },
    { type: 'divider' },
    { key: 'delete', label: options.deleteLabel, danger: true, onClick: options.onDelete }
  ]
}

export const PINNED_SESSIONS_STORAGE_KEY = 'cb-workbench-pinned-sessions'

export function loadPinnedSessionKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY)
    const keys = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

export function persistPinnedSessionKeys(keys: Set<string>): void {
  try {
    localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify([...keys]))
  } catch {
    // ignore storage failures
  }
}

export function nativePinKey(toolType: AIToolType, nativeSessionId: string): string {
  return `native:${toolType}:${nativeSessionId}`
}

export function openedPinKey(openedSessionId: string): string {
  return `opened:${openedSessionId}`
}

export function isSessionRowPinned(
  row: SidebarSessionRow,
  pinnedKeys: Set<string>,
  openedSessionMap?: Map<string, AICodingSession>
): boolean {
  if (row.nativeSessionId && pinnedKeys.has(nativePinKey(row.toolType, row.nativeSessionId))) return true
  if (row.openedSessionId) {
    if (pinnedKeys.has(openedPinKey(row.openedSessionId))) return true
    if (openedSessionMap?.get(row.openedSessionId)?.pinned) return true
  }
  return false
}

/** Sort order for workspaces within a group: pinned first, then manual `order`,
 *  then `createdAt` as a stable fallback for older entries lacking `order`. */
const workspaceSort = (a: AICodingWorkspace, b: AICodingWorkspace): number =>
  (Number(!!b.pinned) - Number(!!a.pinned)) ||
  ((a.order ?? Infinity) - (b.order ?? Infinity)) ||
  (a.createdAt - b.createdAt)

/** Context carrying a sortable item's drag listeners down to the handle icon, so
 *  the handle can live deep inside the workspace header without prop drilling. */
const SortableWorkspaceHandleContext = React.createContext<{
  listeners: ReturnType<typeof useSortable>['listeners']
  attributes: ReturnType<typeof useSortable>['attributes'] | undefined
}>({ listeners: undefined, attributes: undefined })

/** Wraps only the workspace header row with the nearest SortableWorkspaceItem's
 *  drag listeners so child session rows and rename inputs don't initiate workspace drags. */
const SortableWorkspaceHeader: React.FC<{ disabled?: boolean; children: React.ReactNode }> = ({
  disabled,
  children
}) => {
  const { listeners, attributes } = React.useContext(SortableWorkspaceHandleContext)
  return (
    <div
      {...(!disabled ? attributes : undefined)}
      {...(!disabled ? listeners : undefined)}
      style={{ outline: 'none' }}
    >
      {children}
    </div>
  )
}

/** Wraps a workspace block as a @dnd-kit sortable item. */
const SortableWorkspaceItem: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <SortableWorkspaceHandleContext.Provider value={{ listeners, attributes }}>
      <div
        ref={setNodeRef}
        style={{
          transform: CSS.Translate.toString(transform),
          transition,
          opacity: isDragging ? 0.4 : 1
        }}
      >
        {children}
      </div>
    </SortableWorkspaceHandleContext.Provider>
  )
}

/**
 * Pair opened ClawBench sessions that lack toolSessionId with unmatched native
 * CLI sessions of the same tool. PTY tools (Grok/Gemini/etc.) never emit a
 * session_id event, so without this the sidebar shows both "Grok session" and
 * the real native history entry for the same conversation.
 *
 * `claimingSessions` (default: `workspaceSessions`) must include closed
 * sessions: a closed tab keeps its toolSessionId, and if it stopped claiming
 * it, a freshly opened session would adopt the closed one's native history
 * (wrong title) while its own history later showed up as a duplicate row.
 */
export function resolveNativeSessionLinks(
  workspaceSessions: AICodingSession[],
  nativeSessions: SidebarNativeSession[],
  claimingSessions: AICodingSession[] = workspaceSessions
): NativeSessionLink[] {
  const claimedNativeKeys = new Set(
    claimingSessions
      .filter((session) => session.toolSessionId)
      .map((session) => `${session.toolType}:${session.toolSessionId}`)
  )

  // Only consider sessions that have actually launched (or are active/non-closed).
  // Freshly created sessions that have never been launched have no process or native history
  // and must never be bound to existing native sessions from prior turns or sibling tabs.
  const unlinkedSessions = workspaceSessions
    .filter(
      (session) =>
        session.toolType !== 'terminal' &&
        !session.toolSessionId &&
        (session.startedAt || session.status !== 'closed')
    )
    .slice()

  if (unlinkedSessions.length === 0) return []

  // Sort unlinked sessions chronologically by start time (oldest opened first)
  unlinkedSessions.sort((a, b) => (a.startedAt || a.createdAt) - (b.startedAt || b.createdAt))

  const minSessionStart = Math.min(
    ...unlinkedSessions.map((s) => s.startedAt || s.createdAt)
  )

  // Filter out already claimed natives and ancient history predating the earliest unlinked session
  const unmatchedNatives = nativeSessions
    .filter(
      (native) =>
        !claimedNativeKeys.has(`${native.toolType}:${native.sessionId}`) &&
        native.modifiedAt >= minSessionStart - NATIVE_LINK_CLOCK_SKEW_MS
    )
    .slice()
    // Sort chronologically (oldest modified first) so the 1st opened session pairs with the
    // 1st native session (FIFO), preventing newly opened tabs from stealing older tabs' titles.
    .sort((a, b) => a.modifiedAt - b.modifiedAt)

  if (unmatchedNatives.length === 0) return []

  const usedSessionIds = new Set<string>()
  const links: NativeSessionLink[] = []

  for (const native of unmatchedNatives) {
    const candidates = unlinkedSessions.filter((session) => {
      if (usedSessionIds.has(session.id)) return false
      if (session.toolType !== native.toolType) return false
      const sessionStart = session.startedAt || session.createdAt
      // Still-running sessions can claim natives written any time after they started.
      // Closed sessions only claim natives written before/around their last update,
      // so a stale session from yesterday won't swallow today's history.
      const sessionEnd =
        session.status === 'idle' || session.status === 'running'
          ? Date.now()
          : (session.updatedAt || sessionStart)

      if (
        native.modifiedAt < sessionStart - NATIVE_LINK_CLOCK_SKEW_MS ||
        native.modifiedAt > sessionEnd + NATIVE_LINK_CLOCK_SKEW_MS
      ) {
        return false
      }

      // If this session already has a title that directly conflicts with the native title,
      // do not bind it (belongs to a different conversation).
      if (session.title && native.title && !isGenericTitle(session.title) && !sessionTitlesMatch(session.title, native.title)) {
        return false
      }

      return true
    })

    if (candidates.length === 0) continue

    // Prioritize candidates:
    // 1. Direct title match (strongest evidence)
    // 2. Causality: session that started BEFORE (or at) native.modifiedAt over one started after
    // 3. FIFO: earlier started session pairs with earlier native session
    candidates.sort((a, b) => {
      const aStart = a.startedAt || a.createdAt
      const bStart = b.startedAt || b.createdAt

      const aTitleMatch = sessionTitlesMatch(a.title, native.title)
      const bTitleMatch = sessionTitlesMatch(b.title, native.title)
      if (aTitleMatch !== bTitleMatch) return aTitleMatch ? -1 : 1

      const aStartedBefore = aStart <= native.modifiedAt
      const bStartedBefore = bStart <= native.modifiedAt
      if (aStartedBefore !== bStartedBefore) return aStartedBefore ? -1 : 1

      return aStart - bStart
    })

    const session = candidates[0]
    usedSessionIds.add(session.id)
    claimedNativeKeys.add(`${native.toolType}:${native.sessionId}`)
    links.push({
      sessionId: session.id,
      toolSessionId: native.sessionId,
      title: native.title || undefined
    })
  }

  return links
}

const AICodingSidebar: React.FC<AICodingSidebarProps> = ({
  onNewWorkspace,
  onNewSession,
  onSelectSession,
  onSelectWorkspace,
  onOpenNewChat,
  onNativeSessionsChange
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const { modal, message } = App.useApp()

  const [searchModalOpen, setSearchModalOpen] = useState(false)

  const workspaces = useAICodingStore((s) => s.workspaces)
  const sessions = useAICodingStore((s) => s.sessions)
  const groups = useAICodingStore((s) => s.groups)
  const activeSessionId = useAICodingStore((s) => s.activeSessionId)
  const deleteWorkspace = useAICodingStore((s) => s.deleteWorkspace)
  const updateWorkspace = useAICodingStore((s) => s.updateWorkspace)
  const renameGroup = useAICodingStore((s) => s.renameGroup)
  const deleteGroup = useAICodingStore((s) => s.deleteGroup)
  const deleteSession = useAICodingStore((s) => s.deleteSession)
  const closeSessionTabs = useAICodingStore((s) => s.closeSessionTabs)
  const attentionItems = useAttentionStore((s) => s.items)
  const codingAttentionIds = useMemo(
    () => attentionItems.filter((i) => i.source === 'ai-coding' && i.targetId).map((i) => i.targetId as string),
    [attentionItems]
  )
  const codingAttentionSet = useMemo(() => new Set(codingAttentionIds), [codingAttentionIds])

  const [sidebarWidth, setSidebarWidth] = useState(240)
  const isResizing = useRef(false)
  const sidebarRootRef = useRef<HTMLDivElement>(null)
  /** Workspace id to scroll into view after expanding from the collapsed rail. */
  const pendingFocusWsIdRef = useRef<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => loadCollapsedGroupIds())
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(() => loadCollapsedWorkspaceIds())
  const collapsedWorkspacesRef = useRef(collapsedWorkspaces)
  collapsedWorkspacesRef.current = collapsedWorkspaces
  const [recentsCollapsed, setRecentsCollapsed] = useState<boolean>(() => loadRecentsCollapsed())
  const [archivedSessionKeys, setArchivedSessionKeys] = useState<Set<string>>(() => loadArchivedSessionKeys())
  const [pinnedSessionKeys, setPinnedSessionKeys] = useState<Set<string>>(() => loadPinnedSessionKeys())
  const openedSessionMap = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])

  // Drag sensors: require pointer movement before a drag starts so stationary
  // clicks of any duration never activate drag mode, flicker opacity, or swallow clicks.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const [renameTarget, setRenameTarget] = useState<{
    type: 'workspace' | 'group'
    id: string
  } | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Native session history state (keyed by workspace id)
  const [nativeSessionsMap, setNativeSessionsMap] = useState<Record<string, NativeSessionState>>({})
  const [nativeSessionVisibleCounts, setNativeSessionVisibleCounts] = useState<Record<string, number>>({})
  const nativeFetchInFlightRef = useRef<Set<string>>(new Set())

  const createSession = useAICodingStore((s) => s.createSession)
  const updateSession = useAICodingStore((s) => s.updateSession)

  // Diff stats per workspace (keyed by workspace id)
  const [diffStats, setDiffStats] = useState<Record<string, { additions: number; deletions: number }>>({})

  // VCS selection shared with the Changes panel + toggle icon. The maps are read
  // via getState() inside fetchDiffStats rather than subscribed: every workspace's
  // detection writes them, and re-running the whole fetch on each write cascaded
  // into hundreds of git/svn spawns at startup, stalling the main process.
  const setVcsAvailable = useVcsSelectionStore((s) => s.setAvailable)
  const setVcsSelection = useVcsSelectionStore((s) => s.setSelection)
  const diffStatRunRef = useRef({ running: false, pending: false })
  const internalVcsSelectRef = useRef(false)
  const workspacesRef = useRef(workspaces)
  useEffect(() => { workspacesRef.current = workspaces }, [workspaces])
  // Only a change to the set of workspace dirs warrants a refetch, not every
  // new `workspaces` array identity from a store refresh.
  const workspaceDirsKey = useMemo(
    () => workspaces.map((w) => `${w.id}\u0000${w.workingDir}`).join('\u0001'),
    [workspaces]
  )

  /** Bind toolSessionId for PTY sessions + pull native titles onto opened rows. Only targets active (non-closed) sessions. */
  const syncOpenedSessionsWithNative = useCallback(async (wsId: string, nativeSessions: SidebarNativeSession[]) => {
    const currentSessions = useAICodingStore.getState().sessions
    const allWorkspaceSessions = currentSessions.filter(
      (session) => session.workspaceId === wsId && session.toolType !== 'terminal'
    )
    const workspaceSessions = allWorkspaceSessions.filter((session) => session.status !== 'closed')
    if (workspaceSessions.length === 0) return

    const links = resolveNativeSessionLinks(workspaceSessions, nativeSessions, allWorkspaceSessions)
    const linkedIds = new Set(links.map((link) => link.sessionId))
    const nativeByKey = new Map(nativeSessions.map((ns) => [`${ns.toolType}:${ns.sessionId}`, ns]))

    const updates: Array<Promise<void>> = links.map((link) => {
      const sess = workspaceSessions.find((s) => s.id === link.sessionId)
      const shouldSetTitle = (!sess?.title || isGenericTitle(sess.title)) && !!link.title
      return updateSession(link.sessionId, {
        toolSessionId: link.toolSessionId,
        ...(shouldSetTitle ? { title: link.title } : {})
      })
    })

    for (const session of workspaceSessions) {
      if (!session.toolSessionId || linkedIds.has(session.id)) continue
      const nativeSession = nativeByKey.get(`${session.toolType}:${session.toolSessionId}`)
      if (!nativeSession?.title || nativeSession.title === session.title) continue
      if (!session.title || isGenericTitle(session.title) || session.title.startsWith('Session ')) {
        updates.push(updateSession(session.id, { title: nativeSession.title }))
      }
    }
    if (updates.length > 0) {
      await Promise.all(updates)
    }

    setPinnedSessionKeys((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const link of links) {
        const sess = workspaceSessions.find((s) => s.id === link.sessionId)
        if (!sess) continue
        const natKey = nativePinKey(sess.toolType, link.toolSessionId)
        const opKey = openedPinKey(sess.id)
        if (sess.pinned || next.has(opKey)) {
          if (!next.has(natKey)) {
            next.add(natKey)
            changed = true
          }
        } else if (next.has(natKey)) {
          if (!next.has(opKey)) {
            next.add(opKey)
            changed = true
          }
          if (!sess.pinned) {
            void updateSession(sess.id, { pinned: true })
          }
        }
      }
      for (const sess of workspaceSessions) {
        if (!sess.toolSessionId) continue
        const natKey = nativePinKey(sess.toolType, sess.toolSessionId)
        const opKey = openedPinKey(sess.id)
        if (sess.pinned || next.has(opKey)) {
          if (!next.has(natKey)) {
            next.add(natKey)
            changed = true
          }
        } else if (next.has(natKey)) {
          if (!next.has(opKey)) {
            next.add(opKey)
            changed = true
          }
          if (!sess.pinned) {
            void updateSession(sess.id, { pinned: true })
          }
        }
      }
      return changed ? next : prev
    })
  }, [updateSession])

  const fetchDiffStatForWorkspace = useCallback(async (
    ws: AICodingWorkspace,
    stats: Record<string, { additions: number; deletions: number }>
  ) => {
    try {
      // Lazily detect the VCS list for this dir once, so the type marker and
      // +/- badge appear without the user first opening the Changes panel.
      // Cached in the shared store; subsequent ticks reuse it.
      let list = useVcsSelectionStore.getState().available[ws.workingDir]
      if (!list) {
        try {
          const detected = (await window.api.vcs.detectAll(ws.workingDir)) as VcsType[]
          list = Array.isArray(detected) ? detected : []
        } catch {
          list = []
        }
        setVcsAvailable(ws.workingDir, list)
        const prev = useVcsSelectionStore.getState().selection[ws.workingDir]
        if (!prev || !list.includes(prev)) {
          internalVcsSelectRef.current = true
          try { setVcsSelection(ws.workingDir, list[0] || null) } finally { internalVcsSelectRef.current = false }
        }
      }
      if (list.length === 0) return
      // Honour the VCS the user picked in the Changes panel for this dir;
      // fall back to the highest-priority detected VCS.
      const sel = useVcsSelectionStore.getState().selection[ws.workingDir]
      const vcs = sel && list.includes(sel) ? sel : list[0]
      const result = await window.api.vcs.diffStat(ws.workingDir, vcs)
      if (result.additions > 0 || result.deletions > 0) {
        stats[ws.id] = result
      }
    } catch { /* ignore dirs without supported VCS */ }
  }, [setVcsAvailable, setVcsSelection])

  /**
   * One pass over all workspaces with bounded concurrency — each diff stat is a
   * git/svn child process, and spawning them all at once blocks the main
   * process for seconds on Windows. Overlapping calls coalesce into one rerun.
   */
  const fetchDiffStats = useCallback(async () => {
    const run = diffStatRunRef.current
    if (run.running) {
      run.pending = true
      return
    }
    run.running = true
    try {
      do {
        run.pending = false
        const stats: Record<string, { additions: number; deletions: number }> = {}
        const queue = [...workspacesRef.current]
        const worker = async (): Promise<void> => {
          for (let ws = queue.shift(); ws; ws = queue.shift()) {
            await fetchDiffStatForWorkspace(ws, stats)
          }
        }
        await Promise.all(Array.from({ length: DIFF_STAT_CONCURRENCY }, worker))
        setDiffStats(stats)
      } while (run.pending)
    } finally {
      run.running = false
    }
  }, [fetchDiffStatForWorkspace])

  useEffect(() => {
    // Deferred so the first paint and the session the user is opening are not
    // competing with a burst of VCS processes.
    const first = window.setTimeout(() => void fetchDiffStats(), DIFF_STAT_INITIAL_DELAY_MS)
    const timer = window.setInterval(() => void fetchDiffStats(), 30_000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [fetchDiffStats, workspaceDirsKey])

  // Follow the VCS the user switches to in the Changes panel. Selections made by
  // detection above are skipped — that pass already uses them.
  useEffect(() => useVcsSelectionStore.subscribe((state, prev) => {
    if (state.selection !== prev.selection && !internalVcsSelectRef.current) void fetchDiffStats()
  }), [fetchDiffStats])

  /**
   * Fetch native sessions for a workspace — queries specified tool types (or all when omitted) and merges.
   * Avoids flipping loading=true for background refreshes when already loaded to avoid UI churn.
   */
  const fetchNativeSessions = useCallback(async (wsId: string, toolTypes?: AIToolType[]) => {
    const ws = workspaces.find(w => w.id === wsId)
    if (!ws) return

    const targetTools = toolTypes && toolTypes.length > 0 ? toolTypes : TOOLS_WITH_NATIVE_SESSIONS
    const inFlightKey = `${wsId}:${[...targetTools].sort().join(',')}`
    if (nativeFetchInFlightRef.current.has(inFlightKey)) return

    nativeFetchInFlightRef.current.add(inFlightKey)
    setNativeSessionsMap(prev => {
      const existing = prev[wsId]
      if (existing?.loaded) return prev
      return {
        ...prev,
        [wsId]: {
          sessions: existing?.sessions || [],
          loading: true,
          loaded: false,
          workingDir: ws.workingDir
        }
      }
    })

    try {
      const results = await Promise.all(
        targetTools.map(async (tt) => {
          try {
            const list = await window.api.aiCoding.listNativeSessions(ws.workingDir, tt)
            return (list || []).map(ns => ({ ...ns, toolType: tt }))
          } catch { return [] }
        })
      )
      const scanned = results.flat()
      setNativeSessionsMap(prev => {
        const existing = prev[wsId]?.sessions || []
        const targetSet = new Set(targetTools)
        const kept = existing.filter(s => !targetSet.has(s.toolType))
        const rawMerged = [...kept, ...scanned].sort((a, b) => b.modifiedAt - a.modifiedAt)
        const seenInWs = new Set<string>()
        const merged = rawMerged.filter((s) => {
          if (!s.sessionId) return false
          const k = `${s.toolType}:${s.sessionId}`
          if (seenInWs.has(k)) return false
          seenInWs.add(k)
          return true
        })

        if (
          existing.length === merged.length &&
          existing.every(
            (s, i) =>
              s.sessionId === merged[i].sessionId &&
              s.title === merged[i].title &&
              s.modifiedAt === merged[i].modifiedAt &&
              s.toolType === merged[i].toolType
          )
        ) {
          if (prev[wsId]?.loaded && !prev[wsId]?.loading) return prev
        }

        return {
          ...prev,
          [wsId]: {
            sessions: merged,
            loading: false,
            loaded: true,
            workingDir: ws.workingDir
          }
        }
      })
      await syncOpenedSessionsWithNative(wsId, scanned)
    } catch {
      setNativeSessionsMap(prev => ({
        ...prev,
        [wsId]: { sessions: prev[wsId]?.sessions || [], loading: false, loaded: true, workingDir: ws.workingDir }
      }))
    } finally {
      nativeFetchInFlightRef.current.delete(inFlightKey)
    }
  }, [syncOpenedSessionsWithNative, workspaces])

  const ensureNativeSessions = useCallback((wsId: string) => {
    const ws = workspaces.find(w => w.id === wsId)
    if (!ws) return
    const state = nativeSessionsMap[wsId]
    if (state?.loaded && state.workingDir === ws.workingDir) return
    fetchNativeSessions(wsId)
  }, [fetchNativeSessions, nativeSessionsMap, workspaces])

  useEffect(() => {
    if (workspaces.length === 0) {
      setNativeSessionsMap({})
      setNativeSessionVisibleCounts({})
      return
    }

    const workspaceIds = new Set(workspaces.map((ws) => ws.id))
    const workspaceDirs = new Map(workspaces.map((ws) => [ws.id, ws.workingDir]))
    setNativeSessionVisibleCounts((prev) => {
      const next: Record<string, number> = {}
      for (const ws of workspaces) {
        if (prev[ws.id] !== undefined) next[ws.id] = prev[ws.id]
      }
      return next
    })
    setNativeSessionsMap((prev) => {
      const next: typeof prev = {}
      for (const [wsId, state] of Object.entries(prev)) {
        const workingDir = workspaceDirs.get(wsId)
        if (!workingDir) continue
        next[wsId] = state.workingDir === workingDir
          ? state
          : { sessions: [], loading: false, loaded: false, workingDir }
      }
      return next
    })
    setCollapsedWorkspaces((prev) => {
      const next = new Set([...prev].filter((wsId) => workspaceIds.has(wsId)))
      return next.size === prev.size ? prev : next
    })
  }, [workspaces])

  useEffect(() => {
    persistCollapsedWorkspaceIds(collapsedWorkspaces)
  }, [collapsedWorkspaces])

  useEffect(() => {
    persistCollapsedGroupIds(collapsedGroups)
  }, [collapsedGroups])

  useEffect(() => {
    persistRecentsCollapsed(recentsCollapsed)
  }, [recentsCollapsed])

  useEffect(() => {
    persistArchivedSessionKeys(archivedSessionKeys)
  }, [archivedSessionKeys])

  useEffect(() => {
    persistPinnedSessionKeys(pinnedSessionKeys)
  }, [pinnedSessionKeys])

  useEffect(() => {
    onNativeSessionsChange?.(nativeSessionsMap)
  }, [nativeSessionsMap, onNativeSessionsChange])

  // On initial mount / workspaces change: scan all workspaces for native sessions
  // so the top-level Recents group and New Chat view reflect recent conversations.
  useEffect(() => {
    for (const ws of workspaces) {
      const state = nativeSessionsMap[ws.id]
      if (state?.workingDir === ws.workingDir && (state.loaded || state.loading)) continue
      fetchNativeSessions(ws.id)
    }
  }, [workspaces, nativeSessionsMap, fetchNativeSessions])

  // Active opened non-terminal tools by workspace. Closed sessions are not scanned.
  const openToolsByWorkspace = useMemo(() => {
    const map = new Map<string, Set<AIToolType>>()
    for (const s of sessions) {
      if (s.toolType === 'terminal' || s.status === 'closed') continue
      let set = map.get(s.workspaceId)
      if (!set) {
        set = new Set()
        map.set(s.workspaceId, set)
      }
      set.add(s.toolType)
    }
    return map
  }, [sessions])

  // Debounced re-sync only when opened non-closed sessions change (added/closed/linked/titled).
  // Excludes updatedAt to avoid re-triggering on normal activity/timestamp updates.
  const openSessionsKey = useMemo(
    () => sessions
      .filter((s) => s.toolType !== 'terminal' && s.status !== 'closed')
      .map((s) => `${s.id}:${s.workspaceId}:${s.toolType}:${s.toolSessionId || ''}:${s.title || ''}`)
      .join('|'),
    [sessions]
  )

  useEffect(() => {
    if (workspaces.length === 0 || openToolsByWorkspace.size === 0) return
    const timer = setTimeout(() => {
      for (const [wsId, tools] of openToolsByWorkspace.entries()) {
        fetchNativeSessions(wsId, Array.from(tools))
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [openSessionsKey, workspaces, openToolsByWorkspace, fetchNativeSessions])

  // Periodic background scan ONLY for currently opened sessions. Closed sessions are not scanned.
  // Fast polling (3s) applies ONLY to recently opened sessions (< 30s old) that are still missing
  // toolSessionId or title. Once older or already resolved, drops back to normal interval (12s).
  // If no sessions are open, background polling stops completely.
  const hasPendingOpenedSessions = useMemo(() => {
    const now = Date.now()
    return sessions.some((s) => {
      if (s.toolType === 'terminal' || s.status === 'closed') return false
      const isPending = !s.toolSessionId || !s.title
      if (!isPending) return false
      const age = now - (s.startedAt || s.createdAt || 0)
      return age >= 0 && age < 30_000
    })
  }, [sessions])

  useEffect(() => {
    if (workspaces.length === 0 || openToolsByWorkspace.size === 0) return
    const intervalMs = hasPendingOpenedSessions ? NATIVE_SESSION_POLL_UNLINKED_MS : NATIVE_SESSION_POLL_MS
    const timer = setInterval(() => {
      for (const [wsId, tools] of openToolsByWorkspace.entries()) {
        fetchNativeSessions(wsId, Array.from(tools))
      }
    }, intervalMs)
    return () => clearInterval(timer)
  }, [workspaces, openToolsByWorkspace, fetchNativeSessions, hasPendingOpenedSessions])

  // Map of opened session ID -> resolved toolSessionId (including provisional matches)
  const sessionToolIdMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const ws of workspaces) {
      const wsSessions = sessions.filter((s) => s.workspaceId === ws.id && s.toolType !== 'terminal')
      const wsNatives = nativeSessionsMap[ws.id]?.sessions || []
      const links = resolveNativeSessionLinks(wsSessions, wsNatives)
      for (const link of links) {
        if (link.sessionId && link.toolSessionId) {
          map.set(link.sessionId, link.toolSessionId)
        }
      }
    }
    for (const s of sessions) {
      if (s.toolSessionId) {
        map.set(s.id, s.toolSessionId)
      }
    }
    return map
  }, [workspaces, sessions, nativeSessionsMap])

  /** Resume a native session into a workspace */
  const handleResumeNativeSession = useCallback(async (wsId: string, toolType: AIToolType, nativeSessionId: string, title?: string) => {
    try {
      const matchesNative = (s: AICodingSession): boolean =>
        s.toolType === toolType &&
        (s.toolSessionId === nativeSessionId || sessionToolIdMap.get(s.id) === nativeSessionId)

      const existingSession =
        sessions.find(s => s.workspaceId === wsId && matchesNative(s)) ||
        sessions.find(s => matchesNative(s))
      if (existingSession) {
        onSelectSession(existingSession.id)
        return
      }

      const isPinned = pinnedSessionKeys.has(nativePinKey(toolType, nativeSessionId))
      const newSession = await createSession(wsId, toolType, 'local')
      await updateSession(newSession.id, {
        toolSessionId: nativeSessionId,
        ...(title ? { title } : {}),
        ...(isPinned ? { pinned: true } : {})
      })
      if (isPinned) {
        setPinnedSessionKeys((prev) => {
          const next = new Set(prev)
          next.add(openedPinKey(newSession.id))
          return next
        })
      }
      onSelectSession(newSession.id)
    } catch {
      message.error(t('coding.createSessionFailed'))
    }
  }, [createSession, updateSession, sessions, sessionToolIdMap, pinnedSessionKeys, onSelectSession, message, t])

  // Global Ctrl+K / Cmd+K search shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchModalOpen(true)
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  // Handle session selection from Search Modal: locate and pulse in sidebar
  const handleSelectFromSearch = useCallback(
    async (
      sessionId: string,
      workspaceId: string,
      nativeToolType?: AIToolType,
      nativeTitle?: string
    ) => {
      const ws = workspaces.find((w) => w.id === workspaceId)
      if (ws) {
        setCollapsedGroups((prev) => {
          if (!prev.has(ws.groupId)) return prev
          const next = new Set(prev)
          next.delete(ws.groupId)
          return next
        })
      }
      setCollapsedWorkspaces((prev) => {
        if (!prev.has(workspaceId)) return prev
        const next = new Set(prev)
        next.delete(workspaceId)
        return next
      })

      if (collapsed) {
        setCollapsed(false)
      }

      if (nativeToolType && !sessionId.startsWith('opened-')) {
        await handleResumeNativeSession(workspaceId, nativeToolType, sessionId, nativeTitle)
      } else {
        onSelectSession(sessionId)
      }

      setTimeout(() => {
        const target =
          document.querySelector(`[data-cb-session-id="${sessionId}"]`) ||
          document.querySelector(`[data-cb-ws-id="${workspaceId}"]`)
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          target.classList.add('cb-locate-flash')
          setTimeout(() => target.classList.remove('cb-locate-flash'), 1400)
        }
      }, 150)
    },
    [collapsed, handleResumeNativeSession, onSelectSession, workspaces]
  )

  const activeNativeSessionId = useMemo(() => {
    if (!activeSessionId) return undefined
    return sessionToolIdMap.get(activeSessionId)
  }, [activeSessionId, sessionToolIdMap])

  const activeToolType = useMemo(() => {
    if (!activeSessionId) return undefined
    return sessions.find((s) => s.id === activeSessionId)?.toolType
  }, [activeSessionId, sessions])

  /** Unified check for whether a session row or recents item matches the current active session/tab. */
  const isRowActive = useCallback(
    (row: {
      openedSessionId?: string
      sessionId?: string
      nativeSessionId?: string
      toolType?: AIToolType
    }) => {
      if (!activeSessionId) return false
      const openedId = row.openedSessionId || row.sessionId
      if (openedId && openedId === activeSessionId) return true

      if (activeNativeSessionId && row.nativeSessionId && row.toolType) {
        if (row.toolType === activeToolType && row.nativeSessionId === activeNativeSessionId) {
          return true
        }
      }

      if (activeNativeSessionId && openedId) {
        const rowNativeId = sessionToolIdMap.get(openedId)
        if (rowNativeId && rowNativeId === activeNativeSessionId && row.toolType === activeToolType) {
          return true
        }
      }

      return false
    },
    [activeSessionId, activeNativeSessionId, activeToolType, sessionToolIdMap]
  )

  // Compute recent conversations for the fixed "Recents" group
  const recentConversations = useMemo(() => {
    const list: Array<{
      key: string
      sessionId?: string
      nativeSessionId?: string
      toolType: AIToolType
      title: string
      modifiedAt: number
      workspaceId: string
      workspaceTitle: string
      isNative: boolean
    }> = []
    const wsMap = new Map(workspaces.map((w) => [w.id, w]))
    const seenNativeKeys = new Set<string>()
    const seenItemKeys = new Set<string>()

    const allNativesByKey = new Map<string, SidebarNativeSession>()
    for (const [wsId, st] of Object.entries(nativeSessionsMap)) {
      if (!wsMap.has(wsId)) continue
      for (const ns of st.sessions || []) {
        if (!ns.sessionId) continue
        const natKey = `${ns.toolType}:${ns.sessionId}`
        const prev = allNativesByKey.get(natKey)
        if (!prev || ns.modifiedAt > prev.modifiedAt) {
          allNativesByKey.set(natKey, ns)
        }
      }
    }

    // Prefer active session, then newest updatedAt when deduplicating opened sessions
    const orderedSessions = [...sessions].sort((a, b) => {
      if (a.id === activeSessionId && b.id !== activeSessionId) return -1
      if (b.id === activeSessionId && a.id !== activeSessionId) return 1
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
    })

    for (const s of orderedSessions) {
      if (s.toolType === 'terminal') continue
      if (archivedSessionKeys.has(openedArchiveKey(s.id))) continue
      const ws = wsMap.get(s.workspaceId)
      if (!ws) continue

      const toolSessionId = sessionToolIdMap.get(s.id) || s.toolSessionId
      const nativeKey = toolSessionId ? `${s.toolType}:${toolSessionId}` : ''
      if (nativeKey && seenNativeKeys.has(nativeKey)) continue
      const nativeSession = nativeKey ? allNativesByKey.get(nativeKey) : undefined

      if (nativeKey) seenNativeKeys.add(nativeKey)
      if (nativeSession && archivedSessionKeys.has(nativeArchiveKey(s.toolType, nativeSession.sessionId))) {
        continue
      }

      const itemKey = `recent-opened-${s.id}`
      if (seenItemKeys.has(itemKey)) continue
      seenItemKeys.add(itemKey)

      const displayTitle =
        (!isGenericTitle(s.title) && s.title) ||
        nativeSession?.title ||
        s.title ||
        `${AI_TOOL_SHORT_NAMES[s.toolType] || s.toolType} chat`

      const modifiedAt = Math.max(
        s.updatedAt || 0,
        s.createdAt || 0,
        nativeSession?.modifiedAt || 0
      )

      list.push({
        key: itemKey,
        sessionId: s.id,
        nativeSessionId: toolSessionId,
        toolType: s.toolType,
        title: displayTitle,
        modifiedAt,
        workspaceId: s.workspaceId,
        workspaceTitle: ws.title || '',
        isNative: false
      })
    }

    // Prefer more specific (deeper) workspace paths if a native session appears under nested workspaces
    const nativeEntries = Object.entries(nativeSessionsMap)
      .filter(([wsId]) => wsMap.has(wsId))
      .sort(([aId], [bId]) => {
        const aLen = wsMap.get(aId)?.workingDir?.length || 0
        const bLen = wsMap.get(bId)?.workingDir?.length || 0
        return bLen - aLen
      })

    for (const [wsId, st] of nativeEntries) {
      const ws = wsMap.get(wsId)
      if (!ws) continue
      for (const ns of st.sessions || []) {
        if (!ns.sessionId) continue
        const natKey = `${ns.toolType}:${ns.sessionId}`
        if (seenNativeKeys.has(natKey)) continue
        seenNativeKeys.add(natKey)
        if (archivedSessionKeys.has(nativeArchiveKey(ns.toolType, ns.sessionId))) continue

        const itemKey = `recent-native-${wsId}-${ns.toolType}-${ns.sessionId}`
        if (seenItemKeys.has(itemKey)) continue
        seenItemKeys.add(itemKey)

        list.push({
          key: itemKey,
          nativeSessionId: ns.sessionId,
          toolType: ns.toolType,
          title: ns.title || `${AI_TOOL_SHORT_NAMES[ns.toolType] || ns.toolType} session`,
          modifiedAt: ns.modifiedAt,
          workspaceId: wsId,
          workspaceTitle: ws.title || '',
          isNative: true
        })
      }
    }

    list.sort((a, b) => b.modifiedAt - a.modifiedAt)
    return list.slice(0, 5)
  }, [sessions, activeSessionId, nativeSessionsMap, workspaces, sessionToolIdMap, archivedSessionKeys])

  const handleTogglePinSessionRow = useCallback((row: SidebarSessionRow) => {
    const isCurrentlyPinned = isSessionRowPinned(row, pinnedSessionKeys, openedSessionMap)
    const nextPinned = !isCurrentlyPinned
    const keys: string[] = []
    if (row.nativeSessionId) keys.push(nativePinKey(row.toolType, row.nativeSessionId))
    if (row.openedSessionId) keys.push(openedPinKey(row.openedSessionId))

    setPinnedSessionKeys((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (nextPinned) {
          next.add(k)
        } else {
          next.delete(k)
        }
      }
      return next
    })

    const matchingSession = row.openedSessionId
      ? openedSessionMap.get(row.openedSessionId)
      : sessions.find((s) => s.toolType === row.toolType && s.toolSessionId === row.nativeSessionId)
    if (matchingSession) {
      void updateSession(matchingSession.id, { pinned: nextPinned })
    }
  }, [pinnedSessionKeys, openedSessionMap, sessions, updateSession])

  /** Hide a conversation from the history list without deleting it. Records both
   * the native key (so it stays hidden across restarts) and the opened-session
   * key (so a session still hidden before it links to a native id doesn't pop
   * back when the link arrives). Also closes any open tab for this session. */
  const handleArchiveSessionRow = useCallback(async (row: SidebarSessionRow) => {
    const keys: string[] = []
    if (row.nativeSessionId) keys.push(nativeArchiveKey(row.toolType, row.nativeSessionId))
    if (row.openedSessionId) keys.push(openedArchiveKey(row.openedSessionId))
    if (keys.length === 0) return

    // Auto-close any opened tab for this session
    const openedIds = new Set<string>()
    if (row.openedSessionId) openedIds.add(row.openedSessionId)
    if (row.nativeSessionId) {
      sessions
        .filter((s) => s.toolType === row.toolType && s.toolSessionId === row.nativeSessionId)
        .forEach((s) => openedIds.add(s.id))
    }
    for (const sid of openedIds) {
      await closeSessionTabs(sid)
    }

    setArchivedSessionKeys((prev) => {
      if (keys.every((k) => prev.has(k))) return prev
      const next = new Set(prev)
      for (const k of keys) next.add(k)
      return next
    })
    message.success(t('coding.sessionArchived'))
  }, [closeSessionTabs, message, sessions, t])

  const handleDeleteSessionRow = useCallback((row: SidebarSessionRow, wsId: string) => {
    modal.confirm({
      title: t('coding.deleteSession'),
      content: t('coding.deleteSessionConfirm', row.title || row.key),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          // 1. Collect all opened sessions matching this row
          const openedIds = new Set<string>()
          if (row.openedSessionId) openedIds.add(row.openedSessionId)
          if (row.nativeSessionId) {
            sessions
              .filter((s) => s.toolType === row.toolType && s.toolSessionId === row.nativeSessionId)
              .forEach((s) => openedIds.add(s.id))
          }

          // 2. Automatically close open tabs for this session
          for (const sid of openedIds) {
            await closeSessionTabs(sid)
          }

          // 3. Delete opened session record(s)
          for (const sid of openedIds) {
            await deleteSession(sid)
          }

          // 4. Delete native CLI session record on disk if present
          if (row.nativeSessionId) {
            const ws = workspaces.find((w) => w.id === wsId)
            if (ws?.workingDir) {
              await window.api.aiCoding.deleteNativeSession(ws.workingDir, row.toolType, row.nativeSessionId)
            }
            dismissCodingTarget(row.nativeSessionId)
            setNativeSessionsMap((prev) => {
              const existing = prev[wsId]
              if (!existing) return prev
              return {
                ...prev,
                [wsId]: {
                  ...existing,
                  sessions: existing.sessions.filter(
                    (s) => !(s.toolType === row.toolType && s.sessionId === row.nativeSessionId)
                  )
                }
              }
            })
          }

          // 5. Clean up pin & archive keys
          const pinKeys: string[] = []
          if (row.nativeSessionId) pinKeys.push(nativePinKey(row.toolType, row.nativeSessionId))
          if (row.openedSessionId) pinKeys.push(openedPinKey(row.openedSessionId))
          for (const sid of openedIds) pinKeys.push(openedPinKey(sid))
          setPinnedSessionKeys((prev) => {
            const next = new Set(prev)
            for (const k of pinKeys) next.delete(k)
            return next
          })

          const archiveKeys: string[] = []
          if (row.nativeSessionId) archiveKeys.push(nativeArchiveKey(row.toolType, row.nativeSessionId))
          if (row.openedSessionId) archiveKeys.push(openedArchiveKey(row.openedSessionId))
          for (const sid of openedIds) archiveKeys.push(openedArchiveKey(sid))
          setArchivedSessionKeys((prev) => {
            const next = new Set(prev)
            for (const k of archiveKeys) next.delete(k)
            return next
          })

          message.success(t('coding.sessionDeleted'))
        } catch (err) {
          console.error('Delete session failed:', err)
          message.error(t('coding.deleteSessionFailed'))
        }
      }
    })
  }, [closeSessionTabs, deleteSession, message, modal, sessions, t, workspaces])

  /** Persist a within-group workspace reorder. Pinned and unpinned are separate
   *  sortable sections, so cross-section drags are rejected. After a valid drag
   *  the whole group's `order` is re-normalized to 0..n-1 (pinned first) so the
   *  sort stays stable. */
  const handleWorkspaceDragEnd = useCallback((event: DragEndEvent, groupId: string) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const groupWs = workspaces.filter((w) => w.groupId === groupId).slice().sort(workspaceSort)
    const activeWs = groupWs.find((w) => w.id === activeId)
    const overWs = groupWs.find((w) => w.id === overId)
    if (!activeWs || !overWs || !!activeWs.pinned !== !!overWs.pinned) return
    const section = groupWs.filter((w) => !!w.pinned === !!activeWs.pinned)
    const from = section.findIndex((w) => w.id === activeId)
    const to = section.findIndex((w) => w.id === overId)
    if (from === -1 || to === -1) return
    const reorderedSection = arrayMove(section, from, to)
    const ordered = activeWs.pinned
      ? [...reorderedSection, ...groupWs.filter((w) => !w.pinned)]
      : [...groupWs.filter((w) => w.pinned), ...reorderedSection]
    void (async () => {
      for (let i = 0; i < ordered.length; i++) {
        const w = ordered[i]
        if (w.order !== i) await updateWorkspace(w.id, { order: i })
      }
    })()
  }, [workspaces, updateWorkspace])

  /** Format relative time */
  const formatRelativeTime = (ms: number): string => {
    const diff = Date.now() - ms
    const minutes = Math.floor(diff / 60_000)
    if (minutes < 1) return t('workbench.justNow')
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    return `${Math.floor(hours / 24)}d`
  }

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isResizing.current = true
      e.preventDefault()
      const startX = e.clientX
      const startWidth = sidebarWidth
      const onMouseMove = (me: MouseEvent): void => {
        const newWidth = Math.min(480, Math.max(160, startWidth + me.clientX - startX))
        setSidebarWidth(newWidth)
      }
      const onMouseUp = (): void => {
        isResizing.current = false
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [sidebarWidth]
  )

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  const toggleWorkspace = useCallback((wsId: string) => {
    const willExpand = collapsedWorkspacesRef.current.has(wsId)
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev)
      if (next.has(wsId)) next.delete(wsId)
      else next.add(wsId)
      collapsedWorkspacesRef.current = next
      return next
    })
    if (willExpand) fetchNativeSessions(wsId)
  }, [fetchNativeSessions])

  const filteredWorkspaces = useMemo(() => {
    if (!filterText.trim()) return workspaces
    const lower = filterText.toLowerCase()
    return workspaces.filter(
      (w) =>
        w.title.toLowerCase().includes(lower) || w.workingDir.toLowerCase().includes(lower)
    )
  }, [workspaces, filterText])

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.order - b.order),
    [groups]
  )

  // Workspace that owns the active session — used to highlight its collapsed-rail avatar and collapsed workspace header.
  const activeWorkspaceId = useMemo(() => {
    if (!activeSessionId) return undefined
    const s = sessions.find((s) => s.id === activeSessionId)
    if (s?.workspaceId) return s.workspaceId
    for (const [wsId, st] of Object.entries(nativeSessionsMap)) {
      if (st.sessions?.some((ns) => ns.sessionId === activeSessionId)) {
        return wsId
      }
    }
    return undefined
  }, [activeSessionId, sessions, nativeSessionsMap])

  // Collapsed-rail items: workspace avatars grouped with dividers, capped at COLLAPSED_RAIL_MAX total.
  const collapsedRailItems = useMemo(() => {
    const items: Array<
      | { kind: 'divider'; key: string }
      | { kind: 'ws'; key: string; ws: AICodingWorkspace }
    > = []
    let count = 0
    let seenGroup = false
    for (const group of sortedGroups) {
      const groupWorkspaces = filteredWorkspaces
        .filter((w) => w.groupId === group.id)
        .sort(workspaceSort)
      if (groupWorkspaces.length === 0) continue
      if (count >= COLLAPSED_RAIL_MAX) break
      if (seenGroup) items.push({ kind: 'divider', key: `cw-div-${group.id}` })
      seenGroup = true
      for (const ws of groupWorkspaces) {
        if (count >= COLLAPSED_RAIL_MAX) break
        items.push({ kind: 'ws', key: `cw-${ws.id}`, ws })
        count += 1
      }
    }
    return items
  }, [sortedGroups, filteredWorkspaces])

  const collapsedTotalCount = filteredWorkspaces.length
  const hasCollapsedOverflow = collapsedTotalCount > COLLAPSED_RAIL_MAX

  /** Expand the sidebar and reveal a workspace clicked from the collapsed rail. */
  const focusWorkspace = useCallback(
    (wsId: string, groupId: string) => {
      setCollapsed(false)
      setCollapsedGroups((prev) => {
        if (!prev.has(groupId)) return prev
        const next = new Set(prev)
        next.delete(groupId)
        return next
      })
      setCollapsedWorkspaces((prev) => {
        if (!prev.has(wsId)) return prev
        const next = new Set(prev)
        next.delete(wsId)
        return next
      })
      ensureNativeSessions(wsId)
      onSelectWorkspace(wsId)
      pendingFocusWsIdRef.current = wsId
    },
    [ensureNativeSessions, onSelectWorkspace]
  )

  // After the sidebar expands, scroll the targeted workspace row into view.
  useEffect(() => {
    if (collapsed) return
    const wsId = pendingFocusWsIdRef.current
    if (!wsId) return
    pendingFocusWsIdRef.current = null
    const timer = window.setTimeout(() => {
      // Escape chars that break a double-quoted attribute selector. (The global
      // `CSS` is shadowed here by the @dnd-kit/utilities import, so escape manually.)
      const safeId = wsId.replace(/["\\]/g, '\\$&')
      const el = sidebarRootRef.current?.querySelector(`[data-cb-ws-id="${safeId}"]`)
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [collapsed, filteredWorkspaces, sortedGroups, collapsedWorkspaces, collapsedGroups])

  // Ensure native sessions are scanned for the active workspace, but preserve
  // the workspace's open/closed state as chosen by the user.
  useEffect(() => {
    if (!activeSessionId) return
    const activeSession = sessions.find((s) => s.id === activeSessionId)
    if (!activeSession?.workspaceId) return
    const ws = workspaces.find((w) => w.id === activeSession.workspaceId)
    if (!ws) return

    setCollapsedGroups((prev) => {
      if (!prev.has(ws.groupId)) return prev
      const next = new Set(prev)
      next.delete(ws.groupId)
      return next
    })

    ensureNativeSessions(ws.id)
  }, [activeSessionId, sessions, workspaces, ensureNativeSessions])

  // Scroll active session or workspace folder into view when tab switches
  useEffect(() => {
    if (!activeSessionId || collapsed) return
    const timer = window.setTimeout(() => {
      const currentSessions = useAICodingStore.getState().sessions
      const activeSession = currentSessions.find((s) => s.id === activeSessionId)
      const wsId = activeSession?.workspaceId
      const isWsCollapsed = wsId ? collapsedWorkspacesRef.current.has(wsId) : false

      if (isWsCollapsed && wsId) {
        // If workspace is closed, lock / scroll into view the workspace folder row directly
        const safeWsId = wsId.replace(/["\\]/g, '\\$&')
        const wsEl = sidebarRootRef.current?.querySelector(`[data-cb-ws-id="${safeWsId}"]`) as HTMLElement | null
        wsEl?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
      } else {
        // If workspace is open, lock / scroll to the active session row in the workspace tree
        const safeSessionId = activeSessionId.replace(/["\\]/g, '\\$&')
        const wsSessionEl = sidebarRootRef.current?.querySelector(
          `[data-cb-session-id="${safeSessionId}"]:not([data-cb-recent-key])`
        ) as HTMLElement | null
        const recentEl = sidebarRootRef.current?.querySelector(
          `[data-cb-recent-key][data-cb-session-id="${safeSessionId}"]`
        ) as HTMLElement | null
        const target = wsSessionEl || recentEl
        target?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
      }
    }, 60)
    return () => window.clearTimeout(timer)
  }, [activeSessionId, collapsed])

  const startRename = (type: 'workspace' | 'group', id: string, current: string) => {
    setRenameTarget({ type, id })
    setRenameValue(current)
  }

  const commitRename = async () => {
    if (!renameTarget || !renameValue.trim()) {
      setRenameTarget(null)
      return
    }
    try {
      if (renameTarget.type === 'workspace') {
        await updateWorkspace(renameTarget.id, { title: renameValue.trim() })
      } else {
        await renameGroup(renameTarget.id, renameValue.trim())
      }
    } catch {
      // ignore
    }
    setRenameTarget(null)
  }

  const handleDeleteWorkspace = (wsId: string) => {
    const ws = workspaces.find((w) => w.id === wsId)
    modal.confirm({
      title: t('coding.deleteWorkspace'),
      content: t('coding.deleteWorkspaceConfirm', ws?.title || wsId),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: () => deleteWorkspace(wsId)
    })
  }

  const handleDeleteGroup = (groupId: string) => {
    const g = groups.find((grp) => grp.id === groupId)
    modal.confirm({
      title: t('coding.deleteGroup'),
      content: t('coding.deleteGroupConfirm', g?.name || groupId),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: async () => {
        const result = await deleteGroup(groupId)
        if (!result.success) message.error(result.error || t('coding.deleteGroupFailed'))
      }
    })
  }

  const buildWorkspaceMenu = (ws: AICodingWorkspace): MenuProps['items'] => [
    {
      key: 'pin',
      label: ws.pinned ? t('workbench.unpin') : t('workbench.pin'),
      onClick: () => updateWorkspace(ws.id, { pinned: !ws.pinned })
    },
    { key: 'rename', label: t('coding.renameItem'), onClick: () => startRename('workspace', ws.id, ws.title) },
    { type: 'divider' },
    { key: 'delete', label: t('coding.deleteWorkspaceMenu'), danger: true, onClick: () => handleDeleteWorkspace(ws.id) }
  ]

  const buildGroupMenu = (groupId: string, name: string): MenuProps['items'] => [
    { key: 'rename', label: t('coding.renameGroup'), onClick: () => startRename('group', groupId, name) },
    { type: 'divider' },
    { key: 'delete', label: t('coding.deleteGroupMenu'), danger: true, onClick: () => handleDeleteGroup(groupId) }
  ]

  const buildSessionRowMenu = (row: SidebarSessionRow, wsId: string): MenuProps['items'] => {
    const isPinned = isSessionRowPinned(row, pinnedSessionKeys, openedSessionMap)
    return createSessionRowMenuItems({
      isPinned,
      onTogglePin: () => handleTogglePinSessionRow(row),
      onArchive: () => void handleArchiveSessionRow(row),
      onDelete: () => handleDeleteSessionRow(row, wsId),
      pinLabel: t('workbench.pin'),
      unpinLabel: t('workbench.unpin'),
      archiveLabel: t('coding.archiveSession'),
      deleteLabel: t('coding.deleteSession')
    })
  }

  const rowBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    boxSizing: 'border-box',
    cursor: 'pointer',
    userSelect: 'none'
  }

  return (
    <div
      ref={sidebarRootRef}
      style={{
        width: collapsed ? 44 : sidebarWidth,
        minWidth: collapsed ? 44 : 160,
        height: '100%',
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
        transition: 'width 0.2s ease, min-width 0.2s ease'
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 38,
          boxSizing: 'border-box',
          padding: collapsed ? '0 8px' : '0 12px',
          fontWeight: 600,
          fontSize: 13,
          color: token.colorText,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}
      >
        {!collapsed && (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t('coding.title')}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {!collapsed && (
            <Tooltip title={t('coding.searchSessions')}>
              <Button
                type="text"
                size="small"
                icon={<SearchOutlined style={{ fontSize: 13, color: token.colorTextSecondary }} />}
                onClick={() => setSearchModalOpen(true)}
              />
            </Tooltip>
          )}
          <Tooltip title={collapsed ? t('common.expandSidebar') : t('common.collapseSidebar')} placement="right">
            <Button
              type="text"
              size="small"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((v) => !v)}
              style={{ flexShrink: 0 }}
            />
          </Tooltip>
        </div>
      </div>

      {/* Collapsed rail: new workspace + workspace first-letter avatars */}
      {collapsed && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            flex: 1,
            minHeight: 0,
            gap: 6,
            padding: '8px 0 6px'
          }}
        >
          <Tooltip title={t('coding.searchSessions')} placement="right">
            <Button
              type="text"
              icon={<SearchOutlined style={{ fontSize: 14, color: token.colorTextSecondary }} />}
              onClick={() => setSearchModalOpen(true)}
              style={{ width: 30, height: 30, flexShrink: 0 }}
            />
          </Tooltip>
          <Tooltip title={t('coding.newChat')} placement="right">
            <Button
              type="primary"
              ghost
              icon={<PlusOutlined />}
              onClick={() => onOpenNewChat?.()}
              style={{ width: 30, height: 30, flexShrink: 0, borderRadius: '50%' }}
            />
          </Tooltip>
          <Tooltip title={t('coding.newWorkspace')} placement="right">
            <Button
              type="primary"
              ghost
              icon={<FolderAddOutlined />}
              onClick={onNewWorkspace}
              style={{ width: 30, height: 30, flexShrink: 0, borderRadius: '50%' }}
            />
          </Tooltip>

          {/* Scrollable workspace avatars, grouped with dividers, capped at COLLAPSED_RAIL_MAX */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              width: '100%',
              overflowY: 'auto',
              overflowX: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6
            }}
          >
            {collapsedRailItems.map((item) =>
              item.kind === 'divider' ? (
                <div
                  key={item.key}
                  style={{
                    width: 18,
                    height: 1,
                    background: token.colorBorderSecondary,
                    margin: '2px 0',
                    flexShrink: 0
                  }}
                />
              ) : (
                <Tooltip
                  key={item.key}
                  title={item.ws.title?.trim() || t('coding.untitledWorkspace')}
                  placement="right"
                >
                  <button
                    type="button"
                    aria-label={item.ws.title?.trim() || t('coding.untitledWorkspace')}
                    onClick={() => focusWorkspace(item.ws.id, item.ws.groupId)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-1px)'
                      e.currentTarget.style.boxShadow = token.boxShadowTertiary
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = ''
                      e.currentTarget.style.boxShadow = ''
                    }}
                    style={{
                      width: 30,
                      height: 30,
                      boxSizing: 'border-box',
                      borderRadius: '50%',
                      flexShrink: 0,
                      padding: 0,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 600,
                      fontSize: 13,
                      fontFamily: 'inherit',
                      transition:
                        'transform 0.14s ease, box-shadow 0.14s ease, background 0.14s ease',
                      border: `1px solid ${
                        item.ws.id === activeWorkspaceId
                          ? token.colorPrimary
                          : token.colorBorderSecondary
                      }`,
                      background:
                        item.ws.id === activeWorkspaceId
                          ? token.colorPrimaryBg
                          : item.ws.pinned
                            ? token.colorPrimaryBgHover
                            : token.colorFillQuaternary,
                      color:
                        item.ws.id === activeWorkspaceId ? token.colorPrimary : token.colorText
                    }}
                  >
                    {firstLetterOf(item.ws.title)}
                  </button>
                </Tooltip>
              )
            )}
          </div>

          {/* Overflow entry — expand the sidebar to see all workspaces */}
          {hasCollapsedOverflow && (
            <Tooltip title={t('coding.moreWorkspaces', collapsedTotalCount)} placement="right">
              <Button
                type="text"
                size="small"
                icon={<EllipsisOutlined />}
                onClick={() => setCollapsed(false)}
                style={{ width: 30, height: 30, flexShrink: 0 }}
              />
            </Tooltip>
          )}
        </div>
      )}

      {/* Content card */}
      {!collapsed && (
      <div style={{
        background: token.colorBgLayout,
        borderRadius: token.borderRadiusSM,
        margin: '3px 4px',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        <style>{`
          .cb-ws-row .cb-ws-hover-actions {
            display: none !important;
          }
          .cb-ws-row:hover .cb-ws-hover-actions {
            display: inline-flex !important;
          }
          .cb-ws-row:hover .cb-ws-pin-icon {
            margin-right: 2px !important;
          }
          @keyframes cb-locate-pulse {
            0%, 100% { background: transparent; }
            50% { background: rgba(59, 130, 246, 0.28); }
          }
          .cb-locate-flash {
            animation: cb-locate-pulse 0.6s ease-in-out 2 !important;
            border-radius: 4px;
          }
        `}</style>

        {/* Top Fixed New Chat & Add Workspace Buttons */}
        <div style={{ padding: '6px 8px 4px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Button
            type="primary"
            ghost
            icon={<PlusOutlined />}
            onClick={() => onOpenNewChat?.()}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              height: 32,
              borderRadius: token.borderRadiusSM,
              fontWeight: 600,
              fontSize: 13,
              borderColor: token.colorPrimary,
              background: token.colorBgContainer
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('coding.newChat')}
            </span>
          </Button>
          <Tooltip title={t('coding.newWorkspace')}>
            <Button
              type="primary"
              ghost
              icon={<FolderAddOutlined />}
              onClick={onNewWorkspace}
              aria-label={t('coding.newWorkspace')}
              style={{
                width: 32,
                height: 32,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                borderRadius: token.borderRadiusSM,
                borderColor: token.colorPrimary,
                background: token.colorBgContainer
              }}
            />
          </Tooltip>
        </div>

        {/* Tree */}
        <div style={{ flex: 1, overflow: 'auto', padding: '2px 0' }}>
          {/* Recents Group */}
          {workspaces.length > 0 && (
            <div style={{ marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
              <div
                data-cb-recents-header="true"
                onClick={() => setRecentsCollapsed((prev) => !prev)}
                style={{
                  ...rowBase,
                  padding: '2px 8px',
                  minHeight: 22,
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 600,
                  color: token.colorTextTertiary,
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  userSelect: 'none',
                  borderRadius: token.borderRadiusSM
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = token.colorFillTertiary
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                <ClockCircleOutlined style={{ fontSize: 11, flexShrink: 0, color: token.colorTextTertiary }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t('coding.recents')}
                </span>
                <RightOutlined
                  style={{
                    fontSize: 10,
                    flexShrink: 0,
                    transition: 'transform 0.18s',
                    transform: recentsCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                    color: token.colorTextQuaternary
                  }}
                />
              </div>
              {!recentsCollapsed && (
                <div data-cb-recents-list="true">
                  {recentConversations.length > 0 ? (
                    recentConversations.map((item) => {
                      const isSelected = isRowActive({
                        sessionId: item.sessionId,
                        nativeSessionId: item.nativeSessionId,
                        toolType: item.toolType
                      })
                      return (
                        <div
                          key={item.key}
                          data-cb-recent-key={item.key}
                          data-cb-session-id={item.sessionId || item.nativeSessionId}
                          onClick={() => {
                            if (item.sessionId) {
                              onSelectSession(item.sessionId)
                            } else if (item.nativeSessionId) {
                              handleResumeNativeSession(item.workspaceId, item.toolType, item.nativeSessionId, item.title)
                            }
                          }}
                          style={{
                            ...rowBase,
                            padding: '2.5px 8px',
                            minHeight: 23,
                            gap: 6,
                            fontSize: 12,
                            color: isSelected ? token.colorPrimary : token.colorTextSecondary,
                            background: isSelected ? token.colorPrimaryBg : 'transparent',
                            borderRadius: token.borderRadiusSM
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) (e.currentTarget as HTMLElement).style.background = token.colorFillSecondary
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                            {getAIToolIcon(item.toolType, 12)}
                          </span>
                          <span
                            title={item.title}
                            style={{
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              lineHeight: '18px'
                            }}
                          >
                            {item.title}
                          </span>
                          {item.workspaceTitle && (
                            <Tag
                              bordered={false}
                              title={item.workspaceTitle}
                              style={{
                                margin: 0,
                                maxWidth: 62,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                borderRadius: 4,
                                fontSize: 10,
                                lineHeight: '16px',
                                paddingInline: 4,
                                background: token.colorFillTertiary,
                                color: token.colorTextTertiary
                              }}
                            >
                              {item.workspaceTitle}
                            </Tag>
                          )}
                        </div>
                      )
                    })
                  ) : (
                    <div style={{ padding: '3px 8px 3px 20px', fontSize: 11, color: token.colorTextQuaternary }}>
                      {t('coding.noRecentSessions')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        {sortedGroups.map((group, groupIndex) => {
          const isCollapsed = collapsedGroups.has(group.id)
          const groupWorkspaces = filteredWorkspaces
            .filter((w) => w.groupId === group.id)
            .sort(workspaceSort)
          const isRenamingGroup =
            renameTarget?.type === 'group' && renameTarget.id === group.id

          const groupRowContent = (
            <div
              onClick={() => {
                if (!isRenamingGroup) toggleGroup(group.id)
              }}
              style={{
                ...rowBase,
                padding: '2px 8px',
                minHeight: 22,
                gap: 5,
                color: token.colorTextSecondary,
                fontSize: 12,
                fontWeight: 600,
                lineHeight: '18px',
                background: 'transparent'
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = token.colorFillTertiary)
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = 'transparent')
              }
            >
              <AppstoreOutlined style={{ fontSize: 12, flexShrink: 0, color: token.colorTextTertiary }} />
              {isRenamingGroup ? (
                <Input
                  size="small"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onPressEnter={commitRename}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  style={{ flex: 1, height: 20, fontSize: 12 }}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {group.isDefault ? t('coding.defaultGroup') : group.name}
                </span>
              )}
              <RightOutlined
                style={{
                  fontSize: 10,
                  flexShrink: 0,
                  transition: 'transform 0.18s',
                  transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                  color: token.colorTextQuaternary
                }}
              />
            </div>
          )

          return (
            <div
              key={group.id}
              style={
                groupIndex > 0
                  ? {
                      borderTop: `1px solid ${token.colorBorderSecondary}`,
                      marginTop: 6,
                      paddingTop: 6
                    }
                  : undefined
              }
            >
              {/* Group row — context menu hidden for default group */}
              {group.isDefault ? (
                groupRowContent
              ) : (
                <Dropdown
                  menu={{ items: buildGroupMenu(group.id, group.name) }}
                  trigger={['contextMenu']}
                >
                  {groupRowContent}
                </Dropdown>
              )}

              {/* Workspaces */}
              {!isCollapsed && (() => {
                const pinnedWorkspaces = groupWorkspaces.filter((w) => w.pinned)
                const unpinnedWorkspaces = groupWorkspaces.filter((w) => !w.pinned)
                const renderWorkspace = (ws: AICodingWorkspace) => {
                  const isRenamingWs =
                    renameTarget?.type === 'workspace' && renameTarget.id === ws.id
                  const isWsCollapsed = collapsedWorkspaces.has(ws.id)
                  const isWsActive = isWsCollapsed && ws.id === activeWorkspaceId
                  const nativeState = nativeSessionsMap[ws.id]
                  const nativeVisibleCount = nativeSessionVisibleCounts[ws.id] || NATIVE_HISTORY_PAGE_SIZE
                  const availableNativeSessions = nativeState?.sessions || []
                  const isNativePinned = (s: SidebarNativeSession) =>
                    pinnedSessionKeys.has(nativePinKey(s.toolType, s.sessionId))
                  const pinnedNativeSessions = availableNativeSessions.filter(isNativePinned)
                  const unpinnedNativeSessions = availableNativeSessions.filter((s) => !isNativePinned(s))
                  const visibleNativeSessions = [
                    ...pinnedNativeSessions,
                    ...unpinnedNativeSessions.slice(0, nativeVisibleCount)
                  ]
                  const hasMoreNativeSessions = unpinnedNativeSessions.length > nativeVisibleCount
                  const workspaceSessions = sessions.filter(
                    (session) => session.workspaceId === ws.id && session.toolType !== 'terminal'
                  )
                  const wsHasAttention = attentionItems.some(
                    (item) =>
                      item.source === 'ai-coding' &&
                      (item.workspaceId === ws.id || workspaceSessions.some((s) => s.id === item.targetId))
                  )
                  const nativeByKey = new Map(
                    availableNativeSessions.map((nativeSession) => [
                      `${nativeSession.toolType}:${nativeSession.sessionId}`,
                      nativeSession
                    ])
                  )
                  // Provisional links hide the duplicate native row immediately while
                  // syncOpenedSessionsWithNative persists toolSessionId asynchronously.
                  const provisionalLinks = resolveNativeSessionLinks(workspaceSessions, availableNativeSessions)
                  const provisionalBySessionId = new Map(
                    provisionalLinks.map((link) => [link.sessionId, link] as const)
                  )
                  const openedNativeKeys = new Set<string>()
                  const openedRows: SidebarSessionRow[] = workspaceSessions.map((session) => {
                    const provisional = provisionalBySessionId.get(session.id)
                    const toolSessionId = session.toolSessionId || provisional?.toolSessionId
                    const nativeKey = toolSessionId ? `${session.toolType}:${toolSessionId}` : ''
                    const nativeSession = nativeKey ? nativeByKey.get(nativeKey) : undefined
                    if (nativeKey) openedNativeKeys.add(nativeKey)
                    return {
                      key: `opened-${session.id}`,
                      toolType: session.toolType,
                      title:
                        (!isGenericTitle(session.title) && session.title) ||
                        provisional?.title ||
                        nativeSession?.title ||
                        session.title ||
                        `${AI_TOOL_SHORT_NAMES[session.toolType] || session.toolType} chat`,
                      modifiedAt: Math.max(session.updatedAt || 0, nativeSession?.modifiedAt || 0),
                      nativeSessionId: toolSessionId,
                      openedSessionId: session.id
                    }
                  })
                  const nativeRows: SidebarSessionRow[] = visibleNativeSessions
                    .filter((nativeSession) => !openedNativeKeys.has(`${nativeSession.toolType}:${nativeSession.sessionId}`))
                    .map((nativeSession) => ({
                      key: `native-${nativeSession.toolType}-${nativeSession.sessionId}`,
                      toolType: nativeSession.toolType,
                      title: nativeSession.title,
                      modifiedAt: nativeSession.modifiedAt,
                      nativeSessionId: nativeSession.sessionId
                    }))
                  const sessionRows = [...openedRows, ...nativeRows]
                    .filter((row) => !isSessionRowArchived(row, archivedSessionKeys))
                    .sort((a, b) => {
                      const aPinned = isSessionRowPinned(a, pinnedSessionKeys, openedSessionMap)
                      const bPinned = isSessionRowPinned(b, pinnedSessionKeys, openedSessionMap)
                      if (aPinned !== bPinned) return aPinned ? -1 : 1
                      return b.modifiedAt - a.modifiedAt
                    })

                  const wsRowContent = (
                    <div
                      data-cb-ws-id={ws.id}
                      data-cb-active={isWsActive ? 'true' : undefined}
                      className="cb-ws-row"
                      style={{
                        ...rowBase,
                        padding: '2.5px 8px',
                        minHeight: 24,
                        gap: 4,
                        fontSize: 13,
                        lineHeight: '19px',
                        color: isWsActive ? token.colorPrimary : token.colorText,
                        background: isWsActive ? token.colorPrimaryBg : 'transparent',
                        borderRadius: token.borderRadiusSM
                      }}
                      onClick={() => {
                        if (isRenamingWs) return
                        toggleWorkspace(ws.id)
                        onSelectWorkspace(ws.id)
                      }}
                      onMouseEnter={(e) => {
                        if (!isWsActive) {
                          (e.currentTarget as HTMLElement).style.background =
                            token.colorFillSecondary
                        }
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          isWsActive ? token.colorPrimaryBg : 'transparent'
                      }}
                    >
                      {/* Folder open/close icon */}
                      {isWsCollapsed ? (
                        <FolderOutlined
                          style={{
                            fontSize: 13,
                            flexShrink: 0,
                            color: ws.id === activeWorkspaceId ? token.colorPrimary : token.colorTextSecondary,
                            cursor: 'pointer',
                            padding: '2px'
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleWorkspace(ws.id)
                          }}
                        />
                      ) : (
                        <FolderOpenOutlined
                          style={{
                            fontSize: 13,
                            flexShrink: 0,
                            color: token.colorPrimary,
                            cursor: 'pointer',
                            padding: '2px'
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleWorkspace(ws.id)
                          }}
                        />
                      )}
                      {isRenamingWs ? (
                        <Input
                          size="small"
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onPressEnter={commitRename}
                          onBlur={commitRename}
                          onClick={(e) => e.stopPropagation()}
                          style={{ flex: 1, height: 22, fontSize: 13 }}
                        />
                      ) : (
                        <>
                          <span
                            style={{
                              position: 'relative',
                              display: 'inline-flex',
                              alignItems: 'center',
                              flex: 1,
                              overflow: 'hidden',
                              minWidth: 0
                            }}
                            title={ws.workingDir}
                          >
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                lineHeight: '19px',
                                paddingBottom: 1,
                                color: isWsActive ? token.colorPrimary : undefined,
                                fontWeight: isWsActive ? 600 : undefined
                              }}
                            >
                              {ws.title}
                            </span>
                            {wsHasAttention && (
                              <span
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  backgroundColor: token.colorError,
                                  boxShadow: `0 0 4px ${token.colorError}`,
                                  alignSelf: 'flex-start',
                                  marginTop: 1,
                                  marginLeft: 3,
                                  flexShrink: 0,
                                  zIndex: 5,
                                  pointerEvents: 'none'
                                }}
                              />
                            )}
                          </span>
                          {/* Diff stat badge */}
                          {diffStats[ws.id] && (
                            <span style={{ fontSize: 11, flexShrink: 0, fontFamily: MONO_FONT_STACK, whiteSpace: 'nowrap' }}>
                              {diffStats[ws.id].additions > 0 && (
                                <span style={{ color: token.colorSuccess }}>+{diffStats[ws.id].additions}</span>
                              )}
                              {diffStats[ws.id].additions > 0 && diffStats[ws.id].deletions > 0 && (
                                <span style={{ color: token.colorTextQuaternary }}>,</span>
                              )}
                              {diffStats[ws.id].deletions > 0 && (
                                <span style={{ color: token.colorError }}>-{diffStats[ws.id].deletions}</span>
                              )}
                            </span>
                          )}
                          {/* Pin indicator - shifts left on hover */}
                          {ws.pinned && (
                            <VerticalAlignTopOutlined
                              title={t('workbench.unpin')}
                              onClick={(e) => {
                                e.stopPropagation()
                                updateWorkspace(ws.id, { pinned: false })
                              }}
                              className="cb-ws-pin-icon"
                              style={{ fontSize: 12, color: token.colorTextTertiary, flexShrink: 0, padding: '2px', cursor: 'pointer' }}
                              onMouseEnter={(e) => {
                                ;(e.currentTarget as HTMLElement).style.color = token.colorPrimary
                              }}
                              onMouseLeave={(e) => {
                                ;(e.currentTarget as HTMLElement).style.color = token.colorTextTertiary
                              }}
                            />
                          )}
                          {/* Hover Actions: Add new session */}
                          <div
                            className="cb-ws-hover-actions"
                            style={{
                              display: 'none',
                              alignItems: 'center',
                              flexShrink: 0
                            }}
                          >
                            <span
                              title={t('coding.newChat')}
                              onClick={(e) => {
                                e.stopPropagation()
                                onNewSession(ws.id)
                              }}
                              style={{ display: 'inline-flex', padding: '2px', cursor: 'pointer' }}
                            >
                              <PlusOutlined style={{ fontSize: 12, color: token.colorTextTertiary }} />
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )

                  return (
                    <SortableWorkspaceItem key={ws.id} id={ws.id}>
                      <SortableWorkspaceHeader disabled={isRenamingWs}>
                        <Dropdown
                          menu={{ items: buildWorkspaceMenu(ws) }}
                          trigger={['contextMenu']}
                        >
                          {wsRowContent}
                        </Dropdown>
                      </SortableWorkspaceHeader>

                      {/* Sessions — hidden when workspace is collapsed */}
                      {!isWsCollapsed && sessionRows.map((row) => {
                        const isSelected = isRowActive({
                          openedSessionId: row.openedSessionId,
                          nativeSessionId: row.nativeSessionId,
                          toolType: row.toolType
                        })
                        const sessionHasAttention =
                          (!!row.openedSessionId && codingAttentionSet.has(row.openedSessionId)) ||
                          (!!row.nativeSessionId && codingAttentionSet.has(row.nativeSessionId))
                        const isPinned = isSessionRowPinned(row, pinnedSessionKeys, openedSessionMap)
                        return (
                          <Dropdown
                            key={row.key}
                            menu={{ items: buildSessionRowMenu(row, ws.id) }}
                            trigger={['contextMenu']}
                          >
                            <div
                              data-cb-session-id={row.openedSessionId || row.nativeSessionId}
                              data-cb-session-key={row.key}
                              onClick={() => {
                                if (row.openedSessionId) {
                                  onSelectSession(row.openedSessionId)
                                } else if (row.nativeSessionId) {
                                  handleResumeNativeSession(ws.id, row.toolType, row.nativeSessionId, row.title)
                                }
                              }}
                              style={{
                                ...rowBase,
                                padding: '1.5px 8px 1.5px 1.8em',
                                minHeight: 22,
                                gap: 5,
                                fontSize: 12,
                                color: isSelected ? token.colorPrimary : token.colorTextSecondary,
                                background: isSelected ? token.colorPrimaryBg : 'transparent',
                                position: 'relative'
                              }}
                              onMouseEnter={(e) => {
                                if (!isSelected)
                                  (e.currentTarget as HTMLElement).style.background = token.colorFillSecondary
                              }}
                              onMouseLeave={(e) => {
                                if (!isSelected)
                                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                              }}
                            >
                              <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                                {sessionHasAttention && (
                                  <span
                                    style={{
                                      position: 'absolute',
                                      top: 1,
                                      left: 1,
                                      transform: 'translate(-50%, -50%)',
                                      width: 6,
                                      height: 6,
                                      borderRadius: '50%',
                                      backgroundColor: token.colorError,
                                      boxShadow: `0 0 4px ${token.colorError}`,
                                      zIndex: 10,
                                      pointerEvents: 'none'
                                    }}
                                  />
                                )}
                                <Tag
                                  color={AI_TOOL_TAG_COLORS[row.toolType]}
                                  title={AI_TOOL_NAMES[row.toolType]}
                                  style={{ ...AI_TOOL_TAG_STYLE, margin: 0, flexShrink: 0, fontSize: 10, lineHeight: '16px', paddingInline: 3, marginInlineEnd: 0 }}
                                >
                                  {getAIToolIcon(row.toolType, 12) ?? AI_TOOL_SHORT_NAMES[row.toolType]}
                                </Tag>
                              </span>
                              <span
                                title={row.title}
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  lineHeight: '18px',
                                  paddingBottom: 1,
                                  flex: 1
                                }}
                              >
                                {row.title}
                              </span>
                              {isPinned && (
                                <VerticalAlignTopOutlined
                                  title={t('workbench.unpin')}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleTogglePinSessionRow(row)
                                  }}
                                  style={{
                                    fontSize: 11,
                                    color: token.colorTextTertiary,
                                    flexShrink: 0,
                                    padding: '2px',
                                    cursor: 'pointer'
                                  }}
                                  onMouseEnter={(e) => {
                                    ;(e.currentTarget as HTMLElement).style.color = token.colorPrimary
                                  }}
                                  onMouseLeave={(e) => {
                                    ;(e.currentTarget as HTMLElement).style.color = token.colorTextTertiary
                                  }}
                                />
                              )}
                              <span style={{ marginLeft: isPinned ? 2 : 'auto', flexShrink: 0, fontSize: 11, color: token.colorTextQuaternary }}>
                                {formatRelativeTime(row.modifiedAt)}
                              </span>
                            </div>
                          </Dropdown>
                        )
                      })}
                      {!isWsCollapsed && !nativeState?.loaded && !nativeState?.loading && (
                        <div
                          onClick={() => ensureNativeSessions(ws.id)}
                          style={{
                            ...rowBase,
                            padding: '2px 8px 2px 1.8em',
                            gap: 5,
                            fontSize: 12,
                            color: token.colorTextTertiary,
                            background: 'transparent'
                          }}
                          onMouseEnter={(e) =>
                            ((e.currentTarget as HTMLElement).style.background = token.colorFillSecondary)
                          }
                          onMouseLeave={(e) =>
                            ((e.currentTarget as HTMLElement).style.background = 'transparent')
                          }
                        >
                          <HistoryOutlined style={{ fontSize: 12, flexShrink: 0 }} />
                          <span>{t('coding.loadHistorySessions')}</span>
                        </div>
                      )}
                      {!isWsCollapsed && nativeState?.loading && visibleNativeSessions.length === 0 && (
                        <div style={{ ...rowBase, padding: '4px 8px 4px 1.8em', gap: 6, fontSize: 12, color: token.colorTextTertiary }}>
                          <Spin size="small" />
                          <span>{t('coding.loadingHistorySessions')}</span>
                        </div>
                      )}
                      {!isWsCollapsed && hasMoreNativeSessions && (
                        <div
                          onClick={() => setNativeSessionVisibleCounts(prev => ({
                            ...prev,
                            [ws.id]: (prev[ws.id] || NATIVE_HISTORY_PAGE_SIZE) + NATIVE_HISTORY_PAGE_SIZE
                          }))}
                          style={{
                            ...rowBase,
                            padding: '2px 8px 2px 1.8em',
                            gap: 5,
                            fontSize: 12,
                            color: token.colorPrimary,
                            background: 'transparent'
                          }}
                          onMouseEnter={(e) =>
                            ((e.currentTarget as HTMLElement).style.background = token.colorFillSecondary)
                          }
                          onMouseLeave={(e) =>
                            ((e.currentTarget as HTMLElement).style.background = 'transparent')
                          }
                        >
                          <HistoryOutlined style={{ fontSize: 12, flexShrink: 0 }} />
                          <span>{t('coding.loadMore')}</span>
                        </div>
                      )}
                    </SortableWorkspaceItem>
                  )
                }
                return (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => handleWorkspaceDragEnd(e, group.id)}
                  >
                    {pinnedWorkspaces.length > 0 && (
                      <SortableContext items={pinnedWorkspaces.map((w) => w.id)} strategy={verticalListSortingStrategy}>
                        {pinnedWorkspaces.map((ws) => renderWorkspace(ws))}
                      </SortableContext>
                    )}
                    {unpinnedWorkspaces.length > 0 && (
                      <SortableContext items={unpinnedWorkspaces.map((w) => w.id)} strategy={verticalListSortingStrategy}>
                        {unpinnedWorkspaces.map((ws) => renderWorkspace(ws))}
                      </SortableContext>
                    )}
                  </DndContext>
                )
              })()}
            </div>
          )
        })}
      </div>
      </div>
      )}

      {/* Resize handle */}
      {!collapsed && (
      <div
        onMouseDown={handleMouseDown}
        style={{
          width: 4,
          cursor: 'col-resize',
          background: 'transparent',
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          zIndex: 10
        }}
        onMouseEnter={(e) =>
          ((e.target as HTMLElement).style.background = token.colorPrimaryBg)
        }
        onMouseLeave={(e) => {
          if (!isResizing.current)
            (e.target as HTMLElement).style.background = 'transparent'
        }}
      />
      )}

      {/* Search Modal */}
      <AICodingSearchModal
        open={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        onNewChat={() => onOpenNewChat?.()}
        onOpenFolder={onNewWorkspace}
        onSelectSession={handleSelectFromSearch}
        workspaces={workspaces}
        sessions={sessions}
        nativeSessionsMap={nativeSessionsMap}
      />
    </div>
  )
}

export default AICodingSidebar
