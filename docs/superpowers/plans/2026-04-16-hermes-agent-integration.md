# Hermes Agent Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hermes-agent as a second managed AI agent in ClawBench's AI Agents hub, with install/start/stop/config UI mirroring the existing OpenClaw integration.

**Architecture:** Main-process service handles install (curl script), gateway process lifecycle (PID tracking), and YAML+env config read/write. IPC layer exposes this to the renderer. A Zustand store drives a hub card and a 3-tab detail page.

**Tech Stack:** Electron/Node.js, js-yaml, React 18, Ant Design v5, Zustand, TypeScript

---

## File Map

| Action | Path |
|---|---|
| Install dep | `frontend/package.json` — add `js-yaml`, `@types/js-yaml` |
| Create | `frontend/src/main/services/hermes.service.ts` |
| Create | `frontend/src/main/ipc/hermes.ipc.ts` |
| Modify | `frontend/src/main/ipc/index.ts` — register hermes IPC |
| Modify | `frontend/src/preload/api.ts` — add `window.api.hermes` namespace |
| Create | `frontend/src/renderer/src/stores/useHermesStore.ts` |
| Create | `frontend/src/renderer/src/pages/AIAgents/HermesCard.tsx` |
| Modify | `frontend/src/renderer/src/pages/AIAgents/AIAgentsPage.tsx` — add HermesCard |
| Create | `frontend/src/renderer/src/pages/Hermes/HermesPage.tsx` |
| Modify | `frontend/src/renderer/src/routes.tsx` — add `/ai-agents/hermes` |
| Modify | `frontend/src/renderer/src/i18n/index.ts` — add `hermes.*` keys |

---

## Task 1: Install js-yaml dependency

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install js-yaml**

```bash
cd frontend && npm install js-yaml && npm install --save-dev @types/js-yaml
```

Expected: `package.json` updated, `node_modules/js-yaml` present.

- [ ] **Step 2: Verify TypeScript can import it**

```bash
cd frontend && npx tsc --noEmit --strict false 2>&1 | head -5
```

Expected: No errors about js-yaml. (Existing errors are fine.)

- [ ] **Step 3: Commit**

```bash
cd frontend && git add package.json package-lock.json
git commit -m "chore: add js-yaml for hermes config parsing"
```

---

## Task 2: Create hermes.service.ts

**Files:**
- Create: `frontend/src/main/services/hermes.service.ts`

- [ ] **Step 1: Create the service file**

