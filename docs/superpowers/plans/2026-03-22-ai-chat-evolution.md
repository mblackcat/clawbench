# AI Chat Evolution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the AI Chat module with smart search gating, message actions (retract/copy), AI reply stats (tokens/duration/feedback), a full agent memory system (soul/memory/user/tools/agents.md), and internal cross-module tool integration.

**Architecture:** Six independent chunks: (1) search prompt optimization, (2) user message context menu, (3) AI reply action bar, (4) agent memory service + system prompt integration, (5) agent memory backend + settings UI, (6) internal cross-module tools. Each chunk is independently committable.

**Tech Stack:** Electron + React 18 + TypeScript + Ant Design v5 + Zustand + electron-vite (frontend); Node.js + Express + SQLite/MySQL/PostgreSQL (backend)

**Spec:** `docs/superpowers/specs/2026-03-22-ai-chat-evolution-design.md`

---

## Chunk 1: Smart Search Gating

### Task 1.1: Optimize Search Strategy in System Prompt

**Files:**
- Modify: `frontend/src/renderer/src/utils/system-prompt-builder.ts:39-50`

- [ ] **Step 1: Update the Search Strategy section**

Replace the current Search Strategy block (lines 39-50) in `buildSystemPrompt()`:

```ts
  // Search Strategy
  if (ctx.webSearchEnabled) {
    sections.push(`## Search Strategy
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
- Cite sources with URLs when available.`)
  }
```

- [ ] **Step 2: Verify the change compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to system-prompt-builder.ts

- [ ] **Step 3: Commit**

```bash
git add frontend/src/renderer/src/utils/system-prompt-builder.ts
git commit -m "feat(ai-chat): optimize search strategy prompt to avoid unnecessary searches"
```

---

## Chunk 2: User Message Context Menu

### Task 2.1: Add Message Delete to Backend

**Files:**
- Modify: `backend/src/repositories/messageRepository.ts`
- Modify: `backend/src/controllers/chatController.ts`
- Modify: `backend/src/routes/chatRoutes.ts`

- [ ] **Step 1: Add delete functions to messageRepository.ts**

Append to `backend/src/repositories/messageRepository.ts`:

```ts
/**
 * Delete a single message by ID
 */
export async function deleteMessageById(messageId: string): Promise<boolean> {
  const result = await database.run(
    'DELETE FROM messages WHERE message_id = ?',
    [messageId]
  );
  return (result?.changes ?? 0) > 0;
}

/**
 * Delete a message and all messages after it in the same conversation
 */
export async function deleteMessagesFromId(
  conversationId: string,
  messageId: string
): Promise<number> {
  // Get the created_at of the target message
  const msg = await database.get<MessageRow>(
    'SELECT created_at FROM messages WHERE message_id = ? AND conversation_id = ?',
    [messageId, conversationId]
  );
  if (!msg) return 0;

  const result = await database.run(
    'DELETE FROM messages WHERE conversation_id = ? AND created_at >= ?',
    [conversationId, msg.created_at]
  );
  return result?.changes ?? 0;
}
```

- [ ] **Step 2: Add delete handler to chatController.ts**

Append to `backend/src/controllers/chatController.ts` (add `deleteMessageById`, `deleteMessagesFromId`, `getMessageById` to the imports from messageRepository):

```ts
/**
 * Delete message(s)
 * DELETE /api/v1/chat/conversations/:id/messages/:messageId
 * Query: ?mode=single|from-here
 */
export async function deleteMessageHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const { id: conversationId, messageId } = req.params;
    const mode = (req.query.mode as string) || 'single';

    // Verify ownership
    const isOwner = await isConversationOwner(conversationId, req.userId);
    if (!isOwner) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not your conversation' },
      });
      return;
    }

    if (mode === 'from-here') {
      const count = await deleteMessagesFromId(conversationId, messageId);
      res.json({ success: true, data: { deleted: count } });
    } else {
      const ok = await deleteMessageById(messageId);
      res.json({ success: true, data: { deleted: ok ? 1 : 0 } });
    }
  } catch (err: any) {
    logger.error('Delete message error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
    });
  }
}
```

- [ ] **Step 3: Add route to chatRoutes.ts**

Add import of `deleteMessageHandler` and add route:

```ts
chatRouter.delete('/conversations/:id/messages/:messageId', authenticate, deleteMessageHandler);
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/repositories/messageRepository.ts backend/src/controllers/chatController.ts backend/src/routes/chatRoutes.ts
git commit -m "feat(backend): add message delete endpoint for retract feature"
```

### Task 2.2: Add deleteMessages Action to Chat Store

**Files:**
- Modify: `frontend/src/renderer/src/stores/useChatStore.ts`
- Modify: `frontend/src/renderer/src/services/apiClient.ts` (if needed for the API call)

- [ ] **Step 1: Add deleteMessages to ChatState interface and implementation**

Add to the ChatState interface (around line 170):

```ts
deleteMessages: (messageId: string, mode: 'single' | 'from-here') => Promise<void>
```

Add implementation in the store (after `clearActiveConversation`):

```ts
deleteMessages: async (messageId: string, mode: 'single' | 'from-here') => {
  const { activeConversationId, messages } = get()
  if (!activeConversationId) return

  // Optimistic UI update
  const targetIndex = messages.findIndex((m) => m.messageId === messageId)
  if (targetIndex === -1) return

  const updatedMessages =
    mode === 'from-here'
      ? messages.slice(0, targetIndex)
      : messages.filter((m) => m.messageId !== messageId)

  set({ messages: updatedMessages })

  // Persist
  if (isLocal()) {
    saveLocalMessages(activeConversationId, updatedMessages)
  } else {
    try {
      const token = apiClient.getToken()
      await fetch(
        `${API_BASE_URL}/chat/conversations/${activeConversationId}/messages/${messageId}?mode=${mode}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      )
    } catch (err) {
      console.error('Failed to delete message:', err)
    }
  }
},
```

- [ ] **Step 2: Verify compilation**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/renderer/src/stores/useChatStore.ts
git commit -m "feat(ai-chat): add deleteMessages action for retract functionality"
```

### Task 2.3: Add Context Menu to User Message Bubble

