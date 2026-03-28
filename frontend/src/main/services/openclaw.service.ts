import { exec, execFile, execSync, spawn } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as net from 'net'
import * as https from 'https'
import * as logger from '../utils/logger'
import { getOpenClawConfig, setOpenClawConfig, resetOpenClawConfig, getInstalledSkills, setInstalledSkills, getModelPriority, setModelPriority, syncModelPriorityWithItems } from '../store/openclaw.store'
import type { OpenClawItem } from '../store/openclaw.store'
import { installTool } from './local-env.service'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

const MASK = '••••••••'

/**
 * Build an augmented env for child processes.
 * - macOS: packaged apps launched from Finder have a restricted PATH,
 *   so we append common Homebrew/local bin dirs.
 * - Windows: PATH stored in process.env is a snapshot from when Electron
 *   launched. If openclaw was installed afterwards (e.g. via PowerShell
 *   script), the new PATH entries won't be visible. We re-read the
 *   current User + Machine PATH from the registry to pick them up.
 */
function getAugmentedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (process.platform === 'win32') {
    try {
      const userPath = execSync(
        'powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\')"',
        { timeout: 5000 }
      ).toString().trim()
      const machinePath = execSync(
        'powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'Machine\')"',
        { timeout: 5000 }
      ).toString().trim()
      if (machinePath || userPath) {
        env.PATH = [machinePath, userPath].filter(Boolean).join(';')
      }
    } catch {
      // Fallback: keep original PATH
      logger.warn('[openclaw] Failed to read Windows PATH from registry')
    }
  } else if (process.platform === 'darwin') {
    let p = env.PATH || ''
    const extras = [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin'
    ]
    const parts = p.split(':')
    for (const ep of extras) {
      if (!parts.includes(ep)) {
        p = `${p}:${ep}`
      }
    }
    env.PATH = p
  }
  return env
}

// Built-in provider IDs that OpenClaw has in its catalog — only need apiKey
const BUILTIN_PROVIDERS = new Set(['openai', 'anthropic', 'google'])

/**
 * Compute full model IDs for an item (mirrors logic in renderer store).
 * Built-in providers (openai/anthropic/google) already store full IDs like 'anthropic/claude-opus-4-6'.
 * Custom/OAuth providers store bare IDs like 'gemini-3.1-pro-preview' → prefixed to 'google-gemini-cli/gemini-3.1-pro-preview'.
 */
function getItemModelIdsFromService(item: OpenClawItem): string[] {
  if (!item.configValues.models) return []
  return item.configValues.models
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => BUILTIN_PROVIDERS.has(item.id) ? m : `${item.id}/${m}`)
}

export interface OpenClawInstallCheck {
  installed: boolean
  version?: string
  path?: string
}

export type OpenClawServiceStatus = 'running' | 'stopped' | 'unknown'

const REQUIRED_NODE_MAJOR = 22

interface NodeVersionCheck {
  installed: boolean
  version?: string
  major?: number
}

/**
 * Check if Node.js is available and return its version.
 */
async function checkNodeVersion(): Promise<NodeVersionCheck> {
  try {
    const env = getAugmentedEnv()
    const { stdout } = await execAsync('node --version', { timeout: 10000, env })
    const raw = stdout.trim() // e.g. "v22.1.0"
    if (!raw) return { installed: false }
    const version = raw.replace(/^v/, '')
    const major = parseInt(version.split('.')[0], 10)
    return { installed: true, version, major: isNaN(major) ? undefined : major }
  } catch {
    return { installed: false }
  }
}

/**
 * Check if openclaw CLI is installed
 */
export async function checkInstalled(): Promise<OpenClawInstallCheck> {
  try {
    const env = getAugmentedEnv()
    // Use exec (shell mode) so that openclaw installed via PowerShell script,
    // npm, or other methods can all be found through the shell's PATH resolution.
    const { stdout } = await execAsync('openclaw -v', { timeout: 10000, env })
    const version = stdout.trim()
    if (!version) return { installed: false }
    let clawPath: string | undefined
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which'
      const { stdout: pathOut } = await execAsync(`${whichCmd} openclaw`, { timeout: 5000, env })
      clawPath = pathOut.trim().split('\n')[0]
    } catch {
      // ignore
    }
    return { installed: true, version, path: clawPath }
  } catch {
    return { installed: false }
  }
}

/**
 * Install openclaw via npm.
 *
 * Pre-checks Node.js availability and version (>= 22 required):
 *   1. If Node.js is not found, attempts automatic installation via
 *      Homebrew (macOS) / winget (Windows) / opens browser (fallback).
 *   2. If Node.js version is below 22, returns an upgrade prompt.
 *   3. Otherwise proceeds with `npm install -g openclaw@latest`.
 */
export async function installOpenClaw(): Promise<{ success: boolean; error?: string; code?: string }> {
  try {
    // ── Step 1: Check Node.js ──
    let nodeCheck = await checkNodeVersion()

    if (!nodeCheck.installed) {
      logger.info('[openclaw] Node.js not found, attempting automatic installation...')
      const installResult = await installTool('nodejs')
      if (installResult.openedBrowser) {
        return {
          success: false,
          code: 'NODE_INSTALL_BROWSER',
          error: 'Node.js 未安装。已打开 Node.js 官网下载页面，请安装 Node.js v22 或以上版本后重试。'
        }
      }
      if (!installResult.success) {
        return {
          success: false,
          code: 'NODE_NOT_FOUND',
          error: `Node.js 未安装且自动安装失败：${installResult.error || '未知错误'}。请手动安装 Node.js v22 或以上版本后重试。\n下载地址：https://nodejs.org/`
        }
      }
      // Re-check after install
      nodeCheck = await checkNodeVersion()
      if (!nodeCheck.installed) {
        return {
          success: false,
          code: 'NODE_NOT_FOUND',
          error: 'Node.js 安装后仍无法检测到，请重启应用后重试，或手动安装 Node.js v22 或以上版本。\n下载地址：https://nodejs.org/'
        }
      }
      logger.info(`[openclaw] Node.js installed successfully: v${nodeCheck.version}`)
    }

    // ── Step 2: Check Node.js version ──
    if (nodeCheck.major !== undefined && nodeCheck.major < REQUIRED_NODE_MAJOR) {
      return {
        success: false,
        code: 'NODE_VERSION_TOO_LOW',
        error: `当前 Node.js 版本为 v${nodeCheck.version}，OpenClaw 要求 Node.js v${REQUIRED_NODE_MAJOR} 或以上。请升级 Node.js 后重试。\n下载地址：https://nodejs.org/`
      }
    }

    // ── Step 3: Install OpenClaw ──
    logger.info(`[openclaw] Node.js v${nodeCheck.version} detected, proceeding with installation...`)
    await execAsync('npm install -g openclaw@latest', { timeout: 600000, env: getAugmentedEnv() })
    writeDefaultConfigIfNeeded()
    return { success: true }
  } catch (err: any) {
    logger.error('Failed to install openclaw:', err)
    return { success: false, error: err.stderr || err.message }
  }
}