```typescript
// frontend/src/main/services/hermes.service.ts
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as logger from '../utils/logger'
import * as yaml from 'js-yaml'

const execAsync = promisify(exec)

// ── Types ──────────────────────────────────────────────────────────────────

export interface HermesInstallCheck {
  installed: boolean
  version?: string
}

export type HermesServiceStatus = 'running' | 'stopped' | 'unknown'

export interface HermesConfig {
  model: {
    provider: string
    model: string
    apiKey: string
    base_url: string
  }
  channels: {
    telegram: { enabled: boolean; token: string }
    discord: { enabled: boolean; token: string }
    slack: { enabled: boolean; bot_token: string; app_token: string }
    signal: { enabled: boolean; phone: string }
  }
  agent: {
    memory_enabled: boolean
    user_profile_enabled: boolean
    max_turns: number
    reasoning_effort: string
  }
}

// ── Constants ─────────────────────────────────────────────────────────────

const HERMES_DIR = path.join(os.homedir(), '.hermes')
const CONFIG_YAML = path.join(HERMES_DIR, 'config.yaml')
const ENV_FILE = path.join(HERMES_DIR, '.env')
const HERMES_BIN = path.join(os.homedir(), '.local', 'bin', 'hermes')

// ── Process tracking ──────────────────────────────────────────────────────

let gatewayPid: number | null = null

// ── Env helpers ──────────────────────────────────────────────────────────

function getAugmentedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (process.platform !== 'win32') {
    const localBin = path.join(os.homedir(), '.local', 'bin')
    const p = env.PATH || ''
    if (!p.split(':').includes(localBin)) {
      env.PATH = `${localBin}:${p}`
    }
  }
  return env
}

function readEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {}
  const result: Record<string, string> = {}
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return result
}

function writeEnvFile(filePath: string, data: Record<string, string>): void {
  const lines = Object.entries(data).map(([k, v]) => `${k}=${v}`)
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8')
}

// ── Install / uninstall ───────────────────────────────────────────────────

export async function checkInstalled(): Promise<HermesInstallCheck> {
  try {
    const env = getAugmentedEnv()
    const { stdout } = await execAsync('hermes --version', { timeout: 10000, env })
    const version = stdout.trim().split('\n')[0]
    return { installed: true, version: version || undefined }
  } catch {
    // Try direct binary path as fallback
    if (fs.existsSync(HERMES_BIN)) {
      return { installed: true }
    }
    return { installed: false }
  }
}

export async function installHermes(): Promise<{ success: boolean; error?: string }> {
  try {
    logger.info('[hermes] Running install script...')
    const scriptUrl = 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh'
    await execAsync(
      `curl -fsSL ${scriptUrl} | bash`,
      { timeout: 600000, env: getAugmentedEnv(), shell: '/bin/bash' }
    )
    logger.info('[hermes] Install complete')
    return { success: true }
  } catch (err: any) {
    logger.error('[hermes] Install failed:', err)
    return { success: false, error: err.stderr || err.message }
  }
}

export async function uninstallHermes(): Promise<{ success: boolean; error?: string }> {
  try {
    // Stop gateway first
    await stopGateway()

    // Remove hermes-agent repo and config dir
    const hermesAgentDir = path.join(HERMES_DIR, 'hermes-agent')
    if (fs.existsSync(hermesAgentDir)) {
      fs.rmSync(hermesAgentDir, { recursive: true, force: true })
    }
    if (fs.existsSync(HERMES_DIR)) {
      fs.rmSync(HERMES_DIR, { recursive: true, force: true })
    }
    // Remove symlink
    if (fs.existsSync(HERMES_BIN)) {
      fs.unlinkSync(HERMES_BIN)
    }
    return { success: true }
  } catch (err: any) {
    logger.error('[hermes] Uninstall failed:', err)
    return { success: false, error: err.message }
  }
}

// ── Gateway process ────────────────────────────────────────────────────────

export async function getServiceStatus(): Promise<HermesServiceStatus> {
  if (gatewayPid === null) return 'stopped'
  try {
    process.kill(gatewayPid, 0)
    return 'running'
  } catch {
    gatewayPid = null
    return 'stopped'
  }
}

export async function startGateway(): Promise<{ success: boolean; error?: string }> {
  try {
    const status = await getServiceStatus()
    if (status === 'running') return { success: true }

    const env = getAugmentedEnv()
    const child = spawn('hermes', ['gateway'], {
      detached: true,
      stdio: 'ignore',
      env
    })
    child.unref()

    if (child.pid === undefined) {
      return { success: false, error: 'Failed to spawn hermes gateway (no PID)' }
    }

    gatewayPid = child.pid
    logger.info(`[hermes] Gateway started with PID ${gatewayPid}`)

    // Wait briefly to catch immediate crash
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const finalStatus = await getServiceStatus()
    if (finalStatus !== 'running') {
      gatewayPid = null
      return { success: false, error: 'hermes gateway exited immediately. Run `hermes doctor` for diagnostics.' }
    }
    return { success: true }
  } catch (err: any) {
    logger.error('[hermes] Failed to start gateway:', err)
    return { success: false, error: err.message }
  }
}

export async function stopGateway(): Promise<{ success: boolean; error?: string }> {
  if (gatewayPid === null) return { success: true }
  try {
    process.kill(gatewayPid, 'SIGTERM')
    // Wait up to 5s then force kill
    await new Promise<void>((resolve) => {
      let waited = 0
      const interval = setInterval(() => {
        waited += 500
        try {
          process.kill(gatewayPid!, 0)
        } catch {
          clearInterval(interval)
          resolve()
          return
        }
        if (waited >= 5000) {
          try { process.kill(gatewayPid!, 'SIGKILL') } catch { /* already dead */ }
          clearInterval(interval)
          resolve()
        }
      }, 500)
    })
    gatewayPid = null
    logger.info('[hermes] Gateway stopped')
    return { success: true }
  } catch (err: any) {
    gatewayPid = null
    return { success: false, error: err.message }
  }
}

// ── Config read/write ──────────────────────────────────────────────────────

export function getConfig(): HermesConfig {
  // Defaults
  const config: HermesConfig = {
    model: { provider: 'anthropic', model: 'claude-opus-4-6', apiKey: '', base_url: '' },
    channels: {
      telegram: { enabled: false, token: '' },
      discord: { enabled: false, token: '' },
      slack: { enabled: false, bot_token: '', app_token: '' },
      signal: { enabled: false, phone: '' }
    },
    agent: { memory_enabled: true, user_profile_enabled: true, max_turns: 50, reasoning_effort: 'medium' }
  }

  // Read YAML
  try {
    if (fs.existsSync(CONFIG_YAML)) {
      const raw = yaml.load(fs.readFileSync(CONFIG_YAML, 'utf-8')) as any || {}
      if (raw.model) {
        config.model.provider = raw.model.provider || config.model.provider
        config.model.model = raw.model.default || raw.model.model || config.model.model
        config.model.base_url = raw.model.base_url || ''
      }
      if (raw.agent) {
        config.agent.max_turns = raw.agent.max_turns ?? config.agent.max_turns
        config.agent.reasoning_effort = raw.agent.reasoning_effort || config.agent.reasoning_effort
      }
      if (raw.memory) {
        config.agent.memory_enabled = raw.memory.memory_enabled ?? config.agent.memory_enabled
        config.agent.user_profile_enabled = raw.memory.user_profile_enabled ?? config.agent.user_profile_enabled
      }
      // Channel enabled flags stored in _ui section
      if (raw._ui?.channels) {
        const ch = raw._ui.channels
        config.channels.telegram.enabled = !!ch.telegram
        config.channels.discord.enabled = !!ch.discord
        config.channels.slack.enabled = !!ch.slack
        config.channels.signal.enabled = !!ch.signal
      }
    }
  } catch (err) {
    logger.warn('[hermes] Failed to read config.yaml:', err)
  }

  // Read .env for secrets
  try {
    const env = readEnvFile(ENV_FILE)
    const providerKeyMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_API_KEY',
      nous: 'NOUS_API_KEY',
      openrouter: 'OPENROUTER_API_KEY'
    }
    const envKey = providerKeyMap[config.model.provider] || 'API_KEY'
    config.model.apiKey = env[envKey] || ''
    config.channels.telegram.token = env['TELEGRAM_BOT_TOKEN'] || ''
    config.channels.discord.token = env['DISCORD_BOT_TOKEN'] || ''
    config.channels.slack.bot_token = env['SLACK_BOT_TOKEN'] || ''
    config.channels.slack.app_token = env['SLACK_APP_TOKEN'] || ''
    config.channels.signal.phone = env['SIGNAL_PHONE'] || ''
  } catch (err) {
    logger.warn('[hermes] Failed to read .env:', err)
  }

  return config
}

export function saveConfig(config: HermesConfig): { success: boolean; error?: string } {
  try {
    if (!fs.existsSync(HERMES_DIR)) {
      fs.mkdirSync(HERMES_DIR, { recursive: true })
    }

    // Read existing YAML to preserve unknown fields
    let existing: any = {}
    if (fs.existsSync(CONFIG_YAML)) {
      try { existing = yaml.load(fs.readFileSync(CONFIG_YAML, 'utf-8')) as any || {} } catch { /* ignore */ }
    }

    // Merge our managed sections
    existing.model = {
      ...(existing.model || {}),
      provider: config.model.provider,
      default: config.model.model,
      base_url: config.model.base_url || undefined
    }
    existing.agent = {
      ...(existing.agent || {}),
      max_turns: config.agent.max_turns,
      reasoning_effort: config.agent.reasoning_effort
    }
    existing.memory = {
      ...(existing.memory || {}),
      memory_enabled: config.agent.memory_enabled,
      user_profile_enabled: config.agent.user_profile_enabled
    }
    existing._ui = {
      channels: {
        telegram: config.channels.telegram.enabled,
        discord: config.channels.discord.enabled,
        slack: config.channels.slack.enabled,
        signal: config.channels.signal.enabled
      }
    }

    fs.writeFileSync(CONFIG_YAML, yaml.dump(existing, { lineWidth: -1 }), 'utf-8')

    // Write .env with secrets
    const providerKeyMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_API_KEY',
      nous: 'NOUS_API_KEY',
      openrouter: 'OPENROUTER_API_KEY'
    }
    const existing_env = readEnvFile(ENV_FILE)
    const envKey = providerKeyMap[config.model.provider] || 'API_KEY'
    if (config.model.apiKey) existing_env[envKey] = config.model.apiKey
    if (config.channels.telegram.token) existing_env['TELEGRAM_BOT_TOKEN'] = config.channels.telegram.token
    if (config.channels.discord.token) existing_env['DISCORD_BOT_TOKEN'] = config.channels.discord.token
    if (config.channels.slack.bot_token) existing_env['SLACK_BOT_TOKEN'] = config.channels.slack.bot_token
    if (config.channels.slack.app_token) existing_env['SLACK_APP_TOKEN'] = config.channels.slack.app_token
    if (config.channels.signal.phone) existing_env['SIGNAL_PHONE'] = config.channels.signal.phone
    writeEnvFile(ENV_FILE, existing_env)

    logger.info('[hermes] Config saved')
    return { success: true }
  } catch (err: any) {
    logger.error('[hermes] Failed to save config:', err)
    return { success: false, error: err.message }
  }
}

export async function upgradeHermes(): Promise<{ success: boolean; error?: string }> {
  try {
    await execAsync('hermes update', { timeout: 300000, env: getAugmentedEnv() })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.stderr || err.message }
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep hermes
```

