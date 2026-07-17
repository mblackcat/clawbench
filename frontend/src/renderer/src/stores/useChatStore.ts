import { create } from 'zustand'
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

/** True when stream events should update the live chat UI (user still on that conversation). */
function isStreamUiActive(taskId?: string | null): boolean {
  const s = useChatStore.getState()
  if (taskId && s.streamingTaskId && taskId !== s.streamingTaskId) return false
  if (!s.streamingConversationId) return false
  return s.activeConversationId === s.streamingConversationId
}

/** Read a File as a base64 data URI (for session-only attachment previews). */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
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

/** IM conversation ids are prefixed so they never clash with local/backend ids */
export const IM_CONV_PREFIX = 'im:'

export function isImConversationId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(IM_CONV_PREFIX)
}

export function toImConversationId(rawId: string): string {
  return rawId.startsWith(IM_CONV_PREFIX) ? rawId : `${IM_CONV_PREFIX}${rawId}`
}

export function fromImConversationId(id: string): string {
  return id.startsWith(IM_CONV_PREFIX) ? id.slice(IM_CONV_PREFIX.length) : id
}

function buildSnippetsFromMessages(
  messages: Array<{ role: string; content: string }>
): string[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-8)
    .map((m) => `${m.role}: ${String(m.content || '').slice(0, 400)}`)
}

/** Push one conversation digest to main process for memory self-update */
async function pushDigestForConversation(
  conv: Conversation,
  messages: Array<{ role: string; content: string }>
): Promise<void> {
  if (isImConversationId(conv.conversationId)) return
  const snippets = buildSnippetsFromMessages(messages)
  if (snippets.length === 0) return
  try {
    await window.api.agent.pushChatDigest({
      conversationId: conv.conversationId,
      title: conv.title || 'Chat',
      source: isLocal() ? 'local-chat' : 'backend-chat',
      updatedAt: conv.updatedAt || Date.now(),
      snippets,
    })
  } catch (err) {
    console.debug('pushChatDigest failed:', err)
  }
}

/** Bulk sync local-mode digests (called when opening AI Chat) */
async function syncLocalChatDigests(): Promise<void> {
  if (!isLocal()) return
  try {
    const convs = loadLocalConversations()
    const entries = convs.slice(0, 30).map((c) => {
      const msgs = loadLocalMessages(c.conversationId)
      return {
        conversationId: c.conversationId,
        title: c.title || 'Chat',
        source: 'local-chat',
        updatedAt: c.updatedAt || Date.now(),
        snippets: buildSnippetsFromMessages(msgs),
      }
    }).filter((e) => e.snippets.length > 0)
    if (entries.length > 0) {
      await window.api.agent.replaceChatDigests(entries)
    }
  } catch (err) {
    console.debug('syncLocalChatDigests failed:', err)
  }
}

// ============ Search source parsers ============

/** Parse search results output into SearchSource[] (legacy URL: lines + markdown links) */
function parseSearchSources(output: string): SearchSource[] {
  const sources: SearchSource[] = []
  // Legacy: [N] Title\n    URL: https://...\n    snippet
  const legacy = /\[\d+\]\s+(.+)\n\s+URL:\s+(https?:\/\/\S+)\n\s+(.*)/g
  let match: RegExpExecArray | null
  while ((match = legacy.exec(output)) !== null) {
    sources.push({
      title: match[1].trim(),
      url: match[2].trim(),
      snippet: match[3].trim()
    })
  }
  if (sources.length > 0) return sources

  // Claude Code–style: 1. [Title](https://...)\n   snippet
  const md = /(\d+)\.\s+\[([^\]]+)\]\((https?:\/\/[^)]+)\)\n?\s*(.*)/g
  while ((match = md.exec(output)) !== null) {
    sources.push({
      title: match[2].trim(),
      url: match[3].trim(),
      snippet: (match[4] || '').trim()
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

/** Safe tools that can be auto-executed without user approval (mirrors main isSafe set) */
const SAFE_TOOLS = new Set([
  'web_search', 'web_browse', 'web_fetch',
  'generate_image', 'edit_image',
  'get_dev_environment',
  'list_workbench_apps', 'search_market_apps',
  'list_coding_workspaces', 'list_coding_sessions',
  'list_terminal_connections', 'list_db_connections',
  'query_database', 'read_agent_file',
  'feishu_read_doc', 'feishu_search_docs', 'feishu_search_messages',
  'feishu_list_wiki_spaces', 'feishu_sheet_read',
])

/** Builtin hybrid loop abort + approval waiters (renderer-side gate) */
let activeBuiltinAbort: AbortController | null = null
const builtinApprovalWaiters = new Map<string, (approved: boolean) => void>()

function waitBuiltinToolApproval(tc: {
  toolCallId: string
  toolName: string
  input: Record<string, any>
}): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      builtinApprovalWaiters.delete(tc.toolCallId)
      resolve(false)
    }, 300_000)
    builtinApprovalWaiters.set(tc.toolCallId, (approved) => {
      clearTimeout(timer)
      builtinApprovalWaiters.delete(tc.toolCallId)
      resolve(approved)
    })
    useChatStore.setState((s) => ({
      pendingToolCalls: [
        ...s.pendingToolCalls.filter((p) => p.toolCallId !== tc.toolCallId),
        {
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
          streamedContent: '',
        },
      ],
      agentPhase: 'calling-tools' as AgentPhase,
    }))
  })
}

function resolveBuiltinToolApproval(toolCallId: string, approved: boolean): boolean {
  const waiter = builtinApprovalWaiters.get(toolCallId)
  if (!waiter) return false
  waiter(approved)
  return true
}

/**
 * Strip ~1MB base64 image payloads from a tool result before sending it back
 * to the model. The image is already rendered in the ToolCallCard, and including
 * the raw bytes in a follow-up request can blow past HTTP/2 frame / provider
 * payload limits (observed as "stream INTERNAL_ERROR; received from peer" on
 * OpenAI Responses API gateways). The model only needs to know the call
 * succeeded plus the revised prompt, so swap the base64 for a marker.
 */
function sanitizeToolOutputForAPI(toolName: string, output: string): string {
  if (toolName !== 'generate_image' && toolName !== 'edit_image') return output
  if (!output) return output
  try {
    const parsed = JSON.parse(output)
    if (parsed && typeof parsed === 'object' && parsed.base64) {
      const { base64: _omit, ...rest } = parsed
      void _omit
      return JSON.stringify({
        ...rest,
        image_omitted: 'Image bytes were generated successfully and shown to the user; not echoed back to model to keep the request small.'
      })
    }
  } catch {
    /* not JSON — leave as-is */
  }
  return output
}

