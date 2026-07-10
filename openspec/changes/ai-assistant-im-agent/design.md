# Design: AI Assistant Core + IM Remote Agent

## Goals

1. One agent pipeline shared by **local AI Chat** and **Feishu remote IM**.
2. User-controllable assistant depth (master switch) and remote surface (IM enable).
3. Clear persona + harness so the model knows module capabilities and boundaries.
4. Durable IM conversation history with session boundaries (idle / `/new` / turn cap).

## Non-Goals

- Replacing slash-command coding cards with pure free-form only (keep cards as coding sub-feature).
- Server-side multi-device memory sync (client-local first).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Renderer                                                         │
│  AI Chat / Settings / TopBar (IM entry if remoteEnabled)          │
│  buildSystemPrompt(soul, harness, memory) when assistantEnabled  │
└────────────────────────────┬────────────────────────────────────┘
                             │ IPC
┌────────────────────────────▼────────────────────────────────────┐
│ Main                                                             │
│  agent-memory.service   soul/memory/tools/user/agents + stats    │
│  memory-updater.service periodic summarize (if assistant ON)     │
│  internal-tools.service expanded module tools                    │
│  im-agent.service       multi-turn IM chat + history store       │
│  im-bridge.service      commands + route plain text → im-agent   │
│  settings / ai-coding stores  flags + IM model + credentials     │
└─────────────────────────────────────────────────────────────────┘
```

### Shared agent turn (local & IM)

```
user
user message
  → load settings: assistantEnabled, tools, web search, IM model (if IM)
  → if assistantEnabled: load soul/memory/user/tools harness + build full system prompt
    else: minimal system prompt (legacy short identity)
  → attach tool definitions (internal + MCP if enabled)
  → stream / complete via ai.service (main process for IM; renderer+IPC for local)
  → persist messages to conversation store
  → if assistantEnabled: enqueue memory digest candidate
```

IM must **not** depend on the renderer being on AI Chat page; agent turns run in **main process**.

## Data model

### Agent settings (`settings` electron-store)

```ts
assistantEnabled: boolean          // default true
setupRole: 'general' | 'design' | 'tech' | 'art' | ''
// existing: customSystemPrompt, defaultToolApprovalMode, maxAgentToolSteps
```

### IM config (`ai-coding` store — extend `AICodingIMConfig`)

```ts
interface AICodingIMConfig {
  feishu: { appId: string; appSecret: string }
  remoteEnabled: boolean           // default false — gates TopBar entry + auto-connect policy
  modelConfigId?: string           // fixed model for IM agent mode
  modelId?: string
  maxTurnsPerSession?: number      // default 40
  idleTimeoutMs?: number           // default 3_600_000 (1h)
}
```

### IM conversation store (new or extend chat persistence)

```ts
interface AgentConversation {
  id: string
  source: 'local' | 'im'
  title: string
  chatId?: string          // Feishu chat id when source=im
  modelConfigId?: string
  modelId?: string
  createdAt: number
  updatedAt: number
  closedAt?: number
  closeReason?: 'idle' | 'new' | 'turn_limit' | 'user' | 'error'
  messages: AgentMessage[]
}
```

- Local AI Chat continues using existing local/backend conversation APIs.
- IM conversations written by main process; renderer lists them with a badge/filter “飞书 IM”.

### Per-IM-chat runtime state (`IMChatState` extend)

```ts
{
  chatId: string
  activeWorkspaceId: string | null
  activeSessionId: string | null   // coding session (existing)
  agentConversationId: string | null
  lastAgentActivityAt: number
  turnCount: number
}
```

## Persona templates

Role → default `soul.md` content (localized strings optional; English markdown body is fine if product is bilingual via “respond in user language” rule).

Each template includes:
- Identity (role-aligned)
- Capabilities (map to enabled modules where possible)
- Boundaries (no credential leak, confirm destructive ops, etc.)

On setup finish: if `soul.md` is empty or still default generic, write role template.  
Settings: dropdown “应用模板” + editor + restore (uses stored `setupRole`).

## Harness (`tools.md` + prompt section)

Default `tools.md` (and prompt injection) documents:

| Module | Agent tools | Notes |
|--------|-------------|--------|
| Workbench | `list_workbench_apps`, `run_workbench_app`, `search_market_apps`, `install_market_app` | Run uses python-runner; install uses marketplace.service |
| Terminal | `list_terminal_sessions`, `run_terminal_command`, `list_db_connections`, `query_database`, `execute_database` | Writes require confirmation policy / tool approval |
| Coding | `list_coding_workspaces`, `list_coding_sessions`, `create_coding_session` | create: workspaceId/path + toolType + initialPrompt |

Harness text also explains **slash commands still work on IM** for power users (`/w`, `/ss`, `/new claude`, `/app`, …).

## Master switch behavior matrix

| Feature | ON | OFF |
|---------|----|-----|
| soul.md in system prompt | yes | no (minimal identity) |
| memory.md / user.md inject | yes | no |
| harness / tools.md inject | yes | no |
| internal tools | yes (if tools enabled in chat prefs) | optional: still allow tools? **Decision: tools remain if user enabled tool mode; only memory+persona stripped** |
| memory self-update job | runs | skipped |
| feedback → memory | skipped for memory.md | stats only always ok |

Clarification: OFF means “raw assistant” — original short system prompt; tool calling can still work for power users, but product default when OFF is closer to plain chat. Implementation: when OFF, skip agent memory load and use fixed short prompt; still pass tools if chatToolsEnabled.

## IM routing

```
handleIncomingMessage(msg):
  parsed = parseCommand(text)
  if command is known slash (help/work/session/app/...):
    existing handlers  // coding + apps sub-features
  else if text is /new (agent new conversation):
    close agent session; acknowledge
  else if plain text OR /chat:
    ensure remoteEnabled
    im-agent.handleUserMessage(chatId, text)
  else:
    existing no-context behavior
