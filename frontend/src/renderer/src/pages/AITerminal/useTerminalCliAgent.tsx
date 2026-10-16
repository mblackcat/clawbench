import React, { useCallback, useEffect, useRef, useState } from 'react'
import { App, Button, Dropdown, Spin, Tooltip, theme } from 'antd'
import { PlusOutlined, DownOutlined } from '@ant-design/icons'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import { useAICodingStore } from '../../stores/useAICodingStore'
import { useT } from '../../i18n'
import type { AIToolType } from '../../types/ai-coding'
import CodingTerminalView from '../AICoding/CodingTerminalView'
import CodingChatPanel from '../AICoding/CodingChatPanel'
import { getAIToolIcon, AI_TOOL_SHORT_NAMES } from '../AICoding/aiToolMeta'

interface AssistantTool {
  toolType: string
  name: string
  installed: boolean
  version?: string
}

/** The machine an assistant session targets ("same machine → same workspace"). */
interface AssistantTarget {
  key: string
  label?: string
  isLocal?: boolean
}

interface AssistantBinding {
  sessionId: string
  workingDir: string
  toolType: AIToolType
}

/**
 * Per-machine session binding keyed by `${target.key}::${kind}`. Module scope so
 * it survives panel remounts (terminal/DB toggles, collapse) without widening
 * the terminal store. Reopening a tab to the same host re-adopts the session.
 */
const targetBindings = new Map<string, AssistantBinding>()

function bindingKey(targetKey: string, kind: 'shell' | 'db'): string {
  return `${targetKey}::${kind}`
}

function toolShortName(toolType: string): string {
  return (AI_TOOL_SHORT_NAMES as Record<string, string>)[toolType] ?? toolType
}

export interface TerminalCliAgentParts {
  /** Tool picker shown in the panel header (left side). */
  headerControls: React.ReactNode
  /** "New session" action shown in the panel header (right side). */
  actionControls: React.ReactNode
  /** Embedded CLI session (TUI or Claude chat) or a hint when none. */
  body: React.ReactNode
}

/**
 * AI Terminal assistant — CLI Agent mode. Reuses an installed AI Coding CLI
 * (as a real TUI, or Claude's SDK chat surface with in-process terminal/DB
 * tools) instead of the model-chat loop. Inert while `enabled` is false.
 */
