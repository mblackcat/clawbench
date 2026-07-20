import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { Dropdown, Input, App, Button, theme, Tooltip, Spin, Tag, Badge } from 'antd'
import type { MenuProps } from 'antd'
import {
  FolderOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
  HistoryOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined
} from '@ant-design/icons'
import { AI_TOOL_SHORT_NAMES, AI_TOOL_TAG_COLORS, AI_TOOL_TAG_STYLE, renderAIToolTagLabel, TOOLS_WITH_NATIVE_SESSIONS } from './aiToolMeta'
import { useT } from '../../i18n'
import { useAICodingStore } from '../../stores/useAICodingStore'
import { useAttentionStore } from '../../stores/useAttentionStore'
import { MONO_FONT_STACK } from '../../utils/mono-font'
import type { AICodingSession, AIToolType } from '../../types/ai-coding'

interface AICodingSidebarProps {
  onNewWorkspace: () => void
  onNewSession: (workspaceId: string) => void
  onSelectSession: (sessionId: string) => void
}

const NATIVE_HISTORY_PAGE_SIZE = 5
const WORKSPACE_COLLAPSE_STORAGE_KEY = 'cb-workbench-collapsed-workspaces'
/** Background re-scan of native CLI history while a workspace is expanded. */
const NATIVE_SESSION_POLL_MS = 12_000
/** Faster scan while opened sessions still lack a toolSessionId (e.g. fresh Grok). */
const NATIVE_SESSION_POLL_UNLINKED_MS = 3_000
/** Allow small clock skew when matching a new native session to an opened one. */
const NATIVE_LINK_CLOCK_SKEW_MS = 5_000

interface SidebarNativeSession {
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

interface SidebarSessionRow {
  key: string
  toolType: AIToolType
  title: string
  modifiedAt: number
  nativeSessionId?: string
  openedSessionId?: string
}

interface NativeSessionLink {
  sessionId: string
  toolSessionId: string
  title?: string
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

/**
 * Pair opened ClawBench sessions that lack toolSessionId with unmatched native
 * CLI sessions of the same tool. PTY tools (Grok/Gemini/etc.) never emit a
 * session_id event, so without this the sidebar shows both "Grok session" and
 * the real native history entry for the same conversation.
 */
function resolveNativeSessionLinks(
  workspaceSessions: AICodingSession[],
  nativeSessions: SidebarNativeSession[]
): NativeSessionLink[] {
  const claimedNativeKeys = new Set(
    workspaceSessions
      .filter((session) => session.toolSessionId)
      .map((session) => `${session.toolType}:${session.toolSessionId}`)
  )

  const unlinkedSessions = workspaceSessions
    .filter((session) => session.toolType !== 'terminal' && !session.toolSessionId)
    .slice()

  if (unlinkedSessions.length === 0) return []

  const unmatchedNatives = nativeSessions
    .filter((native) => !claimedNativeKeys.has(`${native.toolType}:${native.sessionId}`))
    .slice()
    .sort((a, b) => b.modifiedAt - a.modifiedAt)

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
      // so a stale "Grok session" from last week won't swallow today's history.
      const sessionEnd =
        session.status === 'idle' || session.status === 'running'
          ? Date.now()
          : (session.updatedAt || sessionStart)
      return (
        native.modifiedAt >= sessionStart - NATIVE_LINK_CLOCK_SKEW_MS &&
        native.modifiedAt <= sessionEnd + NATIVE_LINK_CLOCK_SKEW_MS
      )
    })
    if (candidates.length === 0) continue