Expected: No errors involving `hermes.service.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/main/services/hermes.service.ts
git commit -m "feat: add hermes.service.ts for install/gateway/config management"
```

---

## Task 3: IPC handler + registration

**Files:**
- Create: `frontend/src/main/ipc/hermes.ipc.ts`
- Modify: `frontend/src/main/ipc/index.ts`

- [ ] **Step 1: Create hermes.ipc.ts**

```typescript
// frontend/src/main/ipc/hermes.ipc.ts
import { ipcMain } from 'electron'
import {
  checkInstalled,
  installHermes,
  uninstallHermes,
  getServiceStatus,
  startGateway,
  stopGateway,
  getConfig,
  saveConfig,
  upgradeHermes
} from '../services/hermes.service'

export function registerHermesIpc(): void {
  ipcMain.handle('hermes:check-installed', async () => checkInstalled())
  ipcMain.handle('hermes:install', async () => installHermes())
  ipcMain.handle('hermes:uninstall', async () => uninstallHermes())
  ipcMain.handle('hermes:get-status', async () => getServiceStatus())
  ipcMain.handle('hermes:start', async () => startGateway())
  ipcMain.handle('hermes:stop', async () => stopGateway())
  ipcMain.handle('hermes:get-config', async () => getConfig())
  ipcMain.handle('hermes:save-config', async (_event, config) => saveConfig(config))
  ipcMain.handle('hermes:upgrade', async () => upgradeHermes())
}
```

- [ ] **Step 2: Register in ipc/index.ts**

Open `frontend/src/main/ipc/index.ts`. Add the import at the top after the existing imports:

```typescript
import { registerHermesIpc } from './hermes.ipc'
```

Add the call inside `registerAllIpcHandlers()` after `registerOpenClawIpc()`:

```typescript
  registerHermesIpc()
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "hermes|error" | head -20
```

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/main/ipc/hermes.ipc.ts frontend/src/main/ipc/index.ts
git commit -m "feat: add hermes IPC handlers and register them"
```

---

## Task 4: Preload API namespace

**Files:**
- Modify: `frontend/src/preload/api.ts`

- [ ] **Step 1: Add hermes namespace**

In `frontend/src/preload/api.ts`, find the closing of the `openclaw` block (around line 313 — ends with `}`). After the `openclaw` block and before `credentials`, insert:

```typescript
  hermes: {
    checkInstalled: () => ipcRenderer.invoke('hermes:check-installed'),
    install: () => ipcRenderer.invoke('hermes:install'),
    uninstall: () => ipcRenderer.invoke('hermes:uninstall'),
    getStatus: () => ipcRenderer.invoke('hermes:get-status'),
    start: () => ipcRenderer.invoke('hermes:start'),
    stop: () => ipcRenderer.invoke('hermes:stop'),
    getConfig: () => ipcRenderer.invoke('hermes:get-config'),
    saveConfig: (config: Record<string, unknown>) =>
      ipcRenderer.invoke('hermes:save-config', config),
    upgrade: () => ipcRenderer.invoke('hermes:upgrade')
  },
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -i hermes
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/preload/api.ts
git commit -m "feat: expose window.api.hermes preload namespace"
```

---

## Task 5: Zustand store

**Files:**
- Create: `frontend/src/renderer/src/stores/useHermesStore.ts`

- [ ] **Step 1: Create store**

```typescript
// frontend/src/renderer/src/stores/useHermesStore.ts
import { create } from 'zustand'

export interface HermesConfig {
  model: {
    provider: string
    model: string
    apiKey: string
    base_url: string
  }
  channels: {
    telegram: { enabled: boolean; token: string }
    discord: { enabled: boolean; token: string }
    slack: { enabled: boolean; bot_token: string; app_token: string }
    signal: { enabled: boolean; phone: string }
  }
  agent: {
    memory_enabled: boolean
    user_profile_enabled: boolean
    max_turns: number
    reasoning_effort: string
  }
}

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
  saveConfig: () => Promise<{ success: boolean; error?: string }>
  startGateway: () => Promise<{ success: boolean; error?: string }>
  stopGateway: () => Promise<{ success: boolean; error?: string }>
  upgradeHermes: () => Promise<{ success: boolean; error?: string }>
}