/**
 * Write a minimal default ~/.openclaw/openclaw.json if it doesn't already exist.
 * Ensures openclaw gateway has a valid base config on first run after installation.
 */
function writeDefaultConfigIfNeeded(): void {
  const openclawDir = path.join(os.homedir(), '.openclaw')
  const configPath = path.join(openclawDir, 'openclaw.json')
  if (fs.existsSync(configPath)) return
  try {
    if (!fs.existsSync(openclawDir)) {
      fs.mkdirSync(openclawDir, { recursive: true })
    }
    const defaultConfig = { gateway: { port: 3000, mode: 'local' } }
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8')
    try { fs.chmodSync(configPath, 0o600) } catch { /* Windows */ }
    logger.info('Wrote default openclaw config at', configPath)
  } catch (err) {
    logger.error('Failed to write default openclaw config:', err)
  }
}

/**
 * Uninstall openclaw globally and optionally remove local config
 */
export async function uninstallOpenClaw(removeConfig: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    // Force-kill the service with SIGKILL (not SIGTERM) so the process has
    // no chance to run its shutdown hooks and write logs back to ~/.openclaw/.
    // A graceful stop here would cause the process to recreate ~/.openclaw/logs/
    // after rmSync has already deleted the directory.
    if (process.platform === 'win32') {
      try { await execFileAsync('taskkill', ['/F', '/IM', 'openclaw*'], { timeout: 10000 }) } catch { /* no process running */ }
    } else {
      try { await execFileAsync('pkill', ['-9', '-f', 'openclaw'], { timeout: 10000 }) } catch { /* no process running */ }
    }
    // Give the OS a moment to fully reap the process
    await new Promise((resolve) => setTimeout(resolve, 800))

    // Uninstall the npm package
    await execAsync('npm uninstall -g openclaw', { timeout: 120000, env: getAugmentedEnv() })

    // Optionally remove ~/.openclaw
    if (removeConfig) {
      const openclawDir = path.join(os.homedir(), '.openclaw')
      if (fs.existsSync(openclawDir)) {
        fs.rmSync(openclawDir, { recursive: true, force: true })
        logger.info('Removed openclaw config directory:', openclawDir)
      }
    }
    // Reset electron-store
    resetOpenClawConfig()
    return { success: true }
  } catch (err: any) {
    logger.error('Failed to uninstall openclaw:', err)
    return { success: false, error: err.stderr || err.message }
  }
}

/**
 * Check if openclaw gateway service is running.
 * Uses TCP port probe on the gateway's default port (3000) which works
 * cross-platform and regardless of how the process was launched.
 */
export async function getServiceStatus(): Promise<OpenClawServiceStatus> {
  const port = getGatewayPort()
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(2000)
    socket.once('connect', () => {
      socket.destroy()
      resolve('running')
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve('stopped')
    })
    socket.once('error', () => {
      socket.destroy()
      resolve('stopped')
    })
    socket.connect(port, '127.0.0.1')
  })
}

/**
 * Read the gateway port from ~/.openclaw/openclaw.json, defaulting to 3000.
 */
function getGatewayPort(): number {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    const raw = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw)
    if (typeof config.gateway?.port === 'number') return config.gateway.port
  } catch {
    // ignore
  }
  return 3000
}

/**
 * Read the gateway dashboard URL from ~/.openclaw/openclaw.json.
 * Returns null when the token has not been generated yet (service not started).
 */
export function getGatewayDashboardUrl(): { url: string | null } {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    const raw = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw)
    const port = typeof config.gateway?.port === 'number' ? config.gateway.port : 3000
    const token = config.gateway?.auth?.token ?? config.gateway?.token ?? null
    if (!token) return { url: null }
    return { url: `http://127.0.0.1:${port}/?token=${token}` }
  } catch {
    return { url: null }
  }
}

/**
 * Ensure ~/.openclaw/openclaw.json has gateway.mode set.
 * The openclaw gateway refuses to start when gateway.mode is unset:
 *   "Gateway start blocked: set gateway.mode=local or pass --allow-unconfigured"
 * This patches existing configs that pre-date this requirement.
 */
function ensureGatewayMode(): void {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw)
    if (!config.gateway?.mode) {
      if (!config.gateway) config.gateway = {}
      config.gateway.mode = 'local'
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
      logger.info('[openclaw] Patched missing gateway.mode=local in config')
    }
  } catch {
    // Config doesn't exist yet — writeDefaultConfigIfNeeded() handles that case
  }
}

/**
 * Start openclaw gateway service.
 *
 * Startup approach:
 *   1. Ensure gateway.mode is set in config (openclaw refuses to start without it).
 *   2. Redirect child stdout+stderr to a temp file so we can capture startup
 *      errors without keeping the parent's event loop alive.
 *   3. Immediately unref() the child so Electron can quit independently.
 *   4. After a 4-second window, probe the port.
 *   5. On failure, read the temp file (and the most recent openclaw log) to
 *      surface actionable error output to the user.
 */