**Files:**
- Modify: `frontend/src/renderer/src/pages/AIChat/ChatMessage.tsx`
- Modify: `frontend/src/renderer/src/i18n/index.ts`

- [ ] **Step 1: Add i18n keys**

Add to zh-CN section (around line 370, after existing chat keys):

```ts
'chat.copy': '复制',
'chat.retract': '撤回',
'chat.retractConfirm': '撤回消息',
'chat.retractSingle': '仅撤回此条消息',
'chat.retractFromHere': '撤回此条及之后所有消息',
'chat.retractSingleDesc': '只删除这一条消息，保留前后对话',
'chat.retractFromHereDesc': '删除这条消息及其之后的所有内容',
'chat.copied': '已复制',
```

Add to en section (around line 1350):

```ts
'chat.copy': 'Copy',
'chat.retract': 'Retract',
'chat.retractConfirm': 'Retract Message',
'chat.retractSingle': 'Retract this message only',
'chat.retractFromHere': 'Retract this and all after',
'chat.retractSingleDesc': 'Only delete this message, keep surrounding conversation',
'chat.retractFromHereDesc': 'Delete this message and everything after it',
'chat.copied': 'Copied',
```

- [ ] **Step 2: Add context menu to ChatMessage.tsx**

Add imports at top of `ChatMessage.tsx`:

```ts
import { CopyOutlined, RollbackOutlined } from '@ant-design/icons'
import { App } from 'antd'
```

Note: `App` is already imported (check existing imports). `Dropdown` is already imported.

Inside the `ChatMessage` component, add after the existing hooks:

```ts
const { message: messageApi, modal } = App.useApp()
const deleteMessages = useChatStore((s) => s.deleteMessages)
const t = useT()

const handleUserContextMenu = useCallback(() => {
  // Context menu items are rendered by Dropdown
}, [])

const userContextMenuItems = isUser ? [
  {
    key: 'copy',
    icon: <CopyOutlined />,
    label: t('chat.copy'),
    onClick: () => {
      navigator.clipboard.writeText(message.content)
      messageApi.success(t('chat.copied'))
    },
  },
  {
    key: 'retract',
    icon: <RollbackOutlined />,
    label: t('chat.retract'),
    onClick: () => {
      modal.confirm({
        title: t('chat.retractConfirm'),
        content: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            <Button
              block
              onClick={() => {
                modal.destroyAll()
                deleteMessages(message.messageId, 'single')
              }}
            >
              {t('chat.retractSingle')}
            </Button>
            <Button
              block
              danger
              onClick={() => {
                modal.destroyAll()
                deleteMessages(message.messageId, 'from-here')
              }}
            >
              {t('chat.retractFromHere')}
            </Button>
          </div>
        ),
        footer: null,
      })
    },
  },
] : []
```

Wrap the user bubble `<div>` (the one with `background: isUser ? token.colorPrimary : ...`) with a Dropdown for user messages:

```tsx
{isUser ? (
  <Dropdown menu={{ items: userContextMenuItems }} trigger={['contextMenu']}>
    <div style={{ background: isUser ? token.colorPrimary : ... }}>
      {/* existing bubble content */}
    </div>
  </Dropdown>
) : (
  <div style={{ background: ... }}>
    {/* existing AI bubble content */}
  </div>
)}
```

Note: Keep the existing bubble div structure intact. Just wrap the user variant with `<Dropdown>`.

Also add `Button` to the antd import: the import already includes `Button` — verify and add if not present.

