import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Button, Input, Tag, Tooltip, theme, Typography, Spin } from 'antd'
import {
  FolderOutlined,
  FolderOpenOutlined,
  CheckCircleFilled,
  ArrowUpOutlined,
  CloseOutlined,
  CompassOutlined,
  ToolOutlined,
  PlusOutlined,
  DownOutlined,
  UpOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { Sparkles } from 'lucide'
import { InteractiveMorphIcon } from '../../components/common/InteractiveMorphIcon'
import { useNavigate } from 'react-router-dom'
import {
  AI_TOOL_NAMES,
  AI_TOOL_TAG_COLORS,
  AI_TOOL_TAG_STYLE,
  TOOLS_WITH_NATIVE_SESSIONS,
  getAIToolIcon
} from './aiToolMeta'
import { useT } from '../../i18n'
import type { AICodingWorkspace, AIToolType, AICodingSession, DetectedCLI } from '../../types/ai-coding'
import {
  toolsCache,
  setToolsCache
} from '../../utils/coding-tools-cache'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

export const DRAFT_STORAGE_KEY = 'cb-ai-coding-new-chat-draft'

export interface NewChatDraft {
  workspaceId?: string | null
  toolType?: AIToolType
  inputText?: string
}

export function loadNewChatDraft(): NewChatDraft {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as NewChatDraft
  } catch {
    return {}
  }
}

export function persistNewChatDraft(draft: NewChatDraft): void {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // ignore storage failures
  }
}

const TOOL_DESCRIPTIONS: Partial<Record<AIToolType, string>> = {
  claude: 'Anthropic Claude Code Agent',
  codex: 'OpenAI Codex CLI',
  antigravity: 'Google DeepMind Antigravity CLI',
  gemini: 'Google Gemini CLI',
  grok: 'xAI Grok Build CLI',
  omp: 'Interactive Pi Coding Agent'
}

interface AICodingNewChatLandingProps {
  workspaces: AICodingWorkspace[]
  sessions?: AICodingSession[]
  nativeSessionsMap?: Record<string, { sessions?: Array<{ modifiedAt: number }> }>
  tools?: DetectedCLI[]
  selectedWorkspaceId?: string | null
  onStartChat: (params: { workspaceId: string; toolType: AIToolType; text: string }) => Promise<void>
  onNewWorkspace: () => void
  onClose?: () => void
  onGoToInstall?: () => void
}

