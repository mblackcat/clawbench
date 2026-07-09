import { create } from 'zustand'
import type {
  AICodingWorkspace, AICodingSession, AICodingGroup, AICodingIMConfig,
  AICodingIMConnectionStatus, AIToolType, DetectedCLI,
  CodingMessage, CodingContentBlock, CodingMode, CodingEffort, ClaudeViewMode,
  AskUserQuestionItem
} from '../types/ai-coding'
import type { LayoutNode, LeafNode, SplitDirection } from '../types/split-layout'
import {
  genPaneId, createDefaultLayout, findLeaf, findLeafBySessionId,
  collectLeaves, replaceNode, removeLeaf, updateLeaf, updateSplitSizes
} from '../types/split-layout'

let msgCounter = 0
function genMsgId(): string { return `wm-${Date.now()}-${++msgCounter}` }
const transcriptHydrationInFlight = new Set<string>()

// Text deltas can arrive far faster than the renderer can cheaply re-parse
// markdown, so we buffer them per session and flush on a short timer. This
// bounds store updates (and therefore re-renders / markdown re-parses) to a
// steady ~12fps regardless of the upstream token rate, which keeps long
// streaming replies from freezing the UI. Non-delta events flush the pending
// text first so block ordering is preserved.
const deltaBuffer = new Map<string, string>()
let deltaFlushTimer: ReturnType<typeof setTimeout> | null = null
const DELTA_FLUSH_MS = 80

function upsertSessionList(
  sessions: AICodingSession[],
  session: AICodingSession
): AICodingSession[] {
  const idx = sessions.findIndex((s) => s.id === session.id)
  if (idx === -1) return [...sessions, session]
  const next = [...sessions]
  next[idx] = session
  return next
}

function toRuntimePermissionMode(toolType: AIToolType, mode: string): string {
  if (toolType === 'codex') {
    // Normalize to the native Codex vocabulary passed to the app-server.
    if (mode === 'ask-first') return 'ask'
    if (mode === 'auto-edit') return 'approve-for-me'
    if (mode === 'plan') return 'ask' // Codex has no plan mode
    return mode // 'ask' | 'approve-for-me' | 'full-access'
  }
  // Claude: map to the SDK PermissionMode. Legacy values (ask-first/auto-edit/
  // full-access) are tolerated so persisted localStorage modes keep working
  // until the user re-selects a native mode.
  const modeMap: Record<string, string> = {
    'manual': 'default',
    'edit-automatically': 'acceptEdits',
    'plan': 'plan',
    'auto': 'bypassPermissions',
    'ask-first': 'default',
    'auto-edit': 'bypassPermissions',
    'full-access': 'bypassPermissions'
  }
  return modeMap[mode] || 'default'
}

/** Default effort per tool, used when the user hasn't picked one. */
export function defaultEffort(toolType: AIToolType): CodingEffort {
  return toolType === 'codex' ? 'medium' : 'high'
}

/** Default mode per tool, used when the user hasn't picked one. */
export function defaultMode(toolType: AIToolType): CodingMode {
  return toolType === 'codex' ? 'ask' : 'manual'
}

// ── sessionMessages persistence (localStorage) ──
const MSG_STORAGE_KEY = 'cb-workbench-messages'
const MSG_PER_SESSION_LIMIT = 100