export const useHermesStore = create<HermesState>((set, get) => ({
  installCheck: null,
  serviceStatus: 'unknown',
  config: null,
  configLoading: false,
  dirty: false,
  installing: false,
  uninstalling: false,
  saving: false,

  checkInstalled: async () => {
    try {
      const result = await window.api.hermes.checkInstalled()
      set({ installCheck: result })
    } catch {
      set({ installCheck: { installed: false } })
    }
  },

  installHermes: async () => {
    set({ installing: true })
    try {
      const result = await window.api.hermes.install()
      if (result.success) {
        const check = await window.api.hermes.checkInstalled()
        set({ installCheck: check, installing: false })
        return { success: true }
      }
      set({ installing: false })
      return { success: false, error: result.error }
    } catch (err: any) {
      set({ installing: false })
      return { success: false, error: err.message }
    }
  },

  uninstallHermes: async () => {
    set({ uninstalling: true })
    try {
      const result = await window.api.hermes.uninstall()
      if (result.success) {
        set({ installCheck: { installed: false }, serviceStatus: 'stopped', config: null, uninstalling: false })
      } else {
        set({ uninstalling: false })
      }
      return result
    } catch (err: any) {
      set({ uninstalling: false })
      return { success: false, error: err.message }
    }
  },

  fetchStatus: async () => {
    try {
      const status = await window.api.hermes.getStatus()
      set({ serviceStatus: status })
    } catch {
      set({ serviceStatus: 'unknown' })
    }
  },

  fetchConfig: async () => {
    set({ configLoading: true })
    try {
      const config = await window.api.hermes.getConfig()
      set({ config, configLoading: false, dirty: false })
    } catch {
      set({ configLoading: false })
    }
  },

  updateConfig: (patch: Partial<HermesConfig>) => {
    const current = get().config
    if (!current) return
    set({ config: { ...current, ...patch }, dirty: true })
  },

  saveConfig: async () => {
    const config = get().config
    if (!config) return { success: false, error: 'No config loaded' }
    set({ saving: true })
    try {
      const result = await window.api.hermes.saveConfig(config as any)
      set({ saving: false, dirty: false })
      return result
    } catch (err: any) {
      set({ saving: false })
      return { success: false, error: err.message }
    }
  },

  startGateway: async () => {
    try {
      const result = await window.api.hermes.start()
      if (result.success) set({ serviceStatus: 'running' })
      return result
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  stopGateway: async () => {
    try {
      const result = await window.api.hermes.stop()
      if (result.success) set({ serviceStatus: 'stopped' })
      return result
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  upgradeHermes: async () => {
    try {
      const result = await window.api.hermes.upgrade()
      if (result.success) {
        const check = await window.api.hermes.checkInstalled()
        set({ installCheck: check })
      }
      return result
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }
}))
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep hermes
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/renderer/src/stores/useHermesStore.ts
git commit -m "feat: add useHermesStore Zustand store for hermes agent"
```

---

## Task 6: HermesCard + AIAgentsPage update

**Files:**
- Create: `frontend/src/renderer/src/pages/AIAgents/HermesCard.tsx`
- Modify: `frontend/src/renderer/src/pages/AIAgents/AIAgentsPage.tsx`

- [ ] **Step 1: Create HermesCard.tsx**

```tsx
// frontend/src/renderer/src/pages/AIAgents/HermesCard.tsx
import React, { useState, useCallback } from 'react'
import { Card, Typography, Space, Button, Result, theme, App } from 'antd'
import { RightOutlined, DownloadOutlined, PoweroffOutlined, ReloadOutlined } from '@ant-design/icons'
import Icon from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useHermesStore } from '../../stores/useHermesStore'
import { useT } from '../../i18n'

const { Text } = Typography

const HermesSvg = () => (
  <svg viewBox="0 0 120 120" width="1em" height="1em" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="60" cy="60" rx="45" ry="50" />
    <ellipse cx="60" cy="60" rx="30" ry="35" fill="rgba(0,0,0,0.15)" />
    <circle cx="45" cy="52" r="7" fill="rgba(255,255,255,0.9)" />
    <circle cx="75" cy="52" r="7" fill="rgba(255,255,255,0.9)" />
    <circle cx="45" cy="52" r="3" fill="#111" />
    <circle cx="75" cy="52" r="3" fill="#111" />
    <path d="M48 72 Q60 82 72 72" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" fill="none" />
    <path d="M35 18 Q28 8 22 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
    <path d="M85 18 Q92 8 98 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
  </svg>
)
const HermesIcon = (props: any) => <Icon component={HermesSvg} {...props} />

interface HermesCardProps {
  isInstalled: boolean
  installing: boolean
  serviceStatus: 'running' | 'stopped' | 'unknown'
  onInstall: () => void
}

const HermesCard: React.FC<HermesCardProps> = ({ isInstalled, installing, serviceStatus, onInstall }) => {
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const { modal } = App.useApp()
  const t = useT()
  const startGateway = useHermesStore((s) => s.startGateway)
  const stopGateway = useHermesStore((s) => s.stopGateway)
  const [actionLoading, setActionLoading] = useState<'start' | 'stop' | null>(null)

  const isRunning = serviceStatus === 'running'
  const isStopped = serviceStatus === 'stopped' || serviceStatus === 'unknown'

  const handleStart = useCallback(async () => {
    setActionLoading('start')
    await startGateway()
    setActionLoading(null)
  }, [startGateway])

  const handleRestart = useCallback(() => {
    modal.confirm({
      title: t('hermes.restartConfirm'),
      content: t('hermes.restartContent'),
      okText: t('hermes.restart'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setActionLoading('start')
        await stopGateway()
        await startGateway()
        setActionLoading(null)
      }
    })
  }, [modal, stopGateway, startGateway, t])

  const handleStop = useCallback(() => {
    modal.confirm({
      title: t('hermes.stopConfirm'),
      content: t('hermes.stopContent'),
      okText: t('hermes.stop'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setActionLoading('stop')
        await stopGateway()
        setActionLoading(null)
      }
    })
  }, [modal, stopGateway, t])

  const statusColor = isRunning ? token.colorSuccess : token.colorTextDisabled

  return (
    <Card
      hoverable
      style={{ borderRadius: token.borderRadiusLG, marginTop: 16 }}
      styles={{ body: { padding: 0 } }}
    >
      {isInstalled ? (
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Space size={12} align="center">
              <HermesIcon style={{ fontSize: 32, color: token.colorPrimary }} />
              <div>
                <Text strong style={{ fontSize: 16 }}>Hermes Agent</Text>
                <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  {t('hermes.description')}
                </Text>
              </div>
            </Space>
            <Space size={8}>
              {isStopped && (
                <Button icon={<ReloadOutlined />} loading={actionLoading === 'start'} onClick={handleStart}>
                  {t('hermes.start')}
                </Button>
              )}
              {isRunning && (
                <Button icon={<ReloadOutlined />} loading={actionLoading === 'start'} onClick={handleRestart}>
                  {t('hermes.restart')}
                </Button>
              )}
              {isRunning && (
                <Button danger icon={<PoweroffOutlined />} loading={actionLoading === 'stop'} onClick={handleStop}>
                  {t('hermes.stop')}
                </Button>
              )}
              <Button type="primary" icon={<RightOutlined />} onClick={() => navigate('/ai-agents/hermes')}>
                {t('hermes.detail')}
              </Button>
            </Space>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {isRunning ? t('hermes.statusRunning') : t('hermes.statusStopped')}
            </Text>
          </div>
        </div>
      ) : (
        <div style={{ padding: '40px 24px' }}>
          <Result
            icon={<HermesIcon style={{ fontSize: 64, color: token.colorTextSecondary }} />}
            title={t('hermes.notInstalled')}
            subTitle={t('hermes.notInstalledDesc')}
            extra={
              <Button type="primary" size="large" icon={<DownloadOutlined />} loading={installing} onClick={onInstall}>
                {installing ? t('hermes.installing') : t('hermes.oneClickInstall')}
              </Button>
            }
          />
        </div>
      )}
    </Card>
  )
}

export default HermesCard
```

- [ ] **Step 2: Update AIAgentsPage.tsx**

Open `frontend/src/renderer/src/pages/AIAgents/AIAgentsPage.tsx`.

Add import after the existing imports:

```typescript
import HermesCard from './HermesCard'
import { useHermesStore } from '../../stores/useHermesStore'
```

Inside the component, after the existing `useOpenClawStore` lines, add:

```typescript
  const hermesInstallCheck = useHermesStore((s) => s.installCheck)
  const hermesInstalling = useHermesStore((s) => s.installing)
  const hermesServiceStatus = useHermesStore((s) => s.serviceStatus)
  const checkHermesInstalled = useHermesStore((s) => s.checkInstalled)
  const fetchHermesStatus = useHermesStore((s) => s.fetchStatus)
  const installHermes = useHermesStore((s) => s.installHermes)
```

Add a `useEffect` after the existing openclaw effects:

```typescript
  useEffect(() => {
    checkHermesInstalled()
  }, [])

  useEffect(() => {
    if (hermesInstallCheck?.installed) {
      fetchHermesStatus()
    }
  }, [hermesInstallCheck?.installed])
```

Add a handler:

```typescript
  const handleInstallHermes = async () => {
    const result = await installHermes()
    if (result.success) {
      message.success(t('hermes.installSuccess'))
    } else {
      modal.error({
        title: t('hermes.installFailed'),
        content: result.error || t('hermes.installFailedContent'),
        okText: t('agents.gotIt'),
        width: 480
      })
    }
  }
```

Replace the comment `{/* Future: more agent cards (e.g. Airi) */}` with:

```tsx
      {hermesInstallCheck !== null && (
        <HermesCard
          isInstalled={hermesInstallCheck.installed}
          installing={hermesInstalling}
          serviceStatus={hermesServiceStatus}
          onInstall={handleInstallHermes}
        />
      )}
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "HermesCard|AIAgentsPage" | head -10
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/renderer/src/pages/AIAgents/HermesCard.tsx \
        frontend/src/renderer/src/pages/AIAgents/AIAgentsPage.tsx
git commit -m "feat: add HermesCard to AI Agents hub page"
```

---

## Task 7: Detail page (HermesPage.tsx)

**Files:**
- Create: `frontend/src/renderer/src/pages/Hermes/HermesPage.tsx`

- [ ] **Step 1: Create the file**

```tsx
// frontend/src/renderer/src/pages/Hermes/HermesPage.tsx
import React, { useEffect, useState } from 'react'
import {
  Button, Tabs, Form, Input, Select, Switch, InputNumber,
  Space, Typography, Spin, Divider, App, theme, Result
} from 'antd'
import {
  ArrowLeftOutlined, PoweroffOutlined, ReloadOutlined,
  ExclamationCircleFilled
} from '@ant-design/icons'
import Icon from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useHermesStore, type HermesConfig } from '../../stores/useHermesStore'
import { useT } from '../../i18n'

const { Title, Text } = Typography

const HermesSvg = () => (
  <svg viewBox="0 0 120 120" width="1em" height="1em" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="60" cy="60" rx="45" ry="50" />
    <ellipse cx="60" cy="60" rx="30" ry="35" fill="rgba(0,0,0,0.15)" />
    <circle cx="45" cy="52" r="7" fill="rgba(255,255,255,0.9)" />
    <circle cx="75" cy="52" r="7" fill="rgba(255,255,255,0.9)" />
    <circle cx="45" cy="52" r="3" fill="#111" />
    <circle cx="75" cy="52" r="3" fill="#111" />
    <path d="M48 72 Q60 82 72 72" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" fill="none" />
    <path d="M35 18 Q28 8 22 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
    <path d="M85 18 Q92 8 98 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
  </svg>
)
const HermesIcon = (props: any) => <Icon component={HermesSvg} {...props} />

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'nous', label: 'Nous Portal' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'custom', label: 'Custom' }
]

const REASONING_EFFORTS = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' }
]