/** Whether tool may auto-run under auto-approve-safe (aligned with main agent isSafe). */
function isSafeTool(toolName: string): boolean {
  if (SAFE_TOOLS.has(toolName)) return true
  if (toolName.startsWith('list_') || toolName.startsWith('get_') || toolName.startsWith('read_')) {
    return true
  }
  if (toolName.startsWith('feishu_')) {
    return (
      toolName.includes('read') ||
      toolName.includes('search') ||
      toolName.includes('list')
    )
  }
  // Side-effect tools and MCP tools require approval under auto-approve-safe
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

  // Feishu IM agent conversation history (main process)
  imConversations: Conversation[]

  // Active conversation
  activeConversationId: string | null
  messages: Message[]
  /** True when viewing an IM history thread (read-only input) */
  activeIsIm: boolean

  // Streaming state
  streaming: boolean
  streamingContent: string
  streamingThinkingContent: string
  streamingTaskId: string | null
  /** Conversation that owns the in-flight stream (prevents sidebar switch pollution). */
  streamingConversationId: string | null
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
  // Absolute file paths of this turn's image attachments (local models only) — kept
  // around so an auto-registered MCP vision-fallback tool call can be injected with
  // the real image bytes, since the model itself can't produce them as an argument.
  currentTurnAttachmentPaths: string[]

  // Agent state
  agentPhase: AgentPhase
  agentStepDescription: string
  agentToolHistory: AgentToolHistoryEntry[]

  // Actions
  fetchFavConversations: (reset?: boolean) => Promise<void>
  loadMoreFavConversations: () => Promise<void>
  fetchConversations: (reset?: boolean) => Promise<void>
  loadMoreConversations: () => Promise<void>
  fetchImConversations: () => Promise<void>
  createConversation: (modelId?: string) => Promise<string>
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  selectConversation: (id: string) => Promise<void>
  clearActiveConversation: () => void
  /**
   * Surface a scheduled-task AI result as a conversation message pair
   * (user prompt + assistant result). Reuses `conversationId` when the task is
   * configured to keep results in one chat, otherwise creates a new conversation
   * named after the task.
   */
  appendScheduledResult: (data: {
    taskId: string
    taskName: string
    status: string
    result: string
    prompt: string
    keepInOneChat: boolean
    conversationId?: string
    modelId?: string
  }) => Promise<void>

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

  // Web tools (Claude Code–style strategy encoded in tool descriptions)
  if (webSearchEnabled) {
    const monthYear = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })
    tools.push({
      name: 'web_search',
      description:
        'Search the web for up-to-date information beyond your knowledge cutoff. ' +
        'Use for current events, latest versions/changelogs, uncertain facts. ' +
        'Skip greetings, pure math/logic, known APIs, and follow-ups already in thread. ' +
        `Current month is ${monthYear} — use this year in queries for recent docs/events. ` +
        'Prefer 2–4 focused searches. CRITICAL: end answers with a Sources: section listing markdown links [Title](URL).',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query; include current year for recent info',
          },
          maxResults: {
            type: 'number',
            description: 'Max results (default 5, max 8)',
          },
        },
        required: ['query'],
      },
    })

    tools.push({
      name: 'web_browse',
      description:
        'Fetch a URL and return readable page text (HTML→text). Use after web_search for promising links or when the user gives a URL. ' +
        'Optional prompt focuses extraction on long pages. Do not re-fetch the same path in one turn. Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Fully-formed URL to fetch' },
          prompt: {
            type: 'string',
            description: 'What to extract from the page (optional focus for long pages)',
          },
        },
        required: ['url'],
      },
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

/** MCP tools heuristically detected (by the main process) as image-recognition tools. */
async function getVisionMcpTools(): Promise<
  Array<{ name: string; description: string; inputSchema: Record<string, any> }>
> {
  try {
    const mcpTools = await window.api.mcp.listTools()
    return mcpTools
      .filter((t: any) => t.isVisionTool)
      .map((t: any) => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || {} }))
  } catch {
    return []
  }
}

/** Whether a local model config has been manually marked as natively supporting vision. */
function localModelSupportsVision(modelConfigId?: string): boolean {
  if (!modelConfigId) return false
  const cfg = useAIModelStore.getState().localModels.find((c) => c.id === modelConfigId)
  return !!cfg?.capabilities?.includes('vision')
}

/**
 * Merge in an auto-detected MCP vision tool for local models that don't natively
 * support vision, when this turn carries image attachments — even if general
 * tool-calling is switched off, otherwise the model has no way to ever "see" the
 * image at all. The model still decides for itself whether to call it.
 */
async function withVisionFallbackTools(
  tools: Array<{ name: string; description: string; inputSchema: Record<string, any> }> | undefined,
  modelSource: 'builtin' | 'local',
  modelConfigId: string | undefined,
  hasImageAttachments: boolean
): Promise<Array<{ name: string; description: string; inputSchema: Record<string, any> }> | undefined> {
  if (modelSource !== 'local' || !hasImageAttachments || localModelSupportsVision(modelConfigId)) {
    return tools
  }
  const visionTools = await getVisionMcpTools()
  if (visionTools.length === 0) return tools
  const existingNames = new Set((tools || []).map((t) => t.name))
  const toAdd = visionTools.filter((t) => !existingNames.has(t.name))
  if (toAdd.length === 0) return tools
  return [...(tools || []), ...toAdd]
}

/**
 * Execute a tool and return the result string
 */
