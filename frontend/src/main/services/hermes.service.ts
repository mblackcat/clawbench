// frontend/src/main/services/hermes.service.ts
import { exec, spawn } from 'child_process'
import { BrowserWindow } from 'electron'
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

const PROVIDER_KEY_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  nous: 'NOUS_API_KEY',
  openrouter: 'OPENROUTER_API_KEY'
}

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
  return new Promise((resolve) => {
    logger.info('[hermes] Running install script...')
    const scriptUrl = 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh'

    const sendProgress = (line: string): void => {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('hermes:install-progress', line)
      })
    }

    const child = spawn(
      '/bin/bash',
      ['-c', `curl -fsSL ${scriptUrl} | bash -s -- --skip-setup`],
      { env: getAugmentedEnv() }
    )

    const handleData = (data: Buffer): void => {
      for (const line of data.toString().split('\n')) {
        if (line.trim()) {
          logger.info('[hermes install]', line)
          sendProgress(line)
        }
      }
    }

    child.stdout?.on('data', handleData)
    child.stderr?.on('data', handleData)

    child.on('close', (code) => {
      if (code === 0) {
        logger.info('[hermes] Install complete')
        resolve({ success: true })
      } else {
        const msg = `Install script exited with code ${code}`
        logger.error('[hermes]', msg)
        resolve({ success: false, error: msg })
      }
    })

    child.on('error', (err) => {
      logger.error('[hermes] Install process error:', err)
      resolve({ success: false, error: err.message })
    })
  })
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

    // Poll for up to 10s to catch both immediate crashes and slow startups
    const started = await new Promise<boolean>((resolve) => {
      let waited = 0
      const interval = setInterval(() => {
        waited += 500
        try {
          process.kill(gatewayPid!, 0)
          clearInterval(interval)
          resolve(true)
          return
        } catch {
          // process died
        }
        if (waited >= 10000) {
          clearInterval(interval)
          resolve(false)
        }
      }, 500)
    })
    if (!started) {
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
  const pidToKill = gatewayPid
  gatewayPid = null  // clear immediately — prevent re-entry
  try {
    process.kill(pidToKill, 'SIGTERM')
    await new Promise<void>((resolve) => {
      let waited = 0
      const interval = setInterval(() => {
        waited += 500
        try {
          process.kill(pidToKill, 0)
        } catch {
          clearInterval(interval)
          resolve()
          return
        }
        if (waited >= 5000) {
          try { process.kill(pidToKill, 'SIGKILL') } catch { /* already dead */ }
          clearInterval(interval)
          resolve()
        }
      }, 500)
    })
    logger.info('[hermes] Gateway stopped')
    return { success: true }
  } catch (err: any) {
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
    const envKey = PROVIDER_KEY_MAP[config.model.provider] || 'API_KEY'
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
    const existing_env = readEnvFile(ENV_FILE)
    const envKey = PROVIDER_KEY_MAP[config.model.provider] || 'API_KEY'
    existing_env[envKey] = config.model.apiKey
    existing_env['TELEGRAM_BOT_TOKEN'] = config.channels.telegram.token
    existing_env['DISCORD_BOT_TOKEN'] = config.channels.discord.token
    existing_env['SLACK_BOT_TOKEN'] = config.channels.slack.bot_token
    existing_env['SLACK_APP_TOKEN'] = config.channels.slack.app_token
    existing_env['SIGNAL_PHONE'] = config.channels.signal.phone
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
