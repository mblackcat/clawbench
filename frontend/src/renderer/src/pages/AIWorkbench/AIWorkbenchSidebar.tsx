import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { Dropdown, Input, App, Button, theme, Tooltip, Spin, Tag } from 'antd'
import type { MenuProps } from 'antd'
import {
  FolderOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
  CodeOutlined,
  HistoryOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined
} from '@ant-design/icons'
import SessionStatusSVG from './SessionStatusSVG'
import { AI_TOOL_SHORT_NAMES, AI_TOOL_TAG_COLORS, AI_TOOL_TAG_STYLE, renderAIToolTagLabel } from './aiToolMeta'
import { useT } from '../../i18n'
import { useAIWorkbenchStore } from '../../stores/useAIWorkbenchStore'
import type { AIToolType } from '../../types/ai-workbench'

interface AIWorkbenchSidebarProps {
  onNewWorkspace: () => void
  onNewSession: (workspaceId: string) => void
  onSelectSession: (sessionId: string) => void
}

/** Tool types that support native session history listing */
const TOOLS_WITH_NATIVE_SESSIONS: AIToolType[] = ['claude', 'codex', 'gemini']
const NATIVE_HISTORY_PAGE_SIZE = 5
const WORKSPACE_COLLAPSE_STORAGE_KEY = 'cb-workbench-collapsed-workspaces'

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