async function executeToolCall(
  toolName: string,
  input: Record<string, any>
): Promise<{ output: string; isError: boolean }> {
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
      // Vision-fallback tool: the model decided to call it, but it cannot itself
      // produce real image bytes as an argument — inject this turn's actual
      // attachment(s) into whichever schema field looks like the image param.
      const attachmentPaths = useChatStore.getState().currentTurnAttachmentPaths
      if (mcpTool.isVisionTool && attachmentPaths.length > 0) {
        const result = await window.api.mcp.callToolWithAttachments(
          mcpTool.serverId,
          toolName,
          input,
          attachmentPaths
        )
        return { output: result.content, isError: result.isError }
      }
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

  imConversations: [],

  activeConversationId: null,
  messages: [],
  activeIsIm: false,

  streaming: false,
  streamingContent: '',
  streamingThinkingContent: '',
  streamingTaskId: null,
  streamingConversationId: null,
  streamingError: null,
  streamStartTime: null,

  toolApprovalMode: 'auto-approve-safe' as ToolApprovalMode,
  pendingToolCalls: [],
  toolsEnabled: true,
  toolLoopController: null,
  webSearchEnabled: false,
  feishuKitsEnabled: false,
  searchSources: [],
  currentTurnAttachmentPaths: [],

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
      // Push digests for memory self-update (fire-and-forget)
      syncLocalChatDigests().catch(() => {})
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

  fetchImConversations: async () => {
    try {
      const list = await window.api.aiCoding.listImConversations()
      const mapped: Conversation[] = (list || []).map((c) => ({
        conversationId: toImConversationId(c.id),
        title: c.title || 'IM Chat',
        favorited: false,
        modelId: (c as any).modelId || null,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        source: 'im' as const,
        imChatId: c.chatId,
        closedAt: c.closedAt,
        closeReason: c.closeReason,
      }))
      set({ imConversations: mapped })
    } catch (err) {
      console.error('Failed to fetch IM conversations:', err)
      set({ imConversations: [] })
    }
  },

  createConversation: async (modelId?: string) => {
    const { activeConversationId, messages, activeIsIm } = get()
    // Empty local chat can be reused; IM history is never reused as a blank draft
    if (activeConversationId && messages.length === 0 && !activeIsIm) {
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
        updatedAt: Date.now(),
        source: 'local',
      }
      saveLocalConversations([conv, ...loadLocalConversations()])
      set((state) => ({
        conversations: [conv, ...state.conversations],
        activeConversationId: id,
        messages: [],
        activeIsIm: false,
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
      activeIsIm: false,
      toolApprovalMode: 'auto-approve-safe' as ToolApprovalMode,
      pendingToolCalls: [],
      agentPhase: 'idle' as AgentPhase,
      agentToolHistory: []
    }))
    return conv.conversationId
  },

  deleteConversation: async (id: string) => {
    if (isImConversationId(id)) {
      await window.api.aiCoding.deleteImConversation(fromImConversationId(id))
      set((state) => ({
        imConversations: state.imConversations.filter((c) => c.conversationId !== id),
        activeConversationId:
          state.activeConversationId === id ? null : state.activeConversationId,
        messages: state.activeConversationId === id ? [] : state.messages,
        activeIsIm: state.activeConversationId === id ? false : state.activeIsIm,
      }))
      return
    }
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
      messages: state.activeConversationId === id ? [] : state.messages,
      activeIsIm: state.activeConversationId === id ? false : state.activeIsIm,
    }))
  },

  renameConversation: async (id: string, title: string) => {
    if (isImConversationId(id)) {
      await window.api.aiCoding.renameImConversation(fromImConversationId(id), title)
      set((state) => ({
        imConversations: state.imConversations.map((c) =>
          c.conversationId === id ? { ...c, title } : c
        ),
      }))
      return
    }
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
    // Cancel any in-flight stream so deltas/finalize cannot land on the new thread
    const prev = get()
    if (prev.streaming || prev.streamingTaskId || activeBuiltinAbort) {
      get().cancelStreaming()
    }

    set({
      activeConversationId: id,
      messages: [],
      activeIsIm: isImConversationId(id),
      streaming: false,
      streamingContent: '',
      streamingThinkingContent: '',
      streamingTaskId: null,
      streamingConversationId: null,
      streamingError: null,
      searchSources: [],
      toolApprovalMode: 'auto-approve-safe' as ToolApprovalMode,
      pendingToolCalls: [],
      agentPhase: 'idle' as AgentPhase,
      agentToolHistory: []
    })

    if (isImConversationId(id)) {
      try {
        const raw = await window.api.aiCoding.getImConversation(fromImConversationId(id))
        if (!raw) {
          set({ messages: [] })
          return
        }
        const msgs: Message[] = (raw.messages || [])
          .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
          .map((m) => ({
            messageId: m.id,
            conversationId: id,
            role: m.role as Message['role'],
            content: m.content,
            modelId: (raw as any).modelId || null,
            createdAt: m.createdAt,
          }))
        set({ messages: msgs })
      } catch (err) {
        console.error('Failed to load IM conversation:', err)
      }
      return
    }

    if (isLocal()) {
      const msgs = loadLocalMessages(id)
      set({ messages: msgs })
      const conv = loadLocalConversations().find((c) => c.conversationId === id)
      if (conv) pushDigestForConversation(conv, msgs).catch(() => {})
      return
    }
    try {
      const result = await apiClient.getConversation(id)
      const msgs = result.messages || []
      set({ messages: msgs })
      if (result.conversation) {
        pushDigestForConversation(
          {
            conversationId: id,
            title: result.conversation.title || 'Chat',
            favorited: !!result.conversation.favorited,
            modelId: result.conversation.modelId || null,
            createdAt: result.conversation.createdAt,
            updatedAt: result.conversation.updatedAt,
            source: 'cloud',
          },
          msgs
        ).catch(() => {})
      }
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
    set({ activeConversationId: null, messages: [], pendingToolCalls: [], activeIsIm: false })
  },

  appendScheduledResult: async (data) => {
    const { taskId, taskName, status, result, prompt, keepInOneChat, conversationId, modelId } = data
    try {
      // 1. Resolve the target conversation id.
      let targetId = keepInOneChat && conversationId ? conversationId : ''
      let createdNew = false
      if (!targetId) {
        if (isLocal()) {
          targetId = localId('conv')
          const conv: Conversation = {
            conversationId: targetId,
            title: taskName,
            modelId: modelId || null,
            favorited: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: 'local'
          }
          saveLocalConversations([conv, ...loadLocalConversations()])
          set((state) => ({ conversations: [conv, ...state.conversations] }))
        } else {
          const conv = await apiClient.createConversation(taskName, modelId)
          targetId = conv.conversationId
          set((state) => ({ conversations: [conv, ...state.conversations] }))
        }
        createdNew = true
        // Remember the conversation so future runs of a "keep in one chat" task append here
        if (keepInOneChat) {
          window.api.scheduledTask.update(taskId, { conversationId: targetId }).catch(() => {})
        }
      }

      if (!targetId) return

      // 2. Build the message pair.
      const assistantContent = status === 'success' ? result : `⚠️ ${result}`
      const now = Date.now()
      const userMsg: Message = {
        messageId: isLocal() ? localId('msg') : 'temp-' + now,
        conversationId: targetId,
        role: 'user',
        content: prompt,
        modelId: null,
        createdAt: now
      }
      const assistantMsg: Message = {
        messageId: isLocal() ? localId('msg') : 'temp-a-' + now,
        conversationId: targetId,
        role: 'assistant',
        content: assistantContent,
        modelId: modelId || null,
        createdAt: now + 1
      }

      // 3. Persist.
      if (isLocal()) {
        const existing = loadLocalMessages(targetId)
        const next = [...existing, userMsg, assistantMsg]
        saveLocalMessages(targetId, next)
      } else {
        const savedUser = await apiClient.sendMessage(targetId, { role: 'user', content: prompt })
        userMsg.messageId = savedUser.messageId
        const savedAssistant = await apiClient.sendMessage(targetId, {
          role: 'assistant',
          content: assistantContent,
          modelId
        })
        assistantMsg.messageId = savedAssistant.messageId
      }

      // 4. Update reactive state.
      const isActive = get().activeConversationId === targetId
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.conversationId === targetId ? { ...c, updatedAt: Date.now() } : c
        ),
        // Only splice into the visible message list if the user is currently
        // viewing this conversation; otherwise leave their view untouched.
        messages: isActive ? [...state.messages, userMsg, assistantMsg] : state.messages
      }))

      // Refresh sidebar ordering/preview if the user is viewing something else.
      if (!isActive || createdNew) {
        get().fetchConversations().catch(() => {})
      }
    } catch (err) {
      console.error('Failed to surface scheduled task result in chat:', err)
    }
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
    const { selectedModelId, selectedModelSource, selectedModelConfigId } = useAIModelStore.getState()
    if (!selectedModelId) return

    const { toolsEnabled, webSearchEnabled, feishuKitsEnabled } = get()
    const enableThinking = useSettingsStore.getState().aiToolsConfig?.toolBehavior?.enableThinking
    await get().sendMessage(
      newContent,
      selectedModelSource,
      selectedModelId,
      selectedModelConfigId || undefined,
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
    const { selectedModelId, selectedModelSource, selectedModelConfigId } = useAIModelStore.getState()
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
      selectedModelConfigId || undefined,
      undefined,
      enableThinking,
      webSearchEnabled,
      feishuKitsEnabled
    )
  },

  sendMessage: async (content, modelSource, modelId, modelConfigId, pendingFiles, enableThinking, webSearchEnabled, feishuKitsEnabled) => {
    const { activeConversationId, toolsEnabled, activeIsIm } = get()
    if (!activeConversationId) return
    // IM history is read-only in the client; continue chatting via Feishu bot
    if (activeIsIm || isImConversationId(activeConversationId)) {
      set({
        streamingError: getT()('chat.imReadOnlyHint'),
      })
      return
    }

    set({
      streamingError: null,
      pendingToolCalls: [],
      searchSources: [],
      agentPhase: 'thinking' as AgentPhase,
      agentStepDescription: '',
      agentToolHistory: [],
      // Bind stream to this conversation so sidebar switches cannot steal the reply
      streamingConversationId: activeConversationId,
      streaming: true,
      streamingContent: '',
      streamingThinkingContent: '',
      // Local path uses main-process agent loop; controller only for builtin SSE fallback UI.
      toolLoopController: new ToolLoopController({ maxSteps: 0, maxDuplicates: 3 }),
      webSearchEnabled: !!webSearchEnabled,
      feishuKitsEnabled: !!feishuKitsEnabled,
    })

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
      // Local models never upload attachments to the backend, so the chat bubble has
      // nothing to fetch from later — capture a data URI now (before pendingFiles is
      // cleared) so the image can still be shown in the conversation history.
      let localAttachments: ChatAttachment[] | undefined
      if (pendingFiles && pendingFiles.length > 0) {
        try {
          localAttachments = await Promise.all(
            pendingFiles.map(async (pf) => ({
              attachmentId: pf.id,
              fileName: pf.file.name,
              fileSize: pf.file.size,
              mimeType: pf.file.type,
              previewUrl: pf.file.type.startsWith('image/') ? await readFileAsDataUrl(pf.file) : undefined
            }))
          )
        } catch (err) {
          console.error('Failed to build local attachment previews:', err)
        }
      }
      userMsg = {
        messageId: localId('msg'),
        conversationId: activeConversationId,
        role: 'user',
        content,
        modelId: null,
        attachments: localAttachments,
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

    // MCP vision fallback: local models that aren't marked as vision-capable can't
    // read the attached image at all — offer an auto-detected MCP image-recognition
    // tool (if one is connected) so the model can call it itself, and remember the
    // attachment paths so the actual call can be injected with real image bytes.
    const imagePaths = (pendingFiles || [])
      .filter((pf) => pf.file.type.startsWith('image/'))
      .map((pf) => (pf.file as any).path as string | undefined)
      .filter((p): p is string => !!p)
    if (modelSource === 'local' && imagePaths.length > 0 && !localModelSupportsVision(modelConfigId)) {
      tools = await withVisionFallbackTools(tools, modelSource, modelConfigId, true)
      set({ currentTurnAttachmentPaths: imagePaths })
    } else {
      set({ currentTurnAttachmentPaths: [] })
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
    // Always bind to the conversation that started the stream — not whatever is active now
    const conversationId = get().streamingConversationId || get().activeConversationId || ''
    const stillViewing = get().activeConversationId === conversationId && !!conversationId

    const isFirstExchange =
      stillViewing &&
      get().messages.filter((m) => m.role === 'user').length === 1 &&
      get().messages.filter((m) => m.role === 'assistant').length === 0
    const userContent = stillViewing
      ? get().messages.find((m) => m.role === 'user')?.content || ''
      : ''

    const { streamStartTime, searchSources } = get()
    const durationMs = streamStartTime ? Date.now() - streamStartTime : undefined
    const tokenCount = usage?.completionTokens

    // Skip creating an empty trailing assistant bubble when the previous turn already
    // rendered the answer as a completed image tool call (generate_image / edit_image)
    // and the model produced no follow-up text. Without this guard, Responses-API
    // models often leave a blank bubble below the image.
    const trailingMessage = stillViewing ? get().messages[get().messages.length - 1] : undefined
    const trailingImageToolCompleted =
      !!trailingMessage &&
      trailingMessage.role === 'assistant' &&
      (trailingMessage.metadata?.toolCalls?.some(
        (tc) =>
          (tc.name === 'generate_image' || tc.name === 'edit_image') &&
          tc.status === 'completed' &&
          !!tc.output
      ) ?? false)
    const isEmptyOutput = !fullContent.trim() && !(thinkingContent && thinkingContent.trim())
    if (isEmptyOutput && trailingImageToolCompleted) {
      set({
        streaming: false,
        streamingContent: '',
        streamingThinkingContent: '',
        streamingTaskId: null,
        streamingConversationId: null,
        searchSources: [],
        agentPhase: 'idle' as AgentPhase,
        agentStepDescription: '',
        agentToolHistory: [],
      })
      return
    }

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

    // Only mutate the live message list when the user is still on that conversation
    if (stillViewing) {
      set((state) => ({
        messages: [...state.messages, assistantMsg],
        streaming: false,
        streamingContent: '',
        streamingThinkingContent: '',
        streamingTaskId: null,
        streamingConversationId: null,
        searchSources: [],
        agentPhase: 'idle' as AgentPhase,
        agentStepDescription: '',
        agentToolHistory: [],
        conversations: state.conversations.map((c) =>
          c.conversationId === conversationId ? { ...c, modelId: modelId, updatedAt: Date.now() } : c
        )
      }))
    } else {
      set({
        streaming: false,
        streamingContent: '',
        streamingThinkingContent: '',
        streamingTaskId: null,
        streamingConversationId: null,
        searchSources: [],
        agentPhase: 'idle' as AgentPhase,
        agentStepDescription: '',
        agentToolHistory: [],
        pendingToolCalls: [],
      })
    }

    // Persist assistant message against the *bound* conversation (even if user switched away)
    if (conversationId && !isLocal()) {
      apiClient
        .sendMessage(conversationId, { role: 'assistant', content: fullContent, modelId, metadata: assistantMsg.metadata })
        .then((saved) => {
          if (get().activeConversationId !== conversationId) return
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
      if (stillViewing) {
        saveLocalMessages(conversationId, get().messages)
      } else {
        // User switched away: append to stored history for that conversation only
        const existing = loadLocalMessages(conversationId)
        saveLocalMessages(conversationId, [...existing, assistantMsg])
      }
      saveLocalConversations(
        loadLocalConversations().map((c) =>
          c.conversationId === conversationId ? { ...c, modelId: modelId, updatedAt: Date.now() } : c
        )
      )
    }

    // Push digest for memory self-update
    if (conversationId && !isImConversationId(conversationId)) {
      const allMsgs = get().messages
      const title =
        [...get().conversations, ...get().favConversations].find((c) => c.conversationId === conversationId)?.title
        || 'Chat'
      pushDigestForConversation(
        {
          conversationId,
          title,
          favorited: false,
          modelId: modelId || null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: isLocal() ? 'local' : 'cloud',
        },
        allMsgs
      ).catch(() => {})
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
    // Only surface error if still viewing the bound conversation
    const bound = get().streamingConversationId
    const active = get().activeConversationId
    if (bound && active && bound !== active) {
      set({
        streaming: false,
        streamingContent: '',
        streamingThinkingContent: '',
        streamingTaskId: null,
        streamingConversationId: null,
        agentPhase: 'idle' as AgentPhase,
        agentStepDescription: '',
        agentToolHistory: [],
      })
      return
    }
    set({
      streaming: false,
      streamingContent: '',
      streamingThinkingContent: '',
      streamingTaskId: null,
      streamingConversationId: null,
      streamingError: error,
      agentPhase: 'idle' as AgentPhase,
      agentStepDescription: '',
      agentToolHistory: [],
    })
  },

  cancelStreaming: () => {
    const { streamingTaskId } = get()
    if (streamingTaskId) {
      window.api.ai.cancelChat(streamingTaskId)
    }
    // Abort builtin hybrid agent loop (SSE + tools)
    if (activeBuiltinAbort) {
      activeBuiltinAbort.abort()
      activeBuiltinAbort = null
    }
    // Reject any pending builtin tool approvals
    for (const [id, resolve] of builtinApprovalWaiters) {
      resolve(false)
      builtinApprovalWaiters.delete(id)
    }
    set({
      streaming: false,
      streamingContent: '',
      streamingThinkingContent: '',
      streamingTaskId: null,
      streamingConversationId: null,
      streamStartTime: null,
      pendingToolCalls: [],
      agentPhase: 'idle' as AgentPhase,
      agentStepDescription: '',
      agentToolHistory: [],
      searchSources: [],
    })
  },

  setToolApprovalMode: (mode: ToolApprovalMode) => {
    set({ toolApprovalMode: mode })
  },

  setToolsEnabled: (enabled: boolean) => {
    set({ toolsEnabled: enabled })
    window.api.settings.setChatPreferences({ toolsEnabled: enabled }).catch(() => {})
  },

  approveToolCall: async (toolCallId: string) => {
    const { pendingToolCalls, messages, activeConversationId, streamingTaskId } = get()
    const tc = pendingToolCalls.find((t) => t.toolCallId === toolCallId)
    if (!tc || !activeConversationId) return

    // Builtin hybrid loop: resolve renderer-side approval waiter
    if (resolveBuiltinToolApproval(toolCallId, true)) {
      set((state) => ({
        pendingToolCalls: state.pendingToolCalls.filter((t) => t.toolCallId !== toolCallId),
        streaming: true,
        agentPhase: 'calling-tools' as AgentPhase,
      }))
      return
    }

    // Main-process agent loop: only signal approval; tools run in main.
    if (streamingTaskId && window.api.ai.approveTool) {
      set((state) => ({
        pendingToolCalls: state.pendingToolCalls.filter((t) => t.toolCallId !== toolCallId),
        streaming: true,
        agentPhase: 'calling-tools' as AgentPhase,
      }))
      try {
        await window.api.ai.approveTool(streamingTaskId, toolCallId)
      } catch (err: any) {
        get().setStreamingError(err?.message || 'Approve failed')
      }
      return
    }

    // Remove from pending (legacy single-turn streamChat path)
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
      // Preserve this round's reasoning so it can be echoed back as reasoning_content
      // on the next API call (required by DeepSeek thinking_mode and similar models).
      thinkingContent: get().streamingThinkingContent || undefined,
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
        const historyForAI: Array<{ role: 'user' | 'assistant'; content: string; reasoningContent?: string }> = []
        for (const m of allMessages) {
          const role = m.role === 'assistant' ? 'assistant' as const : 'user' as const
          let content = m.content || ''

          // Inline tool call results into assistant message text
          if (m.metadata?.toolCalls && m.metadata.toolCalls.length > 0) {
            const toolTexts = m.metadata.toolCalls
              .filter((tc) => tc.output)
              .map((tc) => `[工具: ${tc.name}${tc.input?.query ? ` "${tc.input.query}"` : tc.input?.url ? ` ${tc.input.url}` : ''}]\n${sanitizeToolOutputForAPI(tc.name, tc.output!)}`)
            if (toolTexts.length > 0) {
              content = (content ? content + '\n\n' : '') + toolTexts.join('\n\n')
            }
          }

          // Skip empty messages
          if (!content.trim()) continue
          // Echo reasoning_content back for thinking models (assistant messages only)
          historyForAI.push({
            role,
            content,
            ...(role === 'assistant' && m.thinkingContent ? { reasoningContent: m.thinkingContent } : {})
          })
        }
        // Append a user instruction to summarize
        historyForAI.push({
          role: 'user' as const,
          content: `[系统提示：${check.reason}] 请基于前面已获取的工具结果，直接回答用户最初的问题。不要再调用相同参数的工具。`
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
            // Echo reasoning_content back for thinking models on tool-calling turns
            ...(m.thinkingContent ? { reasoningContent: m.thinkingContent } : {}),
            toolCalls: [
              { id: tc.toolCallId, name: tc.toolName, input: tc.input }
            ]
          }
        }
        return {
          role: m.role,
          content: m.content,
          ...(m.role === 'assistant' && m.thinkingContent ? { reasoningContent: m.thinkingContent } : {})
        }
      })
      // Add tool result
      historyForAI.push({
        role: 'tool' as any,
        content: sanitizeToolOutputForAPI(tc.toolName, result.output || ''),
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
      // Keep offering the vision-fallback tool across follow-up turns in this same
      // conversation cycle (e.g. the model may retry or call it after another tool).
      if (get().currentTurnAttachmentPaths.length > 0) {
        tools = await withVisionFallbackTools(tools, modelSource, selectedModelConfigId || undefined, true)
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
    const { pendingToolCalls, activeConversationId, streamingTaskId } = get()
    const tc = pendingToolCalls.find((t) => t.toolCallId === toolCallId)
    if (!tc || !activeConversationId) return

    // Builtin hybrid loop
    if (resolveBuiltinToolApproval(toolCallId, false)) {
      set((state) => ({
        pendingToolCalls: state.pendingToolCalls.filter((t) => t.toolCallId !== toolCallId),
      }))
      return
    }

    // Main-process agent loop
    if (streamingTaskId && window.api.ai.rejectTool) {
      set((state) => ({
        pendingToolCalls: state.pendingToolCalls.filter((t) => t.toolCallId !== toolCallId),
      }))
      window.api.ai.rejectTool(streamingTaskId, toolCallId).catch(() => {})
      return
    }

    // Legacy single-turn path
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
    const allConvs = [...get().conversations, ...get().favConversations, ...get().imConversations]
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
 * When assistant master switch is off, returns empty context (minimal prompt).
 */
async function loadAgentMemory(assistantEnabled: boolean): Promise<AgentMemoryContext> {
  if (!assistantEnabled) return {}
  try {
    // Progressive context: only always-on slices are loaded into the system prompt.
    // tools.md / agents.md are fetched on demand via read_agent_file.
    const [soul, memory, user, statsSnippet] = await Promise.all([
      window.api.agent.readMemory('soul.md'),
      window.api.agent.readMemory('memory.md'),
      window.api.agent.readMemory('user.md'),
      window.api.agent.statsSnippet(),
    ])
    return { soul, memory, user, statsSnippet }
  } catch {
    return {}
  }
}

/**
 * Builtin (cloud) path: hybrid agent loop with shared main-process tools.
 * Model streams via backend SSE; tools/compact/anti-spin use the same main catalog
 * as local agent query (unbounded loop, concurrent batches, result budget).
 */
async function streamBuiltin(
  modelId: string,
  conversationId: string,
  attachmentIds: string[],
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, any> }>,
  enableThinking?: boolean,
  webSearchEnabled?: boolean
): Promise<void> {
  const state = useChatStore.getState()
  let messages: Array<any> = state.messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.thinkingContent ? { reasoningContent: m.thinkingContent } : {}),
    ...(m.metadata?.toolCalls?.length
      ? {
          toolCalls: m.metadata.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        }
      : {}),
  }))

  let customPrompt = ''
  let assistantEnabled = true
  try {
    const agentSettings = await window.api.settings.getAgentSettings()
    customPrompt = agentSettings?.customSystemPrompt || ''
    assistantEnabled = agentSettings?.assistantEnabled !== false
  } catch { /* ignore */ }

  const agentMemory = await loadAgentMemory(assistantEnabled)
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
    agentMemory,
    assistantEnabled,
  })
  messages = [{ role: 'system', content: systemPrompt }, ...messages.filter((m) => m.role !== 'system')]

  await streamBuiltinAgentLoop(
    modelId,
    conversationId,
    messages,
    tools,
    attachmentIds,
    enableThinking,
    webSearchEnabled
  )
}

