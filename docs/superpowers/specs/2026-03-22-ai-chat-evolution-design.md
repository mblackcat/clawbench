# AI Chat Evolution - Design Spec (v2)

## Overview

Six improvements to the AI Chat module:

1. **Smart search gating** - prevent unnecessary web searches + show search status indicator
2. **User message context menu** - right-click to copy, edit, regenerate, or retract messages
3. **AI reply action bar** - copy, thumbs up/down, token count, duration stats
4. **Agent memory system** - soul.md / memory.md / user.md / tools.md / agents.md / stats.json with feedback-driven learning
5. **Internal cross-module tools** - IPC routing with MCP abstraction layer (Local Env, Workbench, AI Coding, AI Terminal)
6. **AI Assistant settings redesign** - full memory management UI

## 1. Smart Search Gating

### Problem

When web search is enabled, the model tends to search on every message including greetings and trivial questions, causing unnecessary latency. Users cannot tell whether the delay is from search or network speed.

### Solution

Two-part approach: prompt-level constraints + UI search status indicator.

#### 1a. Prompt Optimization

Optimize the `Search Strategy` section in `system-prompt-builder.ts` to include explicit rules about when NOT to search:

```
## Search Strategy
You have web search capability. Use it judiciously — NOT on every message.

**Do NOT search (answer directly):**
- Greetings, small talk, casual conversation (e.g. "hi", "thanks", "how are you")
- Math, logic, or reasoning problems
- Code writing tasks (unless you specifically need latest API docs or library versions)
- Basic knowledge: history, grammar, concept explanations, well-established facts
- Follow-up questions about content already in this conversation
- Short simple questions you can confidently answer from training data

**DO search:**
- Current events, real-time data, latest news
- Specific product versions, release notes, changelogs, recent updates
- Factual claims you are genuinely unsure about
- URLs or specific web content the user references
- Questions explicitly asking about "latest", "current", "today", "2024/2025/2026" etc.

**Execution rules:**
- First decide: does this message need search? If NO, answer directly without calling any search tools.
- If YES, use plan_search to declare your strategy, then execute with web_search.
- Do not repeat the same query — vary keywords for each round.
- After gathering sufficient information (typically 2-4 rounds), stop searching and synthesize.
- Cite sources with URLs when available.
```

#### 1b. Search Status Indicator

When `web_search` tool is being called, display a visible status indicator on the AI reply bubble:
- Show a small `<Tag>` with a search icon + "正在搜索..." / "Searching..." text above or inside the AI message area
- The indicator appears when a `web_search` tool call is detected in the streaming tool calls
- It disappears when the tool call completes and the model continues with content

Implementation: In `ChatMessage.tsx` or `ChatArea.tsx`, check `useChatStore.getState().pendingToolCalls` (or `agentToolHistory`) for any active `web_search` call during streaming. When `isStreaming && hasActiveSearchTool`, render the search indicator above the streaming message. Do NOT check `message.metadata?.toolCalls` since metadata is not populated during streaming.

### Files Changed

- `frontend/src/renderer/src/utils/system-prompt-builder.ts` - rewrite Search Strategy section
- `frontend/src/renderer/src/pages/AIChat/ChatMessage.tsx` - add search status indicator (using store state, not message metadata)

## 2. User Message Context Menu

### Behavior

Right-click on a user message bubble shows a dropdown menu with four actions:

1. **Copy** - copies message text to clipboard
2. **Edit** - opens an inline editor (TextArea) to modify the message content. On confirm:
   - Replaces the original message content
   - Deletes all messages after this one (AI replies and subsequent messages)
   - Automatically re-sends the edited content to trigger a new AI response
3. **Regenerate** - keeps the user message unchanged, deletes the AI reply that immediately follows, and re-triggers the AI to generate a new response
4. **Retract** - opens a confirmation modal with two options:
   - "Retract this message only" - deletes just this message
   - "Retract this and all after" - deletes this message and everything after it

After retraction, no automatic re-processing occurs. The next time the user sends a message, the chat store uses the current (post-retraction) message list as context.

