import { create } from 'zustand'
import type {
  AIWorkbenchWorkspace, AIWorkbenchSession, AIWorkbenchGroup, AIWorkbenchIMConfig,
  AIWorkbenchIMConnectionStatus, AIToolType, DetectedCLI,
  WorkbenchMessage, WorkbenchContentBlock, WorkbenchMode, ClaudeViewMode,
  AskUserQuestionItem
} from '../types/ai-workbench'
import type { LayoutNode, LeafNode, SplitDirection } from '../types/split-layout'
import {
  genPaneId, createDefaultLayout, findLeaf, findLeafBySessionId,
  collectLeaves, replaceNode, removeLeaf, updateLeaf, updateSplitSizes
} from '../types/split-layout'

let msgCounter = 0
function genMsgId(): string { return `wm-${Date.now()}-${++msgCounter}` }

// ── sessionMessages persistence (localStorage) ──
const MSG_STORAGE_KEY = 'cb-workbench-messages'
const MSG_PER_SESSION_LIMIT = 100

function loadPersistedMessages(): Record<string, WorkbenchMessage[]> {
  try {
    const raw = localStorage.getItem(MSG_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function persistMessages(msgs: Record<string, WorkbenchMessage[]>): void {
  try {
    // Trim each session to the latest N messages before saving
    const trimmed: Record<string, WorkbenchMessage[]> = {}
    for (const [sid, arr] of Object.entries(msgs)) {
      if (arr.length > 0) {
        trimmed[sid] = arr.length > MSG_PER_SESSION_LIMIT ? arr.slice(-MSG_PER_SESSION_LIMIT) : arr
      }
    }
    localStorage.setItem(MSG_STORAGE_KEY, JSON.stringify(trimmed))
  } catch { /* storage full — silently skip */ }
}

function parseClaudeEvent(event: Record<string, unknown>): WorkbenchContentBlock[] {
  const blocks: WorkbenchContentBlock[] = []
  const msgType = event.type as string
  if (msgType === 'assistant') {
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

interface AIWorkbenchState {
  workspaces: AIWorkbenchWorkspace[]; sessions: AIWorkbenchSession[]; groups: AIWorkbenchGroup[]
  imConfig: AIWorkbenchIMConfig; imStatus: AIWorkbenchIMConnectionStatus; loading: boolean
  activeSessionId: string | null
  sessionMessages: Record<string, WorkbenchMessage[]>; sessionStreaming: Record<string, boolean>
  sessionStreamingBlocks: Record<string, WorkbenchContentBlock[]>; sessionModes: Record<string, WorkbenchMode>
  fetchWorkspaces: () => Promise<void>; fetchSessions: () => Promise<void>; fetchGroups: () => Promise<void>
  fetchIMConfig: () => Promise<void>; fetchAll: () => Promise<void>
  createWorkspace: (wd: string, gid: string) => Promise<AIWorkbenchWorkspace>
  updateWorkspace: (id: string, u: Partial<AIWorkbenchWorkspace>) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>
  createSession: (wid: string, tt: AIToolType, src?: 'local' | 'im') => Promise<AIWorkbenchSession>
  updateSession: (id: string, u: Partial<AIWorkbenchSession>) => Promise<void>
  deleteSession: (id: string) => Promise<void>; stopSession: (id: string) => Promise<void>
  launchSession: (id: string, opts?: { forcePty?: boolean }) => Promise<{ success: boolean; error?: string }>
  createGroup: (n: string) => Promise<AIWorkbenchGroup>; renameGroup: (id: string, n: string) => Promise<void>
  deleteGroup: (id: string) => Promise<{ success: boolean; error?: string }>
  saveIMConfig: (c: AIWorkbenchIMConfig) => Promise<void>
  imConnect: () => Promise<void>; imDisconnect: () => Promise<void>
  imTest: () => Promise<{ success: boolean; error?: string }>
  fetchIMStatus: () => Promise<void>; setIMStatus: (s: AIWorkbenchIMConnectionStatus) => void
  initListeners: () => () => void; setActiveSession: (sid: string | null) => void
  createAndOpenSession: (wid: string, tt: AIToolType) => Promise<void>; detectTools: () => Promise<DetectedCLI[]>
  sendUserMessage: (sid: string, text: string) => Promise<void>; clearSessionMessages: (sid: string) => void
  executeSlashCommand: (sid: string, command: string) => Promise<void>
  setSessionMode: (sid: string, m: WorkbenchMode) => void; interruptSession: (sid: string) => Promise<void>
  claudeViewModes: Record<string, ClaudeViewMode>
  setClaudeViewMode: (sid: string, m: ClaudeViewMode) => void
  sessionPendingQuestions: Record<string, { id: string; questions: AskUserQuestionItem[] } | null>
  answerQuestion: (sid: string, questionId: string, answerText: string) => Promise<void>
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

export const useAIWorkbenchStore = create<AIWorkbenchState>((set, get) => ({
  workspaces: [], sessions: [], groups: [],
  imConfig: { feishu: { appId: '', appSecret: '' } }, imStatus: { state: 'disconnected' }, loading: false,
  activeSessionId: null, sessionMessages: loadPersistedMessages(), sessionStreaming: {}, sessionStreamingBlocks: {}, sessionModes: {},
  claudeViewModes: {},
  sessionPendingQuestions: {},
  globalLayout: null,
  focusedPaneId: null,

  fetchWorkspaces: async () => { try { set({ workspaces: await window.api.aiWorkbench.getWorkspaces() }) } catch (e) { console.error('fetch workspaces:', e) } },
  fetchSessions: async () => { try { set({ sessions: await window.api.aiWorkbench.getSessions() }) } catch (e) { console.error('fetch sessions:', e) } },
  fetchGroups: async () => { try { set({ groups: await window.api.aiWorkbench.getGroups() }) } catch (e) { console.error('fetch groups:', e) } },
  fetchIMConfig: async () => { try { set({ imConfig: await window.api.aiWorkbench.getIMConfig() }) } catch (e) { console.error('fetch IM config:', e) } },
  fetchAll: async () => {
    set({ loading: true })
    try {
      const [workspaces, sessions, groups, imConfig, imStatus] = await Promise.all([
        window.api.aiWorkbench.getWorkspaces(), window.api.aiWorkbench.getSessions(),
        window.api.aiWorkbench.getGroups(), window.api.aiWorkbench.getIMConfig(), window.api.aiWorkbench.imGetStatus()])
      set({ workspaces, sessions, groups, imConfig, imStatus, loading: false })
    } catch (e) { console.error('fetch all:', e); set({ loading: false }) }
  },
  createWorkspace: async (wd, gid) => { const w = await window.api.aiWorkbench.createWorkspace(wd, gid); set({ workspaces: await window.api.aiWorkbench.getWorkspaces() }); return w },
  updateWorkspace: async (id, u) => { await window.api.aiWorkbench.updateWorkspace(id, u); set({ workspaces: await window.api.aiWorkbench.getWorkspaces() }) },
  deleteWorkspace: async (id) => {
    const { sessions, activeSessionId } = get(); const wsIds = new Set(sessions.filter(s => s.workspaceId === id).map(s => s.id))
    await window.api.aiWorkbench.deleteWorkspace(id)
    const [workspaces, ss] = await Promise.all([window.api.aiWorkbench.getWorkspaces(), window.api.aiWorkbench.getSessions()])
    set({ workspaces, sessions: ss, activeSessionId: activeSessionId && wsIds.has(activeSessionId) ? null : activeSessionId })
  },
  createSession: async (wid, tt, src = 'local') => { const s = await window.api.aiWorkbench.createSession(wid, tt, src); set({ sessions: await window.api.aiWorkbench.getSessions() }); return s },
  updateSession: async (id, u) => { await window.api.aiWorkbench.updateSession(id, u); set({ sessions: await window.api.aiWorkbench.getSessions() }) },
  deleteSession: async (id) => {
    const { activeSessionId: aid, sessionMessages: sm, sessionStreaming: ss, sessionStreamingBlocks: sb, sessionModes: smo } = get()
    await window.api.aiWorkbench.deleteSession(id); const sessions = await window.api.aiWorkbench.getSessions()
    const nm = { ...sm }; const ns = { ...ss }; const nb = { ...sb }; const nmo = { ...smo }; delete nm[id]; delete ns[id]; delete nb[id]; delete nmo[id]
    set({ sessions, activeSessionId: aid === id ? null : aid, sessionMessages: nm, sessionStreaming: ns, sessionStreamingBlocks: nb, sessionModes: nmo })
  },
  stopSession: async (id) => { await window.api.aiWorkbench.stopSession(id); const sessions = await window.api.aiWorkbench.getSessions(); set(s => ({ sessions, sessionStreaming: { ...s.sessionStreaming, [id]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [id]: [] } })) },
  launchSession: async (id, opts) => { const r = await window.api.aiWorkbench.launchSession(id, opts); if (r.success) set({ sessions: await window.api.aiWorkbench.getSessions() }); return r },
  createGroup: async (n) => { const g = await window.api.aiWorkbench.createGroup(n); set({ groups: await window.api.aiWorkbench.getGroups() }); return g },
  renameGroup: async (id, n) => { await window.api.aiWorkbench.renameGroup(id, n); set({ groups: await window.api.aiWorkbench.getGroups() }) },
  deleteGroup: async (id) => {
    const r = await window.api.aiWorkbench.deleteGroup(id)
    if (r.success) { const [w, s, g] = await Promise.all([window.api.aiWorkbench.getWorkspaces(), window.api.aiWorkbench.getSessions(), window.api.aiWorkbench.getGroups()]); set({ workspaces: w, sessions: s, groups: g }) }
    return r
  },
  saveIMConfig: async (c) => { await window.api.aiWorkbench.saveIMConfig(c); set({ imConfig: c }) },
  imConnect: async () => { set({ imStatus: { state: 'connecting' } }); try { await window.api.aiWorkbench.imConnect() } catch (e: any) { set({ imStatus: { state: 'error', error: e?.message || String(e) } }); throw e } },
  imDisconnect: async () => { await window.api.aiWorkbench.imDisconnect(); set({ imStatus: { state: 'disconnected' } }) },
  imTest: async () => window.api.aiWorkbench.imTest(),
  fetchIMStatus: async () => { try { set({ imStatus: await window.api.aiWorkbench.imGetStatus() }) } catch (e) { console.error('fetch IM status:', e) } },
  setIMStatus: (status) => set({ imStatus: status }),

  initListeners: () => {
    const u1 = window.api.aiWorkbench.onIMStatusChanged((s) => get().setIMStatus(s as AIWorkbenchIMConnectionStatus))
    const u2 = window.api.aiWorkbench.onDataChanged(() => { get().fetchWorkspaces(); get().fetchSessions(); get().fetchGroups() })
    const u3 = window.api.aiWorkbench.onPtyExit(({ sessionId }) => {
      set(st => ({ sessions: st.sessions.map(s => s.id === sessionId ? { ...s, status: 'closed' as const, lastActivity: 'none' as const, updatedAt: Date.now() } : s) }))
      get().fetchSessions()
    })
    const u4 = window.api.aiWorkbench.onPipeEvent(({ sessionId, event }) => {
      const st = get(); const session = st.sessions.find(s => s.id === sessionId); if (!session) return
      const et = (event as any).type as string
      if (et === 'pipe_exit' || et === 'pipe_error' || et === 'slash_command_done') {
        const cb = st.sessionStreamingBlocks[sessionId] || []
        if (cb.length > 0) { const m: WorkbenchMessage = { id: genMsgId(), sessionId, role: 'assistant', blocks: cb, timestamp: Date.now() }; set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), m] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] }, sessionPendingQuestions: { ...s.sessionPendingQuestions, [sessionId]: null } })) }
        else set(s => ({ sessionStreaming: { ...s.sessionStreaming, [sessionId]: false }, sessionPendingQuestions: { ...s.sessionPendingQuestions, [sessionId]: null } }))
        return
      }
      if (et === 'raw_output') {
        const content = (event as any).content as string; if (!content) return
        set(s => { const blocks = [...(s.sessionStreamingBlocks[sessionId] || [])]; const last = blocks[blocks.length - 1]; if (last && last.type === 'raw_output') blocks[blocks.length - 1] = { type: 'raw_output', text: last.text + '\n' + content }; else blocks.push({ type: 'raw_output', text: content }); return { sessionStreaming: { ...s.sessionStreaming, [sessionId]: true }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: blocks } } })
        const act = (event as any).activity as string
        if (act === 'waiting_input' || act === 'auth_request') { const cur = get(); const blocks = cur.sessionStreamingBlocks[sessionId] || []; if (blocks.length > 0) { const m: WorkbenchMessage = { id: genMsgId(), sessionId, role: 'assistant', blocks, timestamp: Date.now() }; set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), m] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] } })) } }
        return
      }
      if (session.toolType === 'claude') {
        // Handle AskUserQuestion dedicated event
        if (et === 'ask_user_question') {
          const questionBlock: WorkbenchContentBlock = {
            type: 'ask_user_question',
            id: (event as any).id || '',
            questions: (event as any).questions || [],
            answered: false,
          }
          // Flush all accumulated streaming blocks + question block into a finalized message
          const cur = get()
          const existingBlocks = cur.sessionStreamingBlocks[sessionId] || []
          const allBlocks = [...existingBlocks, questionBlock]
          const m: WorkbenchMessage = { id: genMsgId(), sessionId, role: 'assistant', blocks: allBlocks, timestamp: Date.now() }
          set(s => ({
            sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), m] },
            sessionStreaming: { ...s.sessionStreaming, [sessionId]: false },
            sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] },
            sessionPendingQuestions: { ...s.sessionPendingQuestions, [sessionId]: { id: (event as any).id || '', questions: (event as any).questions || [] } }
          }))
          return
        }
        // Handle TodoWrite dedicated event — append to streaming blocks (non-interactive)
        if (et === 'todo_update') {
          const todoBlock: WorkbenchContentBlock = {
            type: 'todo_update',
            todos: (event as any).todos || [],
          }
          set(s => ({
            sessionStreaming: { ...s.sessionStreaming, [sessionId]: true },
            sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [...(s.sessionStreamingBlocks[sessionId] || []), todoBlock] }
          }))
          return
        }
        const pb = parseClaudeEvent(event as Record<string, unknown>)
        if (et === 'system') {
          // Only skip init events; forward other system events (e.g. slash command responses) as text
          if ((event as any).subtype === 'init') return
          const sysText = (event as any).message || (event as any).content || ''
          if (sysText) {
            set(s => ({ sessionStreaming: { ...s.sessionStreaming, [sessionId]: true }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [...(s.sessionStreamingBlocks[sessionId] || []), { type: 'text' as const, text: String(sysText) }] } }))
          }
          return
        }
        if (et === 'assistant') { set(s => ({ sessionStreaming: { ...s.sessionStreaming, [sessionId]: true }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [...(s.sessionStreamingBlocks[sessionId] || []), ...pb] } })); return }
        if (et === 'result') { const existing = get().sessionStreamingBlocks[sessionId] || []; let ab = [...existing]; if (ab.length === 0) { const resultText = typeof (event as any).result === 'string' ? (event as any).result : ''; if (resultText) ab.push({ type: 'text', text: resultText }) }; const cost = typeof (event as any).cost_usd === 'number' ? (event as any).cost_usd : undefined; if (ab.length > 0) { const m: WorkbenchMessage = { id: genMsgId(), sessionId, role: 'assistant', blocks: ab, timestamp: Date.now(), costUsd: cost }; set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), m] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] } })) } else set(s => ({ sessionStreaming: { ...s.sessionStreaming, [sessionId]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] } })); return }
        if (et === 'error') { const ab = [...(get().sessionStreamingBlocks[sessionId] || []), ...pb]; if (ab.length > 0) { const m: WorkbenchMessage = { id: genMsgId(), sessionId, role: 'assistant', blocks: ab, timestamp: Date.now() }; set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), m] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] } })) } }
      }
    })
    return () => { u1(); u2(); u3(); u4() }
  },

  setActiveSession: (sid) => set({ activeSessionId: sid }),
  createAndOpenSession: async (wid, tt) => { const s = await get().createSession(wid, tt, 'local'); set({ activeSessionId: s.id }) },
  detectTools: async () => window.api.aiWorkbench.detectTools(),

  sendUserMessage: async (sessionId, text) => {
    const { sessions } = get(); const session = sessions.find(s => s.id === sessionId); if (!session) return
    const userMsg: WorkbenchMessage = { id: genMsgId(), sessionId, role: 'user', blocks: [{ type: 'text', text }], timestamp: Date.now() }
    set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), userMsg] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: true }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] } }))
    if (!session.title) { const t = text.slice(0, 50) + (text.length > 50 ? '…' : ''); try { await window.api.aiWorkbench.updateSession(sessionId, { title: t }); set({ sessions: await window.api.aiWorkbench.getSessions() }) } catch { /* */ } }
    if (session.status === 'closed' || session.status === 'completed' || session.status === 'error') {
      const r = await get().launchSession(sessionId)
      if (!r.success) { const em: WorkbenchMessage = { id: genMsgId(), sessionId, role: 'system', blocks: [{ type: 'text', text: `启动失败: ${r.error}` }], timestamp: Date.now() }; set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), em] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false } })); return }
      await new Promise(r => setTimeout(r, 500))
    }
    try { await window.api.aiWorkbench.writeToSession(sessionId, text) } catch (err: any) { const em: WorkbenchMessage = { id: genMsgId(), sessionId, role: 'system', blocks: [{ type: 'text', text: `发送失败: ${err?.message || String(err)}` }], timestamp: Date.now() }; set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), em] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false } })) }
  },
  clearSessionMessages: (sid) => set(s => ({ sessionMessages: { ...s.sessionMessages, [sid]: [] }, sessionStreaming: { ...s.sessionStreaming, [sid]: false }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sid]: [] } })),
  executeSlashCommand: async (sessionId, command) => {
    // Add a system message showing the command, then set streaming
    const cmdMsg: WorkbenchMessage = { id: genMsgId(), sessionId, role: 'user', blocks: [{ type: 'text', text: command }], timestamp: Date.now() }
    set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), cmdMsg] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: true }, sessionStreamingBlocks: { ...s.sessionStreamingBlocks, [sessionId]: [] } }))
    try {
      const r = await window.api.aiWorkbench.executeSlashCommand(sessionId, command)
      if (!r.success) {
        const em: WorkbenchMessage = { id: genMsgId(), sessionId, role: 'system', blocks: [{ type: 'text', text: `命令执行失败: ${r.error}` }], timestamp: Date.now() }
        set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), em] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false } }))
      }
      // Success: response events come via onPipeEvent listener (slash_command_done finalizes)
    } catch (err: any) {
      const em: WorkbenchMessage = { id: genMsgId(), sessionId, role: 'system', blocks: [{ type: 'text', text: `命令执行失败: ${err?.message || String(err)}` }], timestamp: Date.now() }
      set(s => ({ sessionMessages: { ...s.sessionMessages, [sessionId]: [...(s.sessionMessages[sessionId] || []), em] }, sessionStreaming: { ...s.sessionStreaming, [sessionId]: false } }))
    }
  },
  setSessionMode: (sid, m) => {
    set(s => ({ sessionModes: { ...s.sessionModes, [sid]: m } }))
    // Sync permission mode to SDK session
    const modeMap: Record<string, string> = { 'plan': 'plan', 'ask-first': 'default', 'auto-edit': 'bypassPermissions' }
    const sdkMode = modeMap[m] || 'default'
    window.api.aiWorkbench.setPermissionMode(sid, sdkMode).catch(() => { /* session may not be running yet */ })
  },
  setClaudeViewMode: (sid, m) => { localStorage.setItem('cb-claude-view-mode', m); set(s => ({ claudeViewModes: { ...s.claudeViewModes, [sid]: m } })) },
  interruptSession: async (sid) => { try { await window.api.aiWorkbench.interruptSession(sid) } catch { /* */ } },
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
useAIWorkbenchStore.subscribe(
  (state, prev) => {
    if (state.sessionMessages !== prev.sessionMessages) {
      if (_persistTimer) clearTimeout(_persistTimer)
      _persistTimer = setTimeout(() => persistMessages(state.sessionMessages), 500)
    }
  }
)
