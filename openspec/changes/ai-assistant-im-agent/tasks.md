# Tasks: ai-assistant-im-agent

## Phase 1 — Assistant core (PR1)

- [x] 1.1 Add `assistantEnabled` (default true) and `setupRole` to settings store + get/set agent settings IPC
- [x] 1.2 Role-based soul templates in `agent-memory.service.ts`; `restoreSoulDefault` uses setupRole
- [x] 1.3 On setup wizard finish, persist role and initialize soul from template if empty
- [x] 1.4 AIAssistantSettings: master switch + persona template selector + save wiring
- [x] 1.5 `buildSystemPrompt`: when assistant disabled → minimal prompt; when enabled inject soul/memory/harness (`tools.md`)
- [x] 1.6 useChatStore: load agent settings flag; skip memory load when disabled
- [x] 1.7 i18n keys (zh/en) for new UI strings

## Phase 2 — Module tools + harness (PR2)

- [x] 2.1 Workbench tools: `run_workbench_app`, `search_market_apps`, `install_market_app`
- [x] 2.2 Terminal tools: session list/run command; DB `execute_database` with safety gates
- [x] 2.3 Coding tools: list workspaces; `create_coding_session` (workspace + tool + initialPrompt)
- [x] 2.4 Default `tools.md` harness body + ensure prompt injects it
- [ ] 2.5 Unit tests for tool providers (happy path + reject unsafe SQL)

## Phase 3 — Memory self-update (PR3)

- [x] 3.1 `memory-updater.service.ts`: collect recent digests, LLM summarize, write memory.md
- [x] 3.2 Start/stop with app lifecycle; skip when `assistantEnabled === false`
- [x] 3.3 Settings copy explaining auto-update behavior

## Phase 4 — IM remote agent (PR4)

- [x] 4.1 Extend `AICodingIMConfig` + store migration (soft: credentials+autoConnect → remoteEnabled)
- [x] 4.2 TopBar: show Feishu entry only when `remoteEnabled`
- [x] 4.3 IM config modal + settings: remote switch, model select, advanced timeouts
- [x] 4.4 `im-agent.service.ts`: multi-turn chat with full system prompt + tools + history persist
- [x] 4.5 Bridge: plain text → im-agent; `/new` alone closes agent session; keep `/new <tool>` coding
- [x] 4.6 Session rules: idle 1h, max turns; notify user on auto-close
- [x] 4.7 Expose IM conversations to renderer via IPC (list/get); AI Chat sidebar UI merge deferred
- [x] 4.8 Update help card for agent + session rules
- [ ] 4.9 Integration smoke: connect mock path / unit tests for session idle & `/new`

## Verification

- [x] V1 Typecheck frontend (main + renderer)
- [ ] V2 Manual checklist: master off/on, template switch, tool run app, IM history after restart
- [x] V3 Unit test: system-prompt-builder master switch / harness
