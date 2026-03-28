export interface Conversation {
  conversationId: string
  title: string
  favorited: boolean
  modelId: string | null
  createdAt: number
  updatedAt: number
}

export interface Message {
  messageId: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  modelId: string | null
  attachments?: ChatAttachment[]
  metadata?: MessageMetadata | null
  thinkingContent?: string
  createdAt: number
}

export interface ChatAttachment {
  attachmentId: string
  fileName: string
  fileSize: number
  mimeType: string
}

export interface PendingAttachment {
  id: string
  file: File
  previewUrl?: string
  uploadedId?: string
  uploading: boolean
  error?: string
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, any>
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'error'
  output?: string
  error?: string
}

export interface SearchSource {
  title: string
  url: string
  snippet?: string
}

export interface MessageMetadata {
  toolCalls?: ToolCall[]
  searchSources?: SearchSource[]
  tokenCount?: number
  durationMs?: number
  feedback?: 'up' | 'down'
  feedbackReason?: string
}

export interface AIModel {
  id: string
  name: string
  provider: string
  maxTokens?: number
}

export interface AIModelConfig {
  id: string
  name: string
  provider: string
  endpoint: string
  apiKey: string
  models: string[]
  enabled: boolean
}

export interface ConversationListResponse {
  conversations: Conversation[]
  total: number
  limit: number
  offset: number
}

export interface MessageListResponse {
  messages: Message[]
  total: number
  limit: number
  offset: number
}

export interface StreamChatChunk {
  type: 'delta' | 'done' | 'error' | 'tool_use'
  content?: string
  toolCall?: { id: string; name: string; input: Record<string, any> }
  usage?: { promptTokens: number; completionTokens: number }
  message?: string
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
  source: 'builtin' | 'mcp'
  mcpServerId?: string
}

export type ToolApprovalMode = 'ask-every-time' | 'auto-approve-safe' | 'auto-approve-session'

export type AgentPhase = 'idle' | 'thinking' | 'calling-tools' | 'summarizing'

export interface AgentToolHistoryEntry {
  id: string
  name: string
  input: Record<string, any>
  output?: string
  status: 'running' | 'completed' | 'error'
  startTime: number
  endTime?: number
}