### Implementation

- `ChatMessage.tsx` - wrap user bubble with `<Dropdown trigger={['contextMenu']}>`, menu items: Copy, Edit, Regenerate, Retract
- `useChatStore.ts` - add actions:
  - `deleteMessages(messageId: string, mode: 'single' | 'from-here')` - for retract
  - `editAndResend(messageId: string, newContent: string)` - delete from-here + re-send with new content
  - `regenerateFromMessage(messageId: string)` - delete the AI reply after this user message, re-send the same user message
  - Backend mode: call `DELETE /api/v1/chat/conversations/:convId/messages/:msgId?mode=single|from-here`
  - Local mode: filter localStorage messages array
- Backend - add delete endpoint in chat controller/service/repository. For `from-here` mode, use the message's auto-increment `id` for ordering (NOT `created_at` timestamp) to avoid edge cases with same-millisecond messages: `DELETE FROM messages WHERE conversation_id = ? AND id >= (SELECT id FROM messages WHERE message_id = ?)`

### Edit UI

When "Edit" is selected:
- The user message bubble transforms into an editable `TextArea` (pre-filled with current content)
- Two buttons appear below: "Confirm" (sends edited message) and "Cancel"
- On confirm: call `editAndResend(messageId, newContent)`

### Files Changed

- `frontend/src/renderer/src/pages/AIChat/ChatMessage.tsx`
- `frontend/src/renderer/src/stores/useChatStore.ts`
- `frontend/src/renderer/src/i18n/index.ts`
- `backend/src/controllers/chatController.ts`
- `backend/src/services/chatService.ts`
- `backend/src/repositories/chatRepository.ts`
- `backend/src/routes/chat.ts`

## 3. AI Reply Action Bar

### Layout

Rendered below the AI message bubble content, only when `!isStreaming`:

```
[Copy] [ThumbUp] [ThumbDown]              [~320 tokens · 2.3s]
```

- Left side: icon-only buttons (antd `Button type="text" size="small"`)
- Right side: `<Text type="secondary" style={{ fontSize: 11 }}>` with token count and duration

### Data Capture

- `useChatStore.ts`: record `streamStartTime` when streaming begins
- On streaming `done` event: compute `durationMs = Date.now() - streamStartTime`, extract `usage.output_tokens` as `tokenCount`
- Store both in `MessageMetadata`

### Type Extension

```ts
// types/chat.ts
interface MessageMetadata {
  toolCalls?: ToolCall[]
  searchSources?: SearchSource[]
  tokenCount?: number      // NEW
  durationMs?: number       // NEW
  feedback?: 'up' | 'down'  // NEW - for thumbs up/down
  feedbackReason?: string    // NEW - optional user-provided reason
}
```

### Files Changed

- `frontend/src/renderer/src/types/chat.ts` - extend MessageMetadata
- `frontend/src/renderer/src/pages/AIChat/ChatMessage.tsx` - add MessageActionBar component
- `frontend/src/renderer/src/stores/useChatStore.ts` - capture token count and duration on stream completion

## 4. Agent Memory System

### File Structure

```
{userData}/clawbench-agent/{userId}/    # logged-in user
{userData}/clawbench-agent/local/       # local (offline) user
  soul.md      # Agent persona (platform preset, user-editable)
  memory.md    # AI-written long-term memory
  user.md      # AI-learned user profile and preferences
  tools.md     # Available tools description (auto-generated)
  agents.md    # Sub-agent definitions (user-editable)
  stats.json   # Cumulative feedback statistics (auto-updated)
```

### Default soul.md

```markdown
# ClawBench AI Assistant

## Identity
Built-in AI assistant for ClawBench desktop IDE, focused on developer workflows.

## Style
- Respond in the user's language
- Concise for simple questions, detailed for complex analysis
- No emoji unless the user uses them first

## Core Capabilities
- Code analysis and debugging
- Tool and environment management
- AI workflow orchestration
- Cross-module task dispatch

## Behavioral Rules
- State uncertainty explicitly when unsure
- Confirm with user before dangerous operations
- Learn from user feedback to improve responses over time
```

