import React, { useState, useMemo, useEffect, useRef } from 'react'
import { Modal, Input, Tag, theme, Typography } from 'antd'
import { SearchOutlined, FolderOpenOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { Plus, Sparkles } from 'lucide'
import { InteractiveMorphIcon } from '../../components/common/InteractiveMorphIcon'
import { getAIToolIcon, AI_TOOL_SHORT_NAMES, AI_TOOL_NAMES, AI_TOOL_TAG_COLORS, AI_TOOL_TAG_STYLE } from './aiToolMeta'
import { useT, getT } from '../../i18n'
import type { AICodingSession, AICodingWorkspace, AIToolType } from '../../types/ai-coding'
import type { SidebarNativeSession } from './AICodingSidebar'

const { Text } = Typography

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return getT()('workbench.justNow')
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export interface SearchSessionItem {
  key: string
  sessionId: string
  toolType: AIToolType
  title: string
  modifiedAt: number
  workspaceId: string
  workspaceTitle: string
  isNative: boolean
}

interface AICodingSearchModalProps {
  open: boolean
  onClose: () => void
  onNewChat: () => void
  onOpenFolder: () => void
  onSelectSession: (
    sessionId: string,
    workspaceId: string,
    nativeToolType?: AIToolType,
    nativeTitle?: string
  ) => void
  workspaces: AICodingWorkspace[]
  sessions: AICodingSession[]
  nativeSessionsMap?: Record<string, { sessions: SidebarNativeSession[]; loaded?: boolean }>
}

export const AICodingSearchModal: React.FC<AICodingSearchModalProps> = ({
  open,
  onClose,
  onNewChat,
  onOpenFolder,
  onSelectSession,
  workspaces,
  sessions,
  nativeSessionsMap = {}
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<any>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [open])

  const workspaceMap = useMemo(() => {
    const map = new Map<string, AICodingWorkspace>()
    for (const ws of workspaces) {
      map.set(ws.id, ws)
    }
    return map
  }, [workspaces])

  // Collect all sessions (opened + native)
  const allSessions = useMemo(() => {
    const list: SearchSessionItem[] = []
    const openedToolSessions = new Set<string>()

    for (const session of sessions) {
      if (session.toolType === 'terminal') continue
      const ws = workspaceMap.get(session.workspaceId)
      const wsTitle = ws?.title || 'Unknown Workspace'
      if (session.toolSessionId) {
        openedToolSessions.add(`${session.toolType}:${session.toolSessionId}`)
      }
      list.push({
        key: `opened-${session.id}`,
        sessionId: session.id,
        toolType: session.toolType,
        title: session.title || `${AI_TOOL_SHORT_NAMES[session.toolType] || session.toolType} session`,
        modifiedAt: session.updatedAt || session.createdAt || 0,
        workspaceId: session.workspaceId,
        workspaceTitle: wsTitle,
        isNative: false
      })
    }

    const nativeEntries = Object.entries(nativeSessionsMap)
      .filter(([wsId]) => workspaceMap.has(wsId))
      .sort(([aId], [bId]) => {
        const aLen = workspaceMap.get(aId)?.workingDir?.length || 0
        const bLen = workspaceMap.get(bId)?.workingDir?.length || 0
        return bLen - aLen
      })

    for (const [wsId, state] of nativeEntries) {
      const ws = workspaceMap.get(wsId)
      if (!ws) continue
      const wsTitle = ws.title || 'Unknown Workspace'
      for (const ns of state.sessions || []) {
        if (!ns.sessionId) continue
        const natKey = `${ns.toolType}:${ns.sessionId}`
        if (openedToolSessions.has(natKey)) continue
        openedToolSessions.add(natKey)
        list.push({
          key: `native-${wsId}-${ns.toolType}-${ns.sessionId}`,
          sessionId: ns.sessionId,
          toolType: ns.toolType,
          title: ns.title || `${AI_TOOL_SHORT_NAMES[ns.toolType] || ns.toolType} session`,
          modifiedAt: ns.modifiedAt,
          workspaceId: wsId,
          workspaceTitle: wsTitle,
          isNative: true
        })
      }
    }

    // Sort by modified time descending
    list.sort((a, b) => b.modifiedAt - a.modifiedAt)
    return list
  }, [sessions, nativeSessionsMap, workspaceMap])

  // Filter sessions by query
  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return allSessions.slice(0, 20)
    }
    return allSessions.filter((s) => {
      const titleMatch = s.title.toLowerCase().includes(q)
      const wsMatch = s.workspaceTitle.toLowerCase().includes(q)
      const toolMatch = (AI_TOOL_NAMES[s.toolType] || s.toolType).toLowerCase().includes(q)
      return titleMatch || wsMatch || toolMatch
    })
  }, [allSessions, query])

  // Total navigable items count: 2 quick actions + filtered sessions
  const totalItems = 2 + filteredSessions.length

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % totalItems)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIndex === 0) {
        onNewChat()
        onClose()
      } else if (selectedIndex === 1) {
        onOpenFolder()
        onClose()
      } else {
        const sessionItem = filteredSessions[selectedIndex - 2]
        if (sessionItem) {
          onSelectSession(
            sessionItem.sessionId,
            sessionItem.workspaceId,
            sessionItem.isNative ? sessionItem.toolType : undefined,
            sessionItem.title
          )
          onClose()
        }
      }
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.querySelector(`[data-active="true"]`) as HTMLElement | null
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedIndex])

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={600}
      centered
      destroyOnHidden
      styles={{
        content: {
          padding: 0,
          borderRadius: token.borderRadiusLG,
          overflow: 'hidden',
          boxShadow: token.boxShadowSecondary,
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorderSecondary}`
        }
      }}
    >
      <div onKeyDown={handleKeyDown} style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Top search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            gap: 10
          }}
        >
          <SearchOutlined style={{ fontSize: 18, color: token.colorTextTertiary }} />
          <Input
            ref={inputRef}
            variant="borderless"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder={t('coding.searchModalPlaceholder')}
            style={{ fontSize: 15, padding: 0 }}
          />
          <Tag
            style={{
              fontSize: 11,
              lineHeight: '18px',
              paddingInline: 6,
              borderRadius: 4,
              color: token.colorTextQuaternary,
              background: token.colorFillQuaternary,
              border: 'none',
              cursor: 'pointer'
            }}
            onClick={onClose}
          >
            ESC
          </Tag>
        </div>

        {/* Quick Actions (Fixed Options) */}
        <div style={{ padding: '8px 10px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <div
            data-active={selectedIndex === 0}
            onClick={() => {
              onNewChat()
              onClose()
            }}
            onMouseEnter={() => setSelectedIndex(0)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 12px',
              borderRadius: token.borderRadiusSM,
              cursor: 'pointer',
              background: selectedIndex === 0 ? token.colorPrimaryBg : 'transparent',
              transition: 'background 0.15s ease'
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: token.borderRadiusSM,
                background: token.colorPrimaryBgHover,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: token.colorPrimary
              }}
            >
              <InteractiveMorphIcon icon={Plus} hoverIcon={Sparkles} size={15} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>
                  {t('coding.newChat')}
                </span>
                <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>(New Chat)</span>
              </div>
              <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                {t('coding.newChatDesc')}
              </span>
            </div>
            <Tag style={{ fontSize: 10, borderRadius: 4, color: token.colorTextTertiary, border: 'none' }}>
              Action
            </Tag>
          </div>

          <div
            data-active={selectedIndex === 1}
            onClick={() => {
              onOpenFolder()
              onClose()
            }}
            onMouseEnter={() => setSelectedIndex(1)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 12px',
              borderRadius: token.borderRadiusSM,
              cursor: 'pointer',
              background: selectedIndex === 1 ? token.colorPrimaryBg : 'transparent',
              transition: 'background 0.15s ease',
              marginTop: 2
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: token.borderRadiusSM,
                background: token.colorFillTertiary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: token.colorTextSecondary
              }}
            >
              <FolderOpenOutlined style={{ fontSize: 15 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>
                  {t('coding.openFolder')}
                </span>
                <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>(Open Folder)</span>
              </div>
              <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                {t('coding.openFolderDesc')}
              </span>
            </div>
            <Tag style={{ fontSize: 10, borderRadius: 4, color: token.colorTextTertiary, border: 'none' }}>
              Workspace
            </Tag>
          </div>
        </div>

        {/* Recent Conversations / Search Results list */}
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 360, minHeight: 120 }}>
          <div
            style={{
              padding: '8px 16px 4px',
              fontSize: 11,
              fontWeight: 600,
              color: token.colorTextTertiary,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <ClockCircleOutlined style={{ fontSize: 11 }} />
            <span>
              {query.trim()
                ? `${filteredSessions.length} 条会话匹配结果`
                : t('coding.recents')}
            </span>
          </div>

          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '4px 10px 10px'
            }}
          >
            {filteredSessions.length === 0 ? (
              <div
                style={{
                  padding: '24px 0',
                  textAlign: 'center',
                  color: token.colorTextQuaternary,
                  fontSize: 13
                }}
              >
                {t('coding.noRecentSessions')}
              </div>
            ) : (
              filteredSessions.map((item, index) => {
                const itemIndex = index + 2
                const isSelected = selectedIndex === itemIndex
                return (
                  <div
                    key={item.key}
                    data-active={isSelected}
                    onClick={() => {
                      onSelectSession(
                        item.sessionId,
                        item.workspaceId,
                        item.isNative ? item.toolType : undefined,
                        item.title
                      )
                      onClose()
                    }}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 10px',
                      borderRadius: token.borderRadiusSM,
                      cursor: 'pointer',
                      background: isSelected ? token.colorFillSecondary : 'transparent',
                      transition: 'background 0.12s ease'
                    }}
                  >
                    {/* Tool icon */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        flexShrink: 0
                      }}
                    >
                      {getAIToolIcon(item.toolType, 15) ?? (
                        <Tag
                          color={AI_TOOL_TAG_COLORS[item.toolType]}
                          style={{ ...AI_TOOL_TAG_STYLE, margin: 0, fontSize: 10, paddingInline: 3 }}
                        >
                          {AI_TOOL_SHORT_NAMES[item.toolType] || item.toolType}
                        </Tag>
                      )}
                    </div>

                    {/* Title */}
                    <span
                      title={item.title}
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 13,
                        color: isSelected ? token.colorPrimary : token.colorText,
                        lineHeight: '20px'
                      }}
                    >
                      {item.title}
                    </span>

                    {/* Workspace tag badge */}
                    <Tag
                      bordered={false}
                      title={item.workspaceTitle}
                      style={{
                        margin: 0,
                        maxWidth: 130,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        borderRadius: 8,
                        fontSize: 11,
                        paddingInline: 6,
                        lineHeight: '18px',
                        background: token.colorFillTertiary,
                        color: token.colorTextSecondary
                      }}
                    >
                      {item.workspaceTitle}
                    </Tag>

                    {/* Modified time */}
                    <span
                      style={{
                        fontSize: 11,
                        color: token.colorTextQuaternary,
                        flexShrink: 0,
                        minWidth: 26,
                        textAlign: 'right'
                      }}
                    >
                      {formatRelativeTime(item.modifiedAt)}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default AICodingSearchModal