export async function startService(): Promise<{ success: boolean; error?: string }> {
  ensureGatewayMode()
  const currentStatus = await getServiceStatus()
  if (currentStatus === 'running') {
    logger.info('[openclaw] Service restarting...')
  }
  // Ensure auth-profiles.json is up-to-date every time the service starts.
  // This covers: (a) first start after migrating from .env, (b) service restart
  // without going through Apply Config.
  try {
    const { items } = getOpenClawConfig()
    const builtinWithKey = items
      .filter((i) => i.category === 'ai_provider' && i.enabled && BUILTIN_PROVIDERS.has(i.id) && i.configValues.apiKey)
      .map((i) => ({ id: i.id, apiKey: i.configValues.apiKey }))

    // Migration: if no keys in electron-store, check .env for legacy keys
    if (builtinWithKey.length === 0) {
      const envPath = path.join(os.homedir(), '.openclaw', '.env')
      try {
        const envContent = fs.readFileSync(envPath, 'utf-8')
        for (const line of envContent.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eqIdx = trimmed.indexOf('=')
          if (eqIdx === -1) continue
          const key = trimmed.substring(0, eqIdx).trim()
          const val = trimmed.substring(eqIdx + 1).trim()
          const providerId = ENV_KEY_TO_PROVIDER[key]
          if (providerId && val) builtinWithKey.push({ id: providerId, apiKey: val })
        }
      } catch { /* no .env — fine */ }
    }

    writeAuthProfilesJson(builtinWithKey)
  } catch (err) {
    logger.warn('[openclaw] Failed to sync auth-profiles.json before start:', err)
  }
  const tmpLog = path.join(os.tmpdir(), `openclaw-startup-${Date.now()}.log`)
  let logFd: number | undefined

  try {
    logFd = fs.openSync(tmpLog, 'w')

    let spawnError: Error | undefined
    const child = spawn('openclaw', ['gateway'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: getAugmentedEnv()
    })

    // Close our end of the fd — the child still holds its own reference
    fs.closeSync(logFd)
    logFd = undefined

    child.on('error', (err) => { spawnError = err })
    child.unref()

    // Poll every 500 ms for up to 10 seconds instead of a fixed sleep.
    // This returns as soon as the gateway is ready and handles slow first-runs
    // (e.g. openclaw writing its auth token before opening the listen port).
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (spawnError) break
      const status = await getServiceStatus()
      if (status === 'running') {
        logger.info('[openclaw] Gateway started successfully')
        try { fs.unlinkSync(tmpLog) } catch { /* ignore */ }
        return { success: true }
      }
    }

    if (spawnError) {
      logger.error('[openclaw] Failed to spawn gateway:', spawnError.message)
      return { success: false, error: spawnError.message }
    }

    // ── Collect error output ──────────────────────────────────────────────────
    // 1. Temp file (captured this run's stdout/stderr)
    //    Strip known non-blocking first-run anomaly lines so users only see
    //    actionable errors (e.g. "Gateway start blocked", module not found).
    const IGNORABLE = [
      'missing-meta-before-write',
      'Config write anomaly',
      'Config overwrite',
      'auth token was missing',
      'Generated a new token',
      'config-audit',
    ]
    let captured = ''
    try {
      const raw = fs.readFileSync(tmpLog, 'utf-8')
      captured = raw.split('\n')
        .filter((line) => line.trim() && !IGNORABLE.some((pat) => line.includes(pat)))
        .join('\n')
        .trim()
    } catch { /* ignore */ }
    try { fs.unlinkSync(tmpLog) } catch { /* ignore */ }

    // 2. Most recent openclaw log file (openclaw writes its own structured log)
    let recentLog = ''
    try {
      const logsDir = path.join(os.homedir(), '.openclaw', 'logs')
      if (fs.existsSync(logsDir)) {
        const entries = fs.readdirSync(logsDir)
          .map((f) => ({ f, t: fs.statSync(path.join(logsDir, f)).mtimeMs }))
          .sort((a, b) => b.t - a.t)
        if (entries.length > 0) {
          const latest = path.join(logsDir, entries[0].f)
          const raw = fs.readFileSync(latest, 'utf-8')
          // Last 40 lines are enough to see the crash reason
          recentLog = raw.split('\n').slice(-40).join('\n').trim()
        }
      }
    } catch { /* ignore */ }

    const errorDetail = [captured, recentLog].filter(Boolean).join('\n---\n') || 'No output captured'
    logger.error(`[openclaw] Gateway failed to start:\n${errorDetail}`)
    return { success: false, error: errorDetail }

  } catch (err: any) {
    if (logFd !== undefined) { try { fs.closeSync(logFd) } catch { /* ignore */ } }
    logger.error('[openclaw] Unexpected error starting gateway:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Stop openclaw gateway service
 */
export async function stopService(): Promise<{ success: boolean; error?: string }> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/F', '/IM', 'openclaw*'], { timeout: 10000 })
    } else {
      await execFileAsync('pkill', ['-f', 'openclaw'], { timeout: 10000 })
    }
    logger.info('[openclaw] Service stopped')
    return { success: true }
  } catch {
    // pkill returns exit 1 if no processes matched, which is fine
    logger.info('[openclaw] Service stopped')
    return { success: true }
  }
}

/**
 * Get config with API keys masked for display.
 * On first load, syncs from native ~/.openclaw/openclaw.json + .env if
 * electron-store is empty (i.e. the user configured openclaw outside ClawBench).
 */
export function getConfig(): { installPath: string; items: OpenClawItem[]; modelPriority: string[] } {
  syncNativeConfigIfNeeded()
  const config = getOpenClawConfig()
  const maskedItems = config.items.map((item) => ({
    ...item,
    configValues: maskSensitiveValues(item)
  }))
  const synced = syncModelPriorityWithItems(getModelPriority(), config.items)
  return { ...config, items: maskedItems, modelPriority: synced }
}

/**
 * Get config with real (unmasked) values
 */
export function getRawConfig(): { installPath: string; items: OpenClawItem[] } {
  syncNativeConfigIfNeeded()
  return getOpenClawConfig()
}

function maskSensitiveValues(item: OpenClawItem): Record<string, string> {
  const masked: Record<string, string> = {}
  for (const [key, value] of Object.entries(item.configValues)) {
    const field = item.configFields.find((f) => f.key === key)
    if (field?.type === 'password' && value && value.length > 0) {
      masked[key] = MASK
    } else {
      masked[key] = value
    }
  }
  return masked
}

/**
 * Save config — handles masked keys by preserving existing values
 */
export function saveConfig(config: { installPath?: string; items?: OpenClawItem[]; modelPriority?: string[] }): void {
  if (config.modelPriority !== undefined) {
    setModelPriority(config.modelPriority)
  }
  if (config.items) {
    const existing = getOpenClawConfig()
    const existingMap = new Map(existing.items.map((item) => [item.id, item]))

    const mergedItems = config.items.map((item) => {
      const existingItem = existingMap.get(item.id)
      if (!existingItem) return item

      const mergedValues: Record<string, string> = {}
      for (const [key, value] of Object.entries(item.configValues)) {
        if (value === MASK && existingItem.configValues[key]) {
          mergedValues[key] = existingItem.configValues[key]
        } else {
          mergedValues[key] = value
        }
      }
      return { ...item, configValues: mergedValues }
    })

    setOpenClawConfig({ installPath: config.installPath, items: mergedItems })
    generateOpenClawJsonConfig(mergedItems)
  } else {
    setOpenClawConfig(config)
  }
  logger.info('[openclaw] Config updated')
}

/**
 * Apply config — save and restart service
 */