export function useTerminalCliAgent(opts: {
  enabled: boolean
  collapsed: boolean
  expand: () => void
}): TerminalCliAgentParts {
  const { enabled, collapsed, expand } = opts
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const t = useT()
  const tRef = useRef(t)
  tRef.current = t

  const [tools, setTools] = useState<AssistantTool[]>([])
  const [toolsLoading, setToolsLoading] = useState(false)
  const [toolsLoaded, setToolsLoaded] = useState(false)
  const [preferredTool, setPreferredTool] = useState<AIToolType | null>(null)
  const [binding, setBinding] = useState<AssistantBinding | null>(null)
  const [creating, setCreating] = useState(false)

  const { activeTabId, activeDBTabId, sideMode, openTabs, openDBTabs, connections, dbConnections } =
    useAITerminalStore()
  const fetchSessions = useAICodingStore((s) => s.fetchSessions)

  const isDBMode = sideMode === 'db'
  const effectiveTabId = isDBMode ? activeDBTabId : activeTabId
  const kind: 'shell' | 'db' = isDBMode ? 'db' : 'shell'
  const currentDBConnId = isDBMode ? openDBTabs.find((x) => x.id === activeDBTabId)?.connectionId : undefined

  /** Shell tabs map through their terminal connection; DB tabs through their DB connection. */
  const resolveTarget = useCallback((): AssistantTarget | null => {
    if (isDBMode) {
      if (!currentDBConnId) return null
      const conn = dbConnections.find((c) => c.id === currentDBConnId)
      if (!conn) return null
      if (conn.type === 'sqlite') {
        const fp = conn.filePath?.trim()
        return { key: fp ? `sqlite:${fp}` : `db:${conn.id}`, label: conn.name, isLocal: true }
      }
      const host = conn.host?.trim()
      return host ? { key: `${host}:${conn.port ?? ''}`, label: host } : { key: `db:${conn.id}`, label: conn.name }
    }
    if (!activeTabId) return null
    const tab = openTabs.find((x) => x.id === activeTabId)
    if (!tab) return null
    if (tab.connectionId === 'local') {
      return { key: 'local', label: tRef.current('terminal.localTerminal'), isLocal: true }
    }
    const conn = connections.find((c) => c.id === tab.connectionId)
    if (!conn) return null
    if (conn.type === 'local') return { key: 'local', label: conn.name, isLocal: true }
    const host = conn.host?.trim()
    return host ? { key: `${host}:${conn.port ?? ''}`, label: host } : { key: `conn:${conn.id}`, label: conn.name }
  }, [isDBMode, currentDBConnId, dbConnections, activeTabId, openTabs, connections])

  const target = resolveTarget()
  const currentBindingKey = target ? bindingKey(target.key, kind) : null

  // Load available tools the first time CLI Agent mode is used.
  useEffect(() => {
    if (!enabled || toolsLoaded) return
    let cancelled = false
    setToolsLoading(true)
    window.api.aiTerminal
      .assistantTools()
      .then((detected) => {
        if (cancelled) return
        setTools(detected)
        setToolsLoaded(true)
        setPreferredTool((prev) => {
          if (prev && detected.some((d) => d.toolType === prev)) return prev
          const first = detected.find((d) => d.installed)
          return first ? (first.toolType as AIToolType) : null
        })
      })
      .catch(() => { if (!cancelled) setTools([]) })
      .finally(() => { if (!cancelled) setToolsLoading(false) })
    return () => { cancelled = true }
  }, [enabled, toolsLoaded])

  // Adopt the last live session for the active machine while expanded; drop
  // bindings whose AI Coding session no longer exists.
  useEffect(() => {
    if (!enabled || collapsed || !currentBindingKey) { setBinding(null); return }
    const existing = targetBindings.get(currentBindingKey)
    if (!existing) { setBinding(null); return }
    const live = useAICodingStore.getState().sessions.some((s) => s.id === existing.sessionId)
    if (!live) {
      targetBindings.delete(currentBindingKey)
      setBinding(null)
      return
    }
    setBinding(existing)
  }, [enabled, collapsed, currentBindingKey])

  /** Snapshot of the live command-line context, injected once at session creation. */
  const buildContext = useCallback(async (): Promise<string> => {
    if (isDBMode && currentDBConnId) {
      const state = useAITerminalStore.getState()
      const conn = state.dbConnections.find((c) => c.id === currentDBConnId)
      const tables = state.dbTables[currentDBConnId] || []
      return [
        conn ? `- connection: ${conn.name} (type: ${conn.type}${conn.database ? `, database: ${conn.database}` : ''})` : '',
        tables.length > 0 ? `- tables / collections: ${tables.join(', ')}` : '- schema unknown'
      ].filter(Boolean).join('\n')
    }
    if (effectiveTabId) {
      try {
        const output = await window.api.aiTerminal.getTerminalOutput(effectiveTabId)
        const recent = (output || '').slice(-3000)
        if (recent.trim()) return ['```', recent, '```'].join('\n')
      } catch { /* ignore */ }
    }
    return ''
  }, [isDBMode, currentDBConnId, effectiveTabId])

  /** Create (or replace) the assistant session for the active machine. */
  const createSession = useCallback(async (toolType: AIToolType) => {
    if (!target || !currentBindingKey) return
    setCreating(true)
    try {
      const prev = targetBindings.get(currentBindingKey)
      if (prev) {
        await window.api.aiTerminal.disposeAssistantSession(prev.sessionId).catch(() => {})
        targetBindings.delete(currentBindingKey)
        setBinding(null)
      }
      const ctx = await buildContext()
      // Point Claude's in-process tools at the live surface shown below.
      const execTarget: { kind: 'shell' | 'db'; ptySessionId?: string; dbConnId?: string } =
        kind === 'db'
          ? { kind: 'db', dbConnId: currentDBConnId }
          : { kind: 'shell', ptySessionId: effectiveTabId ?? undefined }
      const created = await window.api.aiTerminal.createAssistantSession(toolType, kind, target, ctx, execTarget)
      const next: AssistantBinding = { ...created, toolType }
      targetBindings.set(currentBindingKey, next)
      await fetchSessions()
      setBinding(next)
      setPreferredTool(toolType)
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }, [target, currentBindingKey, kind, fetchSessions, buildContext, currentDBConnId, effectiveTabId, message])

  if (!enabled) return { headerControls: null, actionControls: null, body: null }

  const activeToolType = binding?.toolType ?? preferredTool
  const toolMenuItems = tools.map((tl) => ({
    key: tl.toolType,
    disabled: !tl.installed,
    icon: getAIToolIcon(tl.toolType as AIToolType, 12),
    label: `${toolShortName(tl.toolType)}${tl.installed ? '' : ` (${t('coding.notInstalled')})`}`,
    onClick: () => {
      if (collapsed) expand()
      void createSession(tl.toolType as AIToolType)
    }
  }))

  const headerControls = (
    <div onClick={(e) => e.stopPropagation()}>
      <Dropdown
        menu={{ items: toolMenuItems }}
        trigger={['click']}
        disabled={toolsLoading || creating || tools.length === 0}
        placement="topLeft"
      >
        <Button size="small" type="text" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          {toolsLoading || creating ? <Spin size="small" /> : activeToolType ? getAIToolIcon(activeToolType, 12) : null}
          <span>
            {tools.length === 0 && !toolsLoading
              ? t('terminal.noToolEnabled')
              : activeToolType
                ? toolShortName(activeToolType)
                : t('terminal.selectTool')}
          </span>
          <DownOutlined style={{ fontSize: 8 }} />
        </Button>
      </Dropdown>
    </div>
  )

  const actionControls = (
    <Tooltip title={t('terminal.newSession')}>
      <Button
        type="text"
        size="small"
        icon={<PlusOutlined />}
        disabled={!activeToolType || creating}
        onClick={(e) => {
          e.stopPropagation()
          if (collapsed) expand()
          if (activeToolType) void createSession(activeToolType)
        }}
        style={{ fontSize: 12 }}
      />
    </Tooltip>
  )

  const body = binding ? (
    <div style={{ height: 320, borderTop: `1px solid ${token.colorBorderSecondary}`, overflow: 'hidden' }}>
      {/* Claude runs as the SDK chat surface so its in-process terminal/DB tools
          and permission prompts work; other tools run as their TUI. */}
      {binding.toolType === 'claude' ? (
        <CodingChatPanel
          key={binding.sessionId}
          sessionId={binding.sessionId}
          onNewSession={() => { if (activeToolType) void createSession(activeToolType) }}
        />
      ) : (
        <CodingTerminalView
          key={binding.sessionId}
          sessionId={binding.sessionId}
          onNewSession={() => { if (activeToolType) void createSession(activeToolType) }}
        />
      )}
    </div>
  ) : (
    <div
      style={{
        padding: '14px 12px',
        fontSize: 12,
        color: token.colorTextSecondary,
        borderTop: `1px solid ${token.colorBorderSecondary}`
      }}
    >
      {tools.length === 0 && !toolsLoading ? t('terminal.enableToolHint') : t('terminal.pickToolHint')}
    </div>
  )

  return { headerControls, actionControls, body }
}
