export type AIToolType = 'claude' | 'codex' | 'gemini' | 'opencode' | 'qwen' | 'terminal'

// ── AskUserQuestion types ──

export interface AskUserQuestionOption {
  label: string
  description?: string
  preview?: string
}

export interface AskUserQuestionItem {
  question: string
  header?: string
  options: AskUserQuestionOption[]
  multiSelect?: boolean
}

// ── TodoWrite types ──

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

// closed  = terminal not started (initial / explicitly ended by user)
// idle    = terminal open, waiting for user input
// running = terminal open, AI actively processing
// completed = terminal exited naturally (task finished)
// error   = terminal exited with error
export type SessionStatus = 'closed' | 'idle' | 'running' | 'completed' | 'error'

export type SessionActivity =
  | 'thinking'      // AI reasoning
  | 'tool_call'     // running a tool (bash, file ops, etc.)
  | 'writing'       // writing / editing files
  | 'reading'       // reading / searching / analyzing
  | 'waiting_input' // waiting for user to type
  | 'auth_request'  // asking for user authorization
  | 'none'

export interface AICodingWorkspace {
  id: string
  title: string           // basename(workingDir)
  workingDir: string
  groupId: string
  createdAt: number
  updatedAt: number
}

export interface AICodingSession {
  id: string
  workspaceId: string       // FK to workspace
  toolSessionId?: string    // AI tool's native session ID for --resume
  toolType: AIToolType      // which CLI tool this session uses
  source: 'local' | 'im'   // PTY vs pipe mode
  status: SessionStatus
  lastActivity: SessionActivity
  costUsd?: number          // accumulated cost (Claude result events)
  durationMs?: number       // elapsed time
  startedAt?: number        // launch timestamp
  title?: string            // auto-generated session title
  createdAt: number
  updatedAt: number
  pidFile?: string
}

// ── AI Coding Chat Message Types ──

export type CodingContentBlock =
  | { type: 'text'; text: string; blockId?: string }
  | { type: 'thinking'; text: string; blockId?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'raw_output'; text: string }
  | { type: 'ask_user_question'; id: string; questions: AskUserQuestionItem[]; answered?: boolean; answerText?: string }
  | { type: 'todo_update'; todos: TodoItem[] }
  | { type: 'context_usage'; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; usedTokens?: number; contextWindow?: number }

export interface CodingMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  blocks: CodingContentBlock[]
  timestamp: number
  costUsd?: number
}

// Permission modes, aligned with each tool's native vocabulary.
// Claude: manual (ask), edit-automatically (accept edits), plan, auto (bypass).
// Codex:  ask (request approval), approve-for-me, full-access.
export type CodingMode =
  | 'manual' | 'edit-automatically' | 'plan' | 'auto'
  | 'ask' | 'approve-for-me' | 'full-access'

// Reasoning effort / thinking depth. Claude uses the SDK `effort` field
// (low|medium|high|xhigh|max) plus an `ultracode` preset (xhigh + ultracode
// flag). Codex uses `modelReasoningEffort` (low|medium|high|xhigh).
export type CodingEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultracode'

/** Claude session view mode: chat UI vs raw CLI terminal */
export type ClaudeViewMode = 'chat' | 'cli'
export type CodingViewMode = ClaudeViewMode

export interface AICodingGroup {
  id: string
  name: string
  isDefault: boolean
  order: number
}

export interface AICodingIMConfig {
  feishu: {
    appId: string
    appSecret: string
  }
}

export interface AICodingConfig {
  workspaces: AICodingWorkspace[]
  sessions: AICodingSession[]
  groups: AICodingGroup[]
  imConfig: AICodingIMConfig
}

export type AICodingIMConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface AICodingIMConnectionStatus {
  state: AICodingIMConnectionState
  error?: string
  connectedAt?: number
}

export interface CodingPendingFile {
  id: string
  filePath: string
  fileName: string
  isImage: boolean
}

/** An image attached to a chat message (base64, sent to the model as a real image block). */
export interface CodingImage {
  data: string       // base64-encoded image bytes (no data: prefix)
  mediaType: string  // e.g. 'image/png'
}

export interface DetectedCLI {
  toolType: AIToolType
  name: string
  installed: boolean
  version?: string
}