const HermesPage: React.FC = () => {
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const { message, modal } = App.useApp()
  const t = useT()

  const installCheck = useHermesStore((s) => s.installCheck)
  const serviceStatus = useHermesStore((s) => s.serviceStatus)
  const config = useHermesStore((s) => s.config)
  const configLoading = useHermesStore((s) => s.configLoading)
  const dirty = useHermesStore((s) => s.dirty)
  const saving = useHermesStore((s) => s.saving)
  const uninstalling = useHermesStore((s) => s.uninstalling)

  const checkInstalled = useHermesStore((s) => s.checkInstalled)
  const fetchStatus = useHermesStore((s) => s.fetchStatus)
  const fetchConfig = useHermesStore((s) => s.fetchConfig)
  const updateConfig = useHermesStore((s) => s.updateConfig)
  const saveConfigAction = useHermesStore((s) => s.saveConfig)
  const startGateway = useHermesStore((s) => s.startGateway)
  const stopGateway = useHermesStore((s) => s.stopGateway)
  const uninstallHermes = useHermesStore((s) => s.uninstallHermes)
  const upgradeHermes = useHermesStore((s) => s.upgradeHermes)

  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [upgrading, setUpgrading] = useState(false)

  useEffect(() => {
    checkInstalled()
  }, [])

  useEffect(() => {
    if (installCheck?.installed) {
      fetchStatus()
      fetchConfig()
    }
  }, [installCheck?.installed])

  const isRunning = serviceStatus === 'running'

  const handleStart = async () => {
    setStarting(true)
    const result = await startGateway()
    setStarting(false)
    if (result.success) {
      message.success(t('hermes.started'))
    } else {
      modal.error({
        title: t('hermes.startFailed'),
        content: (
          <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {result.error || t('hermes.unknownError')}
          </pre>
        ),
        width: 600
      })
    }
  }

  const handleStop = () => {
    modal.confirm({
      title: t('hermes.stopConfirm'),
      icon: <ExclamationCircleFilled />,
      content: t('hermes.stopContent'),
      okText: t('hermes.stop'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        setStopping(true)
        const result = await stopGateway()
        setStopping(false)
        if (result.success) {
          message.success(t('hermes.stopped'))
        } else {
          message.error(result.error || t('hermes.stopFailed'))
        }
      }
    })
  }

  const handleRestart = () => {
    modal.confirm({
      title: t('hermes.restartConfirm'),
      icon: <ExclamationCircleFilled />,
      content: t('hermes.restartContent'),
      okText: t('hermes.restart'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        setStarting(true)
        await stopGateway()
        const result = await startGateway()
        setStarting(false)
        if (result.success) {
          message.success(t('hermes.restarted'))
        } else {
          message.error(result.error || t('hermes.restartFailed'))
        }
      }
    })
  }

  const handleSave = async () => {
    const result = await saveConfigAction()
    if (result.success) {
      message.success(t('hermes.configSaved'))
    } else {
      message.error(result.error || t('hermes.configSaveFailed'))
    }
  }

  const handleSaveAndRestart = async () => {
    const saveResult = await saveConfigAction()
    if (!saveResult.success) {
      message.error(saveResult.error || t('hermes.configSaveFailed'))
      return
    }
    setStarting(true)
    if (isRunning) await stopGateway()
    const startResult = await startGateway()
    setStarting(false)
    if (startResult.success) {
      message.success(t('hermes.configApplied'))
    } else {
      message.error(startResult.error || t('hermes.startFailed'))
    }
  }

  const handleUninstall = () => {
    modal.confirm({
      title: t('hermes.uninstallTitle'),
      icon: <ExclamationCircleFilled />,
      content: t('hermes.uninstallDesc'),
      okText: t('hermes.confirmUninstall'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        const result = await uninstallHermes()
        if (result.success) {
          message.success(t('hermes.uninstalled'))
          navigate('/ai-agents')
        } else {
          message.error(result.error || t('hermes.uninstallFailed'))
        }
      }
    })
  }

  const handleUpgrade = async () => {
    setUpgrading(true)
    const result = await upgradeHermes()
    setUpgrading(false)
    if (result.success) {
      message.success(t('hermes.upgraded'))
    } else {
      message.error(result.error || t('hermes.upgradeFailed'))
    }
  }

  if (installCheck === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!installCheck.installed) {
    return (
      <div style={{ maxWidth: 700, margin: '60px auto', padding: '0 24px' }}>
        <Result
          icon={<HermesIcon style={{ fontSize: 64, color: token.colorTextSecondary }} />}
          title={t('hermes.notInstalled')}
          subTitle={t('hermes.notInstalledDesc')}
          extra={
            <Button onClick={() => navigate('/ai-agents')} icon={<ArrowLeftOutlined />}>
              {t('hermes.backToAgents')}
            </Button>
          }
        />
      </div>
    )
  }

  const statusColor = isRunning ? token.colorSuccess : token.colorTextDisabled

  const modelTab = config ? (
    <div style={{ maxWidth: 520, paddingTop: 16 }}>
      <Form layout="vertical">
        <Form.Item label={t('hermes.provider')}>
          <Select
            value={config.model.provider}
            options={PROVIDERS}
            onChange={(v) => updateConfig({ model: { ...config.model, provider: v } })}
          />
        </Form.Item>
        <Form.Item label={t('hermes.model')}>
          <Input
            value={config.model.model}
            onChange={(e) => updateConfig({ model: { ...config.model, model: e.target.value } })}
            placeholder="e.g. claude-opus-4-6"
          />
        </Form.Item>
        <Form.Item label={t('hermes.apiKey')}>
          <Input.Password
            value={config.model.apiKey}
            onChange={(e) => updateConfig({ model: { ...config.model, apiKey: e.target.value } })}
            placeholder={t('hermes.apiKeyPlaceholder')}
          />
        </Form.Item>
        <Form.Item label={t('hermes.baseUrl')}>
          <Input
            value={config.model.base_url}
            onChange={(e) => updateConfig({ model: { ...config.model, base_url: e.target.value } })}
            placeholder="https://api.example.com/v1 (optional)"
          />
        </Form.Item>
      </Form>
    </div>
  ) : null

  const channelsTab = config ? (
    <div style={{ maxWidth: 520, paddingTop: 16 }}>
      <Form layout="vertical">
        <Divider orientation="left" plain><Text type="secondary" style={{ fontSize: 12 }}>Telegram</Text></Divider>
        <Form.Item label={t('hermes.enabled')}>
          <Switch
            checked={config.channels.telegram.enabled}
            onChange={(v) => updateConfig({ channels: { ...config.channels, telegram: { ...config.channels.telegram, enabled: v } } })}
          />
        </Form.Item>
        {config.channels.telegram.enabled && (
          <Form.Item label={t('hermes.botToken')}>
            <Input.Password
              value={config.channels.telegram.token}
              onChange={(e) => updateConfig({ channels: { ...config.channels, telegram: { ...config.channels.telegram, token: e.target.value } } })}
              placeholder="123456:ABC-DEF..."
            />
          </Form.Item>
        )}

        <Divider orientation="left" plain><Text type="secondary" style={{ fontSize: 12 }}>Discord</Text></Divider>
        <Form.Item label={t('hermes.enabled')}>
          <Switch
            checked={config.channels.discord.enabled}
            onChange={(v) => updateConfig({ channels: { ...config.channels, discord: { ...config.channels.discord, enabled: v } } })}
          />
        </Form.Item>
        {config.channels.discord.enabled && (
          <Form.Item label={t('hermes.botToken')}>
            <Input.Password
              value={config.channels.discord.token}
              onChange={(e) => updateConfig({ channels: { ...config.channels, discord: { ...config.channels.discord, token: e.target.value } } })}
              placeholder="Bot token..."
            />
          </Form.Item>
        )}

        <Divider orientation="left" plain><Text type="secondary" style={{ fontSize: 12 }}>Slack</Text></Divider>
        <Form.Item label={t('hermes.enabled')}>
          <Switch
            checked={config.channels.slack.enabled}
            onChange={(v) => updateConfig({ channels: { ...config.channels, slack: { ...config.channels.slack, enabled: v } } })}
          />
        </Form.Item>
        {config.channels.slack.enabled && (
          <>
            <Form.Item label={t('hermes.slackBotToken')}>
              <Input.Password
                value={config.channels.slack.bot_token}
                onChange={(e) => updateConfig({ channels: { ...config.channels, slack: { ...config.channels.slack, bot_token: e.target.value } } })}
                placeholder="xoxb-..."
              />
            </Form.Item>
            <Form.Item label={t('hermes.slackAppToken')}>
              <Input.Password
                value={config.channels.slack.app_token}
                onChange={(e) => updateConfig({ channels: { ...config.channels, slack: { ...config.channels.slack, app_token: e.target.value } } })}
                placeholder="xapp-..."
              />
            </Form.Item>
          </>
        )}

        <Divider orientation="left" plain><Text type="secondary" style={{ fontSize: 12 }}>Signal</Text></Divider>
        <Form.Item label={t('hermes.enabled')}>
          <Switch
            checked={config.channels.signal.enabled}
            onChange={(v) => updateConfig({ channels: { ...config.channels, signal: { ...config.channels.signal, enabled: v } } })}
          />
        </Form.Item>
        {config.channels.signal.enabled && (
          <Form.Item label={t('hermes.signalPhone')}>
            <Input
              value={config.channels.signal.phone}
              onChange={(e) => updateConfig({ channels: { ...config.channels, signal: { ...config.channels.signal, phone: e.target.value } } })}
              placeholder="+1234567890"
            />
          </Form.Item>
        )}
      </Form>
    </div>
  ) : null

  const agentTab = config ? (
    <div style={{ maxWidth: 520, paddingTop: 16 }}>
      <Form layout="vertical">
        <Form.Item label={t('hermes.memoryEnabled')}>
          <Switch
            checked={config.agent.memory_enabled}
            onChange={(v) => updateConfig({ agent: { ...config.agent, memory_enabled: v } })}
          />
        </Form.Item>
        <Form.Item label={t('hermes.userProfileEnabled')}>
          <Switch
            checked={config.agent.user_profile_enabled}
            onChange={(v) => updateConfig({ agent: { ...config.agent, user_profile_enabled: v } })}
          />
        </Form.Item>
        <Form.Item label={t('hermes.maxTurns')}>
          <InputNumber
            min={1}
            max={500}
            value={config.agent.max_turns}
            onChange={(v) => updateConfig({ agent: { ...config.agent, max_turns: v ?? 50 } })}
            style={{ width: 120 }}
          />
        </Form.Item>
        <Form.Item label={t('hermes.reasoningEffort')}>
          <Select
            value={config.agent.reasoning_effort}
            options={REASONING_EFFORTS}
            onChange={(v) => updateConfig({ agent: { ...config.agent, reasoning_effort: v } })}
            style={{ width: 180 }}
          />
        </Form.Item>
      </Form>
    </div>
  ) : null

  const tabItems = [
    { key: 'model', label: t('hermes.tabModel'), children: modelTab },
    { key: 'channels', label: t('hermes.tabChannels'), children: channelsTab },
    { key: 'agent', label: t('hermes.tabAgent'), children: agentTab }
  ]

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 24px 80px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate('/ai-agents')}>
          {t('hermes.backToAgents')}
        </Button>
      </div>

      {/* Title + status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Space size={12} align="center">
          <HermesIcon style={{ fontSize: 36, color: token.colorPrimary }} />
          <div>
            <Title level={4} style={{ margin: 0 }}>Hermes Agent</Title>
            {installCheck.version && (
              <Text type="secondary" style={{ fontSize: 12 }}>v{installCheck.version}</Text>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {isRunning ? t('hermes.statusRunning') : t('hermes.statusStopped')}
            </Text>
          </div>
        </Space>
        <Space>
          {!isRunning && (
            <Button icon={<ReloadOutlined />} loading={starting} onClick={handleStart}>
              {t('hermes.start')}
            </Button>
          )}
          {isRunning && (
            <Button icon={<ReloadOutlined />} loading={starting} onClick={handleRestart}>
              {t('hermes.restart')}
            </Button>
          )}
          {isRunning && (
            <Button danger icon={<PoweroffOutlined />} loading={stopping} onClick={handleStop}>
              {t('hermes.stop')}
            </Button>
          )}
        </Space>
      </div>

      {/* Config tabs */}
      <Spin spinning={configLoading}>
        <Tabs items={tabItems} />
      </Spin>

      {/* Bottom action bar */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '12px 24px',
          background: token.colorBgElevated,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 100
        }}
      >
        <Button danger onClick={handleUninstall} loading={uninstalling}>
          {t('hermes.uninstall')}
        </Button>
        <Space>
          <Button onClick={handleUpgrade} loading={upgrading}>
            {t('hermes.upgrade')}
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!dirty}>
            {t('hermes.save')}
          </Button>
          <Button type="primary" onClick={handleSaveAndRestart} loading={saving} disabled={!dirty}>
            {t('hermes.saveAndRestart')}
          </Button>
        </Space>
      </div>
    </div>
  )
}

