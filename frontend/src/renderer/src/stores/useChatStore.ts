import { create } from 'zustand'
import { flushSync } from 'react-dom'
import apiClient, { API_BASE_URL } from '../services/apiClient'
import { useAIModelStore } from './useAIModelStore'
import { useAuthStore } from './useAuthStore'
import { ToolLoopController } from '../utils/tool-loop-controller'
import { useSettingsStore } from './useSettingsStore'
import { buildSystemPrompt, type AgentMemoryContext } from '../utils/system-prompt-builder'
import type {
  Conversation,
  Message,
  PendingAttachment,
  ChatAttachment,
  ToolCall,
  ToolApprovalMode,
  AgentPhase,
  AgentToolHistoryEntry,
  SearchSource
} from '../types/chat'
import { getT } from '../i18n'

const PAGE_SIZE = 20

/** Check if currently in local (offline) mode */
function isLocal(): boolean {
  return useAuthStore.getState().isLocalMode
}

/** Generate a unique local ID */
function localId(prefix = 'local'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============ Local-mode persistence helpers ============
const LOCAL_CONV_KEY = 'clawbench_local_chat_conversations'
const localMsgKey = (id: string) => `clawbench_local_chat_messages_${id}`

function loadLocalConversations(): Conversation[] {
  try {
    const data = localStorage.getItem(LOCAL_CONV_KEY)
    return data ? JSON.parse(data) : []
  } catch { return [] }
}
function saveLocalConversations(conversations: Conversation[]): void {
  try { localStorage.setItem(LOCAL_CONV_KEY, JSON.stringify(conversations)) } catch { /* ignore */ }
}
function loadLocalMessages(conversationId: string): Message[] {
  try {
    const data = localStorage.getItem(localMsgKey(conversationId))
    return data ? JSON.parse(data) : []
  } catch { return [] }
}
function saveLocalMessages(conversationId: string, messages: Message[]): void {
  try { localStorage.setItem(localMsgKey(conversationId), JSON.stringify(messages)) } catch { /* ignore */ }
}
function deleteLocalMessages(conversationId: string): void {
  try { localStorage.removeItem(localMsgKey(conversationId)) } catch { /* ignore */ }
}

// ============ Search source parsers ============

/** Parse search results output into SearchSource[] */
function parseSearchSources(output: string): SearchSource[] {
  const sources: SearchSource[] = []
  // Match pattern: [N] Title\n    URL: https://...\n    snippet
  const resultRegex = /\[\d+\]\s+(.+)\n\s+URL:\s+(https?:\/\/\S+)\n\s+(.*)/g
  let match: RegExpExecArray | null
  while ((match = resultRegex.exec(output)) !== null) {
    sources.push({
      title: match[1].trim(),
      url: match[2].trim(),
      snippet: match[3].trim()
    })
  }
  return sources
}

/** Parse web_browse output into a single SearchSource */
function parseBrowseSource(output: string, url: string): SearchSource | null {
  const titleMatch = output.match(/^Title:\s*(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : ''
  if (!title || title === '(no title)') return null
  const snippet = output.substring(0, 200).replace(/Title:.*\n?URL:.*\n?/, '').trim()
  return { title, url, snippet }
}

interface PendingToolCall {
  toolCallId: string
  toolName: string
  input: Record<string, any>
  streamedContent: string // text streamed before tool_use
}

/** Safe tools that can be auto-executed without user approval */
const SAFE_TOOLS = new Set([
  'web_search', 'web_browse', 'plan_search',
  'generate_image', 'edit_image'
])

function isSafeTool(toolName: string): boolean {
  if (SAFE_TOOLS.has(toolName)) return true
  // MCP tools are considered safe by default (not execute_command)
  if (toolName !== 'execute_command') return true
  return false
}

interface ChatState {
  // Favorited conversations
  favConversations: Conversation[]
  favTotal: number
  favOffset: number
  favHasMore: boolean

  // Regular conversations
  conversations: Conversation[]
  total: number
  offset: number
  hasMore: boolean

  // Active conversation
  activeConversationId: string | null
  messages: Message[]

  // Streaming state
  streaming: boolean
  streamingContent: string
  streamingThinkingContent: string
  streamingTaskId: string | null
  streamingError: string | null
  streamStartTime: number | null

  // Tool calling state
  toolApprovalMode: ToolApprovalMode
  pendingToolCalls: PendingToolCall[]
  toolsEnabled: boolean
  toolLoopController: ToolLoopController | null
  webSearchEnabled: boolean
  feishuKitsEnabled: boolean
  searchSources: SearchSource[]

  // Agent state
  agentPhase: AgentPhase
  agentStepDescription: string
  agentToolHistory: AgentToolHistoryEntry[]

  // Actions
  fetchFavConversations: (reset?: boolean) => Promise<void>
  loadMoreFavConversations: () => Promise<void>
  fetchConversations: (reset?: boolean) => Promise<void>
  loadMoreConversations: () => Promise<void>
  createConversation: (modelId?: string) => Promise<string>
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  selectConversation: (id: string) => Promise<void>
  clearActiveConversation: () => void

  // Message actions
  sendMessage: (
    content: string,
    modelSource: 'builtin' | 'local',
    modelId: string,
    modelConfigId?: string,
    pendingFiles?: PendingAttachment[],
    enableThinking?: boolean,
    webSearchEnabled?: boolean,
    feishuKitsEnabled?: boolean
  ) => Promise<void>
  appendStreamingContent: (content: string) => void
  finalizeStreaming: (fullContent: string, modelId: string, thinkingContent?: string, usage?: { promptTokens: number; completionTokens: number }) => void
  setStreamingError: (error: string) => void
  cancelStreaming: () => void

  // Tool calling actions
  setToolApprovalMode: (mode: ToolApprovalMode) => void
  setToolsEnabled: (enabled: boolean) => void
  approveToolCall: (toolCallId: string) => void
  rejectToolCall: (toolCallId: string) => void

  // Message edit/retract actions
  deleteMessages: (messageId: string, mode: 'single' | 'from-here') => Promise<void>
  editAndResend: (messageId: string, newContent: string) => Promise<void>
  regenerateFromMessage: (messageId: string) => Promise<void>

  // Export
  exportConversation: (id: string, format: 'markdown' | 'json') => void

  // Prefill input (set by external pages, consumed by ChatInput)
  prefillInput: string | null
  setPrefillInput: (text: string | null) => void
}

/**
 * Get available tools (builtin + MCP) for AI requests
 */
async function getAvailableTools(
  webSearchEnabled?: boolean,
  feishuKitsEnabled?: boolean
): Promise<
  Array<{ name: string; description: string; inputSchema: Record<string, any> }>
> {
  const tools: Array<{ name: string; description: string; inputSchema: Record<string, any> }> = []

  // Built-in command executor
  tools.push({
    name: 'execute_command',
    description:
      'Execute a shell command on the local machine. Use this to run scripts, check file contents, install packages, or perform other system operations.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Working directory for the command (optional)' }
      },
      required: ['command']
    }
  })

  // Built-in image generation
  tools.push({
    name: 'generate_image',
    description:
      'Generate an image from a text description using AI image generation (e.g. DALL-E, Stable Diffusion). Returns the image as a base64-encoded string.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'A detailed text description of the image to generate' },
        size: { type: 'string', description: 'Image size (e.g. "1024x1024", "1024x1792", "1792x1024")' },
        style: { type: 'string', description: 'Image style: "vivid" or "natural"', enum: ['vivid', 'natural'] },
        quality: { type: 'string', description: 'Image quality: "standard" or "hd"', enum: ['standard', 'hd'] }
      },
      required: ['prompt']
    }
  })

  // Built-in image edit
  tools.push({
    name: 'edit_image',
    description:
      'Edit or transform an existing image based on a text description. The image should be referenced by its file path.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'A description of what to change or how to edit the image' },
        imagePath: { type: 'string', description: 'File path of the source image to edit' },
        size: { type: 'string', description: 'Output image size (e.g. "1024x1024")' }
      },
      required: ['prompt', 'imagePath']
    }
  })

  // Web search tool (only when enabled)
  if (webSearchEnabled) {
    tools.push({
      name: 'plan_search',
      description:
        'Before searching, declare your search plan: what queries you will use and why. This helps organize multi-step research.',
      inputSchema: {
        type: 'object',
        properties: {
          queries: { type: 'array', items: { type: 'string' }, description: 'List of search queries to execute' },
          reasoning: { type: 'string', description: 'Brief explanation of your search strategy' }
        },
        required: ['queries', 'reasoning']
      }
    })

    tools.push({
      name: 'web_search',
      description:
        'Search the web for current information. Use this to find up-to-date answers, recent news, documentation, or any information that may have changed after your training cutoff. Always use this tool when the user asks about current events, latest versions, real-time data, or anything that requires fresh information.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          maxResults: { type: 'number', description: 'Maximum number of results to return (default: 5)' }
        },
        required: ['query']
      }
    })

    // web_browse tool
    tools.push({
      name: 'web_browse',
      description:
        'Browse a specific web page URL to read its full content. Use this after web_search to read detailed content from promising search results. Returns the page title and text content.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to browse' }
        },
        required: ['url']
      }
    })
  }

  // Feishu Kits tools (only when enabled + available)
  if (feishuKitsEnabled) {
    try {
      const availability = await window.api.feishuTools.checkAvailability()
      if (availability.available) {
        const feishuTools = await window.api.feishuTools.list()
        for (const t of feishuTools) {
          tools.push(t)
        }
      }
    } catch {
      // Feishu tools not available
    }
  }

  // MCP tools
  try {
    const mcpTools = await window.api.mcp.listTools()
    for (const t of mcpTools) {
      tools.push({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || {}
      })
    }
  } catch {
    // MCP not available
  }

  // Internal cross-module tools
  try {
    const internalTools = await window.api.internalTools.list()
    for (const t of internalTools) {
      tools.push(t)
    }
  } catch {
    // Internal tools not available
  }

  return tools
}