- [ ] **Step 3: Verify compilation**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/renderer/src/pages/AIChat/ChatMessage.tsx frontend/src/renderer/src/i18n/index.ts
git commit -m "feat(ai-chat): add right-click context menu with copy and retract for user messages"
```

---

## Chunk 3: AI Reply Action Bar

### Task 3.1: Extend MessageMetadata Types

**Files:**
- Modify: `frontend/src/renderer/src/types/chat.ts:53-56`

- [ ] **Step 1: Add new fields to MessageMetadata**

```ts
export interface MessageMetadata {
  toolCalls?: ToolCall[]
  searchSources?: SearchSource[]
  tokenCount?: number
  durationMs?: number
  feedback?: 'up' | 'down'
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/renderer/src/types/chat.ts
git commit -m "feat(ai-chat): extend MessageMetadata with tokenCount, durationMs, feedback fields"
```

### Task 3.2: Capture Token Count and Duration in Chat Store

**Files:**
- Modify: `frontend/src/renderer/src/stores/useChatStore.ts`

- [ ] **Step 1: Add streamStartTime to state**

Add to the ChatState interface:

```ts
streamStartTime: number
```

Initialize in the store defaults:

```ts
streamStartTime: 0,
```

- [ ] **Step 2: Set streamStartTime when streaming starts**

In `sendMessage` (around line 591 where streaming state is set), add:

```ts
set({ ..., streamStartTime: Date.now() })
```

- [ ] **Step 3: Pass usage data to finalizeStreaming**

Change `finalizeStreaming` signature to accept usage:

```ts
finalizeStreaming: (fullContent: string, modelId: string, thinkingContent?: string, usage?: { promptTokens?: number; completionTokens?: number }) => {
```

In the `assistantMsg` construction, compute and include metadata:

```ts
const durationMs = Date.now() - get().streamStartTime
const tokenCount = usage?.completionTokens || undefined

const assistantMsg: Message = {
  ...
  metadata: {
    ...(get().searchSources.length > 0 ? { searchSources: get().searchSources } : {}),
    ...(tokenCount ? { tokenCount } : {}),
    ...(durationMs > 0 ? { durationMs } : {}),
  },
  ...
}
```

If the resulting metadata object has no keys, set it to `undefined`.

- [ ] **Step 4: Update all callers of finalizeStreaming to pass usage**

In `streamBuiltinWithMessages` (around line 1277-1278), the SSE `done` event:

```ts
} else if (data.type === 'done') {
  useChatStore.getState().finalizeStreaming(fullContent, modelId, fullThinkingContent || undefined, data.usage)
}
```

In `streamLocalWithMessages` (around line 1398-1401), the IPC `done` handler:

```ts
const cleanupDone = window.api.ai.onChatDone((data) => {
  if (data.taskId === taskId) {
    useChatStore.getState().finalizeStreaming(fullContent, modelId, fullThinkingContent || undefined, data.usage)
    cleanup()
  }
})
```

- [ ] **Step 5: Verify compilation**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/renderer/src/stores/useChatStore.ts
git commit -m "feat(ai-chat): capture token count and duration on stream completion"
```

### Task 3.3: Add submitFeedback Action

**Files:**
- Modify: `frontend/src/renderer/src/stores/useChatStore.ts`

- [ ] **Step 1: Add submitFeedback to ChatState and implementation**

Add to interface:

```ts
submitFeedback: (messageId: string, type: 'up' | 'down') => void
```

Add implementation:

```ts
submitFeedback: (messageId: string, type: 'up' | 'down') => {
  // Update message metadata with feedback
  set((state) => ({
    messages: state.messages.map((m) =>
      m.messageId === messageId
        ? { ...m, metadata: { ...m.metadata, feedback: type } }
        : m
    ),
  }))

  // Persist feedback to backend
  const { activeConversationId, messages } = get()
  if (activeConversationId && !isLocal()) {
    const msg = messages.find((m) => m.messageId === messageId)
    if (msg) {
      apiClient.sendMessage(activeConversationId, {
        role: msg.role,
        content: msg.content,
        modelId: msg.modelId || undefined,
        metadata: { ...msg.metadata, feedback: type },
      }).catch(() => {})
    }
  } else if (activeConversationId && isLocal()) {
    saveLocalMessages(activeConversationId, get().messages)
  }

  // Trigger memory update via IPC (fire-and-forget) — will be implemented in Chunk 4
  const snippet = messages.slice(-5).map((m) => ({
    role: m.role,
    content: m.content.substring(0, 500),
  }))
  try {
    window.api.agent?.processFeedback?.({ messageId, type, snippet })
  } catch {
    // agent namespace not yet available — skip
  }
},
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/renderer/src/stores/useChatStore.ts
git commit -m "feat(ai-chat): add submitFeedback action for thumbs up/down"
```

### Task 3.4: Build MessageActionBar Component

**Files:**
- Modify: `frontend/src/renderer/src/pages/AIChat/ChatMessage.tsx`
- Modify: `frontend/src/renderer/src/i18n/index.ts`

- [ ] **Step 1: Add i18n keys**

Add to zh-CN:

```ts
'chat.thumbsUp': '有帮助',
'chat.thumbsDown': '没帮助',
'chat.tokens': 'tokens',
```

Add to en:

```ts
'chat.thumbsUp': 'Helpful',
'chat.thumbsDown': 'Not helpful',
'chat.tokens': 'tokens',
```

- [ ] **Step 2: Create MessageActionBar inside ChatMessage.tsx**

Add before the `ChatMessage` component:

```tsx
import { CopyOutlined, LikeOutlined, DislikeOutlined, LikeFilled, DislikeFilled } from '@ant-design/icons'

function MessageActionBar({ message }: { message: Message }) {
  const { token } = theme.useToken()
  const { message: messageApi } = App.useApp()
  const submitFeedback = useChatStore((s) => s.submitFeedback)
  const t = useT()

  const feedback = message.metadata?.feedback

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    messageApi.success(t('chat.copied'))
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 6,
        paddingTop: 4,
      }}
    >
      {/* Left: action buttons */}
      <div style={{ display: 'flex', gap: 2 }}>
        <Button
          type="text"
          size="small"
          icon={<CopyOutlined />}
          onClick={handleCopy}
          style={{ color: token.colorTextTertiary, fontSize: 12 }}
        />
        <Button
          type="text"
          size="small"
          icon={feedback === 'up' ? <LikeFilled /> : <LikeOutlined />}
          onClick={() => submitFeedback(message.messageId, 'up')}
          style={{
            color: feedback === 'up' ? token.colorPrimary : token.colorTextTertiary,
            fontSize: 12,
          }}
        />
        <Button
          type="text"
          size="small"
          icon={feedback === 'down' ? <DislikeFilled /> : <DislikeOutlined />}
          onClick={() => submitFeedback(message.messageId, 'down')}
          style={{
            color: feedback === 'down' ? token.colorError : token.colorTextTertiary,
            fontSize: 12,
          }}
        />
      </div>

      {/* Right: stats */}
      <div style={{ fontSize: 11, color: token.colorTextQuaternary }}>
        {message.metadata?.tokenCount && (
          <span>~{message.metadata.tokenCount} {t('chat.tokens')}</span>
        )}
        {message.metadata?.tokenCount && message.metadata?.durationMs && (
          <span> · </span>
        )}
        {message.metadata?.durationMs && (
          <span>{(message.metadata.durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Render MessageActionBar in AI message bubbles**

In the `ChatMessage` component, after the model tag (`{message.modelId && !isUser && ...}`), add:

```tsx
{/* Action bar for AI messages */}
{!isUser && !isStreaming && (
  <MessageActionBar message={message} />
)}
```

- [ ] **Step 4: Verify compilation**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderer/src/pages/AIChat/ChatMessage.tsx frontend/src/renderer/src/i18n/index.ts
git commit -m "feat(ai-chat): add action bar with copy, thumbs up/down, token count and duration"
```

---

## Chunk 4: Agent Memory Service + System Prompt Integration

### Task 4.1: Create Agent Memory Service (Main Process)

**Files:**
- Create: `frontend/src/main/services/agent-memory.service.ts`

- [ ] **Step 1: Create the service**

```ts
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { logger } from '../utils/logger'

const MEMORY_FILES = ['soul.md', 'memory.md', 'user.md', 'tools.md', 'agents.md'] as const
type MemoryFilename = (typeof MEMORY_FILES)[number]

const DEFAULT_SOUL = `# ClawBench AI Assistant

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
`

function getMemoryDir(userId?: string): string {
  const base = path.join(app.getPath('userData'), 'clawbench-agent')
  return path.join(base, userId || 'local')
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function readMemoryFile(filename: MemoryFilename, userId?: string): string {
  const dir = getMemoryDir(userId)
  const filePath = path.join(dir, filename)

  if (!fs.existsSync(filePath)) {
    // Return default for soul.md, empty for others
    if (filename === 'soul.md') return DEFAULT_SOUL
    return ''
  }

  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    logger.error(`Failed to read memory file ${filename}:`, err)
    return filename === 'soul.md' ? DEFAULT_SOUL : ''
  }
}

export function writeMemoryFile(filename: MemoryFilename, content: string, userId?: string): void {
  const dir = getMemoryDir(userId)
  ensureDir(dir)
  const filePath = path.join(dir, filename)

  try {
    fs.writeFileSync(filePath, content, 'utf-8')
  } catch (err) {
    logger.error(`Failed to write memory file ${filename}:`, err)
  }
}

export function readAllMemories(userId?: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const f of MEMORY_FILES) {
    result[f] = readMemoryFile(f, userId)
  }
  return result
}

export function resetMemoryFile(filename: MemoryFilename, userId?: string): void {
  if (filename === 'soul.md') {
    writeMemoryFile('soul.md', DEFAULT_SOUL, userId)
  } else {
    writeMemoryFile(filename, '', userId)
  }
}

export { MEMORY_FILES, MemoryFilename, DEFAULT_SOUL }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/main/services/agent-memory.service.ts
git commit -m "feat(agent-memory): create agent memory service for soul/memory/user/tools/agents.md"
```

### Task 4.2: Create Agent Memory IPC Handlers

**Files:**
- Create: `frontend/src/main/ipc/agent-memory.ipc.ts`
- Modify: `frontend/src/main/ipc/index.ts`

- [ ] **Step 1: Create IPC handler file**

```ts
import { ipcMain } from 'electron'
import {
  readMemoryFile,
  writeMemoryFile,
  readAllMemories,
  resetMemoryFile,
  MEMORY_FILES,
  MemoryFilename,
} from '../services/agent-memory.service'
import { getSettingsStore } from '../store/settings.store'

function getCurrentUserId(): string | undefined {
  try {
    const store = getSettingsStore()
    return store.get('authUserId') as string | undefined
  } catch {
    return undefined
  }
}

export function registerAgentMemoryIpc(): void {
  ipcMain.handle('agent-memory:read', (_event, filename: string) => {
    if (!MEMORY_FILES.includes(filename as MemoryFilename)) {
      throw new Error(`Invalid memory file: ${filename}`)
    }
    return readMemoryFile(filename as MemoryFilename, getCurrentUserId())
  })

  ipcMain.handle('agent-memory:write', (_event, filename: string, content: string) => {
    if (!MEMORY_FILES.includes(filename as MemoryFilename)) {
      throw new Error(`Invalid memory file: ${filename}`)
    }
    writeMemoryFile(filename as MemoryFilename, content, getCurrentUserId())
  })

  ipcMain.handle('agent-memory:read-all', () => {
    return readAllMemories(getCurrentUserId())
  })

  ipcMain.handle('agent-memory:reset', (_event, filename: string) => {
    if (!MEMORY_FILES.includes(filename as MemoryFilename)) {
      throw new Error(`Invalid memory file: ${filename}`)
    }
    resetMemoryFile(filename as MemoryFilename, getCurrentUserId())
  })

  ipcMain.handle('agent-memory:process-feedback', async (_event, data: {
    messageId: string
    type: 'up' | 'down'
    snippet: Array<{ role: string; content: string }>
  }) => {
    // This will be connected to a background LLM call in Task 4.4
    // For now, just log
    const { logger } = await import('../utils/logger')
    logger.info('Agent feedback received:', data.type, data.messageId)
  })
}
```

- [ ] **Step 2: Register in ipc/index.ts**

Add import and call `registerAgentMemoryIpc()` in the `registerAllIpc()` function.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/main/ipc/agent-memory.ipc.ts frontend/src/main/ipc/index.ts
git commit -m "feat(agent-memory): add IPC handlers for memory file operations"
```

### Task 4.3: Expose agent Namespace in Preload API

**Files:**
- Modify: `frontend/src/preload/api.ts`

- [ ] **Step 1: Add agent namespace**

Add before `windowControl` (around line 573):

```ts
agent: {
  readMemory: (filename: string) =>
    ipcRenderer.invoke('agent-memory:read', filename),
  writeMemory: (filename: string, content: string) =>
    ipcRenderer.invoke('agent-memory:write', filename, content),
  readAll: () => ipcRenderer.invoke('agent-memory:read-all'),
  resetMemory: (filename: string) =>
    ipcRenderer.invoke('agent-memory:reset', filename),
  processFeedback: (data: {
    messageId: string
    type: 'up' | 'down'
    snippet: Array<{ role: string; content: string }>
  }) => ipcRenderer.invoke('agent-memory:process-feedback', data),
},
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/preload/api.ts
git commit -m "feat(agent-memory): expose agent memory namespace in preload API"
```

### Task 4.4: Integrate Agent Memory into System Prompt Builder

**Files:**
- Modify: `frontend/src/renderer/src/utils/system-prompt-builder.ts`
- Modify: `frontend/src/renderer/src/stores/useChatStore.ts`

- [ ] **Step 1: Update SystemPromptContext and buildSystemPrompt**

Add to `SystemPromptContext`:

```ts
agentMemory?: {
  soul?: string
  memory?: string
  user?: string
  agents?: string
}
```

Rewrite `buildSystemPrompt` to inject memory:

```ts
export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const sections: string[] = []