export default HermesPage
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep Hermes | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/renderer/src/pages/Hermes/HermesPage.tsx
git commit -m "feat: add HermesPage detail config page with 3-tab UI"
```

---

## Task 8: Routes + i18n

**Files:**
- Modify: `frontend/src/renderer/src/routes.tsx`
- Modify: `frontend/src/renderer/src/i18n/index.ts`

- [ ] **Step 1: Add lazy import and route in routes.tsx**

After the `OpenClawPage` lazy import line (line 17), add:

```typescript
const HermesPage = React.lazy(() => import('./pages/Hermes/HermesPage'))
```

After the `/ai-agents/openclaw` route (line 51), add:

```tsx
          <Route path="/ai-agents/hermes" element={<HermesPage />} />
```

- [ ] **Step 2: Add i18n keys**

In `frontend/src/renderer/src/i18n/index.ts`, find the `zh` locale object (first locale block). After the last `agents.*` key block, add:

```typescript
    'hermes.installSuccess': 'Hermes Agent 安装成功',
    'hermes.installFailed': '安装失败',
    'hermes.installFailedContent': '安装失败，请检查网络和 curl 命令是否可用',
    'hermes.description': '自我进化 AI 助手，内置学习循环与多平台通道',
    'hermes.notInstalled': 'Hermes Agent 未安装',
    'hermes.notInstalledDesc': 'Hermes Agent 是 Nous Research 出品的开源自进化 AI 助手，支持 Telegram、Discord 等多种通道。',
    'hermes.oneClickInstall': '一键安装',
    'hermes.installing': '正在安装...',
    'hermes.start': '启动',
    'hermes.restart': '重启',
    'hermes.stop': '停止',
    'hermes.detail': '详情配置',
    'hermes.backToAgents': '返回 AI Agents',
    'hermes.statusRunning': '运行中',
    'hermes.statusStopped': '已停止',
    'hermes.restartConfirm': '重启 Hermes',
    'hermes.restartContent': '确认重启 Hermes 网关？当前会话将会中断。',
    'hermes.stopConfirm': '停止 Hermes',
    'hermes.stopContent': '确认停止 Hermes 网关？已连接的通道将断开。',
    'hermes.started': 'Hermes 已启动',
    'hermes.stopped': 'Hermes 已停止',
    'hermes.restarted': 'Hermes 已重启',
    'hermes.startFailed': '启动失败',
    'hermes.stopFailed': '停止失败',
    'hermes.restartFailed': '重启失败',
    'hermes.unknownError': '未知错误',
    'hermes.uninstallTitle': '卸载 Hermes Agent',
    'hermes.uninstallDesc': '此操作将删除 ~/.hermes 目录及二进制文件，且无法撤销。',
    'hermes.confirmUninstall': '确认卸载',
    'hermes.uninstalled': 'Hermes Agent 已卸载',
    'hermes.uninstallFailed': '卸载失败',
    'hermes.upgrade': '检查更新',
    'hermes.upgraded': 'Hermes 已升级',
    'hermes.upgradeFailed': '升级失败',
    'hermes.save': '保存',
    'hermes.saveAndRestart': '保存并重启',
    'hermes.configSaved': '配置已保存',
    'hermes.configApplied': '配置已保存并重启网关',
    'hermes.configSaveFailed': '保存配置失败',
    'hermes.tabModel': 'AI 模型',
    'hermes.tabChannels': '通道',
    'hermes.tabAgent': '智能体',
    'hermes.provider': '服务商',
    'hermes.model': '模型',
    'hermes.apiKey': 'API Key',
    'hermes.apiKeyPlaceholder': '请输入 API Key',
    'hermes.baseUrl': 'Base URL（自定义端点）',
    'hermes.enabled': '启用',
    'hermes.botToken': 'Bot Token',
    'hermes.slackBotToken': 'Bot Token (xoxb-)',
    'hermes.slackAppToken': 'App Token (xapp-)',
    'hermes.signalPhone': '手机号码',
    'hermes.memoryEnabled': '启用记忆',
    'hermes.userProfileEnabled': '启用用户画像',
    'hermes.maxTurns': '最大轮次',
    'hermes.reasoningEffort': '推理强度',
    'hermes.uninstall': '卸载',
