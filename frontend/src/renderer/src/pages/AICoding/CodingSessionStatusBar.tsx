import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Tooltip, theme } from 'antd'
import {
  FolderOutlined,
  BranchesOutlined,
  DashboardOutlined,
  DollarOutlined,
  DiffOutlined,
  MessageOutlined
} from '@ant-design/icons'
import { Sparkles } from 'lucide'
import { AntdMorphIcon } from '../../components/common/AntdMorphIcon'
import { useT } from '../../i18n'
import { MONO_FONT_STACK } from '../../utils/mono-font'
import { useAICodingStore } from '../../stores/useAICodingStore'
import { getAIToolIcon } from './aiToolMeta'
import type { AICodingSession, AIToolType, CodingContentBlock } from '../../types/ai-coding'

export interface CodingSessionStatusBarProps {
  sessionId: string
  session: AICodingSession
  workingDir: string
  messageCount?: number
  onToggleGitPanel?: () => void
}

/** Formats token count to compact human-readable format: 500, 12.5k, 200k, 1.2M */
export function formatTokens(num: number): string {
  if (!num || num < 0) return '0'
  if (num < 1000) return `${num}`
  if (num < 1_000_000) {
    const k = num / 1000
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`
  }
  const m = num / 1_000_000
  return `${m.toFixed(1)}M`
}

/** Default context window size fallback per tool (a `[1m]` model alias selects Claude's 1M window). */
export function getDefaultContextWindow(toolType?: AIToolType, model?: string): number {
  if (toolType === 'claude' && model && /\[1m\]/i.test(model)) return 1_000_000
  switch (toolType) {
    case 'gemini':
    case 'antigravity':
      return 1_000_000
    case 'grok':
      return 128_000
    case 'codex':
    case 'claude':
    default:
      return 200_000
  }
}

/** Formats model names into standardized display names */
export function formatModelName(model?: string, toolType?: AIToolType): string {
  if (model) {
    const m = model.trim()
    const lower = m.toLowerCase()
    if (lower.includes('claude-3-7-sonnet') || lower.includes('claude 3.7 sonnet')) return 'Claude 3.7 Sonnet'
    if (lower.includes('claude-3-5-sonnet') || lower.includes('claude 3.5 sonnet')) return 'Claude 3.5 Sonnet'
    if (lower.includes('claude-3-5-haiku') || lower.includes('claude 3.5 haiku')) return 'Claude 3.5 Haiku'
    if (lower.includes('claude-3-opus') || lower.includes('claude 3 opus')) return 'Claude 3 Opus'
    // Claude 4+ ids: claude-<family>-<major>[-<minor>][-<date>][[1m]] (minor ≤ 2 digits, dates are 8)
    const claude = lower.match(/claude-(opus|sonnet|haiku|fable|mythos)-(\d{1,2})(?:-(\d{1,2}))?(?!\d)/)
    if (claude) {
      const [, family, major, minor] = claude
      return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${minor ? `${major}.${minor}` : major}`
    }
    if (lower.includes('claude opus 5.5')) return 'Claude Opus 5.5'
    if (lower.includes('gpt-4o-mini') || lower.includes('gpt 4o mini')) return 'GPT-4o mini'
    if (lower.includes('gpt-4o') || lower.includes('gpt 4o')) return 'GPT-4o'
    if (lower.includes('o3-mini')) return 'o3-mini'
    if (lower.includes('o1-mini')) return 'o1-mini'
    if (lower.includes('o1')) return 'o1'
    if (lower.includes('gemini-3.8-flash') || lower.includes('gemini 3.8 flash')) return 'Gemini 3.8 Flash'
    if (lower.includes('gemini-3.8-pro') || lower.includes('gemini 3.8 pro')) return 'Gemini 3.8 Pro'
    if (lower.includes('gemini-2.5-pro') || lower.includes('gemini 2.5 pro')) return 'Gemini 2.5 Pro'
    if (lower.includes('gemini-2.5-flash') || lower.includes('gemini 2.5 flash')) return 'Gemini 2.5 Flash'
    if (lower.includes('gemini-2.0-flash') || lower.includes('gemini 2.0 flash')) return 'Gemini 2.0 Flash'
    if (lower.includes('gemini-1.5-pro') || lower.includes('gemini 1.5 pro')) return 'Gemini 1.5 Pro'
    if (lower.includes('gemini-1.5-flash') || lower.includes('gemini 1.5 flash')) return 'Gemini 1.5 Flash'
    if (lower.includes('grok-2') || lower.includes('grok 2')) return 'Grok 2'
    if (lower.includes('grok-3') || lower.includes('grok 3')) return 'Grok 3'
    if (lower.includes('grok-code') || lower.includes('grok code')) return 'Grok Code'
    return m
  }
  switch (toolType) {
    case 'claude':
      // Unknown until Claude Code reports it — don't claim a specific version.
      return 'Claude'
    case 'codex':
      return 'GPT-4o'
    case 'antigravity':
      return 'Gemini 3.8 Flash'
    case 'gemini':
      return 'Gemini 2.5 Pro'
    case 'grok':
      return 'Grok 2'
    default:
      return 'AI Model'
  }
}