export async function applyConfig(config: {
  installPath?: string
  items?: OpenClawItem[]
  modelPriority?: string[]
}): Promise<{ success: boolean; error?: string }> {
  saveConfig(config)
  logger.info('[openclaw] Config applied, restarting service...')
  await stopService()
  await new Promise((resolve) => setTimeout(resolve, 1000))
  return startService()
}

/**
 * Generate ~/.openclaw/openclaw.json and ~/.openclaw/.env strictly following the official schema.
 *
 * Reference: https://docs.openclaw.ai/gateway/configuration-reference
 *
 * Key discovery:
 *   - models.providers entries ALWAYS require baseUrl + models array.
 *   - Built-in providers (openai, anthropic, google) are recognized natively by
 *     OpenClaw via env vars (OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY)
 *     in ~/.openclaw/.env — they do NOT go into models.providers.
 *   - Only custom/third-party providers go into models.providers with full config.
 *
 * Key mappings:
 *   ai_provider (builtin: openai/anthropic/google) → ~/.openclaw/.env (API key env vars)
 *   ai_provider (custom: deepseek/custom)          → models.providers.<id> = { baseUrl, apiKey, api, models: [...] }
 *   comm_tool                                      → channels.<id> = { enabled, ...values }
 *   skill (coding)                                 → tools.profile = "coding"
 *   skill (elevated)                               → tools.elevated = { enabled: true }
 *   builtin_feature (web_search)                   → tools.web.search = { enabled, apiKey }
 *   builtin_feature (web_fetch)                    → tools.web.fetch = { enabled }
 *   builtin_feature (tts)                          → messages.tts = { provider, ... }
 *   builtin_feature (browser)                      → browser = { enabled }
 *   builtin_feature (cron)                         → cron = { enabled }
 */