    // Prefer the opened session whose start time is closest to the native mtime.
    candidates.sort((a, b) => {
      const aStart = a.startedAt || a.createdAt
      const bStart = b.startedAt || b.createdAt
      return Math.abs(native.modifiedAt - aStart) - Math.abs(native.modifiedAt - bStart)
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
  onSelectSession
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const { modal, message } = App.useApp()

  const workspaces = useAICodingStore((s) => s.workspaces)
  const sessions = useAICodingStore((s) => s.sessions)
  const groups = useAICodingStore((s) => s.groups)
  const activeSessionId = useAICodingStore((s) => s.activeSessionId)
  const deleteWorkspace = useAICodingStore((s) => s.deleteWorkspace)
  const updateWorkspace = useAICodingStore((s) => s.updateWorkspace)
  const renameGroup = useAICodingStore((s) => s.renameGroup)
  const deleteGroup = useAICodingStore((s) => s.deleteGroup)
  const codingAttentionIds = useAttentionStore((s) =>
    s.items.filter((i) => i.source === 'ai-coding' && i.targetId).map((i) => i.targetId as string)
  )
  const codingAttentionSet = useMemo(() => new Set(codingAttentionIds), [codingAttentionIds])

  const [sidebarWidth, setSidebarWidth] = useState(240)
  const isResizing = useRef(false)
  const [collapsed, setCollapsed] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(() => loadCollapsedWorkspaceIds())

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

  /** Bind toolSessionId for PTY sessions + pull native titles onto opened rows. */
  const syncOpenedSessionsWithNative = useCallback(async (wsId: string, nativeSessions: SidebarNativeSession[]) => {
    const currentSessions = useAICodingStore.getState().sessions
    const workspaceSessions = currentSessions.filter((session) => session.workspaceId === wsId)
    const links = resolveNativeSessionLinks(workspaceSessions, nativeSessions)
    const linkedIds = new Set(links.map((link) => link.sessionId))
    const nativeByKey = new Map(nativeSessions.map((ns) => [`${ns.toolType}:${ns.sessionId}`, ns]))

    const updates: Array<Promise<void>> = links.map((link) =>
      updateSession(link.sessionId, {
        toolSessionId: link.toolSessionId,
        ...(link.title ? { title: link.title } : {})
      })
    )

    for (const session of workspaceSessions) {
      if (!session.toolSessionId || linkedIds.has(session.id)) continue
      const nativeSession = nativeByKey.get(`${session.toolType}:${session.toolSessionId}`)
      if (!nativeSession?.title || nativeSession.title === session.title) continue
      updates.push(updateSession(session.id, { title: nativeSession.title }))
    }

    if (updates.length > 0) {
      await Promise.all(updates)
    }
  }, [updateSession])

  const fetchDiffStats = useCallback(async () => {
    const stats: Record<string, { additions: number; deletions: number }> = {}
    await Promise.all(
      workspaces.map(async (ws) => {
        try {
          const result = await window.api.vcs.diffStat(ws.workingDir)
          if (result.additions > 0 || result.deletions > 0) {
            stats[ws.id] = result
          }
        } catch { /* ignore dirs without supported VCS */ }
      })
    )
    setDiffStats(stats)
  }, [workspaces])

  useEffect(() => {
    fetchDiffStats()
    const timer = setInterval(fetchDiffStats, 30_000)
    return () => clearInterval(timer)
  }, [fetchDiffStats])

  /** Fetch native sessions for a workspace — queries all supported tool types and merges */
  const fetchNativeSessions = useCallback(async (wsId: string) => {
    const ws = workspaces.find(w => w.id === wsId)
    if (!ws) return
    if (nativeFetchInFlightRef.current.has(wsId)) return

    nativeFetchInFlightRef.current.add(wsId)
    setNativeSessionsMap(prev => ({
      ...prev,
      [wsId]: {
        sessions: prev[wsId]?.sessions || [],
        loading: true,
        loaded: prev[wsId]?.loaded || false,
        workingDir: ws.workingDir
      }
    }))
    try {
      const results = await Promise.all(
        TOOLS_WITH_NATIVE_SESSIONS.map(async (tt) => {
          try {
            const list = await window.api.aiCoding.listNativeSessions(ws.workingDir, tt)
            return (list || []).map(ns => ({ ...ns, toolType: tt }))
          } catch { return [] }
        })
      )
      const merged = results.flat()
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
      setNativeSessionsMap(prev => ({ ...prev, [wsId]: { sessions: merged, loading: false, loaded: true, workingDir: ws.workingDir } }))
      await syncOpenedSessionsWithNative(wsId, merged)
    } catch {
      setNativeSessionsMap(prev => ({ ...prev, [wsId]: { sessions: [], loading: false, loaded: true, workingDir: ws.workingDir } }))
    } finally {
      nativeFetchInFlightRef.current.delete(wsId)
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
    for (const ws of workspaces) {
      if (collapsedWorkspaces.has(ws.id)) continue
      const state = nativeSessionsMap[ws.id]
      if (state?.workingDir === ws.workingDir && (state.loaded || state.loading)) continue
      fetchNativeSessions(ws.id)
    }
  }, [workspaces, collapsedWorkspaces, nativeSessionsMap, fetchNativeSessions])

  const sessionRefreshKey = useMemo(
    () => sessions.map((s) => `${s.id}:${s.workspaceId}:${s.toolSessionId || ''}:${s.title || ''}:${s.updatedAt}`).join('|'),
    [sessions]
  )

  useEffect(() => {
    if (workspaces.length === 0) return
    const timer = setTimeout(() => {
      for (const ws of workspaces) {
        if (!collapsedWorkspaces.has(ws.id)) fetchNativeSessions(ws.id)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [sessionRefreshKey, workspaces, collapsedWorkspaces, fetchNativeSessions])

  // PTY tools (Grok etc.) don't update ClawBench session state while the user
  // types in xterm, so re-scan native history periodically while expanded.
  // Poll faster when any opened session is still missing toolSessionId.
  const hasUnlinkedOpenedSessions = useMemo(
    () => sessions.some((s) => s.toolType !== 'terminal' && !s.toolSessionId),
    [sessions]
  )
  useEffect(() => {
    if (workspaces.length === 0) return
    const intervalMs = hasUnlinkedOpenedSessions ? NATIVE_SESSION_POLL_UNLINKED_MS : NATIVE_SESSION_POLL_MS
    const timer = setInterval(() => {
      for (const ws of workspaces) {
        if (!collapsedWorkspaces.has(ws.id)) fetchNativeSessions(ws.id)
      }
    }, intervalMs)
    return () => clearInterval(timer)
  }, [workspaces, collapsedWorkspaces, fetchNativeSessions, hasUnlinkedOpenedSessions])

  /** Resume a native session into a workspace */
  const handleResumeNativeSession = useCallback(async (wsId: string, toolType: AIToolType, nativeSessionId: string, title?: string) => {
    try {
      const existingSession = sessions.find(s =>
        s.workspaceId === wsId &&
        s.toolType === toolType &&
        s.toolSessionId === nativeSessionId
      )
      if (existingSession) {
        onSelectSession(existingSession.id)
        return
      }

      const newSession = await createSession(wsId, toolType, 'local')
      await updateSession(newSession.id, { toolSessionId: nativeSessionId, ...(title ? { title } : {}) })
      onSelectSession(newSession.id)
    } catch {
      message.error(t('coding.createSessionFailed'))
    }
  }, [createSession, updateSession, sessions, onSelectSession, message, t])

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
    const willExpand = collapsedWorkspaces.has(wsId)
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev)
      if (next.has(wsId)) next.delete(wsId)
      else next.add(wsId)
      return next
    })
    if (willExpand) fetchNativeSessions(wsId)
  }, [collapsedWorkspaces, fetchNativeSessions])

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

  const buildWorkspaceMenu = (wsId: string, title: string): MenuProps['items'] => [
    { key: 'rename', label: t('coding.renameItem'), onClick: () => startRename('workspace', wsId, title) },
    { type: 'divider' },
    { key: 'delete', label: t('coding.deleteWorkspaceMenu'), danger: true, onClick: () => handleDeleteWorkspace(wsId) }
  ]

  const buildGroupMenu = (groupId: string, name: string): MenuProps['items'] => [
    { key: 'rename', label: t('coding.renameGroup'), onClick: () => startRename('group', groupId, name) },
    { type: 'divider' },
    { key: 'delete', label: t('coding.deleteGroupMenu'), danger: true, onClick: () => handleDeleteGroup(groupId) }
  ]

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
          padding: '12px 12px 8px',
          fontWeight: 600,
          fontSize: 14,
          color: token.colorText,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}
      >
        {!collapsed && <span>AI Coding</span>}
        <div style={{ display: 'flex', gap: 2 }}>
          {!collapsed && (
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={onNewWorkspace}
              style={{ color: token.colorPrimary }}
              title={t('coding.newWorkspace')}
            />
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

      {/* Collapsed: quick new workspace button */}
      {collapsed && (
        <div style={{ padding: '8px 8px 4px' }}>
          <Tooltip title={t('coding.newWorkspace')} placement="right">
            <Button
              type="text"
              icon={<PlusOutlined />}
              onClick={onNewWorkspace}
              style={{ width: '100%', padding: 0, color: token.colorPrimary }}
            />
          </Tooltip>
        </div>
      )}

      {/* Search + Tree card */}
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
        {/* Search */}
        <div style={{ padding: '6px 8px 4px', flexShrink: 0 }}>
          <Input
            size="small"
            placeholder={t('coding.searchWorkspace')}
            prefix={<SearchOutlined style={{ color: token.colorTextQuaternary, fontSize: 12 }} />}
            allowClear
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>

        {/* Tree */}
        <div style={{ flex: 1, overflow: 'auto', padding: '2px 0' }}>
        {sortedGroups.map((group) => {
          const isCollapsed = collapsedGroups.has(group.id)
          const groupWorkspaces = filteredWorkspaces.filter((w) => w.groupId === group.id)
          const isRenamingGroup =
            renameTarget?.type === 'group' && renameTarget.id === group.id

          const groupRowContent = (
            <div
              onClick={() => {
                if (!isRenamingGroup) toggleGroup(group.id)
              }}
              style={{
                ...rowBase,
                padding: '3px 8px',
                gap: 5,
                color: token.colorTextSecondary,
                fontSize: 12,
                fontWeight: 600,
                background: 'transparent'
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = token.colorFillTertiary)
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = 'transparent')
              }
            >
              <FolderOutlined style={{ fontSize: 12, flexShrink: 0 }} />
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
            <div key={group.id}>
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
              {!isCollapsed &&
                groupWorkspaces.map((ws) => {
                  const isRenamingWs =
                    renameTarget?.type === 'workspace' && renameTarget.id === ws.id
                  const isWsCollapsed = collapsedWorkspaces.has(ws.id)
                  const nativeState = nativeSessionsMap[ws.id]
                  const nativeVisibleCount = nativeSessionVisibleCounts[ws.id] || NATIVE_HISTORY_PAGE_SIZE
                  const availableNativeSessions = nativeState?.sessions || []
                  const visibleNativeSessions = availableNativeSessions.slice(0, nativeVisibleCount)
                  const hasMoreNativeSessions = availableNativeSessions.length > nativeVisibleCount
                  const workspaceSessions = sessions.filter(
                    (session) => session.workspaceId === ws.id && session.toolType !== 'terminal'
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
                        session.title ||
                        provisional?.title ||
                        nativeSession?.title ||
                        `${AI_TOOL_SHORT_NAMES[session.toolType] || session.toolType} session`,
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
                    .sort((a, b) => b.modifiedAt - a.modifiedAt)

                  const wsRowContent = (
                    <div
                      style={{
                        ...rowBase,
                        padding: '3px 8px',
                        gap: 4,
                        fontSize: 13,
                        color: token.colorText,
                        background: 'transparent'
                      }}
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLElement).style.background =
                          token.colorFillSecondary)
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLElement).style.background = 'transparent')
                      }
                    >
                      {/* Expand/collapse toggle */}
                      <RightOutlined
                        style={{
                          fontSize: 10,
                          flexShrink: 0,
                          transition: 'transform 0.18s',
                          transform: isWsCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                          color: token.colorTextQuaternary,
                          padding: '2px'
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleWorkspace(ws.id)
                        }}
                      />
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
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                            title={ws.workingDir}
                            onClick={() => toggleWorkspace(ws.id)}
                          >
                            {ws.title}
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
                          {/* Add new session */}
                          <PlusOutlined
                            style={{
                              fontSize: 12,
                              color: token.colorTextTertiary,
                              flexShrink: 0,
                              padding: '2px'
                            }}
                            title={t('coding.newSession')}
                            onClick={(e) => {
                              e.stopPropagation()
                              onNewSession(ws.id)
                            }}
                          />
                        </>
                      )}
                    </div>
                  )

                  return (
                    <div key={ws.id}>
                      <Dropdown
                        menu={{ items: buildWorkspaceMenu(ws.id, ws.title) }}
                        trigger={['contextMenu']}
                      >
                        {wsRowContent}
                      </Dropdown>

                      {/* Sessions — hidden when workspace is collapsed */}
                      {!isWsCollapsed && sessionRows.map((row) => {
                        const isSelected = activeSessionId === row.openedSessionId
                        const sessionHasAttention =
                          !!row.openedSessionId && codingAttentionSet.has(row.openedSessionId)

                        return (
                          <div
                            key={row.key}
                            onClick={() => {
                              if (row.openedSessionId) {
                                onSelectSession(row.openedSessionId)
                              } else if (row.nativeSessionId) {
                                handleResumeNativeSession(ws.id, row.toolType, row.nativeSessionId, row.title)
                              }
                            }}
                            style={{
                              ...rowBase,
                              padding: '2px 8px 2px 1.8em',
                              gap: 5,
                              fontSize: 12,
                              color: isSelected ? token.colorPrimary : token.colorTextSecondary,
                              background: isSelected ? token.colorPrimaryBg : 'transparent'
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
                            <HistoryOutlined style={{ fontSize: 12, color: token.colorTextTertiary, flexShrink: 0 }} />
                            <Tag color={AI_TOOL_TAG_COLORS[row.toolType]} style={{ ...AI_TOOL_TAG_STYLE, margin: 0, flexShrink: 0, fontSize: 10, lineHeight: '16px', paddingInline: 3 }}>
                              {renderAIToolTagLabel(row.toolType, AI_TOOL_SHORT_NAMES[row.toolType], 12)}
                            </Tag>
                            <span
                              title={row.title}
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                lineHeight: '20px',
                                flex: 1
                              }}
                            >
                              {row.title}
                            </span>
                            {sessionHasAttention && (
                              <Badge status="error" style={{ flexShrink: 0 }} />
                            )}
                            <span style={{ marginLeft: sessionHasAttention ? 0 : 'auto', flexShrink: 0, fontSize: 11, color: token.colorTextQuaternary }}>
                              {formatRelativeTime(row.modifiedAt)}
                            </span>
                          </div>
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
                    </div>
                  )
                })}
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
    </div>
  )
}

export default AICodingSidebar