### stats.json Structure

```json
{
  "totalFeedback": { "up": 0, "down": 0 },
  "byTopic": {},
  "recentTrend": [],
  "soulSuggestions": []
}
```

Fields:
- `totalFeedback` - cumulative thumbs up/down counts
- `byTopic` - per-topic feedback counts (topics extracted by the LLM during feedback processing, e.g. "coding", "general", "debugging")
- `recentTrend` - daily aggregated feedback for the last 30 days: `{ date: string, up: number, down: number }`
- `soulSuggestions` - pending suggestions for soul.md modifications: `{ suggestion: string, reason: string, feedbackCount: number }[]`. These are surfaced in the Settings UI under "Feedback Statistics" for manual review and acceptance. The user can accept (append to soul.md) or dismiss each suggestion. Suggestions are NOT auto-applied — the threshold of 3+ feedbacks merely highlights them as "recommended" in the UI.

### Memory Service (Main Process)

New file: `frontend/src/main/services/agent-memory.service.ts`

```ts
interface AgentMemoryService {
  // Read a memory file for the current user
  readMemory(filename: string): Promise<string>
  // Write a memory file for the current user
  writeMemory(filename: string, content: string): Promise<void>
  // Read all memory files (including stats.json)
  readAllMemories(): Promise<Record<string, string>>
  // Get the memory directory path for current user
  getMemoryDir(): string
  // Read/update stats
  readStats(): Promise<FeedbackStats>
  updateStats(feedback: FeedbackData): Promise<void>
  // Sync local files to backend (logged-in users only)
  syncToBackend(): Promise<void>
  // Pull from backend on startup (logged-in users only)
  pullFromBackend(): Promise<void>
}
```

User identity: determined by `electron-store` auth state. Logged-in users use `{userId}/` subdirectory, local users use `local/`. The main process should import `settingsStore` from `store/settings.store.ts` and read the user ID from the stored auth token (the actual key name must be verified against the store schema during implementation).

### Feedback-to-Memory Flow (Enhanced)

When user clicks thumbs up/down on an AI reply:

1. **Frontend** records feedback:
   - For thumbs-down: show a popover with quick-select tags ("不准确/Inaccurate", "太啰嗦/Too verbose", "没回答问题/Didn't answer", "风格不好/Bad style") + an optional free-text input + "Submit" button
   - For thumbs-up: directly record (optionally expandable to add a reason)
   - Data: `{ messageId, feedbackType, reason?: string, conversationSnippet }`

2. **Frontend** calls `useChatStore.submitFeedback(messageId, type, reason?)`:
   - Updates `metadata.feedback` and `metadata.feedbackReason` on the message
   - Gathers full current conversation (truncated to last 20 messages or 4000 chars) as context snippet
   - Calls `window.api.agent.processFeedback(data)` (fire-and-forget)