const CodingSessionStatusBar: React.FC<CodingSessionStatusBarProps> = ({
  sessionId,
  session,
  workingDir,
  messageCount,
  onToggleGitPanel
}) => {
  const t = useT()
  const { token } = theme.useToken()

  // Git state
  const [gitBranch, setGitBranch] = useState<string>('')
  const [isGit, setIsGit] = useState<boolean>(false)
  const [diffStat, setDiffStat] = useState<{ additions: number; deletions: number }>({ additions: 0, deletions: 0 })

  // Live stats from backend (accurate tokens, cost, and model)
  const [liveStats, setLiveStats] = useState<{
    model?: string
    costUsd?: number
    contextUsage?: {
      inputTokens?: number
      cachedInputTokens?: number
      outputTokens?: number
      usedTokens?: number
      contextWindow?: number
    }
    /** Configured model's window, reported before any usage exists (fresh session). */
    contextWindow?: number
  } | null>(null)

  // The bar is reused across tabs: drop the previous session's stats and ignore
  // late responses for it, or a newly added tab shows the old tab's model/window.
  const statsSessionRef = useRef(sessionId)
  statsSessionRef.current = sessionId
  useEffect(() => {
    setLiveStats(null)
  }, [sessionId])

  const refreshStats = useCallback(async () => {
    if (!sessionId) return
    try {
      const stats = await window.api?.aiCoding?.getSessionStats?.(sessionId)
      if (stats && statsSessionRef.current === sessionId) {
        setLiveStats(stats)
      }
    } catch {
      // ignore
    }
  }, [sessionId])

  // Pull context usage and messages from zustand store
  const contextUsageFromStore = useAICodingStore((s) => s.sessionContextUsage[sessionId])
  const messages = useAICodingStore((s) => s.sessionMessages[sessionId] || [])

  // Session turn/message count (unified from former chat status bar)
  const turnCount = useMemo(() => {
    if (typeof messageCount === 'number') return messageCount
    return messages.length
  }, [messageCount, messages.length])

  // Derive latest context usage block if store key isn't populated
  const contextUsage = useMemo(() => {
    if (liveStats?.contextUsage && (liveStats.contextUsage.usedTokens || liveStats.contextUsage.inputTokens || liveStats.contextUsage.outputTokens)) {
      return liveStats.contextUsage
    }
    if (contextUsageFromStore) return contextUsageFromStore
    for (let i = messages.length - 1; i >= 0; i--) {
      const found = messages[i].blocks.find((b): b is Extract<CodingContentBlock, { type: 'context_usage' }> => b.type === 'context_usage')
      if (found) return found
    }
    return liveStats?.contextUsage
  }, [liveStats?.contextUsage, contextUsageFromStore, messages])

  // Accumulated session cost
  const totalCost = useMemo(() => {
    if (typeof liveStats?.costUsd === 'number' && liveStats.costUsd > 0) return liveStats.costUsd
    if (typeof session?.costUsd === 'number' && session.costUsd > 0) return session.costUsd
    return messages.reduce((max, m) => Math.max(max, m.costUsd || 0), 0)
  }, [liveStats?.costUsd, session?.costUsd, messages])

  // Context progress metrics
  const { usedTokens, totalTokens, percent, barColor } = useMemo(() => {
    const used = contextUsage?.usedTokens ??
      ((contextUsage?.inputTokens || 0) + (contextUsage?.cachedInputTokens || 0) + (contextUsage?.outputTokens || 0))
    let total = contextUsage?.contextWindow || liveStats?.contextWindow || 0
    if (!total || total <= 0) {
      total = getDefaultContextWindow(session?.toolType, session?.model)
    }
    // Usage above a 200k window can only mean a 1M-context Claude session
    // (covers blocks persisted before the window was detected correctly).
    if (session?.toolType === 'claude' && used > total && total < 1_000_000) total = 1_000_000
    const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
    const color = pct >= 85 ? token.colorError : pct >= 70 ? token.colorWarning : token.colorSuccess
    return { usedTokens: used, totalTokens: total, percent: pct, barColor: color }
  }, [contextUsage, liveStats?.contextWindow, session?.toolType, session?.model, token.colorError, token.colorWarning, token.colorSuccess])

  // Shortened working directory for display
  const shortDir = useMemo(() => {
    if (!workingDir) return ''
    let p = workingDir
    if (p.startsWith('/Users/')) {
      const parts = p.split('/')
      if (parts.length >= 3) p = '~/' + parts.slice(3).join('/')
    } else if (p.startsWith('C:\\Users\\')) {
      const parts = p.split('\\')
      if (parts.length >= 3) p = '~\\' + parts.slice(3).join('\\')
    }
    return p
  }, [workingDir])

  const refreshVcsInfo = useCallback(async () => {
    if (!workingDir) {
      setGitBranch('')
      setIsGit(false)
      setDiffStat({ additions: 0, deletions: 0 })
      return
    }
    try {
      const branchRes = await window.api?.git?.listBranches?.(workingDir).catch(() => null)
      if (branchRes && typeof branchRes.current === 'string' && branchRes.current.length > 0) {
        setIsGit(true)
        setGitBranch(branchRes.current)
        const stat = await window.api?.git?.diffStat?.(workingDir).catch(() => ({ additions: 0, deletions: 0 }))
        setDiffStat(stat || { additions: 0, deletions: 0 })
      } else {
        setIsGit(false)
        setGitBranch('')
        setDiffStat({ additions: 0, deletions: 0 })
      }
    } catch {
      setIsGit(false)
      setGitBranch('')
      setDiffStat({ additions: 0, deletions: 0 })
    }
  }, [workingDir])

  // Fetch VCS info and live stats on mount, directory/session change, and poll periodically
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (cancelled) return
      await Promise.allSettled([refreshVcsInfo(), refreshStats()])
    }
    void run()
    // Poll faster when running (2s) to update tokens/cost/git diff live, slower when idle (8s)
    const intervalMs = session?.status === 'running' ? 2000 : 8000
    const timer = setInterval(() => { void run() }, intervalMs)
    const onFocus = (): void => { void run() }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshVcsInfo, refreshStats, session?.status])

  // Also immediately refresh whenever session status transitions (e.g. running -> idle after code edits)
  useEffect(() => {
    void refreshVcsInfo()
    void refreshStats()
  }, [session?.status, refreshVcsInfo, refreshStats])

  const handleOpenDir = useCallback(() => {
    if (workingDir && window.api?.aiCoding?.openDirectory) {
      window.api.aiCoding.openDirectory(workingDir).catch(() => {})
    }
  }, [workingDir])

  // Once stats have loaded they are authoritative, even when they report no
  // model: the backend already discards the stale placeholder older sessions
  // persisted in `session.model` ('Claude 3.7 Sonnet').
  const rawModel = liveStats ? liveStats.model : session?.model
  const modelName = useMemo(
    () => formatModelName(rawModel, session?.toolType),
    [rawModel, session?.toolType]
  )

  const toolIcon = useMemo(
    () => (session ? getAIToolIcon(session.toolType, 12) : null),
    [session]
  )

  return (
    <div
      data-testid="coding-session-status-bar"
      style={{
        height: 26,
        minHeight: 26,
        maxHeight: 26,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 10px',
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        fontSize: 11,
        flexShrink: 0,
        userSelect: 'none',
        overflow: 'hidden',
        zIndex: 2,
      }}
    >
      {/* Left zone: 所在工作目录、如果是git显示分支、改动行数增减数量 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, overflow: 'hidden' }}>
        {/* 所在工作目录 */}
        <Tooltip title={`${t('coding.statusWorkingDir', workingDir || '-')} (${t('coding.statusOpenDir')})`}>
          <div
            role="button"
            onClick={handleOpenDir}
            data-testid="status-bar-working-dir"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: token.colorTextSecondary,
            }}
          >
            <FolderOutlined style={{ fontSize: 11, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {shortDir || workingDir || '-'}
            </span>
          </div>
        </Tooltip>

        {/* 如果是git，显示分支 */}
        {isGit && gitBranch ? (
          <Tooltip title={t('coding.statusGitBranch', gitBranch)}>
            <div
              data-testid="status-bar-git-branch"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'default',
                color: token.colorSuccess,
                flexShrink: 0,
              }}
            >
              <BranchesOutlined style={{ fontSize: 11 }} />
              <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {gitBranch}
              </span>
            </div>
          </Tooltip>
        ) : null}

        {/* 改动行数增减数量 */}
        <Tooltip
          title={`${t('coding.statusDiffLines', String(diffStat.additions), String(diffStat.deletions))}${onToggleGitPanel ? ` (${t('coding.statusToggleChanges')})` : ''}`}
        >
          <div
            role={onToggleGitPanel ? 'button' : undefined}
            onClick={onToggleGitPanel}
            data-testid="status-bar-diff-stat"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              cursor: onToggleGitPanel ? 'pointer' : 'default',
              flexShrink: 0,
              padding: '0 3px',
              borderRadius: 3,
            }}
          >
            <DiffOutlined style={{ fontSize: 11, color: token.colorTextSecondary }} />
            <span style={{ fontFamily: MONO_FONT_STACK, fontSize: 11 }}>
              <span style={{ color: diffStat.additions > 0 ? token.colorSuccess : token.colorTextTertiary }}>
                +{diffStat.additions}
              </span>
              {' '}
              <span style={{ color: diffStat.deletions > 0 ? token.colorError : token.colorTextTertiary }}>
                -{diffStat.deletions}
              </span>
            </span>
          </div>
        </Tooltip>
      </div>

      {/* Right zone: 对话轮数、上下文占用进度条、消耗费用、模型情况 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {/* 对话轮数 (统一来自chat模式原状态栏) */}
        {turnCount > 0 ? (
          <Tooltip title={t('coding.turnsCount', String(turnCount))}>
            <div
              data-testid="status-bar-message-count"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'default',
                color: token.purple6,
                flexShrink: 0,
              }}
            >
              <MessageOutlined style={{ fontSize: 11 }} />
              <span style={{ fontFamily: MONO_FONT_STACK, fontSize: 11 }}>
                {t('coding.turnsCount', String(turnCount))}
              </span>
            </div>
          </Tooltip>
        ) : null}

        {/* 上下文占用进度条 */}
        <Tooltip
          title={
            <div style={{ fontSize: 12 }}>
              <div>{t('coding.statusContextUsage', formatTokens(usedTokens), formatTokens(totalTokens), String(percent))}</div>
              {contextUsage ? (
                <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
                  {t(
                    'coding.statusContextTokens',
                    (contextUsage.inputTokens || 0).toLocaleString(),
                    (contextUsage.cachedInputTokens || 0).toLocaleString(),
                    (contextUsage.outputTokens || 0).toLocaleString()
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
                  {t('coding.statusNoContext')}
                </div>
              )}
            </div>
          }
        >
          <div
            data-testid="status-bar-context-progress"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'default' }}
          >
            <DashboardOutlined style={{ fontSize: 11, color: barColor }} />
            <div
              style={{
                width: 44,
                height: 5,
                borderRadius: 2.5,
                background: token.colorFillSecondary,
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: `${percent}%`,
                  height: '100%',
                  borderRadius: 2.5,
                  background: barColor,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span style={{ fontFamily: MONO_FONT_STACK, fontSize: 11, color: token.colorTextSecondary }}>
              {formatTokens(usedTokens)}/{formatTokens(totalTokens)} ({percent}%)
            </span>
          </div>
        </Tooltip>

        {/* 消耗费用 */}
        <Tooltip title={t('coding.statusCost', totalCost.toFixed(4))}>
          <div
            data-testid="status-bar-cost"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              cursor: 'default',
              color: totalCost > 0 ? token.colorWarningText : token.colorTextSecondary,
            }}
          >
            <DollarOutlined style={{ fontSize: 11 }} />
            <span style={{ fontFamily: MONO_FONT_STACK, fontSize: 11 }}>
              ${totalCost.toFixed(4)}
            </span>
          </div>
        </Tooltip>

        {/* 模型情况 */}
        <Tooltip title={t('coding.statusModel', modelName)}>
          <div
            data-testid="status-bar-model"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'default',
              color: token.colorText,
              fontWeight: 500,
            }}
          >
            {toolIcon ? (
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>{toolIcon}</span>
            ) : (
              <AntdMorphIcon icon={Sparkles} size={11} style={{ color: token.colorPrimary }} />
            )}
            <span style={{ fontSize: 11 }}>
              {modelName}
            </span>
          </div>
        </Tooltip>
      </div>
    </div>
  )
}

export default React.memo(CodingSessionStatusBar)