```

**Conflict:** `/new` currently means “create coding session tool list”.  
**Decision:** Keep `/new [tool]` for coding; use **`/newchat` or `/agent new`** for agent conversation reset — OR: when no active coding session, bare `/new` resets agent chat; with args `/new claude` keeps coding semantics.

Preferred UX per requirement “用户主动 /new 新起个对话”:
- **`/new` alone** → start new **agent** conversation (close previous agent session).
- **`/new <tool>`** → existing coding session create.
- Document in help card.

Idle: on each agent message, if `now - lastAgentActivityAt > idleTimeoutMs`, auto-close previous conversation and open a new one before handling.

## TopBar / Settings UI

1. **TopBar**: render Feishu button only if `imConfig.remoteEnabled === true`.
2. **AICodingIMConfigModal** (and Settings subsection):
   - Switch: 远程 IM 控制
   - App ID / Secret (existing)
   - Model selector (config + model)
   - Connect / Disconnect / Test
   - Optional: max turns, idle hours (advanced)
3. **AIAssistantSettings**:
   - Master switch 启用 AI 助手能力
   - Persona template selector + editor
   - Memory files + note about auto-update
   - Link to IM remote settings

## Memory self-update

- Timer in main process (e.g. every 30–60 min) when app is running and `assistantEnabled`.
- Collect recent conversation digests (last N messages from local chat store + IM agent store).
- Call LLM with summarizer prompt → merge into `memory.md` (bounded size, e.g. 8–12k chars).
- Debounce: skip if no new messages since last run.

## Security

- DB writes / destructive shell: respect `defaultToolApprovalMode`. For IM remote path without UI approval, **auto-approve-safe** only; reject/force-confirm risky tools via text reply asking user to confirm with an explicit phrase, or block with message.
- Never put secrets into IM cards or memory.

## Migration

- Existing IM configs: `remoteEnabled` defaults **false** → TopBar entry disappears until user enables (breaking UX change; document in release notes).  
  **Soft migration option:** if `appId` and `appSecret` already set and `imAutoConnect` was true, set `remoteEnabled=true` once so existing users keep the icon. **Adopt soft migration.**
- `soul.md` unchanged for existing users; templates only apply on setup or explicit “apply template”.

## Key Decisions

1. **Main-process IM agent** so remote works with window minimized.
2. **Soft-migrate** remoteEnabled when credentials + autoConnect already present.
3. **`/new` alone** resets agent chat; **`/new <tool>`** keeps coding.
4. **Master OFF** strips persona/memory/harness; tools still gated by chat tool prefs.
5. **Coding cards** remain; agent chat is separate conversation stream (text or light cards).
6. **IM history** stored main-side, visible in AI Chat with source filter.

## Open Questions

None blocking — product defaults above match the requirement text. Optional later: IM reply as interactive cards vs plain text for long tool traces.

## PR Plan

### PR1 — Assistant core settings + persona + prompt
- `assistantEnabled`, `setupRole` in settings store
- Role soul templates + setup wiring
- Settings UI: master switch, template picker
- `system-prompt-builder` harness injection; honor master switch

### PR2 — Expand internal tools (apps / terminal / coding)
- run app, market search/install
- terminal command + DB execute (gated)
- create coding session with initial prompt
- Default tools.md harness content

### PR3 — Memory self-update service
- Digest collection + periodic LLM merge into memory.md
- Gate on assistantEnabled

### PR4 — IM remote agent + history + non-persistent entry
- Extend IM config (remoteEnabled, model, timeouts)
- TopBar conditional render + soft migration
- im-agent.service multi-turn + persistence
- Bridge routing + `/new` semantics + help text
- Settings IM model UI
- AI Chat history filter for IM conversations