  // 1. Soul (replaces old hardcoded base identity)
  if (ctx.agentMemory?.soul) {
    sections.push(ctx.agentMemory.soul)
  } else {
    sections.push(`You are a professional AI assistant. You are accurate, helpful, and thorough.
- Respond in the same language the user uses
- Do not use emoji unless the user does
- Prioritize accuracy over speed — verify facts before stating them
- Be concise for simple questions, detailed for complex ones`)
  }

  // 2. Long-term memory
  if (ctx.agentMemory?.memory && ctx.agentMemory.memory.trim().length > 100) {
    sections.push(`## Your Memory\nThe following is your accumulated memory from past interactions. Use it to provide more personalized and consistent responses:\n\n${ctx.agentMemory.memory}`)
  }

  // 3. User profile
  if (ctx.agentMemory?.user && ctx.agentMemory.user.trim().length > 0) {
    sections.push(`## User Profile\nWhat you've learned about this user:\n\n${ctx.agentMemory.user}`)
  }

  // 4. Workflow (unchanged)
  sections.push(`## Workflow
1. Understand the user's intent before acting
2. For simple questions, answer directly
3. For complex tasks, briefly outline your plan, then execute step by step
4. When using tools, prefer parallel execution for independent calls
5. After completing tool calls, synthesize results into a clear answer`)