export const AICodingNewChatLanding: React.FC<AICodingNewChatLandingProps> = ({
  workspaces,
  sessions,
  nativeSessionsMap,
  tools: propsTools,
  selectedWorkspaceId: initialWorkspaceId,
  onStartChat,
  onNewWorkspace,
  onClose,
  onGoToInstall
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const navigate = useNavigate()

  // Load cached draft (selections & input text)
  const [draft] = useState<NewChatDraft>(() => loadNewChatDraft())

  // Coding Tools: query installed & enabled tools, consistent with workspace add session
  const [tools, setTools] = useState<DetectedCLI[]>(() => {
    if (propsTools) return propsTools
    return toolsCache ?? []
  })
  const [toolsLoading, setToolsLoading] = useState<boolean>(() => {
    if (propsTools) return false
    return toolsCache === null && Boolean(window.api?.aiCoding?.detectTools)
  })

  const fetchTools = useCallback((useCache: boolean): void => {
    if (propsTools) {
      setTools(propsTools)
      setToolsLoading(false)
      return
    }
    if (useCache && toolsCache !== null) {
      setTools(toolsCache)
      setToolsLoading(false)
      return
    }
    if (!window.api?.aiCoding?.detectTools) {
      setToolsLoading(false)
      return
    }
    setToolsLoading(true)
    window.api.aiCoding
      .detectTools()
      .then((detected) => {
        // Exclude plain terminal — users open that via the sidebar terminal icon
        const coding = (detected || []).filter((c) => c.toolType !== 'terminal')
        setToolsCache(coding)
        setTools(coding)
      })
      .catch(() => setTools([]))
      .finally(() => setToolsLoading(false))
  }, [propsTools])

  useEffect(() => {
    fetchTools(true)
  }, [fetchTools])

  // Filter for only installed and enabled coding tools (matching workspace New Session dialog)
  const availableTools = useMemo(() => {
    const list = propsTools ?? tools
    return list.filter((c) => c.installed && c.enabled !== false && c.toolType !== 'terminal')
  }, [propsTools, tools])

  // Optional internal fallback scan for native sessions if parent did not provide nativeSessionsMap
  const [internalNativeMap, setInternalNativeMap] = useState<Record<string, Array<{ modifiedAt: number }>>>({})

  useEffect(() => {
    if (nativeSessionsMap && Object.values(nativeSessionsMap).some((s) => (s?.sessions?.length || 0) > 0)) return
    if (!window.api?.aiCoding?.listNativeSessions) return

    let cancelled = false
    const scanAll = async (): Promise<void> => {
      const result: Record<string, Array<{ modifiedAt: number }>> = {}
      await Promise.all(
        workspaces.map(async (ws) => {
          try {
            const list = await Promise.all(
              TOOLS_WITH_NATIVE_SESSIONS.map(async (tt) => {
                try {
                  const items = await window.api.aiCoding.listNativeSessions(ws.workingDir, tt)
                  return items || []
                } catch { return [] }
              })
            )
            result[ws.id] = list.flat()
          } catch {
            result[ws.id] = []
          }
        })
      )
      if (!cancelled) {
        setInternalNativeMap(result)
      }
    }
    void scanAll()
    return () => { cancelled = true }
  }, [workspaces, nativeSessionsMap])

  // Map workspace id to its latest session activity timestamp (from live sessions, passed native sessions, or internal scan)
  const workspaceLatestActivityMap = useMemo(() => {
    const map = new Map<string, number>()
    if (sessions && sessions.length > 0) {
      for (const s of sessions) {
        if (!s.workspaceId) continue
        const activity = (typeof s.lastActivity === 'number' ? s.lastActivity : undefined) || s.updatedAt || s.createdAt || 0
        const curr = map.get(s.workspaceId) || 0
        if (activity > curr) {
          map.set(s.workspaceId, activity)
        }
      }
    }
    if (nativeSessionsMap) {
      for (const [wsId, st] of Object.entries(nativeSessionsMap)) {
        for (const ns of st?.sessions || []) {
          const activity = ns.modifiedAt || 0
          const curr = map.get(wsId) || 0
          if (activity > curr) {
            map.set(wsId, activity)
          }
        }
      }
    }
    for (const [wsId, list] of Object.entries(internalNativeMap)) {
      for (const ns of list || []) {
        const activity = ns.modifiedAt || 0
        const curr = map.get(wsId) || 0
        if (activity > curr) {
          map.set(wsId, activity)
        }
      }
    }
    return map
  }, [sessions, nativeSessionsMap, internalNativeMap])

  // Workspaces sorted by recent session activity, falling back to workspace update/create time
  const sortedWorkspaces = useMemo(() => {
    return [...workspaces].sort((a, b) => {
      const actA = workspaceLatestActivityMap.get(a.id) || 0
      const actB = workspaceLatestActivityMap.get(b.id) || 0
      if (actA !== actB) {
        return actB - actA
      }
      const timeA = a.updatedAt || a.createdAt || 0
      const timeB = b.updatedAt || b.createdAt || 0
      if (timeA !== timeB) {
        return timeB - timeA
      }
      return a.title.localeCompare(b.title)
    })
  }, [workspaces, workspaceLatestActivityMap])

  const hasOverflow = sortedWorkspaces.length > 9

  const userSelectedWorkspaceRef = useRef(false)

  // Workspace selection priority: draft -> initialWorkspaceId -> first sorted workspace
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(() => {
    if (draft.workspaceId && sortedWorkspaces.some((w) => w.id === draft.workspaceId)) {
      return draft.workspaceId
    }
    if (initialWorkspaceId && sortedWorkspaces.some((w) => w.id === initialWorkspaceId)) {
      return initialWorkspaceId
    }
    return sortedWorkspaces[0]?.id || null
  })

  // Synchronize default selected workspace when sortedWorkspaces updates if user has not manually selected
  useEffect(() => {
    if (userSelectedWorkspaceRef.current) return
    if (draft.workspaceId || initialWorkspaceId) return
    if (sortedWorkspaces.length > 0 && selectedWorkspaceId !== sortedWorkspaces[0].id) {
      setSelectedWorkspaceId(sortedWorkspaces[0].id)
    }
  }, [sortedWorkspaces, draft.workspaceId, initialWorkspaceId, selectedWorkspaceId])

  // Tool selection priority: draft -> first available tool -> 'claude'
  const [selectedToolType, setSelectedToolType] = useState<AIToolType>(() => {
    if (draft.toolType) return draft.toolType
    return 'claude'
  })

  // Synchronize selected tool if currently chosen tool is not in available tools list
  useEffect(() => {
    if (availableTools.length > 0) {
      if (!availableTools.some((t) => t.toolType === selectedToolType)) {
        setSelectedToolType(availableTools[0].toolType)
      }
    }
  }, [availableTools, selectedToolType])

  // Expand state: auto-expand if selected workspace is beyond top 9
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    const targetWsId = draft.workspaceId || initialWorkspaceId
    if (targetWsId) {
      const idx = sortedWorkspaces.findIndex((w) => w.id === targetWsId)
      if (idx >= 9) return true
    }
    return false
  })

  const visibleWorkspaces = useMemo(() => {
    if (isExpanded || !hasOverflow) {
      return sortedWorkspaces
    }
    return sortedWorkspaces.slice(0, 9)
  }, [sortedWorkspaces, isExpanded, hasOverflow])

  // Cached input text
  const [inputText, setInputText] = useState(() => draft.inputText || '')
  const [submitting, setSubmitting] = useState(false)

  // Persist selections & prompt text to draft cache
  useEffect(() => {
    persistNewChatDraft({
      workspaceId: selectedWorkspaceId,
      toolType: selectedToolType,
      inputText
    })
  }, [selectedWorkspaceId, selectedToolType, inputText])

  const selectedWorkspace = useMemo(
    () => sortedWorkspaces.find((w) => w.id === selectedWorkspaceId) || null,
    [sortedWorkspaces, selectedWorkspaceId]
  )

  const canSend = Boolean(
    selectedWorkspaceId &&
    selectedToolType &&
    availableTools.some((t) => t.toolType === selectedToolType) &&
    inputText.trim() &&
    !submitting
  )

  const handleSubmit = async () => {
    if (!selectedWorkspaceId || !selectedToolType || !inputText.trim() || submitting) return
    if (!availableTools.some((t) => t.toolType === selectedToolType)) return
    setSubmitting(true)
    try {
      await onStartChat({
        workspaceId: selectedWorkspaceId,
        toolType: selectedToolType,
        text: inputText.trim()
      })
      // Clear draft input text once sent
      setInputText('')
      persistNewChatDraft({
        workspaceId: selectedWorkspaceId,
        toolType: selectedToolType,
        inputText: ''
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (canSend) {
        void handleSubmit()
      }
    }
  }

  const handleGoToInstallRoute = () => {
    if (onGoToInstall) {
      onGoToInstall()
    } else {
      navigate('/local-env', { state: { scrollTo: 'ai-tools' } })
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        height: '100%',
        minHeight: 0,
        background: token.colorBgContainer,
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Scrollable Main Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '28px 24px 140px'
        }}
      >
        <div style={{ maxWidth: 840, width: '100%' }}>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginBottom: 24
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: token.borderRadiusLG,
                    background: token.colorPrimaryBg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: token.colorPrimary
                  }}
                >
                  <InteractiveMorphIcon icon={Sparkles} hoverIcon={Sparkles} size={20} />
                </div>
                <Title level={4} style={{ margin: 0, fontWeight: 700, fontSize: 20 }}>
                  {t('coding.startNewChat')}
                </Title>
              </div>
              <Paragraph
                style={{
                  margin: '6px 0 0',
                  color: token.colorTextTertiary,
                  fontSize: 13
                }}
              >
                {t('coding.startNewChatSub')}
              </Paragraph>
            </div>
            {onClose && (
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined style={{ fontSize: 13, color: token.colorTextTertiary }} />}
                onClick={onClose}
              />
            )}
          </div>

          {/* Area 1: Workspace Selection (Small card style) */}
          <div style={{ marginBottom: 28 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CompassOutlined style={{ fontSize: 13, color: token.colorPrimary }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>
                  {t('coding.selectWorkspace')}
                </span>
                <Tag
                  style={{
                    fontSize: 11,
                    lineHeight: '16px',
                    paddingInline: 6,
                    borderRadius: 10,
                    margin: 0,
                    border: 'none',
                    background: token.colorFillTertiary,
                    color: token.colorTextSecondary
                  }}
                >
                  {workspaces.length}
                </Tag>
              </div>
              {hasOverflow && (
                <Button
                  type="link"
                  size="small"
                  onClick={() => setIsExpanded((prev) => !prev)}
                  style={{
                    fontSize: 12,
                    padding: 0,
                    height: 'auto',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    color: token.colorPrimary
                  }}
                >
                  {isExpanded ? (
                    <>
                      <span>{t('coding.collapse')}</span>
                      <UpOutlined style={{ fontSize: 10 }} />
                    </>
                  ) : (
                    <>
                      <span>{t('coding.expandAll')} ({workspaces.length})</span>
                      <DownOutlined style={{ fontSize: 10 }} />
                    </>
                  )}
                </Button>
              )}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
                gap: 10
              }}
            >
              {visibleWorkspaces.map((ws) => {
                const isSelected = ws.id === selectedWorkspaceId
                return (
                  <div
                    key={ws.id}
                    onClick={() => {
                      userSelectedWorkspaceRef.current = true
                      setSelectedWorkspaceId(ws.id)
                    }}
                    style={{
                      border: `1.5px solid ${isSelected ? token.colorPrimary : token.colorBorderSecondary}`,
                      background: isSelected ? token.colorPrimaryBg : token.colorBgContainer,
                      borderRadius: token.borderRadiusLG,
                      padding: '10px 12px',
                      cursor: 'pointer',
                      transition: 'all 0.18s ease',
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      boxShadow: isSelected
                        ? `0 2px 8px ${token.colorPrimaryBgHover}`
                        : 'none'
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = token.colorBorder
                        e.currentTarget.style.transform = 'translateY(-1px)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = token.colorBorderSecondary
                        e.currentTarget.style.transform = ''
                      }
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isSelected ? (
                        <FolderOpenOutlined style={{ fontSize: 15, color: token.colorPrimary }} />
                      ) : (
                        <FolderOutlined style={{ fontSize: 15, color: token.colorTextSecondary }} />
                      )}
                      <span
                        title={ws.title}
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          color: isSelected ? token.colorPrimary : token.colorText,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1
                        }}
                      >
                        {ws.title}
                      </span>
                      {isSelected && (
                        <CheckCircleFilled
                          style={{ fontSize: 14, color: token.colorPrimary, flexShrink: 0 }}
                        />
                      )}
                    </div>
                    <span
                      title={ws.workingDir}
                      style={{
                        fontSize: 11,
                        color: token.colorTextQuaternary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        lineHeight: 1.2
                      }}
                    >
                      {ws.workingDir}
                    </span>
                  </div>
                )
              })}

              {/* Add New Workspace card */}
              <div
                onClick={onNewWorkspace}
                style={{
                  border: `1.5px dashed ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadiusLG,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  color: token.colorTextSecondary,
                  transition: 'all 0.18s ease',
                  minHeight: 56
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = token.colorPrimary
                  e.currentTarget.style.color = token.colorPrimary
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = token.colorBorderSecondary
                  e.currentTarget.style.color = token.colorTextSecondary
                }}
              >
                <PlusOutlined style={{ fontSize: 12 }} />
                <span style={{ fontSize: 12, fontWeight: 500 }}>
                  {t('coding.openLocalFolder')}
                </span>
              </div>
            </div>

            {hasOverflow && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                <Button
                  type="text"
                  size="small"
                  onClick={() => setIsExpanded((prev) => !prev)}
                  icon={isExpanded ? <UpOutlined style={{ fontSize: 11 }} /> : <DownOutlined style={{ fontSize: 11 }} />}
                  style={{
                    color: token.colorTextSecondary,
                    fontSize: 12,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  {isExpanded
                    ? t('coding.collapse')
                    : `${t('coding.expandAll')} (${sortedWorkspaces.length})`}
                </Button>
              </div>
            )}
          </div>

          {/* Area 2: Coding Tools Selection (only enabled coding tools) */}
          <div style={{ marginBottom: 28 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ToolOutlined style={{ fontSize: 13, color: token.colorPrimary }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>
                  {t('coding.selectTool')}
                </span>
                <Tag
                  style={{
                    fontSize: 11,
                    lineHeight: '16px',
                    paddingInline: 6,
                    borderRadius: 10,
                    margin: 0,
                    border: 'none',
                    background: token.colorFillTertiary,
                    color: token.colorTextSecondary
                  }}
                >
                  {availableTools.length}
                </Tag>
              </div>

              <Tooltip title={t('coding.refreshTools')}>
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined spin={toolsLoading} style={{ fontSize: 12, color: token.colorTextTertiary }} />}
                  onClick={() => fetchTools(false)}
                  disabled={toolsLoading}
                />
              </Tooltip>
            </div>

            {toolsLoading && availableTools.length === 0 ? (
              <div
                style={{
                  padding: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  color: token.colorTextTertiary
                }}
              >
                <Spin size="small" />
                <span style={{ fontSize: 12 }}>{t('coding.detectingTools')}</span>
              </div>
            ) : availableTools.length === 0 ? (
              <div
                style={{
                  border: `1.5px dashed ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadiusLG,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: token.colorFillAlter
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: token.colorTextSecondary }}>
                    {t('coding.noInstalledToolsTitle')}
                  </div>
                  <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>
                    {t('coding.noInstalledToolsDesc')}
                  </div>
                </div>
                <Button
                  type="primary"
                  size="small"
                  onClick={handleGoToInstallRoute}
                >
                  {t('coding.goToInstall')}
                </Button>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 10
                }}
              >
                {availableTools.map((tool) => {
                  const isSelected = tool.toolType === selectedToolType
                  const icon = getAIToolIcon(tool.toolType, 18)
                  const displayName = AI_TOOL_NAMES[tool.toolType] || tool.name
                  const desc = tool.version
                    ? `v${tool.version} · ${TOOL_DESCRIPTIONS[tool.toolType] || tool.name}`
                    : (TOOL_DESCRIPTIONS[tool.toolType] || tool.name)
                  return (
                    <div
                      key={tool.toolType}
                      onClick={() => setSelectedToolType(tool.toolType)}
                      style={{
                        border: `1.5px solid ${isSelected ? token.colorPrimary : token.colorBorderSecondary}`,
                        background: isSelected ? token.colorPrimaryBg : token.colorBgContainer,
                        borderRadius: token.borderRadiusLG,
                        padding: '10px 12px',
                        cursor: 'pointer',
                        transition: 'all 0.18s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        boxShadow: isSelected
                          ? `0 2px 8px ${token.colorPrimaryBgHover}`
                          : 'none'
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.borderColor = token.colorBorder
                          e.currentTarget.style.transform = 'translateY(-1px)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.borderColor = token.colorBorderSecondary
                          e.currentTarget.style.transform = ''
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 6,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}
                        >
                          {icon}
                        </div>
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            color: isSelected ? token.colorPrimary : token.colorText,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1
                          }}
                        >
                          {displayName}
                        </span>
                        {isSelected && (
                          <CheckCircleFilled
                            style={{ fontSize: 14, color: token.colorPrimary, flexShrink: 0 }}
                          />
                        )}
                      </div>
                      <span
                        title={desc}
                        style={{
                          fontSize: 11,
                          color: token.colorTextTertiary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          lineHeight: 1.2
                        }}
                      >
                        {desc}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Fixed Input Box */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '16px 24px 20px',
          background: `linear-gradient(to top, ${token.colorBgContainer} 80%, transparent)`,
          display: 'flex',
          justifyContent: 'center',
          zIndex: 10
        }}
      >
        <div
          style={{
            maxWidth: 840,
            width: '100%',
            background: token.colorBgElevated,
            border: `1.5px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG + 2,
            boxShadow: token.boxShadowTertiary,
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = token.colorPrimary
            e.currentTarget.style.boxShadow = `0 8px 28px ${token.colorPrimaryBgHover}`
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = token.colorBorderSecondary
            e.currentTarget.style.boxShadow = token.boxShadowTertiary
          }}
        >
          {/* Prompt textarea */}
          <TextArea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              t('coding.promptPlaceholder')
            }
            autoSize={{ minRows: 2, maxRows: 6 }}
            variant="borderless"
            style={{
              padding: 0,
              fontSize: 14,
              resize: 'none',
              background: 'transparent'
            }}
          />

          {/* Bottom Bar: Selection Indicators & Send Button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 6,
              borderTop: `1px solid ${token.colorBorderSecondary}`
            }}
          >
            {/* Selections info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {selectedWorkspace ? (
                <Tag
                  color="blue"
                  style={{
                    margin: 0,
                    borderRadius: 6,
                    fontSize: 11,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <FolderOutlined style={{ fontSize: 11 }} />
                  <span>{selectedWorkspace.title}</span>
                </Tag>
              ) : (
                <Tag color="warning" style={{ margin: 0, borderRadius: 6, fontSize: 11 }}>
                  请选择工作区
                </Tag>
              )}

              {selectedToolType && availableTools.some((t) => t.toolType === selectedToolType) ? (
                <Tag
                  color={AI_TOOL_TAG_COLORS[selectedToolType]}
                  style={{
                    margin: 0,
                    borderRadius: 6,
                    fontSize: 11,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  {getAIToolIcon(selectedToolType, 12)}
                  <span>{AI_TOOL_NAMES[selectedToolType]}</span>
                </Tag>
              ) : (
                <Tag color="warning" style={{ margin: 0, borderRadius: 6, fontSize: 11 }}>
                  {t('coding.selectTool')}
                </Tag>
              )}
            </div>

            {/* Send Button */}
            <Tooltip
              title={
                !selectedWorkspaceId
                  ? t('coding.pleaseSelectWorkspaceAndTool')
                  : !selectedToolType || !availableTools.some((t) => t.toolType === selectedToolType)
                    ? t('coding.selectTool')
                    : !inputText.trim()
                      ? t('coding.promptPlaceholder')
                      : `${t('coding.send')} (Enter)`
              }
            >
              <Button
                type="primary"
                shape="round"
                size="middle"
                icon={<ArrowUpOutlined style={{ fontSize: 13 }} />}
                disabled={!canSend}
                loading={submitting}
                onClick={handleSubmit}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontWeight: 600,
                  height: 32,
                  paddingInline: 16
                }}
              >
                {t('coding.send')}
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AICodingNewChatLanding