function generateOpenClawJsonConfig(items: OpenClawItem[]): void {
  const openclawDir = path.join(os.homedir(), '.openclaw')
  const configPath = path.join(openclawDir, 'openclaw.json')
  const envPath = path.join(openclawDir, '.env')

  try {
    if (!fs.existsSync(openclawDir)) {
      fs.mkdirSync(openclawDir, { recursive: true })
    }

    // Start from the existing config so that sections ClawBench doesn't manage
    // (e.g. gateway settings written by openclaw onboard, cron.jobs populated
    // by openclaw at runtime) are preserved across saves.
    let config: Record<string, any> = {}
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    } catch {
      // No existing file or invalid JSON → start fresh
    }

    // Snapshot cron.jobs before we touch the cron section so we can restore them.
    const existingCronJobs: any[] | undefined = Array.isArray(config.cron?.jobs)
      ? config.cron.jobs
      : undefined

    const envLines: string[] = []

    // Read existing .env to preserve keys we don't manage
    const managedEnvKeys = new Set<string>()
    let existingEnvLines: string[] = []
    try {
      existingEnvLines = fs.readFileSync(envPath, 'utf-8').split('\n')
    } catch {
      // .env doesn't exist yet
    }

    // ── AI providers ── (ClawBench fully owns the models section)
    const enabledProviders = items.filter((i) => i.category === 'ai_provider' && i.enabled)
    const customProviders: Record<string, any> = {}
    const builtinProvidersWithKey: Array<{ id: string; apiKey: string; models?: string }> = []
    let googleGeminiCliEnabled = false

    for (const item of enabledProviders) {
      if (BUILTIN_PROVIDERS.has(item.id)) {
        // Built-in providers → auth-profiles.json (openclaw v2026; .env ignored by default)
        if (item.configValues.apiKey) {
          builtinProvidersWithKey.push({ id: item.id, apiKey: item.configValues.apiKey, models: item.configValues.models })
        }
      } else if (item.id === 'google-gemini-cli') {
        // google-gemini-cli → plugin entry (auth managed by openclaw CLI itself)
        googleGeminiCliEnabled = true
        // If API key mode, write to auth.profiles
        if (item.configValues.authMode === 'api_key' && item.configValues.apiKey) {
          if (!config.auth) config.auth = {}
          if (!config.auth.profiles) config.auth.profiles = {}
          config.auth.profiles['google-gemini-cli:manual'] = {
            provider: 'google-gemini-cli',
            mode: 'api_key',
            key: item.configValues.apiKey
          }
        } else {
          // OAuth mode: preserve existing oauth profile, don't overwrite with empty
          // (auth was established via openclaw auth login)
        }
      } else {
        // Custom providers → models.providers with full config
        const entry: Record<string, any> = {}
        if (item.configValues.baseUrl) entry.baseUrl = item.configValues.baseUrl
        if (item.configValues.apiKey) entry.apiKey = item.configValues.apiKey
        if (item.configValues.api) entry.api = item.configValues.api
        if (item.configValues.models) {
          const modelIds = item.configValues.models
            .split(',')
            .map((m) => m.trim())
            .filter(Boolean)
          if (modelIds.length > 0) {
            entry.models = modelIds.map((id) => ({ id }))
          }
        }
        customProviders[item.id] = entry
      }
    }

    // Write auth-profiles.json for built-in providers
    writeAuthProfilesJson(builtinProvidersWithKey)

    if (Object.keys(customProviders).length > 0) {
      config.models = { providers: customProviders }
    } else {
      delete config.models
    }

    // ── plugins: google-gemini-cli-auth ──
    if (googleGeminiCliEnabled) {
      if (!config.plugins) config.plugins = {}
      if (!config.plugins.entries) config.plugins.entries = {}
      config.plugins.entries['google-gemini-cli-auth'] = { enabled: true }
    } else {
      // Remove plugin only if it was previously enabled by ClawBench (preserve if unknown)
      if (config.plugins?.entries?.['google-gemini-cli-auth']?.enabled === true) {
        delete config.plugins.entries['google-gemini-cli-auth']
        if (Object.keys(config.plugins.entries).length === 0) delete config.plugins.entries
        if (!config.plugins.entries && Object.keys(config.plugins).length === 0) delete config.plugins
      }
    }

    // ── agents.defaults ── Use model priority list: first = primary, rest = fallbacks
    const storedPriority = getModelPriority()
    const syncedPriority = syncModelPriorityWithItems(storedPriority, items)
    const primaryModelId = syncedPriority[0] || (() => {
      // Fallback: derive from first enabled provider (keeps existing behaviour when priority is empty)
      const firstBuiltin = builtinProvidersWithKey[0]
      const firstCustom = enabledProviders.find((p) => !BUILTIN_PROVIDERS.has(p.id) && p.id !== 'google-gemini-cli')
      const ggcItem = enabledProviders.find((p) => p.id === 'google-gemini-cli')
      if (firstBuiltin) {
        return firstBuiltin.models?.split(',')[0]?.trim() || BUILTIN_DEFAULT_MODELS[firstBuiltin.id]
      }
      if (ggcItem?.configValues.models) {
        const firstModel = ggcItem.configValues.models.split(',')[0]?.trim()
        return firstModel ? `google-gemini-cli/${firstModel}` : undefined
      }
      if (firstCustom) {
        const firstModel = firstCustom.configValues.models?.split(',')[0]?.trim()
        return firstModel ? `${firstCustom.id}/${firstModel}` : undefined
      }
      return undefined
    })()

    if (!config.agents) config.agents = {}
    if (!config.agents.defaults) config.agents.defaults = {}
    if (!config.agents.defaults.model) config.agents.defaults.model = {}

    if (primaryModelId) {
      config.agents.defaults.model.primary = primaryModelId
      config.agents.defaults.model.fallbacks = syncedPriority.slice(1)
    } else {
      delete config.agents.defaults.model.primary
      delete config.agents.defaults.model.fallbacks
    }

    // ── agents.defaults.models ── All models from all enabled providers (full pool)
    const allEnabledModels: Record<string, object> = {}
    for (const item of enabledProviders) {
      for (const modelId of getItemModelIdsFromService(item)) {
        allEnabledModels[modelId] = {}
      }
    }
    if (Object.keys(allEnabledModels).length > 0) {
      config.agents.defaults.models = allEnabledModels
    } else {
      delete config.agents.defaults.models
    }

    // ── channels ── (ClawBench fully owns the channels section)
    const channels: Record<string, any> = {}
    items
      .filter((i) => i.category === 'comm_tool' && i.enabled)
      .forEach((item) => {
        const entry: Record<string, any> = { enabled: true }
        for (const [key, value] of Object.entries(item.configValues)) {
          if (value) entry[key] = value
        }
        channels[item.id] = entry
      })
    if (Object.keys(channels).length > 0) {
      config.channels = channels
    } else {
      delete config.channels
    }

    // ── tools ──
    // ClawBench manages: profile, elevated, web.search, web.fetch.
    // Any other tool fields (e.g. set by openclaw itself) are preserved.
    const tools: Record<string, any> = { ...(config.tools as Record<string, any> || {}) }
    delete tools.profile
    delete tools.elevated
    if (tools.web) {
      delete tools.web.search
      delete tools.web.fetch
      if (Object.keys(tools.web).length === 0) delete tools.web
    }

    // ── skills → tools.profile / tools.elevated / skills.entries ──
    const enabledSkills = items.filter((i) => i.category === 'skill' && i.enabled)
    for (const skill of enabledSkills) {
      if (skill.id === 'coding') {
        tools.profile = 'coding'
      } else if (skill.id === 'elevated') {
        tools.elevated = { enabled: true }
      } else {
        if (!config.skills) config.skills = {}
        if (!config.skills.entries) config.skills.entries = {}
        const entry: Record<string, any> = { enabled: true }
        for (const [key, value] of Object.entries(skill.configValues)) {
          if (value) entry[key] = value
        }
        config.skills.entries[skill.id] = entry
      }
    }

    // ── builtin features ──
    const enabledFeatures = items.filter((i) => i.category === 'builtin_feature' && i.enabled)
    const enabledFeatureIds = new Set(enabledFeatures.map((f) => f.id))
    for (const feat of enabledFeatures) {
      switch (feat.id) {
        case 'web_search': {
          if (!tools.web) tools.web = {}
          const search: Record<string, any> = { enabled: true }
          if (feat.configValues.apiKey) search.apiKey = feat.configValues.apiKey
          tools.web.search = search
          break
        }
        case 'web_fetch': {
          if (!tools.web) tools.web = {}
          tools.web.fetch = { enabled: true }
          break
        }
        case 'tts': {
          if (!config.messages) config.messages = {}
          const tts: Record<string, any> = {
            auto: 'inbound',
            provider: feat.configValues.provider || 'edge'
          }
          const provider = feat.configValues.provider
          if (provider && provider !== 'edge' && feat.configValues.apiKey) {
            tts[provider] = { apiKey: feat.configValues.apiKey }
          }
          config.messages.tts = tts
          break
        }
        case 'browser': {
          config.browser = { enabled: true }
          break
        }
        // cron is handled below — must preserve cron.jobs
      }
    }

    // Apply tools (or remove if nothing is managed)
    if (Object.keys(tools).length > 0) {
      config.tools = tools
    } else {
      delete config.tools
    }

    // TTS cleanup
    if (!enabledFeatureIds.has('tts')) {
      if (config.messages?.tts) {
        delete config.messages.tts
        if (Object.keys(config.messages).length === 0) delete config.messages
      }
    }

    // Browser cleanup
    if (!enabledFeatureIds.has('browser')) {
      delete config.browser
    }

    // Cron: always rewrite to keep enabled flag accurate; preserve cron.jobs at all times
    if (enabledFeatureIds.has('cron') || existingCronJobs?.length) {
      config.cron = { enabled: enabledFeatureIds.has('cron') }
      if (existingCronJobs) config.cron.jobs = existingCronJobs
    } else {
      delete config.cron
    }

    // Write openclaw.json
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    try { fs.chmodSync(configPath, 0o600) } catch { /* Windows */ }

    // Write .env — preserve unmanaged lines, update managed ones
    const allManagedKeys = new Set([...managedEnvKeys, ...Object.values(BUILTIN_ENV_KEYS)])
    const preservedLines = existingEnvLines.filter((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return true
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) return true
      const key = trimmed.substring(0, eqIdx).trim()
      return !allManagedKeys.has(key)
    })
    const finalEnv = [...preservedLines.filter((l) => l.trim()), ...envLines].join('\n') + '\n'
    fs.writeFileSync(envPath, finalEnv, 'utf-8')
    try { fs.chmodSync(envPath, 0o600) } catch { /* Windows */ }

    logger.info('Generated openclaw config at', configPath)
  } catch (err) {
    logger.error('Failed to generate openclaw config:', err)
  }
}

/** Mapping from builtin provider id → environment variable name in ~/.openclaw/.env */
const BUILTIN_ENV_KEYS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY'
}

/** Reverse mapping: env var name → builtin provider id */
const ENV_KEY_TO_PROVIDER: Record<string, string> = {
  OPENAI_API_KEY: 'openai',
  ANTHROPIC_API_KEY: 'anthropic',
  GOOGLE_API_KEY: 'google'
}