/**
 * Execute a tool and return the result string
 */
async function executeToolCall(
  toolName: string,
  input: Record<string, any>
): Promise<{ output: string; isError: boolean }> {
  // Handle plan_search pseudo-tool
  if (toolName === 'plan_search') {
    const queries = input.queries || []
    const reasoning = input.reasoning || ''
    return {
      output: `Search plan confirmed. ${queries.length} queries planned. Reasoning: ${reasoning}\nProceed with your searches.`,
      isError: false
    }
  }

  // Check if it's a Feishu tool
  if (toolName.startsWith('feishu_')) {
    try {
      const result = await window.api.feishuTools.execute(toolName, input)
      return { output: result.content, isError: result.isError }
    } catch (err: any) {
      return { output: err.message || 'Feishu tool execution failed', isError: true }
    }
  }

  // Check if it's an MCP tool
  try {
    const mcpTools = await window.api.mcp.listTools()
    const mcpTool = mcpTools.find((t: any) => t.name === toolName)
    if (mcpTool && mcpTool.serverId) {
      const result = await window.api.mcp.callTool(mcpTool.serverId, toolName, input)
      return { output: result.content, isError: result.isError }
    }
  } catch {
    // Not an MCP tool or MCP unavailable
  }

  // Built-in tools (via IPC to main process)
  if (toolName === 'execute_command' || toolName === 'generate_image' || toolName === 'edit_image' || toolName === 'web_search' || toolName === 'web_browse') {
    try {
      const result = await window.api.mcp.callTool('__builtin__', toolName, input)
      return { output: result.content, isError: result.isError }
    } catch (err: any) {
      return { output: err.message || 'Tool execution failed', isError: true }
    }
  }

  // Internal cross-module tools
  try {
    const result = await window.api.internalTools.execute(toolName, input)
    if (result) {
      return { output: result.content, isError: result.isError }
    }
  } catch {
    // Not an internal tool
  }

  return { output: `Unknown tool: ${toolName}`, isError: true }
}