const AIWorkbenchSidebar: React.FC<AIWorkbenchSidebarProps> = ({
  onNewWorkspace,
  onNewSession,
  onSelectSession
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const { modal, message } = App.useApp()

  const workspaces = useAIWorkbenchStore((s) => s.workspaces)
  const sessions = useAIWorkbenchStore((s) => s.sessions)
  const groups = useAIWorkbenchStore((s) => s.groups)
  const activeSessionId = useAIWorkbenchStore((s) => s.activeSessionId)
  const deleteWorkspace = useAIWorkbenchStore((s) => s.deleteWorkspace)
  const updateWorkspace = useAIWorkbenchStore((s) => s.updateWorkspace)
  const deleteSession = useAIWorkbenchStore((s) => s.deleteSession)
  const renameGroup = useAIWorkbenchStore((s) => s.renameGroup)
  const deleteGroup = useAIWorkbenchStore((s) => s.deleteGroup)

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

  const createSession = useAIWorkbenchStore((s) => s.createSession)
  const updateSession = useAIWorkbenchStore((s) => s.updateSession)

  const openNativeSessionKeys = useMemo(() => {
    return new Set(
      sessions
        .filter(s => s.toolSessionId)
        .map(s => `${s.toolType}:${s.toolSessionId}`)
    )
  }, [sessions])

  // Diff stats per workspace (keyed by workspace id)
  const [diffStats, setDiffStats] = useState<Record<string, { additions: number; deletions: number }>>({})

  const fetchDiffStats = useCallback(async () => {
    const stats: Record<string, { additions: number; deletions: number }> = {}
    await Promise.all(
      workspaces.map(async (ws) => {
        try {
          const result = await window.api.git.diffStat(ws.workingDir)
          if (result.additions > 0 || result.deletions > 0) {
            stats[ws.id] = result
          }
        } catch { /* ignore non-git dirs */ }
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
            const list = await window.api.aiWorkbench.listNativeSessions(ws.workingDir, tt)
            return (list || []).map(ns => ({ ...ns, toolType: tt }))
          } catch { return [] }
        })
      )
      const merged = results.flat()
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
      setNativeSessionsMap(prev => ({ ...prev, [wsId]: { sessions: merged, loading: false, loaded: true, workingDir: ws.workingDir } }))
    } catch {
      setNativeSessionsMap(prev => ({ ...prev, [wsId]: { sessions: [], loading: false, loaded: true, workingDir: ws.workingDir } }))
    } finally {
      nativeFetchInFlightRef.current.delete(wsId)
    }
  }, [workspaces])

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

  /** Resume a native session into a workspace */
  const handleResumeNativeSession = useCallback(async (wsId: string, toolType: AIToolType, nativeSessionId: string, title?: string) => {
    try {
      const newSession = await createSession(wsId, toolType, 'local')
      await updateSession(newSession.id, { toolSessionId: nativeSessionId, ...(title ? { title } : {}) })
      useAIWorkbenchStore.getState().setActiveSession(newSession.id)
    } catch {
      message.error(t('coding.createSessionFailed'))
    }
  }, [createSession, updateSession, message, t])

  /** Format relative time */
  const formatRelativeTime = (ms: number): string => {
    const diff = Date.now() - ms
    const minutes = Math.floor(diff / 60_000)
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    return `${Math.floor(hours / 24)}d`
  }

  /** Build history dropdown items for a workspace */
  const buildHistoryItems = useCallback((wsId: string): MenuProps['items'] => {
    const state = nativeSessionsMap[wsId]
    if (!state || state.loading) return [{ key: 'loading', label: <Spin size="small" />, disabled: true }]
    const availableSessions = state.sessions.filter(ns => !openNativeSessionKeys.has(`${ns.toolType}:${ns.sessionId}`))
    if (state.sessions.length === 0) return [{ key: 'empty', label: '无历史会话', disabled: true }]
    const visibleCount = nativeSessionVisibleCounts[wsId] || NATIVE_HISTORY_PAGE_SIZE
    const visibleSessions = availableSessions.slice(0, visibleCount)
    if (visibleSessions.length === 0) return [{ key: 'empty', label: '无历史会话', disabled: true }]
    const items: NonNullable<MenuProps['items']> = visibleSessions.map(ns => {
      const timePart = formatRelativeTime(ns.modifiedAt)
      return {
        key: ns.sessionId,
        label: (
          <span
            title={ns.title}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              maxWidth: 320,
            }}
          >
            <Tag color={AI_TOOL_TAG_COLORS[ns.toolType]} style={{ ...AI_TOOL_TAG_STYLE, margin: 0, flexShrink: 0, fontSize: 11, lineHeight: '18px', paddingInline: 4 }}>
              {renderAIToolTagLabel(ns.toolType, AI_TOOL_SHORT_NAMES[ns.toolType], 12)}
            </Tag>
            <span style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {ns.title}
            </span>
            <span style={{ flexShrink: 0, fontSize: 11, color: '#999' }}>{timePart}</span>
          </span>
        )
      }
    })
    if (availableSessions.length > visibleCount) {
      items.push({
        key: `load-more:${wsId}`,
        label: <span style={{ color: token.colorPrimary }}>{t('coding.loadMore')}</span>
      })
    }
    return items
  }, [nativeSessionsMap, nativeSessionVisibleCounts, openNativeSessionKeys, t, token.colorPrimary])

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

  const wsSessionsMap = useMemo(() => {
    const map: Record<string, typeof sessions> = {}
    for (const s of sessions) {
      if (!map[s.workspaceId]) map[s.workspaceId] = []
      map[s.workspaceId].push(s)
    }
    return map
  }, [sessions])

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

  const handleDeleteSession = (sessionId: string) => {
    modal.confirm({
      title: t('coding.deleteSession'),
      content: t('coding.deleteSessionConfirm'),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: () => deleteSession(sessionId)
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
                  const wsSessions = wsSessionsMap[ws.id] || []
                  const isRenamingWs =
                    renameTarget?.type === 'workspace' && renameTarget.id === ws.id
                  const isWsCollapsed = collapsedWorkspaces.has(ws.id)
                  const nativeState = nativeSessionsMap[ws.id]
                  const nativeVisibleCount = nativeSessionVisibleCounts[ws.id] || NATIVE_HISTORY_PAGE_SIZE
                  const availableNativeSessions = (nativeState?.sessions || [])
                    .filter(ns => !openNativeSessionKeys.has(`${ns.toolType}:${ns.sessionId}`))
                  const visibleNativeSessions = availableNativeSessions.slice(0, nativeVisibleCount)
                  const hasMoreNativeSessions = availableNativeSessions.length > nativeVisibleCount
                  const sessionRows = [
                    ...wsSessions.map((session, idx) => ({
                      kind: 'local' as const,
                      key: session.id,
                      sortAt: session.updatedAt || session.createdAt,
                      session,
                      idx
                    })),
                    ...visibleNativeSessions.map((nativeSession) => ({
                      kind: 'native' as const,
                      key: `native-${nativeSession.toolType}-${nativeSession.sessionId}`,
                      sortAt: nativeSession.modifiedAt,
                      nativeSession
                    }))
                  ].sort((a, b) => b.sortAt - a.sortAt)

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
                            <span style={{ fontSize: 11, flexShrink: 0, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
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
                          {/* History sessions */}
                          <Dropdown
                            menu={{
                              items: buildHistoryItems(ws.id),
                              onClick: ({ key }) => {
                                if (String(key).startsWith('load-more:')) {
                                  setNativeSessionVisibleCounts(prev => ({
                                    ...prev,
                                    [ws.id]: (prev[ws.id] || NATIVE_HISTORY_PAGE_SIZE) + NATIVE_HISTORY_PAGE_SIZE
                                  }))
                                  return
                                }
                                const state = nativeSessionsMap[ws.id]
                                const ns = state?.sessions.find(s => s.sessionId === key)
                                if (ns) handleResumeNativeSession(ws.id, ns.toolType, key, ns.title)
                              },
                              style: { maxHeight: 'min(360px, 60vh)', overflowY: 'auto' }
                            }}
                            overlayStyle={{ maxWidth: 380 }}
                            placement="bottomLeft"
                            autoAdjustOverflow
                            trigger={['click']}
                            onOpenChange={(open) => open && ensureNativeSessions(ws.id)}
                          >
                            <HistoryOutlined
                              style={{
                                fontSize: 12,
                                color: token.colorTextTertiary,
                                flexShrink: 0,
                                padding: '2px'
                              }}
                              title="历史会话"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </Dropdown>
                          {/* Add new session */}
                          <PlusOutlined
                            style={{
                              fontSize: 12,
                              color: token.colorTextTertiary,
                              flexShrink: 0,
                              padding: '2px'
                            }}
                            title="新建会话"
                            onClick={(e) => {
                              e.stopPropagation()
                              onNewSession(ws.id)
                            }}
                          />
                          {/* Open directory in native terminal */}
                          <CodeOutlined
                            style={{
                              fontSize: 12,
                              color: token.colorTextTertiary,
                              flexShrink: 0,
                              padding: '2px'
                            }}
                            title={t('coding.openInTerminal')}
                            onClick={(e) => {
                              e.stopPropagation()
                              window.api.aiWorkbench.openTerminal(ws.workingDir).catch(() => {})
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
                        if (row.kind === 'native') {
                          const ns = row.nativeSession
                          return (
                            <div
                              key={row.key}
                              onClick={() => handleResumeNativeSession(ws.id, ns.toolType, ns.sessionId, ns.title)}
                              style={{
                                ...rowBase,
                                padding: '2px 8px 2px 1.8em',
                                gap: 5,
                                fontSize: 12,
                                color: token.colorTextSecondary,
                                background: 'transparent'
                              }}
                              onMouseEnter={(e) =>
                                ((e.currentTarget as HTMLElement).style.background = token.colorFillSecondary)
                              }
                              onMouseLeave={(e) =>
                                ((e.currentTarget as HTMLElement).style.background = 'transparent')
                              }
                            >
                              <HistoryOutlined style={{ fontSize: 12, color: token.colorTextTertiary, flexShrink: 0 }} />
                              <Tag color={AI_TOOL_TAG_COLORS[ns.toolType]} style={{ ...AI_TOOL_TAG_STYLE, margin: 0, flexShrink: 0, fontSize: 10, lineHeight: '16px', paddingInline: 3 }}>
                                {renderAIToolTagLabel(ns.toolType, AI_TOOL_SHORT_NAMES[ns.toolType], 12)}
                              </Tag>
                              <span
                                title={ns.title}
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  lineHeight: '20px'
                                }}
                              >
                                {ns.title}
                              </span>
                              <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 11, color: token.colorTextQuaternary }}>
                                {formatRelativeTime(ns.modifiedAt)}
                              </span>
                            </div>
                          )
                        }

                        const session = row.session
                        const isSelected = activeSessionId === session.id
                        const sessionLabel = session.title
                          ? `${AI_TOOL_SHORT_NAMES[session.toolType]}: ${session.title}`
                          : `${AI_TOOL_SHORT_NAMES[session.toolType]} #${row.idx + 1}`
                        return (
                          <Dropdown
                            key={session.id}
                            menu={{
                              items: [
                                {
                                  key: 'delete',
                                  label: t('coding.deleteSession'),
                                  danger: true,
                                  onClick: () => handleDeleteSession(session.id)
                                }
                              ]
                            }}
                            trigger={['contextMenu']}
                          >
                            <div
                              onClick={() => {
                                onSelectSession(session.id)
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
                                  (e.currentTarget as HTMLElement).style.background =
                                    token.colorFillSecondary
                              }}
                              onMouseLeave={(e) => {
                                if (!isSelected)
                                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                              }}
                            >
                              {/* icon aligned with text via inline-flex */}
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  height: 20,
                                  flexShrink: 0
                                }}
                              >
                                <SessionStatusSVG
                                  status={session.status}
                                  activity={session.lastActivity}
                                  size={14}
                                />
                              </span>
                              <span
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  lineHeight: '20px'
                                }}
                              >
                                {sessionLabel}
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

export default AIWorkbenchSidebar