const BUILTIN_AGENT_HARD_CEILING = 200

/**
 * Unbounded hybrid agent loop for builtin models.
 * Shares anti-spin (loop-scoped fingerprints), approval gate, and cancel with local semantics.
 */
async function streamBuiltinAgentLoop(
  modelId: string,
  conversationId: string,
  messages: Array<any>,
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, any> }>,
  attachmentIds?: string[],
  enableThinking?: boolean,
  webSearchEnabled?: boolean
): Promise<void> {
  // Cancel previous builtin loop if any
  if (activeBuiltinAbort) {
    activeBuiltinAbort.abort()
  }
  const abort = new AbortController()
  activeBuiltinAbort = abort
  const signal = abort.signal

  const state = useChatStore.getState()
  let step = 0
  let working = [...messages]
  let firstTurnAttachments = attachmentIds
  /** Loop-scoped anti-spin — passed into every executeAgentTools IPC call */
  let fingerprints: Record<string, number> = {}

  try {
    while (step < BUILTIN_AGENT_HARD_CEILING) {
      if (signal.aborted) return

      // Soft context budget via main compact helper when oversized
      if (estimateBuiltinChars(working) > 100_000) {
        try {
          const compacted = await window.api.ai.compactMessages({ messages: working })
          if (signal.aborted) return
          if (compacted.compacted) {
            working = compacted.messages
            useChatStore.setState({ agentStepDescription: 'Context compacted' })
          }
        } catch { /* compact optional */ }
      }

      if (signal.aborted) return
      useChatStore.setState({ agentPhase: 'thinking' as AgentPhase, streaming: true, streamingContent: '' })
      const turn = await streamBuiltinOneTurn(
        modelId,
        conversationId,
        working,
        tools,
        firstTurnAttachments,
        enableThinking,
        webSearchEnabled,
        signal
      )
      firstTurnAttachments = undefined // only on first request

      if (signal.aborted) return

      if (turn.error) {
        if (signal.aborted || turn.error === 'aborted') return
        useChatStore.getState().setStreamingError(turn.error)
        return
      }

      if (!turn.toolCalls.length) {
        if (signal.aborted) return
        useChatStore
          .getState()
          .finalizeStreaming(turn.text, modelId, turn.thinking || undefined, turn.usage)
        return
      }

      // Record assistant + tool calls in working history
      working.push({
        role: 'assistant',
        content: turn.text || '',
        ...(turn.thinking ? { reasoningContent: turn.thinking } : {}),
        toolCalls: turn.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })),
      })

      // Approval gate (shared semantics with local runOneTool)
      const approvalMode = useChatStore.getState().toolApprovalMode
      const approvedCalls: Array<{ id: string; name: string; input: Record<string, any> }> = []
      const rejectedResults: Array<{ id: string; name: string; content: string; isError: boolean }> = []

      for (const tc of turn.toolCalls) {
        if (signal.aborted) return
        const needsAsk =
          approvalMode === 'ask-every-time' ||
          (approvalMode === 'auto-approve-safe' && !isSafeTool(tc.name))

        if (needsAsk) {
          useChatStore.setState({
            agentPhase: 'calling-tools' as AgentPhase,
            agentStepDescription: `Awaiting approval: ${tc.name}`,
          })
          const ok = await waitBuiltinToolApproval({
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.input,
          })
          if (signal.aborted) return
          if (!ok) {
            rejectedResults.push({
              id: tc.id,
              name: tc.name,
              content: 'Tool call rejected by user',
              isError: true,
            })
            continue
          }
        }
        approvedCalls.push(tc)
      }

      // Show approved tools as running
      for (const tc of approvedCalls) {
        const historyEntry: AgentToolHistoryEntry = {
          id: tc.id,
          name: tc.name,
          input: tc.input,
          status: 'running',
          startTime: Date.now(),
        }
        useChatStore.setState((s) => ({
          agentPhase: 'calling-tools' as AgentPhase,
          agentStepDescription: tc.name,
          agentToolHistory: [...s.agentToolHistory.filter((h) => h.id !== tc.id), historyEntry],
        }))
      }

      // Execute via main shared catalog (partition + budget + loop-scoped anti-spin)
      let results = [...rejectedResults]
      if (approvedCalls.length > 0 && !signal.aborted) {
        const batch = await window.api.ai.executeAgentTools({
          calls: approvedCalls,
          toolsEnabled: state.toolsEnabled,
          webSearchEnabled: !!webSearchEnabled,
          feishuKitsEnabled: state.feishuKitsEnabled,
          fingerprints,
        })
        if (signal.aborted) return
        fingerprints = batch.fingerprints
        results = [...results, ...batch.results]
      }

      for (const r of results) {
        working.push({
          role: 'tool',
          content: r.content,
          toolCallId: r.id,
        })
        useChatStore.setState((s) => ({
          agentToolHistory: s.agentToolHistory.map((h) =>
            h.id === r.id
              ? {
                  ...h,
                  status: (r.isError ? 'error' : 'completed') as 'completed' | 'error',
                  output: r.content,
                  endTime: Date.now(),
                }
              : h
          ),
        }))
        if (!r.isError && r.name === 'web_search' && r.content) {
          const sources = parseSearchSources(r.content)
          if (sources.length > 0) {
            useChatStore.setState((s) => ({ searchSources: [...s.searchSources, ...sources] }))
          }
        }
      }

      step++
    }
    if (!signal.aborted) {
      useChatStore.getState().setStreamingError('Agent tool loop hit safety ceiling')
    }
  } catch (err: any) {
    if (signal.aborted || err?.name === 'AbortError') return
    useChatStore.getState().setStreamingError(err.message || 'Builtin agent loop failed')
  } finally {
    if (activeBuiltinAbort === abort) {
      activeBuiltinAbort = null
    }
  }
}

