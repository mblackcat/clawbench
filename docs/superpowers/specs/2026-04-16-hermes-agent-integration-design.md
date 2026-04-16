# Hermes Agent Integration Design

**Date:** 2026-04-16  
**Scope:** Add hermes-agent as a second AI agent in the AI Agents hub, mirroring the OpenClaw management UI pattern.

---

## Overview

Hermes Agent (by Nous Research) is a self-improving CLI AI assistant with a built-in learning loop, skill creation, multi-platform messaging gateway (Telegram, Discord, Slack, WhatsApp, Signal), and support for any LLM provider. This integration adds full lifecycle management — install, start/stop gateway, and in-app config editing — to the ClawBench AI Agents page.

Source: https://github.com/NousResearch/hermes-agent

---

## Architecture

The integration mirrors OpenClaw's 3-layer structure:

```
Main Process (Node.js)          Preload (Bridge)           Renderer (React)
hermes.service.ts               api.ts                     HermesCard.tsx (hub)
hermes.ipc.ts                   window.api.hermes          HermesPage.tsx (detail)
                                                           useHermesStore.ts
```

### Files to Create

| File | Description |
|---|---|
| `frontend/src/main/services/hermes.service.ts` | Install, start/stop gateway, config read/write, version check |
| `frontend/src/main/ipc/hermes.ipc.ts` | Thin IPC wrappers invoking hermes.service |
| `frontend/src/renderer/src/stores/useHermesStore.ts` | Zustand store (install state, service status, config) |
| `frontend/src/renderer/src/pages/AIAgents/HermesCard.tsx` | Agent card on hub page (install/start/stop/detail) |
| `frontend/src/renderer/src/pages/Hermes/HermesPage.tsx` | Detail config page with 3 tabs |

### Files to Modify

| File | Change |
|---|---|
| `frontend/src/preload/api.ts` | Add `window.api.hermes` namespace |
| `frontend/src/renderer/src/pages/AIAgents/AIAgentsPage.tsx` | Add `<HermesCard>` below OpenClaw |
| `frontend/src/renderer/src/routes.tsx` | Add `/ai-agents/hermes` route |
| `frontend/src/renderer/src/i18n/index.ts` | Add `hermes.*` i18n keys (zh-CN + en) |
| `frontend/src/main/index.ts` | Register `hermes.ipc.ts` handler |

---

## Installation

**Detection:** Check that `~/.local/bin/hermes` exists (or `hermes` is resolvable in augmented PATH) and `hermes --version` succeeds.

**Install:** Download and execute the official install script:
```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
```
Run in a child process with combined stdout/stderr. Stream output to the renderer via IPC progress events (same pattern as existing install flows). The script handles uv, Python 3.11+, git clone, pip install, PATH setup, and initial `~/.hermes/` scaffolding.

**Uninstall:** Remove `~/.hermes/` directory and `~/.local/bin/hermes` symlink.

**Update:** `hermes update` CLI command.

**Version:** Parse `hermes --version` output.

---

## Service Management (Gateway)

Hermes' messaging gateway is the persistent background process:

- **Start:** `hermes gateway` (spawned as a detached child process; store PID in memory or a `.hermes-gateway.pid` temp file)
- **Stop:** Send SIGTERM to the tracked PID; wait up to 5 seconds then SIGKILL
- **Status:** Check if the PID is still alive (`process.kill(pid, 0)`)
- **Restart:** Stop then start

The gateway runs in the background connecting messaging platforms. If no channels are configured, the service runs in "local-only" mode (still usable via `hermes` CLI).

---

## Config Management

Hermes config lives in `~/.hermes/config.yaml` (YAML) and `~/.hermes/.env` (API keys).

The detail page exposes the three most impactful sections:

### Tab 1: AI 模型 (Model)
Fields from `model.*` in `config.yaml`:
- **Provider** (select): `anthropic`, `openai`, `google`, `nous`, `openrouter`, `custom`
- **Model** (text input): e.g. `claude-opus-4-6`, `gpt-4o`
- **API Key** (password input): stored in `~/.hermes/.env` as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.
- **Base URL** (text, optional): for custom provider endpoints

