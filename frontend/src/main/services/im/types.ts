/**
 * IM Abstraction Layer — adapter interface & shared types.
 *
 * Design: each IM platform (Feishu, Telegram, Slack …) implements `IMAdapter`.
 * The `IMBridgeService` orchestrates command parsing, session mapping and
 * periodic card updates through this interface, staying platform-agnostic.
 */

// ── Incoming ──

export interface IMIncomingMessage {
  /** Platform-specific message id */
  messageId: string
  /** Platform-specific chat / conversation id */
  chatId: string
  /** Plain-text content (commands are extracted from this) */
  text: string
  /** Who sent the message (platform user id) */
  senderId: string
  /** Optional sender display name */
  senderName?: string
}

// ── Outgoing card payloads ──

export interface IMCardAction {
  /** Unique tag for callback routing */
  tag: string
  label: string
  /** Optional value attached to the callback */
  value?: string
  /** 'primary' | 'danger' | 'default' */
  type?: string
}

export interface IMCardSection {
  title?: string
  /** Markdown-formatted text */
  content: string
  /** Optional per-section action buttons, rendered after this section's content */
  actions?: IMCardAction[]
}

export interface IMCardPayload {
  title: string
  sections: IMCardSection[]
  actions?: IMCardAction[]
  /** Pre-built platform JSON — if set, toFeishuCardJSON() returns this directly */
  rawJSON?: string
}

// ── Card action callback ──

export interface IMCardCallback {
  /** The action tag that was clicked */
  actionTag: string
  /** Value attached to the action */
  actionValue?: string
  /** Platform user id */
  userId: string
  /** Platform-specific open_id / chat_id context */
  chatId: string
  /** Original card message id so we can update it */
  messageId?: string
  /** Form field values when a form submit button is clicked */
  formValue?: Record<string, string>
}

// ── Connection state ──

export type IMConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface IMConnectionStatus {
  state: IMConnectionState
  error?: string
  connectedAt?: number
}

// ── Adapter interface ──

export interface IMAdapter {
  /** Human-readable adapter name, e.g. "feishu" */
  readonly name: string

  /** Current connection status */
  getStatus(): IMConnectionStatus

  /**
   * Start the long-lived connection (WebSocket / polling / etc.).
   * Must call `onMessage` for every incoming user message and
   * `onCardCallback` for interactive card button clicks.
   */
  connect(config: Record<string, string>): Promise<void>

  /** Gracefully disconnect */
  disconnect(): Promise<void>

  /** Send a new card message. Returns the platform message id. */
  sendCard(chatId: string, card: IMCardPayload): Promise<string>

  /** Update an existing card message in-place. */
  updateCard(chatId: string, messageId: string, card: IMCardPayload): Promise<void>

  /** Send a simple text reply. */
  sendText(chatId: string, text: string): Promise<string>

  /** Add an emoji reaction to a message. Optional — not all platforms support this. */
  addReaction?(messageId: string, emojiType: string): Promise<void>

  // ── Event hooks (set by bridge) ──

  onMessage: ((msg: IMIncomingMessage) => void) | null
  onCardCallback: ((cb: IMCardCallback) => void) | null
  onStatusChange: ((status: IMConnectionStatus) => void) | null
}

// ── IM Bridge types (used by orchestrator) ──

/** A single entry in the per-card input history */
export interface InputHistoryEntry {
  text: string
  /** false = currently being processed (shows spinner); true = AI has responded */
  done: boolean
}

/** Tracks which Feishu card corresponds to which workspace/session */
export interface CardMapping {
  workspaceId: string
  sessionId?: string
  chatId: string
  messageId: string
  /** Last text snapshot pushed to the card (avoid redundant updates) */
  lastSnapshot: string
  updatedAt: number
  /** History of inputs sent to this session, shown in the card */
  inputHistory?: InputHistoryEntry[]
}

/** Per-chat state for IM bridge */
export interface IMChatState {
  chatId: string
  activeWorkspaceId: string | null
  activeSessionId: string | null
}

/** Parsed command from user message */
export interface ParsedCommand {
  command:
    | 'help' | 'work' | 'session' | 'exit' | 'status'
    | 'app-list' | 'app-run' | 'app-market' | 'app-install' | 'chat'
    | 'cw' | 'new'
    | 'unknown'
  /** e.g. workspace/session index for /work <n>, /ss <id> */
  args: string[]
  /** Raw text */
  raw: string
}