```

Then find the `en` locale object (second locale block) and add the same keys with English values:

```typescript
    'hermes.installSuccess': 'Hermes Agent installed successfully',
    'hermes.installFailed': 'Installation failed',
    'hermes.installFailedContent': 'Installation failed. Please check your network and curl availability.',
    'hermes.description': 'Self-improving AI assistant with learning loop and multi-platform gateway',
    'hermes.notInstalled': 'Hermes Agent not installed',
    'hermes.notInstalledDesc': 'Hermes Agent by Nous Research is an open-source self-improving AI assistant with Telegram, Discord and more.',
    'hermes.oneClickInstall': 'One-click Install',
    'hermes.installing': 'Installing...',
    'hermes.start': 'Start',
    'hermes.restart': 'Restart',
    'hermes.stop': 'Stop',
    'hermes.detail': 'Configure',
    'hermes.backToAgents': 'Back to AI Agents',
    'hermes.statusRunning': 'Running',
    'hermes.statusStopped': 'Stopped',
    'hermes.restartConfirm': 'Restart Hermes',
    'hermes.restartContent': 'Restart the Hermes gateway? Active sessions will be interrupted.',
    'hermes.stopConfirm': 'Stop Hermes',
    'hermes.stopContent': 'Stop the Hermes gateway? Connected channels will disconnect.',
    'hermes.started': 'Hermes started',
    'hermes.stopped': 'Hermes stopped',
    'hermes.restarted': 'Hermes restarted',
    'hermes.startFailed': 'Start failed',
    'hermes.stopFailed': 'Stop failed',
    'hermes.restartFailed': 'Restart failed',
    'hermes.unknownError': 'Unknown error',
    'hermes.uninstallTitle': 'Uninstall Hermes Agent',
    'hermes.uninstallDesc': 'This will delete the ~/.hermes directory and binary. This cannot be undone.',
    'hermes.confirmUninstall': 'Confirm Uninstall',
    'hermes.uninstalled': 'Hermes Agent uninstalled',
    'hermes.uninstallFailed': 'Uninstall failed',
    'hermes.upgrade': 'Check for Updates',
    'hermes.upgraded': 'Hermes upgraded',
    'hermes.upgradeFailed': 'Upgrade failed',
    'hermes.save': 'Save',
    'hermes.saveAndRestart': 'Save & Restart',
    'hermes.configSaved': 'Configuration saved',
    'hermes.configApplied': 'Configuration saved and gateway restarted',
    'hermes.configSaveFailed': 'Failed to save configuration',
    'hermes.tabModel': 'AI Model',
    'hermes.tabChannels': 'Channels',
    'hermes.tabAgent': 'Agent',
    'hermes.provider': 'Provider',
    'hermes.model': 'Model',
    'hermes.apiKey': 'API Key',
    'hermes.apiKeyPlaceholder': 'Enter your API key',
    'hermes.baseUrl': 'Base URL (custom endpoint)',
    'hermes.enabled': 'Enable',
    'hermes.botToken': 'Bot Token',
    'hermes.slackBotToken': 'Bot Token (xoxb-)',
    'hermes.slackAppToken': 'App Token (xapp-)',
    'hermes.signalPhone': 'Phone number',
    'hermes.memoryEnabled': 'Enable Memory',
    'hermes.userProfileEnabled': 'Enable User Profile',
    'hermes.maxTurns': 'Max Turns',
    'hermes.reasoningEffort': 'Reasoning Effort',
    'hermes.uninstall': 'Uninstall',
```

- [ ] **Step 3: Full type-check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: No errors (or only pre-existing errors unrelated to hermes).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/renderer/src/routes.tsx frontend/src/renderer/src/i18n/index.ts
git commit -m "feat: add hermes route and i18n translations"
```

---

## Task 9: Verify + push

- [ ] **Step 1: Run typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | tail -5
```

Expected: Clean or pre-existing errors only.

- [ ] **Step 2: Run lint**

```bash
cd frontend && npm run lint 2>&1 | grep hermes | head -20
```

Expected: No hermes-specific lint errors.

- [ ] **Step 3: Start dev to smoke-test**

```bash
cd frontend && npm run dev
```

Navigate to `/ai-agents`. Verify:
- HermesCard appears below OpenClaw card
- "Hermes Agent 未安装" state shows correctly with install button
- Clicking "详情配置" navigates to `/ai-agents/hermes`
- Detail page shows back button, tabs render without errors

- [ ] **Step 4: Push to all remotes**

```bash
git remote | xargs -I{} git push {} master
```

Expected: All remotes updated successfully.