### Tab 2: 通道 (Gateway Channels)
Toggle switches for each platform. When enabled, show the required token/webhook field:
- **Telegram** — Bot token
- **Discord** — Bot token  
- **Slack** — Bot token + App token
- **WhatsApp** — Requires WhatsApp Web bridge (shows info note)
- **Signal** — Phone number

Config is written to the `gateway.channels` or `platforms` section in `config.yaml`.

### Tab 3: 智能体 (Agent)
- **Memory enabled** (switch): `memory.memory_enabled`
- **User profile** (switch): `memory.user_profile_enabled`
- **Max turns** (number): `agent.max_turns`
- **Reasoning effort** (select): `none`, `low`, `medium`, `high`, `xhigh` — maps to `agent.reasoning_effort`

Config changes require restarting the gateway to take effect. A "Save & Restart" action handles this.

---

## Renderer Store (`useHermesStore.ts`)

```ts
interface HermesState {
  installCheck: { installed: boolean; version?: string } | null
  serviceStatus: 'running' | 'stopped' | 'unknown'
  config: HermesConfig | null
  configLoading: boolean
  dirty: boolean
  installing: boolean
  uninstalling: boolean
  saving: boolean

  checkInstalled: () => Promise<void>
  installHermes: () => Promise<{ success: boolean; error?: string }>
  uninstallHermes: () => Promise<{ success: boolean; error?: string }>
  fetchStatus: () => Promise<void>
  fetchConfig: () => Promise<void>
  updateConfig: (patch: Partial<HermesConfig>) => void
  saveConfig: () => Promise<void>
  startGateway: () => Promise<{ success: boolean; error?: string }>
  stopGateway: () => Promise<{ success: boolean; error?: string }>
  upgradeHermes: () => Promise<{ success: boolean; error?: string }>
}
```

---

## IPC Channels

| Channel | Direction | Description |
|---|---|---|
| `hermes:check-installed` | invoke | Returns `{ installed, version? }` |
| `hermes:install` | invoke | Runs install script, returns `{ success, error? }` |
| `hermes:uninstall` | invoke | Removes files, returns `{ success, error? }` |
| `hermes:get-status` | invoke | Returns `'running' \| 'stopped' \| 'unknown'` |
| `hermes:start` | invoke | Starts gateway process |
| `hermes:stop` | invoke | Stops gateway process |
| `hermes:get-config` | invoke | Reads and returns parsed config |
| `hermes:save-config` | invoke | Writes config to YAML + .env |
| `hermes:upgrade` | invoke | Runs `hermes update` |
| `hermes:install-progress` | renderer event | Streams install output lines |

---

## Hub Card (`HermesCard.tsx`)

Matches `OpenClawCard.tsx` structure:
- **Not installed:** Result component with logo, description, one-click install button
- **Installed:** Header with logo + name + description; action buttons (Start/Stop/Restart); status indicator; "Detail Config" navigation button

---

## Detail Page (`HermesPage.tsx`)

Route: `/ai-agents/hermes`

Structure mirrors `OpenClawPage.tsx`:
- Back button to `/ai-agents`
- Status bar (running/stopped + version)
- Start/Stop/Restart actions
- 3-tab config panel (AI Model, Channels, Agent)
- Bottom bar: Save, Save & Restart, Uninstall

---

## i18n Keys

New `hermes.*` keys in both `zh` and `en` locales covering: install/uninstall messages, status strings, tab labels, field labels, and action button text.

---

## Error Handling

- Install failure: Show error modal with stderr output (same pattern as OpenClaw)
- Service start failure: Show error message with advice to run `hermes doctor`
- Config write failure: Show error message; don't mark config as clean

---

## Out of Scope

- MCP server management (too complex for v1)
- Cron job management (no UI; users use `~/.hermes/cron/`)
- Subagent/delegation config
- All 25 config sections — only the 3 most impactful tabs are exposed
- Windows support (hermes install script targets Mac/Linux/WSL; card shows a note on Windows)