/** Default model IDs for built-in providers (openclaw v2026 format) */
const BUILTIN_DEFAULT_MODELS: Record<string, string> = {
  openai: 'openai/gpt-4o',
  anthropic: 'anthropic/claude-opus-4-6',
  google: 'google/gemini-2.0-flash'
}

/**
 * Write ~/.openclaw/agents/main/agent/auth-profiles.json
 * openclaw v2026 reads built-in provider API keys from this file
 * (shellEnvFallback is disabled by default — .env is NOT used).
 */
function writeAuthProfilesJson(providers: Array<{ id: string; apiKey: string }>): void {
  const authProfilesDir = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'agent')
  const authProfilesPath = path.join(authProfilesDir, 'auth-profiles.json')

  let existing: Record<string, any> = { version: 1, profiles: {} }
  try {
    existing = JSON.parse(fs.readFileSync(authProfilesPath, 'utf-8'))
    if (!existing.profiles) existing.profiles = {}
  } catch {
    // Start fresh
  }

  // Remove existing manual profiles for all built-in providers (ClawBench owns these)
  for (const providerId of BUILTIN_PROVIDERS) {
    delete existing.profiles[`${providerId}:manual`]
  }

  // Write profiles for enabled providers that have an API key
  for (const { id, apiKey } of providers) {
    existing.profiles[`${id}:manual`] = { type: 'api_key', provider: id, key: apiKey }
  }

  if (!fs.existsSync(authProfilesDir)) {
    fs.mkdirSync(authProfilesDir, { recursive: true })
  }
  fs.writeFileSync(authProfilesPath, JSON.stringify(existing, null, 2), 'utf-8')
  try { fs.chmodSync(authProfilesPath, 0o600) } catch { /* Windows */ }
}

/** Whether we've already attempted the native config sync this session */
let nativeConfigSynced = false

/**
 * One-time sync: read ~/.openclaw/openclaw.json + .env and merge into
 * electron-store items so the UI reflects the user's actual configuration.
 * Only runs when electron-store items are still at defaults (all disabled,
 * all config values empty).
 */
