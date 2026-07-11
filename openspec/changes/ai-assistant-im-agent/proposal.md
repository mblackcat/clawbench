# Proposal: AI Assistant Capability Unification + Feishu IM Remote Agent

## Why

Today ClawBench has fragmented AI surfaces:
- **AI Chat** has persona (`soul.md`), memory files, and limited internal tools (list-only for apps/coding/DB).
- **Feishu IM** is coding-centric (`IMBridge` + slash commands); `/chat` is a one-shot LLM call with no tools, memory, or history.
- **Top-bar Feishu IM entry is always visible**, even when the user does not want remote control.
- Module capabilities (apps, terminal/DB, coding) are not fully reachable from conversational AI.

Users need one coherent **AI Assistant agent** used both locally and remotely via Feishu, with clear persona/harness/memory, and an opt-in remote IM control path.

## What Changes

### 1. AI Assistant master switch (default ON)
- Settings → AI 助手: global enable switch, **default true**.
- When **OFF**:
  - Do **not** update long-term memory (no periodic summarize / feedback-driven memory writes).
  - Use the **original / minimal system prompt** (no soul, memory, harness injection).
- When **ON**: full agent pipeline (persona + harness + memory + tools).

### 2. Agent persona (soul) from setup role
- On setup completion (or first run after role selection), initialize `soul.md` from a **role template** (`general` / `design` / `tech` / `art`).
- Persona must state identity, capabilities, and **boundaries**.
- Settings UI: switch template **or** free-edit; keep “restore default” (role-aware).

### 3. Harness: built-in module capability description
- Inject a structured **Harness** section into the system prompt (from `tools.md` + live module flags).
- Describe how to use:
  - **Workbench apps**: list / run installed apps; search marketplace; install published apps.
  - **AI Terminal**: open/connect sessions, run commands; DB connect, query, and (gated) update.
  - **AI Coding**: create coding session in a workspace with an initial prompt.
- Expand `internal-tools` so the agent can **act**, not only list (execute apps, terminal cmds, DB ops, create coding sessions).

### 4. Memory: cross-module summary + self-update
- Aggregate AI conversation summaries across AI Chat / Terminal assistant / Coding-related agent turns (and IM agent history when enabled).
- **Self-update** while the desktop client is online: periodic job rewrites/condenses `memory.md`.
- Master switch OFF → skip all memory writes.

### 5. Remote IM control (opt-in, non-persistent entry)
- New flag: **remote IM control enabled** (default **false** for entry visibility; credentials can still be saved).
- Linked to current top-bar Feishu IM settings modal + AI Coding IM config store.
- **Top-bar Feishu icon only renders when remote IM control is enabled.**
- Settings page can configure the same options (credentials, connect, **IM-mode model** fixed selection).
- When enabled, Feishu bot conversation ≈ local AI Chat:
  - Same persona / harness / memory (if assistant master ON).
  - Uses configured **IM model** (or last default chat model as fallback).
  - Tool calling for apps / terminal / DB / coding (same internal tools).
  - **Legacy remote AI Coding** (slash commands, session cards, multi-turn within one card) remains as a **sub-capability**.
- IM multi-turn sessions:
  - Persist as conversation history (source: `im`) visible when user returns to client (AI Chat sidebar or dedicated IM history).
  - Session lifecycle:
    - Soft limit on turns (configurable, e.g. 40).
    - **>1h idle silence → auto close** session (next message starts a new conversation).
    - User can send `/new` to start a fresh conversation explicitly.
  - Coding session cards remain independent of the agent chat session.

## Capabilities

### New Capabilities
- `ai-assistant-core`: master switch, role personas, harness injection, expanded module tools, memory self-update.
- `im-remote-agent`: remote IM enable flag, non-persistent entry, IM model selection, full agent chat over Feishu with history + session rules.

### Modified Capabilities
- Existing IM bridge coding commands remain; plain text without active coding session routes to agent chat when remote IM is on.
- AI Chat system prompt builder and settings UI.

## Impact

| Area | Files / modules (indicative) |
|------|------------------------------|
| Settings / store | `settings.store.ts`, `AIAssistantSettings.tsx`, `ai-coding.store` IM config |
| Persona / memory | `agent-memory.service.ts`, setup wizard finish path |
| Prompt | `system-prompt-builder.ts`, `useChatStore.ts` |
| Tools | `internal-tools.service.ts`, marketplace + python-runner + ai-terminal + ai-coding services |
| IM | `im-bridge.service.ts`, `im-commands.ts`, `feishu-cards.ts`, `TopBar.tsx`, `AICodingIMConfigModal.tsx` |
| History | chat conversation persistence (main or renderer) with `source: 'im'` |

## Out of Scope (this change)
- New IM platforms beyond Feishu.
- Changing OpenClaw / Hermes product surfaces.
- Full autonomous multi-agent orchestration beyond existing tool calling.