3. **Main process** triggers a background LLM call (using direct HTTP `net.fetch` to the AI provider endpoint, NOT `streamChat()` which would conflict with the renderer's streaming state):
   - Uses `stream: false` for a simple request-response pattern
   - System prompt: "You are updating your long-term memory files based on user feedback. You have access to the current memory files and feedback statistics."
   - Input includes: conversation snippet + feedback type + user's reason + current memory.md + current user.md + current stats.json summary + current soul.md (first 1000 chars)
   - Expected output: JSON with keys:
     ```json
     {
       "memory_md": "...",
       "user_md": "...",
       "topic": "coding",
       "soul_suggestion": null | { "suggestion": "...", "reason": "..." }
     }
     ```
   - For thumbs-up: note effective patterns, user preferences, communication style
   - For thumbs-down: record improvement areas, what the user expected, what went wrong

4. **Main process** processes the LLM response:
   - Write updated `memory.md` and `user.md`
   - Update `stats.json`: increment counters, update byTopic, append to recentTrend, process soul_suggestion
   - If a `soul_suggestion` matches an existing suggestion in stats.json, increment its `feedbackCount`
   - If `feedbackCount >= 3`, auto-append the suggestion to `soul.md` and remove from pending suggestions
   - For logged-in users: debounced (5s) sync all changed files to backend

### System Prompt Integration

`buildSystemPrompt()` gains a new parameter `agentMemory`:

```ts
interface SystemPromptContext {
  // ... existing fields ...
  agentMemory?: {
    soul?: string
    memory?: string
    user?: string
    agents?: string
    statsSnippet?: string  // condensed stats for context
  }
}
```

Injection order in the built prompt:
1. soul.md content (always, replaces the old hardcoded "Base Identity" section)
2. memory.md (if > 100 chars)
3. user.md (if non-empty)
4. Stats snippet (if non-empty): a 1-2 line summary like "Feedback: 42 helpful, 8 unhelpful. Strongest topics: coding (90% positive). Recent trend: improving."
5. Workflow section
6. Tool Guidance section
7. Search Strategy section (if enabled)
8. Safety section
9. Context section
10. agents.md (if non-empty)

### Storage: Dual-Layer Sync

| User Type | Local Path | Backend Sync |
|-----------|-----------|--------------|
| Local | `{userData}/clawbench-agent/local/` | None |
| Logged-in | `{userData}/clawbench-agent/{userId}/` | Write-debounce 5s push; pull on startup (backend wins on conflict). UI should show a warning: "登录用户的记忆文件会与服务器同步，本地离线修改可能被覆盖" |

### Backend Schema

```sql
CREATE TABLE agent_memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  filename   TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, filename)
);
```

### Backend API

```
GET  /api/v1/agent/memory             → list all memory files for current user
GET  /api/v1/agent/memory/:filename   → read one file
PUT  /api/v1/agent/memory/:filename   → update one file { content: string }
```

Auth: JWT required (uses userId from token).

### Feedback UI → Memory Connection

In `ChatMessage.tsx`, the `MessageActionBar` thumbs buttons:
- Thumbs-up: directly calls `submitFeedback(messageId, 'up')`
- Thumbs-down: opens a `Popover` with:
  - 4 quick-select `Tag` buttons (checkable): "不准确", "太啰嗦", "没回答问题", "风格不好"
  - Optional `TextArea` (2 rows, placeholder: "补充说明...")
  - "Submit" button → calls `submitFeedback(messageId, 'down', combinedReason)`

`submitFeedback` action in `useChatStore`:
1. Updates the message's `metadata.feedback` and `metadata.feedbackReason` fields (persists to backend/localStorage)
2. Gathers last 20 messages (truncated) as context snippet
3. Calls `window.api.agent.processFeedback({ messageId, type, reason, snippet })` (fire-and-forget)

### Files Changed (new)

- `frontend/src/main/services/agent-memory.service.ts` - memory file read/write/sync/stats
- `frontend/src/main/ipc/agent-memory.ipc.ts` - IPC handlers
- `frontend/src/preload/api.ts` - add `agent` namespace
- `backend/src/repositories/agentMemoryRepository.ts`
- `backend/src/services/agentMemoryService.ts`
- `backend/src/controllers/agentMemoryController.ts`
- `backend/src/routes/agentMemory.ts`
- `backend/src/database/schema/` - migration for agent_memories table

### Files Changed (modified)

- `frontend/src/renderer/src/utils/system-prompt-builder.ts` - accept and inject agent memory + stats
- `frontend/src/renderer/src/stores/useChatStore.ts` - load memories before sending, handle feedback with reason
- `frontend/src/renderer/src/pages/Settings/AIAssistantSettings.tsx` - redesign with memory editor UI

## 5. Internal Cross-Module Tool Integration

### Architecture

IPC routing with MCP abstraction layer. Tools are accessed via a unified `InternalToolProvider` interface that currently routes through direct IPC, but can be swapped to real MCP servers in the future without changing the consumer code.

#### Abstraction Layer

```ts
// internal-tool-provider.ts
interface InternalToolProvider {
  name: string
  listTools(): Promise<ToolDefinition[]>
  executeTool(toolName: string, input: Record<string, any>): Promise<ToolResult>
}

interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
}

interface ToolResult {
  content: string
  isError: boolean
}
```

New file: `frontend/src/main/services/internal-tools.service.ts` implements a registry of `InternalToolProvider` instances, one per module:

```ts
class InternalToolRegistry {
  private providers: Map<string, InternalToolProvider> = new Map()

  register(provider: InternalToolProvider): void
  unregister(name: string): void
  listAllTools(): Promise<ToolDefinition[]>
  executeTool(toolName: string, input: Record<string, any>): Promise<ToolResult>
}
```

Each module implements `InternalToolProvider`:
- `LocalEnvToolProvider` - wraps local-env detection
- `WorkbenchToolProvider` - wraps sub-app listing and execution
- `CodingToolProvider` - wraps AI coding session management
- `TerminalToolProvider` - wraps DB connection and query

### Tool Definitions

| Tool Name | Source Module | Description |
|-----------|-------------|-------------|
| `get_dev_environment` | Local Env | Returns Python/Node/Git/Docker install status and versions |
| `list_workbench_apps` | Workbench | Lists installed Python sub-apps with parameter descriptions |
| `run_workbench_app` | Workbench | Runs a specified sub-app (triggers python-runner) |
| `list_coding_sessions` | AI Coding | Lists current Claude Code / Codex / Gemini session states |
| `query_database` | AI Terminal | Executes read-only SQL on connected databases. Safety: reject queries containing semicolons or keywords like DROP/DELETE/INSERT/UPDATE/ALTER/TRUNCATE (not just checking startsWith SELECT) |
| `list_db_connections` | AI Terminal | Gets configured DB connection list |

### Tool Execution Flow

1. AI model returns `tool_use` with an internal tool name
2. `useChatStore` tool handler recognizes it as internal (not MCP, not builtin)
3. Sends IPC: `window.api.internalTools.execute(toolName, input)`
4. Main process `InternalToolRegistry.executeTool()` routes to the correct provider
5. Provider calls the underlying module service
6. Returns result to chat store for continuation

### tools.md Auto-Generation

`tools.md` is auto-generated (not user-edited) listing all currently available internal tools. Refreshed:
- On app startup
- When DB connections change
- When apps are installed/uninstalled

Write is debounced and cached: only write to disk when content actually changes (compare with last-written content to avoid unnecessary I/O on every message send).

### Files Changed

- `frontend/src/main/services/internal-tools.service.ts` - new, tool registry + providers
- `frontend/src/main/ipc/internal-tools.ipc.ts` - new, IPC handlers
- `frontend/src/preload/api.ts` - add `internalTools` namespace
- `frontend/src/renderer/src/stores/useChatStore.ts` - register internal tools in getAvailableTools(), handle execution

## 6. AI Assistant Settings Redesign

### New Layout

Replace current `AIAssistantSettings.tsx` with sections:

```
AI Assistant Settings
├── Agent Persona (soul.md)
│     Monaco editor, full-text editable
│     [Restore Default] button
│
├── Long-term Memory
│     [memory.md] [user.md] tab switch
│     Monaco editor (read/write)
│     [Clear] + [Sync Now] (logged-in users only)
│
├── Feedback Statistics
│     Summary cards: total feedback, topic breakdown, recent trend chart
│     Pending soul.md suggestions with [Accept] / [Dismiss] buttons (highlighted when 3+ feedbacks support a suggestion)
│     [Reset Stats] button
│
├── Capabilities & Sub-agents
│     [tools.md] (read-only, auto-generated)
│     [agents.md] (editable)
│
└── Behavior Settings (preserved from current)
      Tool approval mode (Select)
      Max tool steps (Slider)
```

### Files Changed

- `frontend/src/renderer/src/pages/Settings/AIAssistantSettings.tsx` - full redesign
- `frontend/src/renderer/src/i18n/index.ts` - new i18n keys

## Non-Goals

- No customSystemPrompt migration (product not yet released)
- No multi-device sync conflict resolution beyond "backend wins"
- No real-time MCP server processes for internal tools (use IPC routing with MCP-compatible interface for now)