function syncNativeConfigIfNeeded(): void {
  if (nativeConfigSynced) return
  nativeConfigSynced = true

  const { items } = getOpenClawConfig()

  const openclawDir = path.join(os.homedir(), '.openclaw')
  const configPath = path.join(openclawDir, 'openclaw.json')
  const envPath = path.join(openclawDir, '.env')

  let nativeConfig: Record<string, any> = {}
  let envVars: Record<string, string> = {}

  try {
    nativeConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch {
    // No native config file
  }
  try {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      envVars[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim()
    }
  } catch {
    // No .env file
  }

  // Nothing to sync
  if (Object.keys(nativeConfig).length === 0 && Object.keys(envVars).length === 0) return

  const itemMap = new Map(items.map((i) => [i.id, i]))

  // ── Builtin AI providers from auth-profiles.json (openclaw v2026) ──
  const authProfilesPath = path.join(openclawDir, 'agents', 'main', 'agent', 'auth-profiles.json')
  try {
    const authProfiles = JSON.parse(fs.readFileSync(authProfilesPath, 'utf-8'))
    const profiles = authProfiles.profiles as Record<string, any> | undefined
    if (profiles) {
      for (const [profileKey, profile] of Object.entries(profiles)) {
        const providerId = profileKey.split(':')[0]
        if (BUILTIN_PROVIDERS.has(providerId) && profile.type === 'api_key') {
          const apiKey = profile.key || profile.apiKey
          if (apiKey) {
            const item = itemMap.get(providerId)
            if (item && !item.enabled) { item.enabled = true; item.configValues.apiKey = apiKey }
          }
        }
      }
    }
  } catch {
    // auth-profiles.json doesn't exist yet
  }

  // ── OAuth providers from auth.profiles in openclaw.json (google-gemini-cli etc.) ──
  const authProfiles = nativeConfig.auth?.profiles as Record<string, any> | undefined
  if (authProfiles) {
    for (const [profileKey, profile] of Object.entries(authProfiles)) {
      const providerId = profileKey.split(':')[0]
      const email = profileKey.split(':')[1] || ''
      if (providerId === 'google-gemini-cli') {
        const item = itemMap.get('google-gemini-cli')
        if (item && !item.enabled) {
          item.enabled = true
          item.configValues.authMode = profile.mode === 'api_key' ? 'api_key' : 'oauth'
          if (email) item.configValues.oauthEmail = email
          if (profile.apiKey || profile.key) {
            item.configValues.apiKey = profile.apiKey || profile.key
          }
        }
      }
    }
  }

  // ── google-gemini-cli models from agents.defaults.models ──
  const agentModels = nativeConfig.agents?.defaults?.models as Record<string, any> | undefined
  if (agentModels) {
    const ggcModels = Object.keys(agentModels)
      .filter((m) => m.startsWith('google-gemini-cli/'))
      .map((m) => m.replace('google-gemini-cli/', ''))
    if (ggcModels.length > 0) {
      const item = itemMap.get('google-gemini-cli')
      if (item && item.enabled && !item.configValues.models) {
        item.configValues.models = ggcModels.join(',')
      }
    }
  }

  // ── Builtin AI providers from .env (legacy fallback) ──
  for (const [envKey, providerId] of Object.entries(ENV_KEY_TO_PROVIDER)) {
    if (envVars[envKey]) {
      const item = itemMap.get(providerId)
      // Only apply if not already populated from auth-profiles.json
      if (item && !item.enabled) {
        item.enabled = true
        item.configValues.apiKey = envVars[envKey]
      }
    }
  }

  // ── Custom AI providers from models.providers ──
  const providers = nativeConfig.models?.providers as Record<string, any> | undefined
  if (providers) {
    for (const [id, cfg] of Object.entries(providers)) {
      const item = itemMap.get(id)
      if (item && !item.enabled) {
        item.enabled = true
        if (cfg.baseUrl) item.configValues.baseUrl = cfg.baseUrl
        if (cfg.apiKey) item.configValues.apiKey = cfg.apiKey
        if (cfg.api) item.configValues.api = cfg.api
        if (cfg.models && Array.isArray(cfg.models)) {
          item.configValues.models = cfg.models.map((m: any) => m.id || m).join(',')
        }
      }
    }
  }

  // ── Channels (comm tools) ──
  const channels = nativeConfig.channels as Record<string, any> | undefined
  if (channels) {
    for (const [id, cfg] of Object.entries(channels)) {
      const item = itemMap.get(id)
      if (item && !item.enabled) {
        item.enabled = !!(cfg.enabled !== false)
        for (const [key, value] of Object.entries(cfg)) {
          if (key !== 'enabled' && typeof value === 'string' && key in item.configValues) {
            item.configValues[key] = value
          }
        }
      }
    }
  }

  // ── Skills ──
  const tools = nativeConfig.tools as Record<string, any> | undefined
  if (tools?.profile === 'coding') {
    const item = itemMap.get('coding')
    if (item) item.enabled = true
  }
  if (tools?.elevated?.enabled) {
    const item = itemMap.get('elevated')
    if (item) item.enabled = true
  }
  const skillEntries = nativeConfig.skills?.entries as Record<string, any> | undefined
  if (skillEntries) {
    for (const [id, cfg] of Object.entries(skillEntries)) {
      const item = itemMap.get(id)
      if (item && cfg.enabled) item.enabled = true
    }
  }

  // ── Builtin features ──
  if (tools?.web?.search?.enabled) {
    const item = itemMap.get('web_search')
    if (item) {
      item.enabled = true
      if (tools.web.search.apiKey) item.configValues.apiKey = tools.web.search.apiKey
    }
  }
  if (tools?.web?.fetch?.enabled) {
    const item = itemMap.get('web_fetch')
    if (item) item.enabled = true
  }
  if (nativeConfig.messages?.tts) {
    const item = itemMap.get('tts')
    if (item) {
      item.enabled = true
      const tts = nativeConfig.messages.tts
      if (tts.provider) item.configValues.provider = tts.provider
      // Extract apiKey from provider-specific sub-object
      const provider = tts.provider
      if (provider && tts[provider]?.apiKey) {
        item.configValues.apiKey = tts[provider].apiKey
      }
    }
  }
  if (nativeConfig.browser?.enabled) {
    const item = itemMap.get('browser')
    if (item) item.enabled = true
  }
  if (nativeConfig.cron?.enabled) {
    const item = itemMap.get('cron')
    if (item) item.enabled = true
  }

  // Persist merged items to electron-store
  setOpenClawConfig({ items })

  // ── Model priority from agents.defaults.model.primary + fallbacks ──
  // Sync if: stored priority is empty, OR it doesn't contain the native primary model
  // (e.g. after migration added a new provider like google-gemini-cli)
  const modelDef = nativeConfig.agents?.defaults?.model as Record<string, any> | undefined
  if (modelDef) {
    const primary: string = modelDef.primary || ''
    const fallbacks: string[] = Array.isArray(modelDef.fallbacks) ? modelDef.fallbacks : []
    const currentPriority = getModelPriority()
    const nativePrimaryMissing = primary && !currentPriority.includes(primary)
    if (currentPriority.length === 0 || nativePrimaryMissing) {
      const allModels = new Set<string>()
      for (const item of items) {
        if (item.category === 'ai_provider' && item.enabled) {
          for (const id of getItemModelIdsFromService(item)) allModels.add(id)
        }
      }
      const priorityFromConfig = [primary, ...fallbacks].filter(
        (m) => m && allModels.has(m)
      )
      if (priorityFromConfig.length > 0) {
        setModelPriority(priorityFromConfig)
      }
    }
  }

  logger.info('Synced native openclaw config into electron-store')
}

// ── Google OAuth ──────────────────────────────────────────────────────────────

/**
 * Trigger Google Gemini CLI OAuth login flow.
 *
 * Runs `openclaw auth login google-gemini-cli`, which:
 *   1. Starts a local callback server
 *   2. Prints the Google OAuth URL to stdout
 *   3. Waits for the user to complete auth in the browser
 *
 * On Windows the browser redirect may not land automatically — the user
 * can copy the callback URL shown by the CLI back here to complete auth.
 *
 * Returns { success, url, error }
 *   url: the Google auth URL (so the renderer can open it explicitly)
 */
export async function startGoogleOAuth(): Promise<{ success: boolean; url?: string; error?: string }> {
  const { shell } = await import('electron')
  const env = getAugmentedEnv()

  return new Promise((resolve) => {
    let authUrl: string | undefined
    let resolved = false

    const proc = spawn('openclaw', ['auth', 'login', 'google-gemini-cli'], {
      env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const onData = (data: Buffer) => {
      const text = data.toString()
      // Look for a URL in the output
      const urlMatch = text.match(/https?:\/\/[^\s"']+/)
      if (urlMatch && !authUrl) {
        authUrl = urlMatch[0]
        shell.openExternal(authUrl).catch(() => {})
      }
    }

    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)

    proc.on('close', (code) => {
      if (resolved) return
      resolved = true
      if (code === 0) {
        // Re-sync native config so updated auth.profiles is picked up
        nativeConfigSynced = false
        resolve({ success: true, url: authUrl })
      } else {
        resolve({ success: false, url: authUrl, error: `openclaw auth login exited with code ${code}` })
      }
    })

    proc.on('error', (err) => {
      if (resolved) return
      resolved = true
      resolve({ success: false, error: err.message })
    })

    // Timeout after 3 minutes
    setTimeout(() => {
      if (!resolved) {
        resolved = true
        proc.kill()
        resolve({ success: false, url: authUrl, error: 'OAuth 超时（3 分钟），请重试' })
      }
    }, 3 * 60 * 1000)
  })
}

// ── Update Check ─────────────────────────────────────────────────────────────

/**
 * Fetch the latest published version of openclaw from the npm registry.
 * Returns null if the registry is unreachable or the package is not found.
 */
export async function checkLatestVersion(): Promise<{ latestVersion: string | null }> {
  return new Promise((resolve) => {
    const req = https.get('https://registry.npmjs.org/openclaw/latest', { timeout: 8000 }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          resolve({ latestVersion: typeof parsed.version === 'string' ? parsed.version : null })
        } catch {
          resolve({ latestVersion: null })
        }
      })
    })
    req.on('error', () => resolve({ latestVersion: null }))
    req.on('timeout', () => { req.destroy(); resolve({ latestVersion: null }) })
  })
}

// ── Community Skills ──────────────────────────────────────────────────────────

export interface CommunitySkill {
  id: string
  name: string
  description: string
  downloads: number
  installsAllTime: number
  stars: number
  author?: string
  version?: string
  category?: string
  tags?: string[]
  detailUrl?: string
}

/**
 * Fetch hot skills from clawhub-skills.com, sorted by installs.
 * Returns an empty array on any network or parse error.
 */