function estimateBuiltinChars(messages: Array<{ content?: string }>): number {
  return messages.reduce((n, m) => n + (m.content?.length || 0), 0)
}

interface BuiltinTurnResult {
  text: string
  thinking: string
  toolCalls: Array<{ id: string; name: string; input: Record<string, any> }>
  usage?: any
  error?: string
}

/**
 * One backend SSE model turn — collects text + all tool_use blocks before returning.
 */
async function streamBuiltinOneTurn(
  modelId: string,
  conversationId: string,
  messages: Array<any>,
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, any> }>,
  attachmentIds?: string[],
  enableThinking?: boolean,
  webSearchEnabled?: boolean,
  signal?: AbortSignal
): Promise<BuiltinTurnResult> {
  if (signal?.aborted) {
    return { text: '', thinking: '', toolCalls: [], error: 'aborted' }
  }

  const token = apiClient.getToken()
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        modelId,
        messages,
        conversationId,
        attachmentIds: attachmentIds && attachmentIds.length > 0 ? attachmentIds : undefined,
        tools,
        enableThinking,
        webSearchEnabled,
      }),
      signal,
    })
  } catch (err: any) {
    if (signal?.aborted || err?.name === 'AbortError') {
      return { text: '', thinking: '', toolCalls: [], error: 'aborted' }
    }
    return { text: '', thinking: '', toolCalls: [], error: err?.message || 'Stream request failed' }
  }

  if (!response.ok) {
    return { text: '', thinking: '', toolCalls: [], error: 'Stream request failed' }
  }

  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let fullContent = ''
  let fullThinkingContent = ''
  const toolCalls: Array<{ id: string; name: string; input: Record<string, any> }> = []
  let usage: any
  let error: string | undefined

  if (reader) {
    let buffer = ''
    try {
      while (true) {
        if (signal?.aborted) {
          try {
            await reader.cancel()
          } catch { /* ignore */ }
          return { text: fullContent, thinking: fullThinkingContent, toolCalls, usage, error: 'aborted' }
        }
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'thinking_delta' && data.content) {
              fullThinkingContent += data.content
              if (isStreamUiActive()) {
                useChatStore.setState({ streamingThinkingContent: fullThinkingContent })
              }
            } else if (data.type === 'delta' && data.content) {
              fullContent += data.content
              if (isStreamUiActive()) {
                useChatStore.setState({ streamingContent: fullContent })
              }
            } else if (data.type === 'done') {
              usage = data.usage
            } else if (data.type === 'error') {
              error = data.message
            } else if (data.type === 'tool_use' && data.toolCall) {
              toolCalls.push({
                id: data.toolCall.id,
                name: data.toolCall.name,
                input: data.toolCall.input || {},
              })
            } else if (data.type === 'search_grounding' && data.sources) {
              const sources: SearchSource[] = (
                data.sources as Array<{ title: string; url: string }>
              ).map((s) => ({ title: s.title, url: s.url }))
              if (sources.length > 0) {
                useChatStore.setState((state) => ({
                  searchSources: [...state.searchSources, ...sources],
                }))
              }
            }
          } catch {
            /* ignore non-JSON */
          }
        }
      }
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') {
        return { text: fullContent, thinking: fullThinkingContent, toolCalls, usage, error: 'aborted' }
      }
      throw err
    }
  }

  return {
    text: fullContent,
    thinking: fullThinkingContent,
    toolCalls,
    usage,
    error,
  }
}

