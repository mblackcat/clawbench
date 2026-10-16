/**
 * Landing view shown on the right side when a workspace title is clicked in
 * the sidebar (open panes stay mounted underneath).
 *
 * Offers the three per-workspace entry points: quick-start a coding session
 * with an installed CLI, open a terminal, and open the Changes panel.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Spin, Tag, Tooltip, theme, Typography, Button } from 'antd'
import { CodeOutlined, FolderOpenOutlined, PlusOutlined, DiffOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { AI_TOOL_NAMES, AI_TOOL_TAG_COLORS, AI_TOOL_TAG_STYLE, renderAIToolTagLabel } from './aiToolMeta'
import { useT } from '../../i18n'
import { useVcsSelectionStore } from '../../stores/useVcsSelectionStore'
import { MONO_FONT_STACK } from '../../utils/mono-font'
import type { AICodingWorkspace, AIToolType, DetectedCLI } from '../../types/ai-coding'
import type { VcsType } from '../../types/ipc'
import { landingToolsCache, setLandingToolsCache } from '../../utils/coding-tools-cache'

const { Text } = Typography

const VCS_LABELS: Record<VcsType, string> = {
  git: 'Git',
  svn: 'SVN',
  perforce: 'Perforce',
  none: ''
}


interface WorkspaceLandingPanelProps {
  workspace: AICodingWorkspace
  /** Create + open a session of the given tool in the focused pane. */
  onOpenSession: (toolType: AIToolType) => void
  /** Open the tool picker dialog for this workspace. */
  onNewSession: () => void
  /** Create + open a terminal session in the focused pane. */
  onOpenTerminal: () => void
  /** Toggle the right-side Changes panel. */
  onToggleChanges: () => void
  changesOpen: boolean
}