export async function listCommunitySkills(): Promise<CommunitySkill[]> {
  return new Promise((resolve) => {
    const url = 'https://clawhub-skills.com/api/skills?sort=installsAllTime&page=1&pageSize=12'
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve([])
          return
        }
        try {
          const parsed = JSON.parse(data)
          const list: any[] = Array.isArray(parsed)
            ? parsed
            : (parsed.skills || parsed.data || parsed.items || [])
          const items: CommunitySkill[] = list.map((s: any) => ({
            id: String(s.slug || s.id || s.name),
            name: s.displayName || s.name || s.title || s.id,
            description: s.summary || s.description || '',
            installsAllTime: Number(s.installsAllTime || s.installs_all_time || 0),
            downloads: Number(s.downloads || s.download_count || 0),
            stars: Number(s.stars || s.star_count || s.stargazers_count || 0),
            author: s.author || s.owner || s.creator || undefined,
            version: s.version || undefined,
            category: s.category || s.parentCategory || s.type || undefined,
            tags: Array.isArray(s.tags) ? s.tags.filter((t: string) => t !== 'latest') : undefined,
            detailUrl: s.detailUrl || s.detail_url || (s.slug ? `https://clawhub-skills.com/skills/${s.slug}` : undefined)
          }))
          resolve(items)
        } catch (err) {
          logger.warn('Failed to parse community skills response:', err)
          resolve([])
        }
      })
    })
    req.on('error', (err) => {
      logger.warn('Failed to fetch community skills:', err)
      resolve([])
    })
    req.on('timeout', () => {
      req.destroy()
      logger.warn('Community skills request timed out')
      resolve([])
    })
  })
}

/**
 * Install a community skill via `npx clawhub@latest install <slug>`.
 * Persists the installed skill id to electron-store.
 */
export async function installSkill(id: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    let output = ''
    const child = spawn('npx', ['clawhub@latest', 'install', id], {
      env: getAugmentedEnv()
    })
    child.stdout?.on('data', (chunk) => { output += chunk.toString() })
    child.stderr?.on('data', (chunk) => { output += chunk.toString() })
    child.on('close', (code) => {
      if (code === 0) {
        const ids = getInstalledSkills()
        if (!ids.includes(id)) {
          setInstalledSkills([...ids, id])
        }
        resolve({ success: true, output })
      } else {
        resolve({ success: false, output })
      }
    })
    child.on('error', (err) => {
      resolve({ success: false, output: err.message })
    })
  })
}

// ── Cron Job Management ───────────────────────────────────────────────────────

export interface CronJob {
  id: string
  name: string
  expression: string
  enabled: boolean
  description: string
  nextRun?: string
}

/**
 * Translate a cron expression into a human-readable Chinese description.
 * Handles the most common patterns; falls back to the raw expression.
 */
function parseCronToNaturalLanguage(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr

  const [minute, hour, dom, month, dow] = parts

  // Every minute
  if (minute === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return '每分钟'
  }

  // Every N minutes: */N * * * *
  const everyNMinutes = minute.match(/^\*\/(\d+)$/)
  if (everyNMinutes && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return `每 ${everyNMinutes[1]} 分钟`
  }

  // Every hour: 0 * * * * or */N * * * *
  if (minute === '0' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return '每小时整点'
  }
  const everyNHours = hour.match(/^\*\/(\d+)$/)
  if (everyNHours && dom === '*' && month === '*' && dow === '*') {
    const m = minute === '0' ? '整点' : `${minute} 分`
    return `每 ${everyNHours[1]} 小时${m}`
  }

  // Daily at specific time: M H * * *
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
    return `每天 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  }

  // Weekdays: M H * * 1-5
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '1-5') {
    return `工作日每天 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  }

  // Weekly on specific day: M H * * D
  const dayNames: Record<string, string> = {
    '0': '周日', '1': '周一', '2': '周二', '3': '周三',
    '4': '周四', '5': '周五', '6': '周六', '7': '周日'
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dayNames[dow]) {
    return `每${dayNames[dow]} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  }

  // Monthly on specific day: M H D * *
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && month === '*' && dow === '*') {
    return `每月 ${dom} 号 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  }

  return expr
}

/**
 * Read cron jobs from ~/.openclaw/cron/jobs.json.
 * The file contains { version, jobs: [...] }; each job stores its schedule
 * under schedule.expr (kind="cron").
 */
export async function getCronJobs(): Promise<CronJob[]> {
  const jobsPath = path.join(os.homedir(), '.openclaw', 'cron', 'jobs.json')
  try {
    const raw = fs.readFileSync(jobsPath, 'utf-8')
    const data = JSON.parse(raw)
    const jobs: any[] = Array.isArray(data.jobs) ? data.jobs : []
    return jobs.map((job: any) => {
      const expr = String(job.schedule?.expr || job.schedule?.expression || '')
      const nextRunMs: number | undefined = job.state?.nextRunAtMs
      const nextRun = nextRunMs ? new Date(nextRunMs).toLocaleString('zh-CN') : undefined
      return {
        id: String(job.id),
        name: job.name || job.id,
        expression: expr,
        enabled: job.enabled !== false,
        description: parseCronToNaturalLanguage(expr),
        nextRun
      }
    })
  } catch {
    return []
  }
}

/**
 * Toggle a cron job's enabled state in ~/.openclaw/cron/jobs.json.
 */
export async function toggleCronJob(id: string, enabled: boolean): Promise<void> {
  const jobsPath = path.join(os.homedir(), '.openclaw', 'cron', 'jobs.json')
  try {
    const raw = fs.readFileSync(jobsPath, 'utf-8')
    const data = JSON.parse(raw)
    if (!Array.isArray(data.jobs)) return
    const job = data.jobs.find((j: any) => String(j.id) === id)
    if (job) {
      job.enabled = enabled
      job.updatedAtMs = Date.now()
      fs.writeFileSync(jobsPath, JSON.stringify(data, null, 2), 'utf-8')
    }
  } catch (err) {
    logger.error('Failed to toggle cron job:', err)
  }
}

// ── Channel Pairing ───────────────────────────────────────────────────────────

/**
 * Approve a pairing request from a channel bot.
 * Runs: openclaw pairing approve <channel> <code>
 * The code is the short uppercase token the bot sends in response to the first message.
 */
export async function pairingApprove(
  channel: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await execAsync(`openclaw pairing approve ${channel} ${code}`, {
      timeout: 30000,
      env: getAugmentedEnv()
    })
    return { success: true }
  } catch (err: any) {
    logger.error(`[openclaw] Pairing approve failed for ${channel}:`, err)
    return { success: false, error: err.stderr?.trim() || err.message }
  }
}