/**
 * Backend SSE streaming with explicit messages (legacy single-turn; kept for recovery paths).
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
  await streamBuiltinAgentLoop(
    modelId,
    conversationId,
    messages,
    tools,
    attachmentIds,
    enableThinking,
    webSearchEnabled
  )
}

/**
 * Local model path: main-process agent query loop (Claude Code–style).
 * System prompt, tools, parallel execution, compact, and multi-turn are owned by main.
 */
async function streamLocal(
  modelConfigId: string,
  modelId: string,
  pendingFiles?: PendingAttachment[],
  _tools?: Array<{ name: string; description: string; inputSchema: Record<string, any> }>,
  enableThinking?: boolean,
  webSearchEnabled?: boolean
): Promise<void> {
  const state = useChatStore.getState()
  const history = state.messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.thinkingContent ? { reasoningContent: m.thinkingContent } : {}),
    ...(m.metadata?.toolCalls?.length
      ? {
          toolCalls: m.metadata.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        }
      : {}),
  }))

  const ipcAttachments =
    pendingFiles && pendingFiles.length > 0
      ? pendingFiles.map((pf) => ({
          filePath: (pf.file as any).path as string,
          mimeType: pf.file.type,
          fileName: pf.file.name,
        }))
      : undefined

  const attachmentPaths = (pendingFiles || [])
    .filter((pf) => pf.file.type.startsWith('image/'))
    .map((pf) => (pf.file as any).path as string | undefined)
    .filter((p): p is string => !!p)

  await streamLocalAgentQuery(
    modelConfigId,
    modelId,
    history,
    ipcAttachments,
    enableThinking,
    webSearchEnabled,
    attachmentPaths
  )
}