  // 5. Tool Guidance (unchanged)
  if (ctx.availableTools.length > 0) {
    sections.push(`## Tool Usage
- Use tools proactively when they can improve answer quality
- Never expose API keys, credentials, or environment variables in tool calls
- For command execution: prefer safe, read-only commands; avoid destructive operations
- Available tools: ${ctx.availableTools.join(', ')}`)
  }

  // 6. Search Strategy (updated in Chunk 1)
  if (ctx.webSearchEnabled) {
    sections.push(`## Search Strategy
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
- Cite sources with URLs when available.`)
  }

  // 7. Safety (unchanged)
  sections.push(`## Safety
- Never reveal API keys, tokens, passwords, or other credentials
- Never execute destructive commands (rm -rf, DROP TABLE, etc.) without explicit user confirmation
- If a request seems harmful or unethical, explain why and suggest alternatives`)

  // 8. Context (unchanged)
  sections.push(`## Context
- Current time: ${ctx.currentTime}
- Timezone: ${ctx.timezone}
- Platform: ${ctx.platform}
- User language: ${ctx.language}`)

  // 9. User custom prompt (removed — replaced by soul.md)

  // 10. Sub-agents
  if (ctx.agentMemory?.agents && ctx.agentMemory.agents.trim().length > 0) {
    sections.push(`## Sub-Agents\n${ctx.agentMemory.agents}`)
  }

  return sections.join('\n\n')
}
```

Remove the `userCustomPrompt` field from `SystemPromptContext` since it's now replaced by soul.md.

- [ ] **Step 2: Update useChatStore to load memories before sending**

In both `streamBuiltin` (line ~1197) and `streamLocal` (line ~1324), replace the customPrompt loading with memory loading:

```ts
// Load agent memory for system prompt
let agentMemory: Record<string, string> = {}
try {
  agentMemory = await window.api.agent.readAll()
} catch { /* ignore */ }

const systemPrompt = buildSystemPrompt({
  currentTime: new Date().toLocaleString(),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  platform: window.api.platform || 'unknown',
  language: lang,
  availableTools: allToolNames,
  webSearchEnabled: !!webSearchEnabled,
  agentMemory: {
    soul: agentMemory['soul.md'],
    memory: agentMemory['memory.md'],
    user: agentMemory['user.md'],
    agents: agentMemory['agents.md'],
  },
})
```

Remove the old `customPrompt` / `getAgentSettings` loading code in these functions.

- [ ] **Step 3: Verify compilation**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/renderer/src/utils/system-prompt-builder.ts frontend/src/renderer/src/stores/useChatStore.ts
git commit -m "feat(agent-memory): integrate agent memory files into system prompt builder"
```

### Task 4.4: Implement Feedback-to-Memory LLM Flow

**Files:**
- Modify: `frontend/src/main/ipc/agent-memory.ipc.ts`
- Modify: `frontend/src/main/services/agent-memory.service.ts`

- [ ] **Step 1: Add processFeedback to agent-memory.service.ts**

Append to the service:

```ts
import { streamChat } from './ai.service'
import { BrowserWindow } from 'electron'

/**
 * Process user feedback by triggering a background LLM call
 * to update memory.md and user.md
 */
export async function processFeedback(
  data: {
    messageId: string
    type: 'up' | 'down'
    snippet: Array<{ role: string; content: string }>
  },
  userId?: string
): Promise<void> {
  const currentMemory = readMemoryFile('memory.md', userId)
  const currentUser = readMemoryFile('user.md', userId)

  const systemMessage = `You are updating your own long-term memory files based on user feedback.
You have two files to update:
1. memory.md — your accumulated knowledge, effective patterns, and improvement notes
2. user.md — your profile of this user: preferences, communication style, expertise areas

Rules:
- Be concise, don't duplicate existing content
- Append new insights, don't overwrite everything
- For thumbs-up: note what worked well, effective response patterns
- For thumbs-down: note what to improve, user's preferred approach
- Return ONLY valid JSON with two keys: "memory_md" and "user_md"
- Each value should be the COMPLETE updated file content`

  const userMessage = `## Current memory.md (first 3000 chars):
${currentMemory.substring(0, 3000)}

## Current user.md (first 2000 chars):
${currentUser.substring(0, 2000)}

## Recent conversation snippet:
${data.snippet.map((m) => `[${m.role}]: ${m.content}`).join('\n')}

## Feedback: ${data.type === 'up' ? 'THUMBS UP (user liked this response)' : 'THUMBS DOWN (user disliked this response)'}

Please update both files based on this feedback. Return JSON only.`

  // Use the first available model config for background processing
  try {
    const { getModelConfigs } = await import('./settings.service')
    const configs = getModelConfigs()
    if (configs.length === 0) {
      logger.info('No model configs available for feedback processing')
      return
    }

    const config = configs[0]
    const modelId = config.models[0] || config.name

    // Use a simple non-streaming approach for background task
    const messages = [
      { role: 'system' as const, content: systemMessage },
      { role: 'user' as const, content: userMessage },
    ]

    // Get the main window for streaming
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return

    const taskId = await streamChat(win, config.id, messages, modelId)

    // Collect the response
    let response = ''
    const handler = (_event: any, eventData: any) => {
      if (eventData.taskId === taskId) {
        if (eventData.content) response += eventData.content
      }
    }
    const doneHandler = (_event: any, eventData: any) => {
      if (eventData.taskId === taskId) {
        win.webContents.removeListener('ai:chat-delta' as any, handler)
        win.webContents.removeListener('ai:chat-done' as any, doneHandler)

        // Parse JSON response
        try {
          // Extract JSON from response (may have markdown code blocks)
          const jsonMatch = response.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            if (parsed.memory_md) {
              writeMemoryFile('memory.md', parsed.memory_md, userId)
            }
            if (parsed.user_md) {
              writeMemoryFile('user.md', parsed.user_md, userId)
            }
            logger.info('Agent memory updated from feedback')
          }
        } catch (parseErr) {
          logger.error('Failed to parse feedback LLM response:', parseErr)
        }
      }
    }

    // Listen for IPC events from the streaming
    win.webContents.ipc.on('ai:chat-delta', handler)
    win.webContents.ipc.on('ai:chat-done', doneHandler)
  } catch (err) {
    logger.error('Failed to process feedback:', err)
  }
}
```