function loadPersistedMessages(): Record<string, CodingMessage[]> {
  try {
    const raw = localStorage.getItem(MSG_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function persistMessages(msgs: Record<string, CodingMessage[]>): void {
  try {
    // Trim each session to the latest N messages before saving
    const trimmed: Record<string, CodingMessage[]> = {}
    for (const [sid, arr] of Object.entries(msgs)) {
      if (arr.length > 0) {
        trimmed[sid] = arr.length > MSG_PER_SESSION_LIMIT ? arr.slice(-MSG_PER_SESSION_LIMIT) : arr
      }
    }
    localStorage.setItem(MSG_STORAGE_KEY, JSON.stringify(trimmed))
  } catch { /* storage full — silently skip */ }
}

function parseClaudeEvent(event: Record<string, unknown>): CodingContentBlock[] {
  const blocks: CodingContentBlock[] = []
  const msgType = event.type as string
  if (msgType === 'context_usage') {
    const usage = (event.usage || {}) as Record<string, number>
    blocks.push({
      type: 'context_usage',
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      usedTokens: usage.usedTokens,
      contextWindow: usage.contextWindow,
    })
  } else if (msgType === 'assistant') {
    const message = event.message as any
    const contentBlocks = Array.isArray(message?.content) ? message.content : []
    for (const block of contentBlocks) {
      if (!block) continue
      if (block.type === 'text' && block.text) blocks.push({ type: 'text', text: block.text })
      else if (block.type === 'thinking' && block.thinking) blocks.push({ type: 'thinking', text: block.thinking })
      else if (block.type === 'tool_use') blocks.push({ type: 'tool_use', id: block.id || '', name: block.name || '', input: block.input || {} })
      else if (block.type === 'tool_result') {
        const content = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map((c: any) => c.text || '').join('\n') : JSON.stringify(block.content)
        blocks.push({ type: 'tool_result', toolUseId: block.tool_use_id || '', content, isError: block.is_error })
      }
    }
  } else if (msgType === 'error') {
    blocks.push({ type: 'text', text: `Error: ${(event.error as any)?.message || event.message || 'Unknown error'}` })
  }
  // Note: 'result' events are NOT parsed here — their result.result field
  // duplicates text already delivered via 'assistant' events.
  // The result handler in onPipeEvent uses a fallback if no blocks accumulated.
  return blocks
}

// (Streaming accumulation is stateless on the client — see onPipeEvent.
// The server sends a simple event protocol: delta / tool_* / thinking_* / result.)

interface AICodingState {
  workspaces: AICodingWorkspace[]; sessions: AICodingSession[]; groups: AICodingGroup[]
  imConfig: AICodingIMConfig; imStatus: AICodingIMConnectionStatus; loading: boolean
  activeSessionId: string | null
  sessionMessages: Record<string, CodingMessage[]>; sessionStreaming: Record<string, boolean>
  sessionStreamingBlocks: Record<string, CodingContentBlock[]>; sessionModes: Record<string, CodingMode>
  sessionEffort: Record<string, CodingEffort>
  sessionContextUsage: Record<string, Extract<CodingContentBlock, { type: 'context_usage' }> | null>
  fetchWorkspaces: () => Promise<void>; fetchSessions: () => Promise<void>; fetchGroups: () => Promise<void>
  fetchIMConfig: () => Promise<void>; fetchAll: () => Promise<void>
  createWorkspace: (wd: string, gid: string) => Promise<AICodingWorkspace>
  updateWorkspace: (id: string, u: Partial<AICodingWorkspace>) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>
  createSession: (wid: string, tt: AIToolType, src?: 'local' | 'im') => Promise<AICodingSession>
  updateSession: (id: string, u: Partial<AICodingSession>) => Promise<void>
  deleteSession: (id: string) => Promise<void>; stopSession: (id: string) => Promise<void>
  launchSession: (id: string, opts?: { forcePty?: boolean; cols?: number; rows?: number; effort?: string }) => Promise<{ success: boolean; error?: string }>
  createGroup: (n: string) => Promise<AICodingGroup>; renameGroup: (id: string, n: string) => Promise<void>
  deleteGroup: (id: string) => Promise<{ success: boolean; error?: string }>
  saveIMConfig: (c: AICodingIMConfig) => Promise<void>
  imConnect: () => Promise<void>; imDisconnect: () => Promise<void>
  imTest: () => Promise<{ success: boolean; error?: string }>
  fetchIMStatus: () => Promise<void>; setIMStatus: (s: AICodingIMConnectionStatus) => void
  initListeners: () => () => void; setActiveSession: (sid: string | null) => void
  hydrateSessionTranscript: (sid: string) => Promise<void>
  createAndOpenSession: (wid: string, tt: AIToolType) => Promise<void>; detectTools: () => Promise<DetectedCLI[]>
  sendUserMessage: (sid: string, text: string, images?: { data: string; mediaType: string }[]) => Promise<void>; clearSessionMessages: (sid: string) => void
  executeSlashCommand: (sid: string, command: string) => Promise<void>
  setSessionMode: (sid: string, m: CodingMode) => void; setSessionEffort: (sid: string, e: CodingEffort) => void; interruptSession: (sid: string) => Promise<void>
  claudeViewModes: Record<string, ClaudeViewMode>
  setClaudeViewMode: (sid: string, m: ClaudeViewMode) => void
  sessionPendingQuestions: Record<string, { id: string; questions: AskUserQuestionItem[] } | null>
  answerQuestion: (sid: string, questionId: string, answerText: string) => Promise<void>
  sessionPendingPermissions: Record<string, { id: string; toolName: string; input: Record<string, unknown> } | null>
  resolvePermission: (sid: string, requestId: string, decision: { behavior: 'allow' | 'deny'; message?: string; updatedInput?: Record<string, unknown>; applySuggestions?: boolean }) => Promise<void>
  // Global split layout state (sessions from any workspace can be mixed)
  globalLayout: LayoutNode | null
  focusedPaneId: string | null
  getOrCreateLayout: () => LayoutNode
  splitPane: (paneId: string, direction: SplitDirection, sessionId?: string) => void
  closePane: (paneId: string) => void
  moveTab: (fromPaneId: string, toPaneId: string, sessionId: string) => void
  setPaneActiveTab: (paneId: string, sessionId: string) => void
  addTabToPane: (paneId: string, sessionId: string) => void
  removeTabFromPane: (paneId: string, sessionId: string) => void
  setFocusedPane: (paneId: string) => void
  setSplitSizes: (path: number[], sizes: number[]) => void
}

export const useAICodingStore = create<AICodingState>((set, get) => ({
  workspaces: [], sessions: [], groups: [],
  imConfig: { feishu: { appId: '', appSecret: '' } }, imStatus: { state: 'disconnected' }, loading: false,
  activeSessionId: null, sessionMessages: loadPersistedMessages(), sessionStreaming: {}, sessionStreamingBlocks: {}, sessionModes: {}, sessionEffort: {}, sessionContextUsage: {},
  claudeViewModes: {},
  sessionPendingQuestions: {},
  sessionPendingPermissions: {},
  globalLayout: null,
  focusedPaneId: null,

  fetchWorkspaces: async () => { try { set({ workspaces: await window.api.aiCoding.getWorkspaces() }) } catch (e) { console.error('fetch workspaces:', e) } },
  fetchSessions: async () => { try { set({ sessions: await window.api.aiCoding.getSessions() }) } catch (e) { console.error('fetch sessions:', e) } },
  fetchGroups: async () => { try { set({ groups: await window.api.aiCoding.getGroups() }) } catch (e) { console.error('fetch groups:', e) } },
  fetchIMConfig: async () => { try { set({ imConfig: await window.api.aiCoding.getIMConfig() }) } catch (e) { console.error('fetch IM config:', e) } },
  fetchAll: async () => {
    set({ loading: true })
    try {
      const [workspaces, sessions, groups, imConfig, imStatus] = await Promise.all([
        window.api.aiCoding.getWorkspaces(), window.api.aiCoding.getSessions(),
        window.api.aiCoding.getGroups(), window.api.aiCoding.getIMConfig(), window.api.aiCoding.imGetStatus()])
      set({ workspaces, sessions, groups, imConfig, imStatus, loading: false })
    } catch (e) { console.error('fetch all:', e); set({ loading: false }) }
  },
  createWorkspace: async (wd, gid) => { const w = await window.api.aiCoding.createWorkspace(wd, gid); set({ workspaces: await window.api.aiCoding.getWorkspaces() }); return w },
  updateWorkspace: async (id, u) => { await window.api.aiCoding.updateWorkspace(id, u); set({ workspaces: await window.api.aiCoding.getWorkspaces() }) },
  deleteWorkspace: async (id) => {
    const { sessions, activeSessionId } = get(); const wsIds = new Set(sessions.filter(s => s.workspaceId === id).map(s => s.id))
    await window.api.aiCoding.deleteWorkspace(id)
    const [workspaces, ss] = await Promise.all([window.api.aiCoding.getWorkspaces(), window.api.aiCoding.getSessions()])
    set({ workspaces, sessions: ss, activeSessionId: activeSessionId && wsIds.has(activeSessionId) ? null : activeSessionId })
  },
  createSession: async (wid, tt, src = 'local') => {
    const session = await window.api.aiCoding.createSession(wid, tt, src)
    set((state) => ({ sessions: upsertSessionList(state.sessions, session) }))
    return session
  },
  updateSession: async (id, updates) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, ...updates, updatedAt: Date.now() } : session
      )
    }))
    const updated = await window.api.aiCoding.updateSession(id, updates)
    if (updated) {
      set((state) => ({ sessions: upsertSessionList(state.sessions, updated) }))
    } else {
      set({ sessions: await window.api.aiCoding.getSessions() })
    }
  },
  deleteSession: async (id) => {
    const { activeSessionId: aid, sessionMessages: sm, sessionStreaming: ss, sessionStreamingBlocks: sb, sessionModes: smo, sessionContextUsage: scu } = get()
    await window.api.aiCoding.deleteSession(id); const sessions = await window.api.aiCoding.getSessions()
    const nm = { ...sm }; const ns = { ...ss }; const nb = { ...sb }; const nmo = { ...smo }; const ncu = { ...scu }; delete nm[id]; delete ns[id]; delete nb[id]; delete nmo[id]; delete ncu[id]
    set({ sessions, activeSessionId: aid === id ? null : aid, sessionMessages: nm, sessionStreaming: ns, sessionStreamingBlocks: nb, sessionModes: nmo, sessionContextUsage: ncu })
  },
  stopSession: async (id) => { await window.api.aiCoding.stopSession(id); const sessions = await window.api.aiCoding.getSessions(); set(s => ({ sessions, sessionStreaming: { ...s.sessionStreaming, [id]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [id]: [] } })) },
  launchSession: async (id, opts) => {
    // Always seed the reasoning effort so the first turn (and any relaunch)
    // honors the user's choice; main process maps it per tool.
    const session = get().sessions.find(s => s.id === id)
    const effort = opts?.effort ?? get().sessionEffort[id] ?? (session ? defaultEffort(session.toolType) : 'high')
    const r = await window.api.aiCoding.launchSession(id, { ...opts, effort })
    if (r.success) set({ sessions: await window.api.aiCoding.getSessions() })
    return r
  },
  createGroup: async (n) => { const g = await window.api.aiCoding.createGroup(n); set({ groups: await window.api.aiCoding.getGroups() }); return g },
  renameGroup: async (id, n) => { await window.api.aiCoding.renameGroup(id, n); set({ groups: await window.api.aiCoding.getGroups() }) },
  deleteGroup: async (id) => {
    const r = await window.api.aiCoding.deleteGroup(id)
    if (r.success) { const [w, s, g] = await Promise.all([window.api.aiCoding.getWorkspaces(), window.api.aiCoding.getSessions(), window.api.aiCoding.getGroups()]); set({ workspaces: w, sessions: s, groups: g }) }
    return r
  },
  saveIMConfig: async (c) => { await window.api.aiCoding.saveIMConfig(c); set({ imConfig: c }) },
  imConnect: async () => { set({ imStatus: { state: 'connecting' } }); try { await window.api.aiCoding.imConnect() } catch (e: any) { set({ imStatus: { state: 'error', error: e?.message || String(e) } }); throw e } },
  imDisconnect: async () => { await window.api.aiCoding.imDisconnect(); set({ imStatus: { state: 'disconnected' } }) },
  imTest: async () => window.api.aiCoding.imTest(),
  fetchIMStatus: async () => { try { set({ imStatus: await window.api.aiCoding.imGetStatus() }) } catch (e) { console.error('fetch IM status:', e) } },
  setIMStatus: (status) => set({ imStatus: status }),

  initListeners: () => {
    const u1 = window.api.aiCoding.onIMStatusChanged((s) => get().setIMStatus(s as AICodingIMConnectionStatus))
    const u2 = window.api.aiCoding.onDataChanged(() => { get().fetchWorkspaces(); get().fetchSessions(); get().fetchGroups() })
    const u3 = window.api.aiCoding.onPtyExit(({ sessionId }) => {
      set(st => ({ sessions: st.sessions.map(s => s.id === sessionId ? { ...s, status: 'closed' as const, lastActivity: 'none' as const, updatedAt: Date.now() } : s) }))
      get().fetchSessions()
    })
    // Flush a session's buffered text deltas into the streaming blocks now.
    const flushPendingDelta = (sessionId: string): void => {
      const pending = deltaBuffer.get(sessionId)
      if (!pending) return
      deltaBuffer.delete(sessionId)
      set(s => {
        const blocks = [...(s.sessionStreamingBlocks[sessionId] || [])]
        const last = blocks[blocks.length - 1]
        if (last && last.type === 'text') blocks[blocks.length - 1] = { ...last, text: (last.text || '') + pending }
        else blocks.push({ type: 'text' as const, text: pending })
        return { sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: blocks } }
      })
    }
    // Coalesce deltas: one timer tick commits every buffered session at once.
    const scheduleDeltaFlush = (): void => {
      if (deltaFlushTimer) return
      deltaFlushTimer = setTimeout(() => {
        deltaFlushTimer = null
        for (const sid of [...deltaBuffer.keys()]) {
          const pending = deltaBuffer.get(sid)
          if (!pending) continue
          deltaBuffer.delete(sid)
          set(s => {
            const blocks = [...(s.sessionStreamingBlocks[sid] || [])]
            const last = blocks[blocks.length - 1]
            if (last && last.type === 'text') blocks[blocks.length - 1] = { ...last, text: (last.text || '') + pending }
            else blocks.push({ type: 'text' as const, text: pending })
            return { sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sid]: blocks } }
          })
        }
      }, DELTA_FLUSH_MS)
    }
    const u4 = window.api.aiCoding.onPipeEvent(({ sessionId, event }) => {
      const st = get(); const session = st.sessions.find(s => s.id === sessionId); if (!session) return
      const et = (event as any).type as string
      if (et === 'pipe_exit' || et === 'pipe_error' || et === 'slash_command_done') {
        flushPendingDelta(sessionId)
        const cb = get().sessionStreamingBlocks[sessionId] || []
        if (cb.length > 0) { const m: CodingMessage = { id: genMsgId(), sessionId, role: 'assistant', blocks: cb, timestamp: Date.now() }; set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), m] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] }, sessionPendingQuestions: { ...s.sessionPendingQuestions, [sessionId]: null } })) }
        else set(s => ({ sessionStreaming: { ...s.sessionStreaming, [sessionId]: false }, sessionPendingQuestions: { ...s.sessionPendingQuestions, [sessionId]: null } }))
        return
      }
      if (et === 'raw_output') {
        const content = (event as any).content as string; if (!content) return
        set(s => { const blocks = [...(s.sessionStreamingBlocks[sessionId] || [])]; const last = blocks[blocks.length - 1]; if (last && last.type === 'raw_output') blocks[blocks.length - 1] = { type: 'raw_output', text: last.text + '\n' + content }; else blocks.push({ type: 'raw_output', text: content }); return { sessionStreaming: { ...s.sessionStreaming, [sessionId]: true }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: blocks } } })
        const act = (event as any).activity as string
        if (act === 'waiting_input' || act === 'auth_request') { const cur = get(); const blocks = cur.sessionStreamingBlocks[sessionId] || []; if (blocks.length > 0) { const m: CodingMessage = { id: genMsgId(), sessionId, role: 'assistant', blocks, timestamp: Date.now() }; set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), m] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] } })) } }
        return
      }
      if (session.toolType === 'claude' || session.toolType === 'codex') {
        // ── Streaming accumulation for Claude (long-lived query) and Codex ──
        if (et === 'turn_start' || et === 'turn_started') {
          // Mark streaming, but do NOT clear blocks: an agentic turn has many
          // assistant messages (text → tool → text → tool …) and we want all of
          // them to accumulate. Block ids are unique per message, so no collisions.
          // Finalization + clear happens on `result`.
          set(s => ({ sessionStreaming: { ...s.sessionStreaming, [sessionId]: true } }))
          return
        }
        // Streaming text is coalesced into deltaBuffer and flushed on a timer
        // (scheduleDeltaFlush) to bound re-render frequency. Other event types
        // flush any buffered text first via flushPendingDelta() below.
        if (et === 'delta') {
          const text = String((event as any).text ?? '')
          if (!text) return
          deltaBuffer.set(sessionId, (deltaBuffer.get(sessionId) || '') + text)
          if (!get().sessionStreaming[sessionId]) {
            set(s => ({ sessionStreaming: { ...s.sessionStreaming, [sessionId]: true } }))
          }
          scheduleDeltaFlush()
          return
        }
        // Commit buffered text before pushing any other block type, so the
        // streamed content stays in the right order.
        flushPendingDelta(sessionId)
        // ── Thinking block ──
        if (et === 'thinking_start') {
          set(s => ({ sessionStreaming: { ...s.sessionStreaming, [sessionId]: true }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [...(s.sessionStreamingBlocks[sessionId] || []), { type: 'thinking' as const, text: '' }] } }))
          return
        }
        if (et === 'thinking_delta') {
          const text = String((event as any).text ?? '')
          if (!text) return
          set(s => {
            const blocks = [...(s.sessionStreamingBlocks[sessionId] || [])]
            const last = blocks[blocks.length - 1]
            if (last && last.type === 'thinking') blocks[blocks.length - 1] = { ...last, text: (last.text || '') + text }
            else blocks.push({ type: 'thinking', text })
            return { sessionStreaming: { ...s.sessionStreaming, [sessionId]: true }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: blocks } }
          })
          return
        }
        if (et === 'thinking_stop') return  // visual only; the block already holds the text
        // ── Tool card lifecycle, keyed by tool id ──
        if (et === 'tool_start') {
          const id = String((event as any).id ?? '')
          const name = String((event as any).name ?? '')
          set(s => ({ sessionStreaming: { ...s.sessionStreaming, [sessionId]: true }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [...(s.sessionStreamingBlocks[sessionId] || []), { type: 'tool_use' as const, id, name, input: {} }] } }))
          return
        }
        if (et === 'tool_executing') {
          const id = String((event as any).id ?? '')
          const name = String((event as any).name ?? '')
          const input = ((event as any).input || {}) as Record<string, unknown>
          set(s => {
            const blocks = [...(s.sessionStreamingBlocks[sessionId] || [])]
            const idx = blocks.findIndex(b => b.type === 'tool_use' && b.id === id)
            if (idx !== -1) {
              const tu = blocks[idx] as Extract<CodingContentBlock, { type: 'tool_use' }>
              blocks[idx] = { ...tu, name: name || tu.name, input }
            }
            return { sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: blocks } }
          })
          return
        }
        if (et === 'tool_result') {
          const id = String((event as any).id ?? '')
          const content = String((event as any).content ?? '')
          const isError = !!(event as any).isError
          set(s => ({ sessionStreaming: { ...s.sessionStreaming, [sessionId]: true }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [...(s.sessionStreamingBlocks[sessionId] || []), { type: 'tool_result' as const, toolUseId: id, content, isError }] } }))
          return
        }

        // ── Structured side-channel events ──
        if (et === 'context_usage') {
          const pb = parseClaudeEvent(event as Record<string, unknown>)
          const usageBlock = pb.find((b): b is Extract<CodingContentBlock, { type: 'context_usage' }> => b.type === 'context_usage')
          if (usageBlock) {
            set(s => ({
              sessionContextUsage: { ...s.sessionContextUsage, [sessionId]: usageBlock },
              sessionStreamingBlocks: {
                ...s.sessionStreamingBlocks,
                [sessionId]: [
                  ...(s.sessionStreamingBlocks[sessionId] || []).filter(b => b.type !== 'context_usage'),
                  usageBlock
                ]
              }
            }))
          }
          return
        }
        // Handle AskUserQuestion dedicated event
        if (et === 'ask_user_question') {
          const questionBlock: CodingContentBlock = {
            type: 'ask_user_question',
            id: (event as any).id || '',
            questions: (event as any).questions || [],
            answered: false,
          }
          // Flush all accumulated streaming blocks + question block into a finalized message
          const cur = get()
          const existingBlocks = cur.sessionStreamingBlocks[sessionId] || []
          const allBlocks = [...existingBlocks, questionBlock]
          const m: CodingMessage = { id: genMsgId(), sessionId, role: 'assistant', blocks: allBlocks, timestamp: Date.now() }
          set(s => ({
            sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), m] },
            sessionStreaming: { ...s.sessionStreaming, [sessionId]: false },
            sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] },
            sessionPendingQuestions: { ...s.sessionPendingQuestions, [sessionId]: { id: (event as any).id || '', questions: (event as any).questions || [] } }
          }))
          return
        }
        // Handle permission_request dedicated event — the SDK's canUseTool
        // callback is blocked awaiting the user's decision, so no further
        // events arrive until resolvePermission() is called. Finalize the
        // accumulated streaming blocks + the permission block into a message
        // (mirrors ask_user_question) so it renders inline and persists.
        if (et === 'permission_request') {
          const permBlock: CodingContentBlock = {
            type: 'permission_request',
            id: (event as any).id || '',
            toolName: (event as any).toolName || '',
            input: (event as any).input || {},
            resolved: false,
          }
          const cur = get()
          const existingBlocks = cur.sessionStreamingBlocks[sessionId] || []
          const allBlocks = [...existingBlocks, permBlock]
          const m: CodingMessage = { id: genMsgId(), sessionId, role: 'assistant', blocks: allBlocks, timestamp: Date.now() }
          set(s => ({
            sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), m] },
            sessionStreaming: { ...s.sessionStreaming, [sessionId]: false },
            sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] },
            sessionPendingPermissions: { ...s.sessionPendingPermissions, [sessionId]: { id: (event as any).id || '', toolName: (event as any).toolName || '', input: (event as any).input || {} } }
          }))
          return
        }
        // Handle TodoWrite dedicated event — append to streaming blocks (non-interactive)
        if (et === 'todo_update') {
          const todoBlock: CodingContentBlock = {
            type: 'todo_update',
            todos: (event as any).todos || [],
          }
          set(s => ({
            sessionStreaming: { ...s.sessionStreaming, [sessionId]: true },
            sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [...(s.sessionStreamingBlocks[sessionId] || []), todoBlock] }
          }))
          return
        }

        // ── Lifecycle events ──
        if (et === 'system') {
          // Skip init events; forward other system events (slash-command feedback) as text.
          if ((event as any).subtype === 'init') return
          const sysText = (event as any).message || (event as any).content || ''
          if (sysText) {
            set(s => ({ sessionStreaming: { ...s.sessionStreaming, [sessionId]: true }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [...(s.sessionStreamingBlocks[sessionId] || []), { type: 'text' as const, text: String(sysText) }] } }))
          }
          return
        }
        if (et === 'result') {
          const existing = get().sessionStreamingBlocks[sessionId] || []
          let ab = [...existing]
          if (ab.length === 0) {
            const resultText = typeof (event as any).result === 'string' ? (event as any).result : ''
            if (resultText) ab.push({ type: 'text', text: resultText })
          }
          const usage = (event as any).usage
          if (usage && !ab.some(b => b.type === 'context_usage')) ab.push({ type: 'context_usage', inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, usedTokens: usage.usedTokens, contextWindow: usage.contextWindow })
          const cost = typeof (event as any).cost_usd === 'number' ? (event as any).cost_usd : undefined
          if (ab.length > 0) {
            const m: CodingMessage = { id: genMsgId(), sessionId, role: 'assistant', blocks: ab, timestamp: Date.now(), costUsd: cost }
            set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), m] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] } }))
          } else {
            set(s => ({ sessionStreaming: { ...s.sessionStreaming, [sessionId]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] } }))
          }
          return
        }
        if (et === 'error') {
          const msg = (event as any)?.error?.message || (event as any)?.message || 'Unknown error'
          const ab: CodingContentBlock[] = [...(get().sessionStreamingBlocks[sessionId] || []), { type: 'text', text: `Error: ${msg}` }]
          const m: CodingMessage = { id: genMsgId(), sessionId, role: 'assistant', blocks: ab, timestamp: Date.now() }
          set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), m] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] } }))
        }
      }
    })
    return () => {
      u1(); u2(); u3(); u4()
      if (deltaFlushTimer) { clearTimeout(deltaFlushTimer); deltaFlushTimer = null }
      deltaBuffer.clear()
    }
  },

  setActiveSession: (sid) => {
    set({ activeSessionId: sid })
    if (sid) void get().hydrateSessionTranscript(sid)
  },
  hydrateSessionTranscript: async (sessionId) => {
    const { sessions, workspaces, sessionMessages } = get()
    if ((sessionMessages[sessionId] || []).length > 0) return

    const session = sessions.find(s => s.id === sessionId)
    if (!session?.toolSessionId || (session.toolType !== 'claude' && session.toolType !== 'codex')) return
    const workspace = workspaces.find(w => w.id === session.workspaceId)
    if (!workspace) return

    const key = `${sessionId}:${session.toolType}:${session.toolSessionId}`
    if (transcriptHydrationInFlight.has(key)) return
    transcriptHydrationInFlight.add(key)

    try {
      const transcript = await window.api.aiCoding.loadNativeSessionTranscript(
        workspace.workingDir,
        session.toolType,
        session.toolSessionId
      )
      if (!Array.isArray(transcript) || transcript.length === 0) return

      set(s => {
        if ((s.sessionMessages[sessionId] || []).length > 0) return {}
        const messages: CodingMessage[] = transcript.slice(-MSG_PER_SESSION_LIMIT).map((msg, idx) => ({
          id: `native-${sessionId}-${msg.timestamp || Date.now()}-${idx}`,
          sessionId,
          role: msg.role,
          blocks: msg.blocks,
          timestamp: msg.timestamp || Date.now(),
        }))
        const contextBlock = [...messages]
          .flatMap((msg) => msg.blocks)
          .reverse()
          .find((block): block is Extract<CodingContentBlock, { type: 'context_usage' }> => block.type === 'context_usage')
        return {
          sessionMessages: { ...s.sessionMessages, [sessionId]: messages },
          ...(contextBlock ? { sessionContextUsage: { ...s.sessionContextUsage, [sessionId]: contextBlock } } : {})
        }
      })
    } catch (err) {
      console.error('hydrate session transcript:', err)
    } finally {
      transcriptHydrationInFlight.delete(key)
    }
  },
  createAndOpenSession: async (wid, tt) => { const s = await get().createSession(wid, tt, 'local'); set({ activeSessionId: s.id }) },
  detectTools: async () => window.api.aiCoding.detectTools(),

  sendUserMessage: async (sessionId, text, images) => {
    const { sessions } = get(); const session = sessions.find(s => s.id === sessionId); if (!session) return
    const userBlocks: CodingContentBlock[] = []
    if (images && images.length > 0) {
      for (const img of images) userBlocks.push({ type: 'text', text: `📎 ${img.mediaType} image (${Math.round(img.data.length * 0.75 / 1024)} KB)` })
    }
    if (text) userBlocks.push({ type: 'text', text })
    const userMsg: CodingMessage = { id: genMsgId(), sessionId, role: 'user', blocks: userBlocks.length > 0 ? userBlocks : [{ type: 'text', text: '' }], timestamp: Date.now() }
    set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), userMsg] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: true }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] } }))
    if (!session.title) { const t = text.slice(0, 50) + (text.length > 50 ? '…' : ''); try { await get().updateSession(sessionId, { title: t }) } catch { /* */ } }
    if (session.status === 'closed' || session.status === 'completed' || session.status === 'error') {
      const r = await get().launchSession(sessionId)
      if (!r.success) { const em: CodingMessage = { id: genMsgId(), sessionId, role: 'system', blocks: [{ type: 'text', text: `启动失败: ${r.error}` }], timestamp: Date.now() }; set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), em] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false } })); return }
      const activeMode = get().sessionModes[sessionId] || defaultMode(session.toolType)
      await window.api.aiCoding.setPermissionMode(sessionId, toRuntimePermissionMode(session.toolType, activeMode)).catch(() => {})
      await new Promise(r => setTimeout(r, 500))
    }
    try { await window.api.aiCoding.writeToSession(sessionId, text, images) } catch (err: any) { const em: CodingMessage = { id: genMsgId(), sessionId, role: 'system', blocks: [{ type: 'text', text: `发送失败: ${err?.message || String(err)}` }], timestamp: Date.now() }; set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), em] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false } })) }
  },
  clearSessionMessages: (sid) => set(s => ({ sessionMessages: { ...s.sessionMessages, [sid]: [] }, sessionStreaming: { ...s.sessionStreaming, [sid]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sid]: [] } })),
  executeSlashCommand: async (sessionId, command) => {
    // Add a system message showing the command, then set streaming
    const cmdMsg: CodingMessage = { id: genMsgId(), sessionId, role: 'user', blocks: [{ type: 'text', text: command }], timestamp: Date.now() }
    set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), cmdMsg] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: true }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] } }))
    try {
      const r = await window.api.aiCoding.executeSlashCommand(sessionId, command)
      if (!r.success) {
        const em: CodingMessage = { id: genMsgId(), sessionId, role: 'system', blocks: [{ type: 'text', text: `命令执行失败: ${r.error}` }], timestamp: Date.now() }
        set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), em] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false } }))
      }
      // Success: response events come via onPipeEvent listener (slash_command_done finalizes)
    } catch (err: any) {
      const em: CodingMessage = { id: genMsgId(), sessionId, role: 'system', blocks: [{ type: 'text', text: `命令执行失败: ${err?.message || String(err)}` }], timestamp: Date.now() }
      set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), em] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false } }))
    }
  },
  setSessionMode: (sid, m) => {
    set(s => ({ sessionModes: { ...s.sessionModes, [sid]: m } }))
    // Sync permission mode to SDK session
    const session = get().sessions.find(s => s.id === sid)
    const runtimeMode = toRuntimePermissionMode(session?.toolType || 'claude', m)
    window.api.aiCoding.setPermissionMode(sid, runtimeMode).catch(() => { /* session may not be running yet */ })
  },
  setSessionEffort: (sid, effort) => {
    set(s => ({ sessionEffort: { ...s.sessionEffort, [sid]: effort } }))
    // Apply live to a running session (best-effort — ignored if not running yet,
    // and re-seeded from sessionEffort on the next launch).
    window.api.aiCoding.setEffort(sid, effort).catch(() => { /* session may not be running yet */ })
  },
  setClaudeViewMode: (sid, m) => { localStorage.setItem('cb-claude-view-mode', m); set(s => ({ claudeViewModes: { ...s.claudeViewModes, [sid]: m } })) },
  interruptSession: async (sid) => { try { await window.api.aiCoding.interruptSession(sid) } catch { /* */ } },
  answerQuestion: async (sessionId, questionId, answerText) => {
    // Mark the question block as answered
    set(s => {
      const msgs = (s.sessionMessages[sessionId] || []).map(m => ({
        ...m,
        blocks: m.blocks.map(b =>
          b.type === 'ask_user_question' && b.id === questionId
            ? { ...b, answered: true, answerText } as typeof b
            : b
        )
      }))
      return {
        sessionMessages: { ...s.sessionMessages, [sessionId]: msgs },
        sessionPendingQuestions: { ...s.sessionPendingQuestions, [sessionId]: null }
      }
    })
    // Send the answer as a user message (creates a new query with resume)
    await get().sendUserMessage(sessionId, answerText)
  },

  resolvePermission: async (sessionId, requestId, decision) => {
    // Mark the permission block as resolved so the card stops soliciting input.
    set(s => {
      const msgs = (s.sessionMessages[sessionId] || []).map(m => ({
        ...m,
        blocks: m.blocks.map(b =>
          b.type === 'permission_request' && b.id === requestId
            ? { ...b, resolved: true, decision: decision.behavior } as typeof b
            : b
        )
      }))
      return {
        sessionMessages: { ...s.sessionMessages, [sessionId]: msgs },
        sessionPendingPermissions: { ...s.sessionPendingPermissions, [sessionId]: null }
      }
    })
    // The SDK's canUseTool callback is blocked awaiting this; unblocking it lets
    // the turn continue (allow → tool runs; deny → SDK reports the denial).
    try {
      await window.api.aiCoding.resolvePermission(sessionId, requestId, decision)
    } catch { /* request may already be gone (interrupt/close) */ }
  },

  // ── Global split layout actions ──

  getOrCreateLayout: () => {
    const { globalLayout } = get()
    if (globalLayout) return globalLayout
    const persisted = _loadPersistedLayout()
    if (persisted) {
      set({ globalLayout: persisted })
      return persisted
    }
    const layout = createDefaultLayout([])
    set({ globalLayout: layout })
    return layout
  },

  splitPane: (paneId, direction, sessionId) => {
    const root = get().globalLayout
    if (!root) return
    const leaf = findLeaf(root, paneId)
    if (!leaf) return

    const newLeaf: LeafNode = {
      type: 'leaf',
      id: genPaneId(),
      tabIds: sessionId ? [sessionId] : [],
      activeTabId: sessionId || null,
    }

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
    set({ globalLayout: newRoot, focusedPaneId: newLeaf.id })
    _persistLayout(newRoot)
  },

  closePane: (paneId) => {
    const root = get().globalLayout
    if (!root) return
    const newRoot = removeLeaf(root, paneId)
    if (!newRoot) {
      const empty = createDefaultLayout([])
      set({ globalLayout: empty, focusedPaneId: empty.id })
      _persistLayout(empty)
      return
    }
    const leaves = collectLeaves(newRoot)
    set({ globalLayout: newRoot, focusedPaneId: leaves[0]?.id || null })
    _persistLayout(newRoot)
  },

  moveTab: (fromPaneId, toPaneId, sessionId) => {
    let root = get().globalLayout
    if (!root) return

    const fromLeaf = findLeaf(root, fromPaneId)
    if (!fromLeaf || !fromLeaf.tabIds.includes(sessionId)) return
    const newFromTabs = fromLeaf.tabIds.filter(id => id !== sessionId)
    root = updateLeaf(root, fromPaneId, leaf => ({
      ...leaf,
      tabIds: newFromTabs,
      activeTabId: leaf.activeTabId === sessionId ? (newFromTabs[0] || null) : leaf.activeTabId,
    }))

    root = updateLeaf(root, toPaneId, leaf => ({
      ...leaf,
      tabIds: [...leaf.tabIds, sessionId],
      activeTabId: sessionId,
    }))

    if (newFromTabs.length === 0) {
      root = removeLeaf(root, fromPaneId) || createDefaultLayout([])
    }

    set({ globalLayout: root, focusedPaneId: toPaneId })
    _persistLayout(root)
  },

  setPaneActiveTab: (paneId, sessionId) => {
    const root = get().globalLayout
    if (!root) return
    const newRoot = updateLeaf(root, paneId, leaf => ({ ...leaf, activeTabId: sessionId }))
    set({ globalLayout: newRoot, activeSessionId: sessionId, focusedPaneId: paneId })
    void get().hydrateSessionTranscript(sessionId)
    _persistLayout(newRoot)
  },

  addTabToPane: (paneId, sessionId) => {
    const root = get().globalLayout
    if (!root) return
    const newRoot = updateLeaf(root, paneId, leaf => ({
      ...leaf,
      tabIds: leaf.tabIds.includes(sessionId) ? leaf.tabIds : [...leaf.tabIds, sessionId],
      activeTabId: sessionId,
    }))
    set({ globalLayout: newRoot, activeSessionId: sessionId, focusedPaneId: paneId })
    void get().hydrateSessionTranscript(sessionId)
    _persistLayout(newRoot)
  },

  removeTabFromPane: (paneId, sessionId) => {
    let root = get().globalLayout
    if (!root) return

    const leaf = findLeaf(root, paneId)
    if (!leaf) return
    const newTabs = leaf.tabIds.filter(id => id !== sessionId)

    if (newTabs.length === 0) {
      root = removeLeaf(root, paneId) || createDefaultLayout([])
      // Focus the first remaining leaf after pane removal
      const leaves = collectLeaves(root)
      const nextLeaf = leaves[0]
      set({
        globalLayout: root,
        focusedPaneId: nextLeaf?.id || null,
        activeSessionId: nextLeaf?.activeTabId || null,
      })
    } else {
      root = updateLeaf(root, paneId, l => ({
        ...l,
        tabIds: newTabs,
        activeTabId: l.activeTabId === sessionId ? (newTabs[0] || null) : l.activeTabId,
      }))
      set({ globalLayout: root })
    }

    _persistLayout(root)
  },

  setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),

  setSplitSizes: (path, sizes) => {
    const root = get().globalLayout
    if (!root) return
    const newRoot = updateSplitSizes(root, path, sizes)
    set({ globalLayout: newRoot })
    _persistLayout(newRoot)
  },
}))

// ── Split layout persistence (global) ──
const LAYOUT_STORAGE_KEY = 'cb-workbench-global-layout'

function _persistLayout(layout: LayoutNode): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  } catch { /* storage full */ }
}

function _loadPersistedLayout(): LayoutNode | null {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// Auto-persist sessionMessages on change (debounced)
let _persistTimer: ReturnType<typeof setTimeout> | null = null
useAICodingStore.subscribe(
  (state, prev) => {
    if (state.sessionMessages !== prev.sessionMessages) {
      if (_persistTimer) clearTimeout(_persistTimer)
      _persistTimer = setTimeout(() => persistMessages(state.sessionMessages), 500)
    }
  }
)