export const useChatStore = create<ChatState>((set, get) => ({
  favConversations: [],
  favTotal: 0,
  favOffset: 0,
  favHasMore: false,

  conversations: [],
  total: 0,
  offset: 0,
  hasMore: false,

  activeConversationId: null,
  messages: [],

  streaming: false,
  streamingContent: '',
  streamingThinkingContent: '',
  streamingTaskId: null,
  streamingError: null,
  streamStartTime: null,

  toolApprovalMode: 'auto-approve-safe' as ToolApprovalMode,
  pendingToolCalls: [],
  toolsEnabled: true,
  toolLoopController: null,
  webSearchEnabled: false,
  feishuKitsEnabled: false,
  searchSources: [],

  agentPhase: 'idle' as AgentPhase,
  agentStepDescription: '',
  agentToolHistory: [],

  fetchFavConversations: async (reset = true) => {
    if (isLocal()) {
      const favs = loadLocalConversations().filter((c) => c.favorited)
      set({ favConversations: favs, favTotal: favs.length, favOffset: favs.length, favHasMore: false })
      return
    }
    try {
      const offset = reset ? 0 : get().favOffset
      const result = await apiClient.listConversations({
        favorited: true,
        limit: PAGE_SIZE,
        offset
      })
      set({
        favConversations: reset
          ? result.conversations
          : [...get().favConversations, ...result.conversations],
        favTotal: result.total,
        favOffset: offset + result.conversations.length,
        favHasMore: offset + result.conversations.length < result.total
      })
    } catch (err) {
      console.error('Failed to fetch favorited conversations:', err)
    }
  },

  loadMoreFavConversations: async () => {
    if (!get().favHasMore) return
    await get().fetchFavConversations(false)
  },

  fetchConversations: async (reset = true) => {
    if (isLocal()) {
      const all = loadLocalConversations().filter((c) => !c.favorited)
      set({ conversations: all, total: all.length, offset: all.length, hasMore: false })
      return
    }
    try {
      const offset = reset ? 0 : get().offset
      const result = await apiClient.listConversations({
        favorited: false,
        limit: PAGE_SIZE,
        offset
      })
      set({
        conversations: reset
          ? result.conversations
          : [...get().conversations, ...result.conversations],
        total: result.total,
        offset: offset + result.conversations.length,
        hasMore: offset + result.conversations.length < result.total
      })
    } catch (err) {
      console.error('Failed to fetch conversations:', err)
    }
  },

  loadMoreConversations: async () => {
    if (!get().hasMore) return
    await get().fetchConversations(false)
  },

  createConversation: async (modelId?: string) => {
    const { activeConversationId, messages } = get()
    if (activeConversationId && messages.length === 0) {
      return activeConversationId
    }

    if (isLocal()) {
      const id = localId('conv')
      const conv: Conversation = {
        conversationId: id,
        title: getT()('chat.newConversation'),
        modelId: modelId || null,
        favorited: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      saveLocalConversations([conv, ...loadLocalConversations()])
      set((state) => ({
        conversations: [conv, ...state.conversations],
        activeConversationId: id,
        messages: [],
        toolApprovalMode: 'auto-approve-safe' as ToolApprovalMode,
        pendingToolCalls: [],
        agentPhase: 'idle' as AgentPhase,
        agentToolHistory: []
      }))
      return id
    }

    const conv = await apiClient.createConversation(undefined, modelId)
    set((state) => ({
      conversations: [conv, ...state.conversations],
      activeConversationId: conv.conversationId,
      messages: [],
      toolApprovalMode: 'auto-approve-safe' as ToolApprovalMode,
      pendingToolCalls: [],
      agentPhase: 'idle' as AgentPhase,
      agentToolHistory: []
    }))
    return conv.conversationId
  },

  deleteConversation: async (id: string) => {
    if (!isLocal()) {
      await apiClient.deleteConversation(id)
    } else {
      saveLocalConversations(loadLocalConversations().filter((c) => c.conversationId !== id))
      deleteLocalMessages(id)
    }
    set((state) => ({
      conversations: state.conversations.filter((c) => c.conversationId !== id),
      favConversations: state.favConversations.filter((c) => c.conversationId !== id),
      activeConversationId:
        state.activeConversationId === id ? null : state.activeConversationId,
      messages: state.activeConversationId === id ? [] : state.messages
    }))
  },

  renameConversation: async (id: string, title: string) => {
    if (!isLocal()) {
      await apiClient.updateConversation(id, { title })
    } else {
      saveLocalConversations(
        loadLocalConversations().map((c) => (c.conversationId === id ? { ...c, title } : c))
      )
    }
    const updateList = (list: Conversation[]) =>
      list.map((c) => (c.conversationId === id ? { ...c, title } : c))
    set((state) => ({
      conversations: updateList(state.conversations),
      favConversations: updateList(state.favConversations)
    }))
  },

  toggleFavorite: async (id: string) => {
    const allConvs = [...get().conversations, ...get().favConversations]
    const conv = allConvs.find((c) => c.conversationId === id)
    if (!conv) return
    const newFavorited = !conv.favorited
    if (!isLocal()) {
      await apiClient.updateConversation(id, { favorited: newFavorited })
      await get().fetchFavConversations()
      await get().fetchConversations()
    } else {
      // Local mode: update in-memory lists and persist
      const updateConv = (c: Conversation) =>
        c.conversationId === id ? { ...c, favorited: newFavorited } : c
      saveLocalConversations(loadLocalConversations().map(updateConv))
      if (newFavorited) {
        set((state) => ({
          conversations: state.conversations.filter((c) => c.conversationId !== id),
          favConversations: [updateConv(conv), ...state.favConversations]
        }))
      } else {
        set((state) => ({
          favConversations: state.favConversations.filter((c) => c.conversationId !== id),
          conversations: [updateConv(conv), ...state.conversations]
        }))
      }
    }
  },

  selectConversation: async (id: string) => {
    set({
      activeConversationId: id,
      messages: [],
      toolApprovalMode: 'auto-approve-safe' as ToolApprovalMode,
      pendingToolCalls: [],
      agentPhase: 'idle' as AgentPhase,
      agentToolHistory: []
    })
    if (isLocal()) {
      // In local mode: load messages from localStorage
      set({ messages: loadLocalMessages(id) })
      return
    }
    try {
      const result = await apiClient.getConversation(id)
      set({ messages: result.messages || [] })
      const msgs = result.messages || []
      const lastAssistant = [...msgs]
        .reverse()
        .find((m) => m.role === 'assistant' && m.modelId)
      const modelId = result.conversation?.modelId || lastAssistant?.modelId
      if (modelId) {
        const { builtinModels, localModels } = useAIModelStore.getState()
        const builtin = builtinModels.find((m) => m.id === modelId)
        if (builtin) {
          useAIModelStore.getState().selectModel(modelId, 'builtin')
        } else {
          for (const config of localModels) {
            if (config.models.includes(modelId)) {
              useAIModelStore.getState().selectModel(modelId, 'local', config.id)
              break
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to load conversation:', err)
    }
  },

  clearActiveConversation: () => {
    set({ activeConversationId: null, messages: [], pendingToolCalls: [] })
  },

  deleteMessages: async (messageId, mode) => {
    const { activeConversationId, messages } = get()
    if (!activeConversationId) return

    if (isLocal()) {
      if (mode === 'from-here') {
        const idx = messages.findIndex((m) => m.messageId === messageId)
        if (idx >= 0) {
          const updated = messages.slice(0, idx)
          set({ messages: updated })
          saveLocalMessages(activeConversationId, updated)
        }
      } else {
        const updated = messages.filter((m) => m.messageId !== messageId)
        set({ messages: updated })
        saveLocalMessages(activeConversationId, updated)
      }
    } else {
      try {
        await apiClient.deleteMessage(activeConversationId, messageId, mode)
        if (mode === 'from-here') {
          const idx = messages.findIndex((m) => m.messageId === messageId)
          if (idx >= 0) set({ messages: messages.slice(0, idx) })
        } else {
          set({ messages: messages.filter((m) => m.messageId !== messageId) })
        }
      } catch (err) {
        console.error('Failed to delete messages:', err)
      }
    }
  },

  editAndResend: async (messageId, newContent) => {
    const { messages, activeConversationId } = get()
    if (!activeConversationId) return

    const idx = messages.findIndex((m) => m.messageId === messageId)
    if (idx < 0) return

    // Delete from this message onwards
    await get().deleteMessages(messageId, 'from-here')

    // Re-send with new content using current model selection
    const { selectedModelId, selectedModelSource, selectedLocalConfigId } = useAIModelStore.getState()
    if (!selectedModelId) return

    const { toolsEnabled, webSearchEnabled, feishuKitsEnabled } = get()
    const enableThinking = useSettingsStore.getState().aiToolsConfig?.toolBehavior?.enableThinking
    await get().sendMessage(
      newContent,
      selectedModelSource,
      selectedModelId,
      selectedLocalConfigId || undefined,
      undefined,
      enableThinking,
      webSearchEnabled,
      feishuKitsEnabled
    )
  },

  regenerateFromMessage: async (messageId) => {
    const { messages, activeConversationId } = get()
    if (!activeConversationId) return

    const idx = messages.findIndex((m) => m.messageId === messageId)
    if (idx < 0 || messages[idx].role !== 'user') return

    const userContent = messages[idx].content

    // Delete the AI reply after this user message (and everything after)
    const nextIdx = idx + 1
    if (nextIdx < messages.length) {
      await get().deleteMessages(messages[nextIdx].messageId, 'from-here')
    }

    // Re-send the same user message
    const { selectedModelId, selectedModelSource, selectedLocalConfigId } = useAIModelStore.getState()
    if (!selectedModelId) return

    // Remove the user message too, sendMessage will re-create it
    const updatedMessages = messages.slice(0, idx)
    set({ messages: updatedMessages })
    if (isLocal()) saveLocalMessages(activeConversationId, updatedMessages)

    const { toolsEnabled, webSearchEnabled, feishuKitsEnabled } = get()
    const enableThinking = useSettingsStore.getState().aiToolsConfig?.toolBehavior?.enableThinking
    await get().sendMessage(
      userContent,
      selectedModelSource,
      selectedModelId,
      selectedLocalConfigId || undefined,
      undefined,
      enableThinking,
      webSearchEnabled,
      feishuKitsEnabled
    )
  },

  sendMessage: async (content, modelSource, modelId, modelConfigId, pendingFiles, enableThinking, webSearchEnabled, feishuKitsEnabled) => {
    const { activeConversationId, toolsEnabled } = get()
    if (!activeConversationId) return

    set({ streamingError: null, pendingToolCalls: [], searchSources: [], agentPhase: 'thinking' as AgentPhase, agentStepDescription: '', agentToolHistory: [] })

    // Create tool loop controller for this message cycle
    const cfg = useSettingsStore.getState().aiToolsConfig?.toolBehavior
    let maxToolSteps = 15
    try {
      const agentSettings = await window.api.settings.getAgentSettings()
      maxToolSteps = agentSettings?.maxAgentToolSteps ?? 15
    } catch { /* ignore */ }
    const toolLoopController = new ToolLoopController({
      maxSteps: maxToolSteps,
      maxDuplicates: 3,
      wallClockTimeoutMs: 120000
    })
    set({ toolLoopController })
    set({ webSearchEnabled: !!webSearchEnabled, feishuKitsEnabled: !!feishuKitsEnabled })

    // Upload files first (if any) — skip in local mode
    let uploadedAttachments: ChatAttachment[] = []
    if (pendingFiles && pendingFiles.length > 0 && !isLocal()) {
      try {
        const uploadPromises = pendingFiles.map((pf) =>
          apiClient.uploadChatAttachment(activeConversationId, pf.file)
        )
        uploadedAttachments = await Promise.all(uploadPromises)
      } catch (err: any) {
        const errMsg = err?.message || getT()('chat.uploadFailed')
        set({ streamingError: errMsg })
        throw err
      }
    }

    // Save user message
    let userMsg: Message
    if (isLocal()) {
      userMsg = {
        messageId: localId('msg'),
        conversationId: activeConversationId,
        role: 'user',
        content,
        modelId: null,
        createdAt: Date.now()
      }
    } else {
      try {
        userMsg = await apiClient.sendMessage(activeConversationId, { role: 'user', content })
      } catch (err: any) {
        const errMsg = err?.message || getT()('chat.sendFailedMsg')
        set({ streamingError: errMsg })
        throw err
      }
    }

    // Link uploaded attachments to the user message
    const attachmentIds = uploadedAttachments.map((a) => a.attachmentId)
    if (attachmentIds.length > 0 && !isLocal()) {
      try {
        await apiClient.linkAttachments(attachmentIds, userMsg.messageId)
      } catch (err) {
        console.error('Failed to link attachments:', err)
      }
      userMsg = { ...userMsg, attachments: uploadedAttachments }
    }

    set((state) => ({
      messages: [...state.messages, userMsg],
      streaming: true,
      streamingContent: '',
      streamingThinkingContent: '',
      streamStartTime: Date.now()
    }))

    // Persist user message immediately in local mode
    if (isLocal()) {
      saveLocalMessages(activeConversationId, get().messages)
    }

    // Get tools if enabled
    let tools: Array<{ name: string; description: string; inputSchema: Record<string, any> }> | undefined
    if (toolsEnabled || webSearchEnabled) {
      try {
        tools = await getAvailableTools(webSearchEnabled, feishuKitsEnabled)
        if (tools.length === 0) tools = undefined
      } catch {
        tools = undefined
      }
    }

    if (modelSource === 'builtin') {
      await streamBuiltin(modelId, activeConversationId, attachmentIds, tools, enableThinking, webSearchEnabled)
    } else {
      await streamLocal(modelConfigId!, modelId, pendingFiles, tools, enableThinking, webSearchEnabled)
    }
  },

  appendStreamingContent: (content: string) => {
    set((state) => ({ streamingContent: state.streamingContent + content }))
  },

  finalizeStreaming: (fullContent: string, modelId: string, thinkingContent?: string, usage?: { promptTokens: number; completionTokens: number }) => {
    const conversationId = get().activeConversationId || ''
    const isFirstExchange =
      get().messages.filter((m) => m.role === 'user').length === 1 &&
      get().messages.filter((m) => m.role === 'assistant').length === 0
    const userContent = get().messages.find((m) => m.role === 'user')?.content || ''

    const { streamStartTime, searchSources } = get()
    const durationMs = streamStartTime ? Date.now() - streamStartTime : undefined
    const tokenCount = usage?.completionTokens

    const metadata: import('../types/chat').MessageMetadata = {
      ...(searchSources.length > 0 ? { searchSources } : {}),
      ...(tokenCount ? { tokenCount } : {}),
      ...(durationMs ? { durationMs } : {}),
    }

    const assistantMsg: Message = {
      messageId: 'temp-' + Date.now(),
      conversationId,
      role: 'assistant',
      content: fullContent,
      modelId,
      thinkingContent: thinkingContent || undefined,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      createdAt: Date.now()
    }
    set((state) => ({
      messages: [...state.messages, assistantMsg],
      streaming: false,
      streamingContent: '',
      streamingThinkingContent: '',
      streamingTaskId: null,
      searchSources: [],
      agentPhase: 'idle' as AgentPhase,
      agentStepDescription: '',
      // Update the conversation's modelId so the sidebar shows the correct provider icon
      conversations: state.conversations.map((c) =>
        c.conversationId === conversationId ? { ...c, modelId: modelId, updatedAt: Date.now() } : c
      )
    }))
    // Persist assistant message to backend (fire-and-forget) — skip in local mode
    if (conversationId && !isLocal()) {
      apiClient
        .sendMessage(conversationId, { role: 'assistant', content: fullContent, modelId, metadata: assistantMsg.metadata })
        .then((saved) => {
          set((state) => ({
            messages: state.messages.map((m) =>
              m.messageId === assistantMsg.messageId
                ? { ...saved, metadata: m.metadata, thinkingContent: m.thinkingContent }
                : m
            )
          }))
        })
        .catch((err) => console.error('Failed to save assistant message:', err))
    } else if (conversationId && isLocal()) {
      // Persist messages to localStorage
      const allMsgs = get().messages
      saveLocalMessages(conversationId, allMsgs)
      // Update conversation updatedAt
      saveLocalConversations(
        loadLocalConversations().map((c) =>
          c.conversationId === conversationId ? { ...c, modelId: modelId, updatedAt: Date.now() } : c
        )
      )
    }

    // Auto-generate title after first exchange
    if (isFirstExchange && conversationId) {
      const { selectedModelSource, selectedModelConfigId } = useAIModelStore.getState()
      const titleMessages = [
        { role: 'user', content: userContent },
        { role: 'assistant', content: fullContent.substring(0, 500) }
      ]

      const updateTitle = (title: string) => {
        const updateList = (list: Conversation[]) =>
          list.map((c) => (c.conversationId === conversationId ? { ...c, title } : c))
        set((state) => ({
          conversations: updateList(state.conversations),
          favConversations: updateList(state.favConversations)
        }))
        if (isLocal()) {
          saveLocalConversations(
            loadLocalConversations().map((c) =>
              c.conversationId === conversationId ? { ...c, title } : c
            )
          )
        }
      }

      if (selectedModelSource === 'builtin' && !isLocal()) {
        apiClient
          .generateTitle(modelId, titleMessages, conversationId)
          .then((title) => {
            if (title) updateTitle(title)
          })
          .catch((err) => console.error('Failed to generate title:', err))
      } else if (selectedModelConfigId) {
        window.api.ai
          .generateTitle(selectedModelConfigId, titleMessages, modelId)
          .then((title) => {
            if (title) {
              updateTitle(title)
              if (!isLocal()) {
                apiClient.updateConversation(conversationId, { title }).catch(() => {})
              }
            }
          })
          .catch((err) => console.error('Failed to generate title:', err))
      }
    }
  },

  setStreamingError: (error: string) => {
    console.error('Streaming error:', error)
    set({
      streaming: false,
      streamingContent: '',
      streamingThinkingContent: '',
      streamingTaskId: null,
      streamingError: error,
      agentPhase: 'idle' as AgentPhase,
      agentStepDescription: ''
    })
  },

  cancelStreaming: () => {
    const { streamingTaskId } = get()
    if (streamingTaskId) {
      window.api.ai.cancelChat(streamingTaskId)
    }
    set({ streaming: false, streamingContent: '', streamingThinkingContent: '', streamingTaskId: null, streamStartTime: null, pendingToolCalls: [], agentPhase: 'idle' as AgentPhase, agentStepDescription: '', agentToolHistory: [] })
  },

  setToolApprovalMode: (mode: ToolApprovalMode) => {
    set({ toolApprovalMode: mode })
  },

  setToolsEnabled: (enabled: boolean) => {
    set({ toolsEnabled: enabled })
    window.api.settings.setChatPreferences({ toolsEnabled: enabled }).catch(() => {})
  },

  approveToolCall: async (toolCallId: string) => {
    const { pendingToolCalls, messages, activeConversationId } = get()
    const tc = pendingToolCalls.find((t) => t.toolCallId === toolCallId)
    if (!tc || !activeConversationId) return

    // Remove from pending
    set((state) => ({
      pendingToolCalls: state.pendingToolCalls.filter((t) => t.toolCallId !== toolCallId),
      streaming: true,
      streamingContent: ''
    }))

    // Add assistant message with tool call (if there was streamed content or tool call info)
    const assistantMsg: Message = {
      messageId: 'tc-assistant-' + Date.now(),
      conversationId: activeConversationId,
      role: 'assistant',
      content: tc.streamedContent || '',
      modelId: null,
      metadata: {
        toolCalls: [
          {
            id: tc.toolCallId,
            name: tc.toolName,
            input: tc.input,
            status: 'approved'
          }
        ]
      },
      createdAt: Date.now()
    }

    set((state) => ({
      messages: [...state.messages, assistantMsg]
    }))

    // Check tool loop control
    const controller = get().toolLoopController
    if (controller) {
      const check = controller.canExecute(tc.toolName, tc.input)
      if (!check.allowed) {
        // Update the tool call status to show it was skipped
        const skippedToolCall: ToolCall = {
          id: tc.toolCallId,
          name: tc.toolName,
          input: tc.input,
          status: 'error',
          output: check.reason || '工具调用已跳过',
          error: check.reason
        }
        set((state) => ({
          messages: state.messages.map((m) =>
            m.messageId === assistantMsg.messageId
              ? { ...m, metadata: { toolCalls: [skippedToolCall] } }
              : m
          )
        }))

        // Continue the conversation — tell the model to summarize with existing results
        const { selectedModelSource, selectedModelId, selectedModelConfigId } =
          useAIModelStore.getState()
        const modelId = selectedModelId || ''

        // Build history from all messages, inlining tool call outputs into text
        const allMessages = get().messages
        const historyForAI: Array<{ role: 'user' | 'assistant'; content: string }> = []
        for (const m of allMessages) {
          const role = m.role === 'assistant' ? 'assistant' as const : 'user' as const
          let content = m.content || ''

          // Inline tool call results into assistant message text
          if (m.metadata?.toolCalls && m.metadata.toolCalls.length > 0) {
            const toolTexts = m.metadata.toolCalls
              .filter((tc) => tc.output)
              .map((tc) => `[工具: ${tc.name}${tc.input?.query ? ` "${tc.input.query}"` : tc.input?.url ? ` ${tc.input.url}` : ''}]\n${tc.output}`)
            if (toolTexts.length > 0) {
              content = (content ? content + '\n\n' : '') + toolTexts.join('\n\n')
            }
          }

          // Skip empty messages
          if (!content.trim()) continue
          historyForAI.push({ role, content })
        }
        // Append a user instruction to summarize
        historyForAI.push({
          role: 'user' as const,
          content: `[系统提示：${check.reason}，搜索阶段已结束] 请基于前面已获取的所有搜索结果和网页内容，直接回答用户最初的问题。不要再调用任何工具。`
        })

        // Continue WITHOUT tools — force the model to answer
        if (selectedModelSource === 'builtin') {
          await streamBuiltinWithMessages(modelId, activeConversationId, historyForAI)
        } else {
          await streamLocalWithMessages(selectedModelConfigId!, modelId, historyForAI)
        }
        return
      }
    }

    // Execute the tool
    try {
      const result = await executeToolCall(tc.toolName, tc.input)
      // Record tool execution for loop control
      get().toolLoopController?.recordExecution(tc.toolName, tc.input)

      // Update agent tool history with completion
      set((state) => ({
        agentToolHistory: state.agentToolHistory.map((h) =>
          h.id === tc.toolCallId
            ? { ...h, status: (result.isError ? 'error' : 'completed') as 'completed' | 'error', output: result.output, endTime: Date.now() }
            : h
        )
      }))

      // Collect search sources from web_search / web_browse results
      if (!result.isError && result.output) {
        if (tc.toolName === 'web_search') {
          const sources = parseSearchSources(result.output)
          if (sources.length > 0) {
            set((state) => ({ searchSources: [...state.searchSources, ...sources] }))
          }
        } else if (tc.toolName === 'web_browse') {
          const source = parseBrowseSource(result.output, tc.input.url)
          if (source) {
            set((state) => ({ searchSources: [...state.searchSources, source] }))
          }
        }
      }

      // Update the tool call status
      const completedToolCall: ToolCall = {
        id: tc.toolCallId,
        name: tc.toolName,
        input: tc.input,
        status: result.isError ? 'error' : 'completed',
        output: result.output,
        error: result.isError ? result.output : undefined
      }

      set((state) => ({
        messages: state.messages.map((m) =>
          m.messageId === assistantMsg.messageId
            ? {
                ...m,
                metadata: { toolCalls: [completedToolCall] }
              }
            : m
        )
      }))

      // Persist tool call message to backend (fire-and-forget)
      if (!isLocal()) {
        const toolMeta = { toolCalls: [completedToolCall] }
        apiClient
          .sendMessage(activeConversationId, {
            role: 'assistant',
            content: tc.streamedContent || '',
            metadata: toolMeta
          })
          .then((saved) => {
            set((state) => ({
              messages: state.messages.map((m) =>
                m.messageId === assistantMsg.messageId
                  ? { ...saved, metadata: m.metadata }
                  : m
              )
            }))
          })
          .catch(() => {})
      }

      // Continue the conversation with tool result
      set({ agentPhase: 'thinking' as AgentPhase, agentStepDescription: '' })
      const { selectedModelSource, selectedModelId, selectedModelConfigId } =
        useAIModelStore.getState()
      const modelId = selectedModelId || ''
      const modelSource = selectedModelSource

      // Build messages for the next round (include tool call + result)
      const allMessages = get().messages
      const historyForAI = allMessages.map((m) => {
        if (m.messageId === assistantMsg.messageId) {
          return {
            role: 'assistant' as const,
            content: m.content,
            toolCalls: [
              { id: tc.toolCallId, name: tc.toolName, input: tc.input }
            ]
          }
        }
        return { role: m.role, content: m.content }
      })
      // Add tool result
      historyForAI.push({
        role: 'tool' as any,
        content: result.output || '',
        toolCallId: tc.toolCallId
      } as any)

      // Get tools for continuation
      let tools:
        | Array<{ name: string; description: string; inputSchema: Record<string, any> }>
        | undefined
      if (get().toolsEnabled || get().webSearchEnabled) {
        try {
          tools = await getAvailableTools(get().webSearchEnabled, get().feishuKitsEnabled)
          if (tools.length === 0) tools = undefined
        } catch {
          tools = undefined
        }
      }

      if (modelSource === 'builtin') {
        // SSE continuation with tool result
        await streamBuiltinWithMessages(modelId, activeConversationId, historyForAI, tools)
      } else {
        // IPC continuation with tool result
        await streamLocalWithMessages(
          selectedModelConfigId!,
          modelId,
          historyForAI,
          tools
        )
      }
    } catch (err: any) {
      get().setStreamingError(err.message || 'Tool execution failed')
    }
  },

  rejectToolCall: (toolCallId: string) => {
    const { pendingToolCalls, activeConversationId } = get()
    const tc = pendingToolCalls.find((t) => t.toolCallId === toolCallId)
    if (!tc || !activeConversationId) return

    // Add assistant message with rejected tool call
    const assistantMsg: Message = {
      messageId: 'tc-rejected-' + Date.now(),
      conversationId: activeConversationId,
      role: 'assistant',
      content: tc.streamedContent || '',
      modelId: null,
      metadata: {
        toolCalls: [
          {
            id: tc.toolCallId,
            name: tc.toolName,
            input: tc.input,
            status: 'rejected'
          }
        ]
      },
      createdAt: Date.now()
    }

    set((state) => ({
      pendingToolCalls: state.pendingToolCalls.filter((t) => t.toolCallId !== toolCallId),
      messages: [...state.messages, assistantMsg],
      streaming: false,
      streamingContent: ''
    }))
  },

  exportConversation: (id: string, format: 'markdown' | 'json') => {
    const allConvs = [...get().conversations, ...get().favConversations]
    const conv = allConvs.find((c) => c.conversationId === id)
    const msgs = get().activeConversationId === id ? get().messages : []

    let content: string
    let fileName: string
    const title = conv?.title || getT()('chat.exportTitle')

    if (format === 'markdown') {
      content = `# ${title}\n\n`
      msgs.forEach((m) => {
        const roleLabel = m.role === 'user' ? getT()('chat.roleUser') : m.role === 'assistant' ? getT()('chat.roleAssistant') : getT()('chat.roleSystem')
        content += `## ${roleLabel}\n\n${m.content}\n\n`
      })
      fileName = `${title}.md`
    } else {
      content = JSON.stringify({ conversation: conv, messages: msgs }, null, 2)
      fileName = `${title}.json`
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  },

  prefillInput: null,
  setPrefillInput: (text) => set({ prefillInput: text })
}))

// ============ Streaming helper functions ============

/**
 * Handle tool_use from SSE data
 */
function handleSSEToolUse(
  data: { toolCall: { id: string; name: string; input: Record<string, any> } },
  fullContent: string
): void {
  const state = useChatStore.getState()
  const tc = data.toolCall

  const pending: PendingToolCall = {
    toolCallId: tc.id,
    toolName: tc.name,
    input: tc.input,
    streamedContent: fullContent
  }

  // Update agent phase
  const toolDescription = tc.name === 'web_search' ? `Searching: ${tc.input.query || ''}`
    : tc.name === 'web_browse' ? `Browsing: ${tc.input.url || ''}`
    : tc.name === 'plan_search' ? 'Planning search strategy'
    : tc.name === 'generate_image' ? 'Generating image'
    : tc.name === 'execute_command' ? `Running: ${tc.input.command || ''}`
    : `Calling: ${tc.name}`

  // Add to agent tool history
  const historyEntry: AgentToolHistoryEntry = {
    id: tc.id,
    name: tc.name,
    input: tc.input,
    status: 'running',
    startTime: Date.now()
  }

  useChatStore.setState((s) => ({
    agentPhase: 'calling-tools' as AgentPhase,
    agentStepDescription: toolDescription,
    agentToolHistory: [...s.agentToolHistory, historyEntry]
  }))

  // Determine if we should auto-execute
  const shouldAutoExecute = state.toolApprovalMode === 'auto-approve-session'
    || (state.toolApprovalMode === 'auto-approve-safe' && isSafeTool(tc.name))

  if (shouldAutoExecute) {
    useChatStore.setState((s) => ({
      pendingToolCalls: [...s.pendingToolCalls, pending],
      streaming: false
    }))
    setTimeout(() => useChatStore.getState().approveToolCall(tc.id), 0)
  } else {
    useChatStore.setState((s) => ({
      pendingToolCalls: [...s.pendingToolCalls, pending],
      streaming: false,
      streamingContent: ''
    }))
  }
}

/**
 * Load agent memory files for system prompt injection.
 */
async function loadAgentMemory(): Promise<AgentMemoryContext> {
  try {
    const [soul, memory, user, agents, statsSnippet] = await Promise.all([
      window.api.agent.readMemory('soul.md'),
      window.api.agent.readMemory('memory.md'),
      window.api.agent.readMemory('user.md'),
      window.api.agent.readMemory('agents.md'),
      window.api.agent.statsSnippet(),
    ])
    return { soul, memory, user, agents, statsSnippet }
  } catch {
    return {}
  }
}

/**
 * Backend SSE streaming (initial call)
 */
async function streamBuiltin(
  modelId: string,
  conversationId: string,
  attachmentIds: string[],
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, any> }>,
  enableThinking?: boolean,
  webSearchEnabled?: boolean
): Promise<void> {
  const messages = useChatStore
    .getState()
    .messages.map((m) => ({ role: m.role, content: m.content }))

  // Build dynamic system prompt
  let customPrompt = ''
  try {
    const agentSettings = await window.api.settings.getAgentSettings()
    customPrompt = agentSettings?.customSystemPrompt || ''
  } catch { /* ignore */ }

  const agentMemory = await loadAgentMemory()
  const allToolNames: string[] = tools ? tools.map((t) => t.name) : []
  const lang = useSettingsStore.getState().language || 'zh-CN'
  const systemPrompt = buildSystemPrompt({
    currentTime: new Date().toLocaleString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: window.api.platform || 'unknown',
    language: lang,
    availableTools: allToolNames,
    webSearchEnabled: !!webSearchEnabled,
    userCustomPrompt: customPrompt,
    agentMemory
  })
  messages.unshift({ role: 'system', content: systemPrompt })

  await streamBuiltinWithMessages(modelId, conversationId, messages, tools, attachmentIds, enableThinking, webSearchEnabled)
}

/**
 * Backend SSE streaming with explicit messages
 */
async function streamBuiltinWithMessages(
  modelId: string,
  conversationId: string,
  messages: Array<any>,
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, any> }>,
  attachmentIds?: string[],
  enableThinking?: boolean,
  webSearchEnabled?: boolean
): Promise<void> {
  try {
    const token = apiClient.getToken()
    const response = await fetch(`${API_BASE_URL}/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        modelId,
        messages,
        conversationId,
        attachmentIds: attachmentIds && attachmentIds.length > 0 ? attachmentIds : undefined,
        tools,
        enableThinking,
        webSearchEnabled
      })
    })

    if (!response.ok) throw new Error('Stream request failed')

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let fullThinkingContent = ''

    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        const lines = text.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'thinking_delta' && data.content) {
                fullThinkingContent += data.content
                flushSync(() => {
                  useChatStore.setState({ streamingThinkingContent: fullThinkingContent })
                })
              } else if (data.type === 'delta' && data.content) {
                fullContent += data.content
                flushSync(() => {
                  useChatStore.setState({ streamingContent: fullContent })
                })
              } else if (data.type === 'done') {
                useChatStore.getState().finalizeStreaming(fullContent, modelId, fullThinkingContent || undefined, data.usage)
              } else if (data.type === 'error') {
                useChatStore.getState().setStreamingError(data.message)
              } else if (data.type === 'tool_use' && data.toolCall) {
                handleSSEToolUse(data, fullContent)
                return
              } else if (data.type === 'search_grounding' && data.sources) {
                // Collect grounding sources from backend Gemini native search
                const sources: SearchSource[] = (data.sources as Array<{ title: string; url: string }>).map((s) => ({
                  title: s.title,
                  url: s.url
                }))
                if (sources.length > 0) {
                  useChatStore.setState((state) => ({
                    searchSources: [...state.searchSources, ...sources]
                  }))
                }
              }
            } catch {
              // ignore non-JSON SSE lines
            }
          }
        }
      }
    }
  } catch (err: any) {
    useChatStore.getState().setStreamingError(err.message || 'Stream failed')
  }
}

/**
 * IPC streaming (initial call)
 */
async function streamLocal(
  modelConfigId: string,
  modelId: string,
  pendingFiles?: PendingAttachment[],
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, any> }>,
  enableThinking?: boolean,
  webSearchEnabled?: boolean
): Promise<void> {
  const messages = useChatStore
    .getState()
    .messages.map((m) => ({ role: m.role, content: m.content }))

  // Build dynamic system prompt
  let customPrompt = ''
  try {
    const agentSettings = await window.api.settings.getAgentSettings()
    customPrompt = agentSettings?.customSystemPrompt || ''
  } catch { /* ignore */ }

  const agentMemory = await loadAgentMemory()
  const allToolNames: string[] = tools ? tools.map((t) => t.name) : []
  const lang = useSettingsStore.getState().language || 'zh-CN'
  const systemPrompt = buildSystemPrompt({
    currentTime: new Date().toLocaleString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: window.api.platform || 'unknown',
    language: lang,
    availableTools: allToolNames,
    webSearchEnabled: !!webSearchEnabled,
    userCustomPrompt: customPrompt,
    agentMemory
  })
  messages.unshift({ role: 'system', content: systemPrompt })

  const ipcAttachments =
    pendingFiles && pendingFiles.length > 0
      ? pendingFiles.map((pf) => ({
          filePath: (pf.file as any).path as string,
          mimeType: pf.file.type,
          fileName: pf.file.name
        }))
      : undefined

  await streamLocalWithMessages(modelConfigId, modelId, messages, tools, ipcAttachments, enableThinking, webSearchEnabled)
}

/**
 * IPC streaming with explicit messages
 */
async function streamLocalWithMessages(
  modelConfigId: string,
  modelId: string,
  messages: Array<any>,
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, any> }>,
  attachments?: Array<{ filePath: string; mimeType: string; fileName: string }>,
  enableThinking?: boolean,
  webSearchEnabled?: boolean
): Promise<void> {
  try {
    const taskId = await window.api.ai.streamChat(
      modelConfigId,
      messages,
      modelId,
      attachments,
      tools,
      enableThinking,
      webSearchEnabled
    )
    useChatStore.setState({ streamingTaskId: taskId })

    let fullContent = ''
    let fullThinkingContent = ''

    const cleanupDelta = window.api.ai.onChatDelta((data) => {
      if (data.taskId === taskId) {
        fullContent += data.content
        flushSync(() => {
          useChatStore.setState({ streamingContent: fullContent })
        })
      }
    })
    const cleanupThinking = window.api.ai.onChatThinkingDelta((data) => {
      if (data.taskId === taskId) {
        fullThinkingContent += data.content
        flushSync(() => {
          useChatStore.setState({ streamingThinkingContent: fullThinkingContent })
        })
      }
    })
    const cleanupDone = window.api.ai.onChatDone((data) => {
      if (data.taskId === taskId) {
        useChatStore.getState().finalizeStreaming(fullContent, modelId, fullThinkingContent || undefined, data.usage)
        cleanup()
      }
    })
    const cleanupError = window.api.ai.onChatError((data) => {
      if (data.taskId === taskId) {
        useChatStore.getState().setStreamingError(data.error)
        cleanup()
      }
    })
    const cleanupToolUse = window.api.ai.onChatToolUse((data) => {
      if (data.taskId === taskId) {
        handleSSEToolUse(
          { toolCall: { id: data.toolCallId, name: data.toolName, input: data.input } },
          fullContent
        )
        cleanup()
      }
    })
    const cleanupSearchGrounding = window.api.ai.onChatSearchGrounding((data) => {
      if (data.taskId === taskId) {
        // Collect grounding sources from Gemini native search
        const sources: SearchSource[] = data.sources.map((s) => ({
          title: s.title,
          url: s.url
        }))
        if (sources.length > 0) {
          useChatStore.setState((state) => ({
            searchSources: [...state.searchSources, ...sources]
          }))
        }
      }
    })

    function cleanup() {
      cleanupDelta()
      cleanupThinking()
      cleanupDone()
      cleanupError()
      cleanupToolUse()
      cleanupSearchGrounding()
    }
  } catch (err: any) {
    useChatStore.getState().setStreamingError(err.message || 'Stream failed')
  }
}