/**
 * Fallback: single-turn streamChat with renderer-side tool loop (legacy / recovery).
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
        useChatStore.setState({ streamingContent: fullContent })
      }
    })
    const cleanupThinking = window.api.ai.onChatThinkingDelta((data) => {
      if (data.taskId === taskId) {
        fullThinkingContent += data.content
        useChatStore.setState({ streamingThinkingContent: fullThinkingContent })
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
        const sources: SearchSource[] = data.sources.map((s) => ({
          title: s.title,
          url: s.url,
        }))
        if (sources.length > 0) {
          useChatStore.setState((state) => ({
            searchSources: [...state.searchSources, ...sources],
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

/**
 * Subscribe to main-process agent query events for one task.
 */
async function streamLocalAgentQuery(
  modelConfigId: string,
  modelId: string,
  messages: Array<any>,
  attachments?: Array<{ filePath: string; mimeType: string; fileName: string }>,
  enableThinking?: boolean,
  webSearchEnabled?: boolean,
  attachmentPaths?: string[]
): Promise<void> {
  const state = useChatStore.getState()
  const lang = useSettingsStore.getState().language || 'zh-CN'

  try {
    const taskId = await window.api.ai.streamAgentQuery({
      modelConfigId,
      modelId,
      messages,
      attachments,
      enableThinking,
      webSearchEnabled,
      toolsEnabled: state.toolsEnabled,
      feishuKitsEnabled: state.feishuKitsEnabled,
      toolApprovalMode: state.toolApprovalMode,
      language: lang,
      attachmentPaths,
    })
    useChatStore.setState({ streamingTaskId: taskId })

    let fullContent = ''
    let fullThinkingContent = ''
    // Content for the current model turn (reset after tools so next turn streams cleanly)
    let turnContent = ''

    const cleanupDelta = window.api.ai.onChatDelta((data) => {
      if (data.taskId !== taskId) return
      // Always accumulate for finalize; only paint if still on this conversation
      turnContent += data.content
      fullContent = turnContent
      if (isStreamUiActive(taskId)) {
        useChatStore.setState({ streamingContent: fullContent, streaming: true })
      }
    })
    const cleanupThinking = window.api.ai.onChatThinkingDelta((data) => {
      if (data.taskId !== taskId) return
      fullThinkingContent += data.content
      if (isStreamUiActive(taskId)) {
        useChatStore.setState({ streamingThinkingContent: fullThinkingContent })
      }
    })
    const cleanupToolUse = window.api.ai.onChatToolUse((data) => {
      if (data.taskId !== taskId) return
      // Tool activity only in compact status bar — do NOT inject chat bubbles mid-stream
      // (was causing noisy highlights; final answer carries search sources instead)
      if (!isStreamUiActive(taskId)) {
        turnContent = ''
        return
      }
      const historyEntry: AgentToolHistoryEntry = {
        id: data.toolCallId,
        name: data.toolName,
        input: data.input,
        status: 'running',
        startTime: Date.now(),
      }
      const desc =
        data.toolName === 'web_search'
          ? `Searching: ${data.input?.query || ''}`
          : data.toolName === 'web_browse'
            ? `Reading: ${data.input?.url || ''}`
            : data.toolName
      useChatStore.setState((s) => ({
        agentPhase: 'calling-tools' as AgentPhase,
        agentStepDescription: desc,
        agentToolHistory: [...s.agentToolHistory.filter((h) => h.id !== data.toolCallId), historyEntry],
        // Clear partial text so search tool cards aren't mixed into the streaming bubble
        streamingContent: '',
      }))
      turnContent = ''
      // Keep thinking for the final answer; do not wipe mid-tool
    })
    const cleanupToolResult = window.api.ai.onChatToolResult((data) => {
      if (data.taskId !== taskId) return
      // Collect search sources even if user switched away (for finalize persistence)
      if (!data.isError && data.toolName === 'web_search' && data.output) {
        const sources = parseSearchSources(data.output)
        if (sources.length > 0) {
          useChatStore.setState((s) => ({ searchSources: [...s.searchSources, ...sources] }))
        }
      }
      if (!isStreamUiActive(taskId)) return
      useChatStore.setState((s) => ({
        agentToolHistory: s.agentToolHistory.map((h) =>
          h.id === data.toolCallId
            ? {
                ...h,
                status: (data.isError ? 'error' : 'completed') as 'completed' | 'error',
                output: data.output,
                endTime: Date.now(),
              }
            : h
        ),
        agentPhase: 'thinking' as AgentPhase,
        agentStepDescription: data.isError ? `Tool error: ${data.toolName}` : '',
      }))
    })
    const cleanupApproval = window.api.ai.onChatToolApproval((data) => {
      if (data.taskId !== taskId) return
      if (!isStreamUiActive(taskId)) return
      const pending: PendingToolCall = {
        toolCallId: data.toolCallId,
        toolName: data.toolName,
        input: data.input,
        streamedContent: '',
      }
      useChatStore.setState((s) => ({
        pendingToolCalls: [...s.pendingToolCalls.filter((p) => p.toolCallId !== data.toolCallId), pending],
        agentPhase: 'calling-tools' as AgentPhase,
      }))
    })
    const cleanupCompact = window.api.ai.onChatCompacted((data) => {
      if (data.taskId !== taskId) return
      if (!isStreamUiActive(taskId)) return
      useChatStore.setState({
        agentStepDescription: 'Context compacted',
      })
    })
    const cleanupDone = window.api.ai.onChatDone((data) => {
      if (data.taskId !== taskId) return
      useChatStore
        .getState()
        .finalizeStreaming(turnContent || fullContent, modelId, fullThinkingContent || undefined, data.usage)
      cleanup()
    })
    const cleanupError = window.api.ai.onChatError((data) => {
      if (data.taskId !== taskId) return
      useChatStore.getState().setStreamingError(data.error)
      cleanup()
    })
    const cleanupSearchGrounding = window.api.ai.onChatSearchGrounding((data) => {
      if (data.taskId !== taskId) return
      const sources: SearchSource[] = data.sources.map((s) => ({
        title: s.title,
        url: s.url,
      }))
      if (sources.length > 0) {
        useChatStore.setState((s) => ({
          searchSources: [...s.searchSources, ...sources],
        }))
      }
    })

    function cleanup() {
      cleanupDelta()
      cleanupThinking()
      cleanupToolUse()
      cleanupToolResult()
      cleanupApproval()
      cleanupCompact()
      cleanupDone()
      cleanupError()
      cleanupSearchGrounding()
    }
  } catch (err: any) {
    // Fall back to legacy single-turn path if agent query IPC is unavailable
    console.error('[chat] agent query failed, falling back:', err)
    useChatStore.getState().setStreamingError(err.message || 'Agent query failed')
  }
}