const WorkspaceLandingPanel: React.FC<WorkspaceLandingPanelProps> = ({
  workspace,
  onOpenSession,
  onNewSession,
  onOpenTerminal,
  onToggleChanges,
  changesOpen
}) => {
  const t = useT()
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const [tools, setTools] = useState<DetectedCLI[]>(landingToolsCache ?? [])
  const [toolsLoading, setToolsLoading] = useState(landingToolsCache === null)
  const [changedCount, setChangedCount] = useState<number | null>(null)

  const resolveVcs = useVcsSelectionStore((s) => s.resolveVcs)
  const setVcsAvailable = useVcsSelectionStore((s) => s.setAvailable)
  const vcsKnown = useVcsSelectionStore((s) => workspace.workingDir in s.available)
  const vcsAvailable = useVcsSelectionStore((s) => s.available)
  const vcsSelection = useVcsSelectionStore((s) => s.selection)
  // Recomputed whenever the shared store learns about this dir (the sidebar
  // detects lazily in the background), so the badge fills in on its own.
  const vcsType = useMemo(
    () => resolveVcs(workspace.workingDir),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspace.workingDir, resolveVcs, vcsAvailable, vcsSelection]
  )

  // Detect the workspace's VCS ourselves when nothing else has yet (the
  // Changes panel / sidebar fill the shared store lazily).
  useEffect(() => {
    if (vcsKnown || !workspace.workingDir) return
    let cancelled = false
    window.api.vcs
      .detectAll(workspace.workingDir)
      .then((list) => {
        if (!cancelled) setVcsAvailable(workspace.workingDir, Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setVcsAvailable(workspace.workingDir, [])
      })
    return () => {
      cancelled = true
    }
  }, [vcsKnown, workspace.workingDir, setVcsAvailable])

  useEffect(() => {
    if (landingToolsCache !== null) {
      setTools(landingToolsCache)
      setToolsLoading(false)
    } else {
      setToolsLoading(true)
    }
    let cancelled = false
    window.api.aiCoding
      .detectTools()
      .then((detected) => {
        // Terminal has its own entry below; only CLIs belong in quick start.
        const coding = detected.filter((c) => c.toolType !== 'terminal')
        setLandingToolsCache(coding)
        if (!cancelled) setTools(coding)
      })
      .catch(() => {
        if (!cancelled && landingToolsCache === null) setTools([])
      })
      .finally(() => {
        if (!cancelled) setToolsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspace.id])

  const fetchChangedCount = useCallback(async () => {
    if (!workspace.workingDir || vcsType === 'none') {
      setChangedCount(null)
      return
    }
    try {
      const result = await window.api.vcs.changedFiles(workspace.workingDir, vcsType)
      setChangedCount(result.files?.length ?? 0)
    } catch {
      setChangedCount(null)
    }
  }, [workspace.workingDir, vcsType])

  useEffect(() => {
    fetchChangedCount()
    const timer = setInterval(fetchChangedCount, 30_000)
    return () => clearInterval(timer)
  }, [fetchChangedCount])

  const installedTools = useMemo(() => tools.filter((c) => c.installed && c.enabled !== false), [tools])

  const cardBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 180,
    padding: '10px 14px',
    borderRadius: token.borderRadius,
    border: `1px solid ${token.colorBorderSecondary}`,
    background: token.colorBgContainer,
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'border-color 0.15s ease, background 0.15s ease, transform 0.15s ease'
  }

  const hoverIn = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.currentTarget.style.borderColor = token.colorPrimary
    e.currentTarget.style.background = token.colorPrimaryBg
  }
  const hoverOut = (e: React.MouseEvent<HTMLDivElement>, active = false): void => {
    e.currentTarget.style.borderColor = active ? token.colorPrimary : token.colorBorderSecondary
    e.currentTarget.style.background = active ? token.colorPrimaryBg : token.colorBgContainer
  }

  const sectionTitle = (label: string): React.ReactNode => (
    <Text style={{ fontSize: 12, fontWeight: 600, color: token.colorTextTertiary }}>{label}</Text>
  )

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'auto',
        padding: '32px 28px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}
    >
      <div style={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* Workspace header */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderOpenOutlined style={{ fontSize: 18, color: token.colorPrimary }} />
            <Text style={{ fontSize: 18, fontWeight: 600 }}>{workspace.title}</Text>
            {vcsType !== 'none' && (
              <Tag color="default" style={{ ...AI_TOOL_TAG_STYLE, marginInlineEnd: 0 }}>
                {VCS_LABELS[vcsType]}
              </Tag>
            )}
          </div>
          <Text
            style={{
              fontSize: 12,
              color: token.colorTextTertiary,
              fontFamily: MONO_FONT_STACK,
              wordBreak: 'break-all'
            }}
            title={workspace.workingDir}
          >
            {workspace.workingDir}
          </Text>
        </div>

        {/* Quick start */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sectionTitle(t('coding.landingQuickStart'))}
          {toolsLoading ? (
            <div style={{ padding: '8px 0' }}>
              <Spin size="small" />
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {installedTools.map((cli) => (
                <div
                  key={cli.toolType}
                  role="button"
                  onClick={() => onOpenSession(cli.toolType)}
                  onMouseEnter={hoverIn}
                  onMouseLeave={(e) => hoverOut(e)}
                  style={{ ...cardBase, minWidth: 150 }}
                >
                  <Tag
                    color={AI_TOOL_TAG_COLORS[cli.toolType] ?? 'default'}
                    style={{ ...AI_TOOL_TAG_STYLE, marginInlineEnd: 0 }}
                  >
                    {renderAIToolTagLabel(cli.toolType, AI_TOOL_NAMES[cli.toolType] || cli.name, 13)}
                  </Tag>
                  {cli.version && (
                    <Text style={{ fontSize: 11, color: token.colorTextQuaternary }}>{cli.version}</Text>
                  )}
                </div>
              ))}
              {/* Always available: pick from the full tool list */}
              <div
                role="button"
                onClick={onNewSession}
                onMouseEnter={hoverIn}
                onMouseLeave={(e) => hoverOut(e)}
                style={{ ...cardBase, minWidth: 130 }}
              >
                <PlusOutlined style={{ fontSize: 14, color: token.colorPrimary }} />
                <Text style={{ fontSize: 13 }}>{t('coding.newSession')}</Text>
              </div>
            </div>
          )}
          {!toolsLoading && installedTools.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 12, color: token.colorTextQuaternary }}>
                {t('coding.landingNoTools')}
              </Text>
              <Button
                type="link"
                size="small"
                style={{ padding: 0, fontSize: 12 }}
                onClick={() => navigate('/local-env', { state: { scrollTo: 'ai-tools' } })}
              >
                {t('coding.goToInstall')}
              </Button>
            </div>
          )}
        </div>

        {/* Terminal + Changes entries */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sectionTitle(t('coding.landingEntries'))}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <div
              role="button"
              onClick={onOpenTerminal}
              onMouseEnter={hoverIn}
              onMouseLeave={(e) => hoverOut(e)}
              style={cardBase}
            >
              <CodeOutlined style={{ fontSize: 16, color: token.colorTextSecondary }} />
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <Text style={{ fontSize: 13 }}>{t('coding.landingTerminal')}</Text>
                <Text style={{ fontSize: 11, color: token.colorTextQuaternary }}>
                  {t('coding.landingTerminalDesc')}
                </Text>
              </div>
            </div>

            <Tooltip title={vcsType === 'none' ? t('coding.landingChangesNoVcs') : undefined}>
              <div
                role="button"
                onClick={() => {
                  if (vcsType === 'none') return
                  onToggleChanges()
                }}
                onMouseEnter={(e) => {
                  if (vcsType !== 'none') hoverIn(e)
                }}
                onMouseLeave={(e) => hoverOut(e, changesOpen)}
                style={{
                  ...cardBase,
                  cursor: vcsType === 'none' ? 'not-allowed' : 'pointer',
                  opacity: vcsType === 'none' ? 0.55 : 1,
                  borderColor: changesOpen ? token.colorPrimary : token.colorBorderSecondary,
                  background: changesOpen ? token.colorPrimaryBg : token.colorBgContainer
                }}
              >
                <DiffOutlined style={{ fontSize: 16, color: token.colorTextSecondary }} />
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Text style={{ fontSize: 13 }}>{t('coding.landingChanges')}</Text>
                  <Text style={{ fontSize: 11, color: token.colorTextQuaternary }}>
                    {vcsType === 'none'
                      ? t('coding.landingChangesNoVcs')
                      : changedCount === null
                        ? t('coding.landingChangesLoading')
                        : changedCount === 0
                          ? t('coding.landingChangesClean')
                          : t('coding.landingChangesCount', String(changedCount))}
                  </Text>
                </div>
              </div>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  )
}

export default WorkspaceLandingPanel
