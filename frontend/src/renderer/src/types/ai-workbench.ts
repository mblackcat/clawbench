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

export interface AIWorkbenchWorkspace {
  id: string
  title: string           // basename(workingDir)
  workingDir: string
  groupId: string
  createdAt: number
  updatedAt: number
}

export interface AIWorkbenchSession {
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

// ── Workbench Chat Message Types ──

export type WorkbenchContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'raw_output'; text: string }
  | { type: 'ask_user_question'; id: string; questions: AskUserQuestionItem[]; answered?: boolean; answerText?: string }
  | { type: 'todo_update'; todos: TodoItem[] }

export interface WorkbenchMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  blocks: WorkbenchContentBlock[]
  timestamp: number
  costUsd?: number
}

export type WorkbenchMode = 'plan' | 'ask-first' | 'auto-edit'

/** Claude session view mode: chat UI vs raw CLI terminal */
export type ClaudeViewMode = 'chat' | 'cli'

export interface AIWorkbenchGroup {
  id: string
  name: string
  isDefault: boolean
  order: number
}

export interface AIWorkbenchIMConfig {
  feishu: {
    appId: string
    appSecret: string
  }
}

export interface AIWorkbenchConfig {
  workspaces: AIWorkbenchWorkspace[]
  sessions: AIWorkbenchSession[]
  groups: AIWorkbenchGroup[]
  imConfig: AIWorkbenchIMConfig
}

export type AIWorkbenchIMConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface AIWorkbenchIMConnectionStatus {
  state: AIWorkbenchIMConnectionState
  error?: string
  connectedAt?: number
}

export interface WorkbenchPendingFile {
  id: string
  filePath: string
  fileName: string
  isImage: boolean
}

export interface DetectedCLI {
  toolType: AIToolType
  name: string
  installed: boolean
  version?: string
}