Note: The exact streaming mechanism needs adaptation. Since this is a background task, consider using the AI service directly with a simpler approach. The implementation above outlines the pattern — during actual implementation, use the simplest available method (e.g., direct HTTP call to OpenAI-compatible endpoint if local model, or backend AI endpoint if builtin).

- [ ] **Step 2: Connect IPC handler to the service**

In `agent-memory.ipc.ts`, update the `process-feedback` handler:

```ts
ipcMain.handle('agent-memory:process-feedback', async (_event, data) => {
  const userId = getCurrentUserId()
  // Fire-and-forget — don't block the UI
  processFeedback(data, userId).catch((err) => {
    logger.error('Feedback processing failed:', err)
  })
})
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/main/services/agent-memory.service.ts frontend/src/main/ipc/agent-memory.ipc.ts
git commit -m "feat(agent-memory): implement feedback-to-memory LLM update flow"
```

---

## Chunk 5: Backend Memory Sync + Settings UI Redesign

### Task 5.1: Backend Agent Memory API

**Files:**
- Create: `backend/src/repositories/agentMemoryRepository.ts`
- Create: `backend/src/controllers/agentMemoryController.ts`
- Create: `backend/src/routes/agentMemoryRoutes.ts`
- Modify: `backend/src/database/schema/sqlite.schema.ts`
- Modify: `backend/src/database/schema/mysql.schema.ts`
- Modify: `backend/src/database/schema/postgres.schema.ts`
- Modify: `backend/src/app.ts` (or wherever routes are registered)

- [ ] **Step 1: Add agent_memories table to all DB schemas**

Add to each schema file the `CREATE TABLE IF NOT EXISTS agent_memories` statement:

SQLite:
```sql
CREATE TABLE IF NOT EXISTS agent_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  UNIQUE(user_id, filename)
);
```

MySQL:
```sql
CREATE TABLE IF NOT EXISTS agent_memories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  filename VARCHAR(100) NOT NULL,
  content LONGTEXT NOT NULL DEFAULT (''),
  updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
  UNIQUE KEY idx_agent_memories_user_file (user_id, filename)
);
```

PostgreSQL:
```sql
CREATE TABLE IF NOT EXISTS agent_memories (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  filename VARCHAR(100) NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  UNIQUE(user_id, filename)
);
```

- [ ] **Step 2: Create agentMemoryRepository.ts**

```ts
import { database } from '../database';

export interface AgentMemory {
  id: number;
  userId: string;
  filename: string;
  content: string;
  updatedAt: number;
}

export async function getMemoryByUserAndFile(
  userId: string,
  filename: string
): Promise<AgentMemory | undefined> {
  return database.get<AgentMemory>(
    'SELECT id, user_id AS "userId", filename, content, updated_at AS "updatedAt" FROM agent_memories WHERE user_id = ? AND filename = ?',
    [userId, filename]
  );
}

export async function getAllMemoriesByUser(
  userId: string
): Promise<AgentMemory[]> {
  return database.all<AgentMemory>(
    'SELECT id, user_id AS "userId", filename, content, updated_at AS "updatedAt" FROM agent_memories WHERE user_id = ?',
    [userId]
  );
}

export async function upsertMemory(
  userId: string,
  filename: string,
  content: string
): Promise<void> {
  const now = Date.now();
  const existing = await getMemoryByUserAndFile(userId, filename);
  if (existing) {
    await database.run(
      'UPDATE agent_memories SET content = ?, updated_at = ? WHERE user_id = ? AND filename = ?',
      [content, now, userId, filename]
    );
  } else {
    await database.run(
      'INSERT INTO agent_memories (user_id, filename, content, updated_at) VALUES (?, ?, ?, ?)',
      [userId, filename, content, now]
    );
  }
}
```

- [ ] **Step 3: Create agentMemoryController.ts**

```ts
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  getAllMemoriesByUser,
  getMemoryByUserAndFile,
  upsertMemory,
} from '../repositories/agentMemoryRepository';
import { logger } from '../utils/logger';

const VALID_FILES = ['soul.md', 'memory.md', 'user.md', 'tools.md', 'agents.md'];

export async function listMemoriesHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
      return;
    }
    const memories = await getAllMemoriesByUser(req.userId);
    const result: Record<string, string> = {};
    for (const m of memories) {
      result[m.filename] = m.content;
    }
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error('List memories error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
}

export async function getMemoryHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
      return;
    }
    const { filename } = req.params;
    if (!VALID_FILES.includes(filename)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid filename' } });
      return;
    }
    const memory = await getMemoryByUserAndFile(req.userId, filename);
    res.json({ success: true, data: { content: memory?.content || '' } });
  } catch (err: any) {
    logger.error('Get memory error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
}

export async function updateMemoryHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
      return;
    }
    const { filename } = req.params;
    if (!VALID_FILES.includes(filename)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid filename' } });
      return;
    }
    const { content } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Content must be a string' } });
      return;
    }
    await upsertMemory(req.userId, filename, content);
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Update memory error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
}
```

- [ ] **Step 4: Create agentMemoryRoutes.ts and register**

```ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listMemoriesHandler,
  getMemoryHandler,
  updateMemoryHandler,
} from '../controllers/agentMemoryController';

const agentMemoryRouter = Router();

agentMemoryRouter.get('/memory', authenticate, listMemoriesHandler);
agentMemoryRouter.get('/memory/:filename', authenticate, getMemoryHandler);
agentMemoryRouter.put('/memory/:filename', authenticate, updateMemoryHandler);

export default agentMemoryRouter;
```

Register in the app: `app.use('/api/v1/agent', agentMemoryRouter);`

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/agentMemoryRepository.ts backend/src/controllers/agentMemoryController.ts backend/src/routes/agentMemoryRoutes.ts backend/src/database/schema/ backend/src/app.ts
git commit -m "feat(backend): add agent memory CRUD API and DB schema"
```

### Task 5.2: Add Backend Sync to Memory Service

**Files:**
- Modify: `frontend/src/main/services/agent-memory.service.ts`

- [ ] **Step 1: Add sync functions**

Add debounced sync-to-backend and pull-from-backend functions:

```ts
import { net } from 'electron'

let syncTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleSyncToBackend(userId: string, apiBaseUrl: string, token: string): void {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(async () => {
    await syncToBackend(userId, apiBaseUrl, token)
  }, 5000)
}

async function syncToBackend(userId: string, apiBaseUrl: string, token: string): Promise<void> {
  try {
    const memories = readAllMemories(userId)
    for (const [filename, content] of Object.entries(memories)) {
      const response = await net.fetch(`${apiBaseUrl}/api/v1/agent/memory/${filename}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      })
      if (!response.ok) {
        logger.error(`Failed to sync ${filename} to backend: ${response.status}`)
      }
    }
    logger.info('Agent memory synced to backend')
  } catch (err) {
    logger.error('Failed to sync memories to backend:', err)
  }
}

export async function pullFromBackend(userId: string, apiBaseUrl: string, token: string): Promise<void> {
  try {
    const response = await net.fetch(`${apiBaseUrl}/api/v1/agent/memory`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return

    const data = await response.json()
    if (data.success && data.data) {
      const dir = getMemoryDir(userId)
      ensureDir(dir)
      for (const [filename, content] of Object.entries(data.data)) {
        if (MEMORY_FILES.includes(filename as MemoryFilename) && typeof content === 'string') {
          // Backend wins on conflict
          writeMemoryFile(filename as MemoryFilename, content, userId)
        }
      }
      logger.info('Agent memory pulled from backend')
    }
  } catch (err) {
    logger.error('Failed to pull memories from backend:', err)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/main/services/agent-memory.service.ts
git commit -m "feat(agent-memory): add debounced sync-to-backend and pull-from-backend"
```

### Task 5.3: Redesign AI Assistant Settings Page

**Files:**
- Modify: `frontend/src/renderer/src/pages/Settings/AIAssistantSettings.tsx`
- Modify: `frontend/src/renderer/src/i18n/index.ts`

- [ ] **Step 1: Add i18n keys for settings redesign**

Add to zh-CN:

```ts
'settings.aiAssistant.agentPersona': 'Agent 人设',
'settings.aiAssistant.agentPersonaDesc': '定义 AI 助手的身份、风格和行为准则（soul.md）',
'settings.aiAssistant.restoreDefault': '恢复默认',
'settings.aiAssistant.longTermMemory': '长期记忆',
'settings.aiAssistant.longTermMemoryDesc': 'AI 助手从交互中积累的记忆和用户画像',
'settings.aiAssistant.memoryTab': '交互记忆',
'settings.aiAssistant.userTab': '用户画像',
'settings.aiAssistant.clearFile': '清空',
'settings.aiAssistant.syncNow': '立即同步',
'settings.aiAssistant.capabilities': '能力与子 Agent',
'settings.aiAssistant.capabilitiesDesc': '可用工具和子 Agent 分工定义',
'settings.aiAssistant.toolsTab': '工具能力',
'settings.aiAssistant.agentsTab': '子 Agent',
'settings.aiAssistant.behavior': '行为设置',
'settings.aiAssistant.saved': '已保存',
'settings.aiAssistant.cleared': '已清空',
'settings.aiAssistant.synced': '同步成功',
'settings.aiAssistant.restored': '已恢复默认',
```

Add corresponding en keys.

- [ ] **Step 2: Rewrite AIAssistantSettings.tsx**

Replace the entire component with the new design featuring four collapsible Card sections:

1. **Agent Persona** — TextArea for soul.md with Restore Default button
2. **Long-term Memory** — Tabs (memory.md / user.md) with TextArea + Clear + Sync Now
3. **Capabilities** — Tabs (tools.md read-only / agents.md editable)
4. **Behavior Settings** — preserved tool approval mode and max steps

Use antd `Collapse` or separate `Card` components. Each TextArea saves on blur (debounced).

Key implementation notes:
- Load all memories via `window.api.agent.readAll()` on mount
- Save individual files via `window.api.agent.writeMemory(filename, content)` on blur
- Sync button calls backend API directly (for logged-in users)
- Use `useAuthStore` to determine if user is logged in (for showing sync button)

- [ ] **Step 3: Verify compilation**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/renderer/src/pages/Settings/AIAssistantSettings.tsx frontend/src/renderer/src/i18n/index.ts
git commit -m "feat(settings): redesign AI Assistant settings with agent memory management UI"
```

---

## Chunk 6: Internal Cross-Module Tool Integration

### Task 6.1: Create Internal Tools Service

**Files:**
- Create: `frontend/src/main/services/internal-tools.service.ts`

- [ ] **Step 1: Create the service with tool definitions and routing**

```ts
import { logger } from '../utils/logger'

export interface InternalToolDef {
  name: string
  description: string
  inputSchema: Record<string, any>
}

export function getInternalToolDefinitions(): InternalToolDef[] {
  return [
    {
      name: 'get_dev_environment',
      description: 'Get the status of development tools installed on this machine (Python, Node.js, Git, Docker, and AI coding tools). Returns version info and install paths.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'list_workbench_apps',
      description: 'List all installed Python sub-apps in the ClawBench workbench, including their names, descriptions, and parameter schemas.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'run_workbench_app',
      description: 'Run an installed Python sub-app by its ID with the given parameters.',
      inputSchema: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'The app ID from list_workbench_apps' },
          params: { type: 'object', description: 'Parameters to pass to the app' },
        },
        required: ['appId'],
      },
    },
    {
      name: 'list_coding_sessions',
      description: 'List active AI coding sessions (Claude Code, Codex, Gemini CLI) with their status and working directories.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'list_db_connections',
      description: 'List configured database connections in AI Terminal (MySQL, PostgreSQL, MongoDB, SQLite).',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'query_database',
      description: 'Execute a read-only SQL query on a connected database. Only SELECT queries are allowed.',
      inputSchema: {
        type: 'object',
        properties: {
          connectionId: { type: 'string', description: 'The DB connection ID from list_db_connections' },
          sql: { type: 'string', description: 'The SELECT SQL query to execute' },
        },
        required: ['connectionId', 'sql'],
      },
    },
  ]
}

export async function executeInternalTool(
  toolName: string,
  input: Record<string, any>
): Promise<{ content: string; isError: boolean }> {
  try {
    switch (toolName) {
      case 'get_dev_environment': {
        const { detectAll } = await import('./local-env.service')
        const results = await detectAll()
        return { content: JSON.stringify(results, null, 2), isError: false }
      }

      case 'list_workbench_apps': {
        const { listInstalledApps } = await import('./subapp.service')
        const apps = await listInstalledApps()
        return { content: JSON.stringify(apps, null, 2), isError: false }
      }

      case 'run_workbench_app': {
        const { executeApp } = await import('./subapp.service')
        const result = await executeApp(input.appId, input.params)
        return { content: JSON.stringify(result), isError: false }
      }

      case 'list_coding_sessions': {
        const { getSessions } = await import('./ai-workbench.service')
        const sessions = await getSessions()
        const summary = sessions.map((s: any) => ({
          id: s.id,
          toolType: s.toolType,
          status: s.status,
          workingDir: s.workingDir,
        }))
        return { content: JSON.stringify(summary, null, 2), isError: false }
      }

      case 'list_db_connections': {
        const { getDBConnections } = await import('./ai-terminal.service')
        const conns = await getDBConnections()
        return { content: JSON.stringify(conns, null, 2), isError: false }
      }

      case 'query_database': {
        // Safety: only allow SELECT
        const sql = (input.sql || '').trim()
        if (!sql.toUpperCase().startsWith('SELECT')) {
          return { content: 'Error: Only SELECT queries are allowed for safety.', isError: true }
        }
        const { queryDB } = await import('./ai-terminal.service')
        const result = await queryDB(input.connectionId, sql)
        return { content: JSON.stringify(result, null, 2), isError: false }
      }

      default:
        return { content: `Unknown internal tool: ${toolName}`, isError: true }
    }
  } catch (err: any) {
    logger.error(`Internal tool ${toolName} failed:`, err)
    return { content: `Error: ${err.message}`, isError: true }
  }
}
```

Note: The exact import paths and function signatures for `detectAll`, `listInstalledApps`, `executeApp`, `getSessions`, `getDBConnections`, `queryDB` need to be verified against the actual service exports during implementation. Adjust accordingly.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/main/services/internal-tools.service.ts
git commit -m "feat(internal-tools): create internal cross-module tool service"
```

### Task 6.2: Create IPC Handlers and Expose in Preload

**Files:**
- Create: `frontend/src/main/ipc/internal-tools.ipc.ts`
- Modify: `frontend/src/main/ipc/index.ts`
- Modify: `frontend/src/preload/api.ts`

- [ ] **Step 1: Create IPC handler**

```ts
import { ipcMain } from 'electron'
import { getInternalToolDefinitions, executeInternalTool } from '../services/internal-tools.service'

export function registerInternalToolsIpc(): void {
  ipcMain.handle('internal-tools:list', () => {
    return getInternalToolDefinitions()
  })

  ipcMain.handle('internal-tools:execute', async (_event, toolName: string, input: Record<string, any>) => {
    return executeInternalTool(toolName, input)
  })
}
```

- [ ] **Step 2: Register in index.ts**

Add import and call `registerInternalToolsIpc()`.

- [ ] **Step 3: Add to preload api.ts**

Add after the `agent` namespace:

```ts
internalTools: {
  list: () => ipcRenderer.invoke('internal-tools:list'),
  execute: (toolName: string, input: Record<string, any>) =>
    ipcRenderer.invoke('internal-tools:execute', toolName, input),
},
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/main/ipc/internal-tools.ipc.ts frontend/src/main/ipc/index.ts frontend/src/preload/api.ts
git commit -m "feat(internal-tools): add IPC handlers and preload API for internal tools"
```

### Task 6.3: Register Internal Tools in Chat Store

**Files:**
- Modify: `frontend/src/renderer/src/stores/useChatStore.ts`

- [ ] **Step 1: Add internal tools to getAvailableTools()**

In the `getAvailableTools` function (around line 188), after the MCP tools section (line ~300), add:

```ts
// Internal cross-module tools (when tools are enabled)
try {
  const internalTools = await window.api.internalTools.list()
  for (const t of internalTools) {
    tools.push({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })
  }
} catch {
  // Internal tools not available
}
```

- [ ] **Step 2: Add internal tool execution to executeToolCall()**

In the `executeToolCall` function (around line 308), before the "Unknown tool" fallback, add:

```ts
// Check if it's an internal tool
try {
  const internalTools = await window.api.internalTools.list()
  const internalTool = internalTools.find((t: any) => t.name === toolName)
  if (internalTool) {
    const result = await window.api.internalTools.execute(toolName, input)
    return { output: result.content, isError: result.isError }
  }
} catch {
  // Internal tools not available
}
```

- [ ] **Step 3: Auto-generate tools.md**

In the `getAvailableTools` function, after collecting all tools, update tools.md:

```ts
// Auto-generate tools.md with current tool list
try {
  const toolDescriptions = tools.map((t) => `- **${t.name}**: ${t.description}`).join('\n')
  const toolsMd = `# Available Tools\n\nAuto-generated list of tools available to the AI assistant.\n\n${toolDescriptions}\n`
  await window.api.agent.writeMemory('tools.md', toolsMd)
} catch {
  // ignore
}
```

- [ ] **Step 4: Verify compilation**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderer/src/stores/useChatStore.ts
git commit -m "feat(internal-tools): register cross-module tools in chat store and auto-generate tools.md"
```

---

## Final Verification

- [ ] **Run full typecheck**: `cd frontend && npx tsc --noEmit`
- [ ] **Run backend tests**: `cd backend && npm test`
- [ ] **Run frontend dev**: `cd frontend && npm run dev` — verify chat works end-to-end
- [ ] **Push to all remotes**: `git remote | xargs -I {} git push {}`
