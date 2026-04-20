// frontend/src/main/services/hermes.service.ts
import { exec, spawn } from 'child_process'
import { BrowserWindow } from 'electron'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as logger from '../utils/logger'
import * as yaml from 'js-yaml'
import type { HermesConfig } from '../../renderer/src/types/hermes'
import { createDefaultHermesConfig } from '../../renderer/src/pages/Hermes/hermes-provider-helpers'

const execAsync = promisify(exec)

// ── Types ──────────────────────────────────────────────────────────────────

export interface HermesInstallCheck {
  installed: boolean
  version?: string
}

export type HermesServiceStatus = 'running' | 'stopped' | 'unknown'

// ── Constants ─────────────────────────────────────────────────────────────

const HERMES_DIR = path.join(os.homedir(), '.hermes')
const CONFIG_YAML = path.join(HERMES_DIR, 'config.yaml')
const ENV_FILE = path.join(HERMES_DIR, '.env')
const HERMES_BIN = path.join(os.homedir(), '.local', 'bin', 'hermes')

const PROVIDER_KEY_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  'gemini-api': 'GOOGLE_API_KEY',
  google: 'GOOGLE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  xai: 'XAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  kimi: 'KIMI_API_KEY',
  qwen: 'DASHSCOPE_API_KEY',
  glm: 'GLM_API_KEY',
  // ark is not a native Hermes provider — it uses openrouter protocol with a custom base URL
  ark: 'OPENROUTER_API_KEY',
  'ollama-cloud': 'OLLAMA_API_KEY',
  copilot: 'GITHUB_COPILOT_TOKEN',
}

// Providers that map to a different Hermes wire provider
const PROVIDER_WIRE_MAP: Record<string, string> = {
  ark: 'openrouter',
}

// Base URLs to inject into .env for remapped providers
const PROVIDER_BASE_URL_MAP: Record<string, string> = {
  ark: 'https://ark.cn-beijing.volces.com/api/v3',
}

// Detect UI provider from wire provider + base URL
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

const HERMES_CHANNEL_KEYS = [
  'telegram',
  'discord',
  'slack',
  'signal',
  'whatsapp',
  'matrix',
  'mattermost',
  'homeassistant',
  'dingtalk',
  'feishu',
  'wecom',
  'weixin',
  'sms',
  'email',
  'bluebubbles',
  'qqbot',
] as const

function readBooleanEnv(value?: string): boolean {
  return value === '1' || value === 'true'
}

function resolveProviderEnvKey(provider: string): string {
  return PROVIDER_KEY_MAP[provider] || 'API_KEY'
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

function readGatewayPidFile(): number | null {
  const pidFile = path.join(HERMES_DIR, 'gateway.pid')
  try {
    if (!fs.existsSync(pidFile)) return null
    const data = JSON.parse(fs.readFileSync(pidFile, 'utf-8'))
    const pid = typeof data === 'object' ? data?.pid : Number(data)
    return pid && Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

export async function getServiceStatus(): Promise<HermesServiceStatus> {
  // Check our in-process tracked PID first
  if (gatewayPid !== null) {
    try {
      process.kill(gatewayPid, 0)
      return 'running'
    } catch {
      gatewayPid = null
    }
  }

  // Fall back to the PID file written by `hermes gateway` itself
  const filePid = readGatewayPidFile()
  if (filePid !== null) {
    try {
      process.kill(filePid, 0)
      gatewayPid = filePid  // adopt the external PID so future calls are fast
      return 'running'
    } catch {
      // Process is dead even though file exists
    }
  }

  return 'stopped'
}

export async function startGateway(): Promise<{ success: boolean; error?: string }> {
  try {
    const status = await getServiceStatus()
    if (status === 'running') return { success: true }

    const env = getAugmentedEnv()

    // Use `hermes gateway start` which daemonizes via launchd (macOS) or the
    // hermes process manager — avoids the foreground-process-exits-immediately issue.
    try {
      const { stderr } = await execAsync('hermes gateway start', { timeout: 15000, env })
      if (stderr?.trim()) logger.warn('[hermes] gateway start stderr:', stderr.trim())
    } catch (err: any) {
      const msg = (err.stderr || err.stdout || err.message || '').trim()
      logger.error('[hermes] gateway start failed:', msg)
      return { success: false, error: msg || 'hermes gateway start failed' }
    }

    // Poll up to 10s for the gateway to write its PID file and come alive
    const started = await new Promise<boolean>((resolve) => {
      let waited = 0
      const interval = setInterval(() => {
        waited += 500
        const pid = readGatewayPidFile()
        if (pid !== null) {
          try {
            process.kill(pid, 0)
            gatewayPid = pid
            clearInterval(interval)
            resolve(true)
            return
          } catch {
            // not alive yet
          }
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
  gatewayPid = null
  try {
    await execAsync('hermes gateway stop', { timeout: 10000, env: getAugmentedEnv() })
    logger.info('[hermes] Gateway stopped')
    return { success: true }
  } catch (err: any) {
    // `hermes gateway stop` exits non-zero if no gateway is running — treat as success
    const msg = (err.stderr || err.stdout || err.message || '').trim()
    if (msg.includes('not running') || msg.includes('No gateway') || msg.includes('Stopped')) {
      return { success: true }
    }
    return { success: false, error: msg }
  }
}

// ── Config read/write ──────────────────────────────────────────────────────

export function readHermesConfigFromSources(rawYaml: any, env: Record<string, string>): HermesConfig {
  let provider = rawYaml?.model?.provider || 'anthropic'

  // Reverse-map wire providers back to UI providers (e.g. openrouter + ark base URL → ark)
  if (provider === 'openrouter' && env.OPENROUTER_BASE_URL === ARK_BASE_URL) {
    provider = 'ark'
  }

  const config = createDefaultHermesConfig(provider)

  config.model.provider = provider
  config.model.model = rawYaml?.model?.default || rawYaml?.model?.model || config.model.model
  config.model.base_url = rawYaml?.model?.base_url || ''
  config.model.authType = (rawYaml?.model?.auth_type || config.model.authType) as HermesConfig['model']['authType']
  config.model.apiKey = env[resolveProviderEnvKey(provider)] || ''

  if (provider === 'bedrock') {
    config.model.authType = 'aws'
    config.model.aws = {
      region: rawYaml?.aws?.region || env.AWS_REGION || 'us-east-1',
      profile: env.AWS_PROFILE || '',
      accessKeyId: env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY || '',
      sessionToken: env.AWS_SESSION_TOKEN || '',
      bedrockBaseUrl: env.BEDROCK_BASE_URL || '',
    }
  }

  if (config.model.authType === 'oauth') {
    config.model.oauth = {
      configured: !!env[`${provider.toUpperCase().replace(/-/g, '_')}_ACCOUNT`],
      accountLabel: env[`${provider.toUpperCase().replace(/-/g, '_')}_ACCOUNT`] || '',
      authMode: rawYaml?.model?.auth_mode || 'oauth',
    }
  }

  if (config.model.authType === 'compatible') {
    config.model.headers = {}
    config.model.extra = {}
  }

  if (config.model.authType === 'local') {
    config.model.local = {
      toolCallParser: rawYaml?.model?.tool_call_parser || '',
      contextWindow: rawYaml?.model?.context_window || '',
      endpointHint: rawYaml?.model?.endpoint_hint || '',
    }
  }

  config.agent.max_turns = rawYaml?.agent?.max_turns ?? config.agent.max_turns
  config.agent.reasoning_effort = rawYaml?.agent?.reasoning_effort || config.agent.reasoning_effort
  config.agent.memory_enabled = rawYaml?.memory?.memory_enabled ?? config.agent.memory_enabled
  config.agent.user_profile_enabled = rawYaml?.memory?.user_profile_enabled ?? config.agent.user_profile_enabled

  const channels = rawYaml?._ui?.channels || {}
  config.channels.telegram.enabled = !!channels.telegram
  config.channels.discord.enabled = !!channels.discord
  config.channels.slack.enabled = !!channels.slack
  config.channels.signal.enabled = !!channels.signal
  config.channels.whatsapp.enabled = !!channels.whatsapp || readBooleanEnv(env.WHATSAPP_ENABLED)
  config.channels.matrix.enabled = !!channels.matrix
  config.channels.mattermost.enabled = !!channels.mattermost
  config.channels.homeassistant.enabled = !!channels.homeassistant
  config.channels.dingtalk.enabled = !!channels.dingtalk
  config.channels.feishu.enabled = !!channels.feishu
  config.channels.wecom.enabled = !!channels.wecom
  config.channels.weixin.enabled = !!channels.weixin
  config.channels.sms.enabled = !!channels.sms
  config.channels.email.enabled = !!channels.email
  config.channels.bluebubbles.enabled = !!channels.bluebubbles
  config.channels.qqbot.enabled = !!channels.qqbot
  config.channels.telegram.token = env.TELEGRAM_BOT_TOKEN || ''
  config.channels.discord.token = env.DISCORD_BOT_TOKEN || ''
  config.channels.slack.bot_token = env.SLACK_BOT_TOKEN || ''
  config.channels.slack.app_token = env.SLACK_APP_TOKEN || ''
  config.channels.signal.http_url = env.SIGNAL_HTTP_URL || ''
  config.channels.signal.account = env.SIGNAL_ACCOUNT || ''
  config.channels.matrix.homeserver = env.MATRIX_HOMESERVER || ''
  config.channels.matrix.access_token = env.MATRIX_ACCESS_TOKEN || ''
  config.channels.mattermost.url = env.MATTERMOST_URL || ''
  config.channels.mattermost.token = env.MATTERMOST_TOKEN || ''
  config.channels.homeassistant.url = env.HASS_URL || ''
  config.channels.homeassistant.token = env.HASS_TOKEN || ''
  config.channels.dingtalk.client_id = env.DINGTALK_CLIENT_ID || ''
  config.channels.dingtalk.client_secret = env.DINGTALK_CLIENT_SECRET || ''
  config.channels.feishu.app_id = env.FEISHU_APP_ID || ''
  config.channels.feishu.app_secret = env.FEISHU_APP_SECRET || ''
  config.channels.wecom.bot_id = env.WECOM_BOT_ID || ''
  config.channels.wecom.secret = env.WECOM_SECRET || ''
  config.channels.weixin.token = env.WEIXIN_TOKEN || ''
  config.channels.weixin.account_id = env.WEIXIN_ACCOUNT_ID || ''
  config.channels.sms.account_sid = env.TWILIO_ACCOUNT_SID || ''
  config.channels.sms.auth_token = env.TWILIO_AUTH_TOKEN || ''
  config.channels.sms.phone_number = env.TWILIO_PHONE_NUMBER || ''
  config.channels.sms.webhook_url = env.SMS_WEBHOOK_URL || ''
  config.channels.email.address = env.EMAIL_ADDRESS || ''
  config.channels.email.password = env.EMAIL_PASSWORD || ''
  config.channels.email.imap_host = env.EMAIL_IMAP_HOST || ''
  config.channels.email.smtp_host = env.EMAIL_SMTP_HOST || ''
  config.channels.bluebubbles.server_url = env.BLUEBUBBLES_SERVER_URL || ''
  config.channels.bluebubbles.password = env.BLUEBUBBLES_PASSWORD || ''
  config.channels.qqbot.app_id = env.QQ_APP_ID || ''
  config.channels.qqbot.client_secret = env.QQ_CLIENT_SECRET || ''

  return config
}

export function normalizeHermesConfigForSave(config: HermesConfig): { yaml: Record<string, any>; env: Record<string, string> } {
  // Map UI provider to Hermes wire provider (ark → openrouter)
  const wireProvider = PROVIDER_WIRE_MAP[config.model.provider] ?? config.model.provider

  const yamlConfig: Record<string, any> = {
    model: {
      provider: wireProvider,
      default: config.model.model,
      base_url: config.model.base_url || undefined,
      auth_type: config.model.authType,
    },
    agent: {
      max_turns: config.agent.max_turns,
      reasoning_effort: config.agent.reasoning_effort,
    },
    memory: {
      memory_enabled: config.agent.memory_enabled,
      user_profile_enabled: config.agent.user_profile_enabled,
    },
    _ui: {
      channels: HERMES_CHANNEL_KEYS.reduce<Record<string, boolean>>((result, channelKey) => {
        result[channelKey] = config.channels[channelKey].enabled
        return result
      }, {}),
    },
  }

  if (config.model.provider === 'bedrock') {
    yamlConfig.aws = {
      region: config.model.aws?.region || 'us-east-1',
    }
  }

  if (config.model.authType === 'local') {
    yamlConfig.model.tool_call_parser = config.model.local?.toolCallParser || undefined
    yamlConfig.model.context_window = config.model.local?.contextWindow || undefined
    yamlConfig.model.endpoint_hint = config.model.local?.endpointHint || undefined
  }

  const env: Record<string, string> = {
    [resolveProviderEnvKey(config.model.provider)]: config.model.apiKey,
    // For providers remapped to a wire protocol, set the required base URL
    ...(PROVIDER_BASE_URL_MAP[config.model.provider]
      ? { OPENROUTER_BASE_URL: PROVIDER_BASE_URL_MAP[config.model.provider] }
      : {}),
    TELEGRAM_BOT_TOKEN: config.channels.telegram.token,
    DISCORD_BOT_TOKEN: config.channels.discord.token,
    SLACK_BOT_TOKEN: config.channels.slack.bot_token,
    SLACK_APP_TOKEN: config.channels.slack.app_token,
    SIGNAL_HTTP_URL: config.channels.signal.http_url,
    SIGNAL_ACCOUNT: config.channels.signal.account,
    WHATSAPP_ENABLED: String(config.channels.whatsapp.enabled),
    MATRIX_HOMESERVER: config.channels.matrix.homeserver,
    MATRIX_ACCESS_TOKEN: config.channels.matrix.access_token,
    MATTERMOST_URL: config.channels.mattermost.url,
    MATTERMOST_TOKEN: config.channels.mattermost.token,
    HASS_URL: config.channels.homeassistant.url,
    HASS_TOKEN: config.channels.homeassistant.token,
    DINGTALK_CLIENT_ID: config.channels.dingtalk.client_id,
    DINGTALK_CLIENT_SECRET: config.channels.dingtalk.client_secret,
    FEISHU_APP_ID: config.channels.feishu.app_id,
    FEISHU_APP_SECRET: config.channels.feishu.app_secret,
    WECOM_BOT_ID: config.channels.wecom.bot_id,
    WECOM_SECRET: config.channels.wecom.secret,
    WEIXIN_TOKEN: config.channels.weixin.token,
    WEIXIN_ACCOUNT_ID: config.channels.weixin.account_id,
    TWILIO_ACCOUNT_SID: config.channels.sms.account_sid,
    TWILIO_AUTH_TOKEN: config.channels.sms.auth_token,
    TWILIO_PHONE_NUMBER: config.channels.sms.phone_number,
    SMS_WEBHOOK_URL: config.channels.sms.webhook_url,
    EMAIL_ADDRESS: config.channels.email.address,
    EMAIL_PASSWORD: config.channels.email.password,
    EMAIL_IMAP_HOST: config.channels.email.imap_host,
    EMAIL_SMTP_HOST: config.channels.email.smtp_host,
    BLUEBUBBLES_SERVER_URL: config.channels.bluebubbles.server_url,
    BLUEBUBBLES_PASSWORD: config.channels.bluebubbles.password,
    QQ_APP_ID: config.channels.qqbot.app_id,
    QQ_CLIENT_SECRET: config.channels.qqbot.client_secret,
    AWS_PROFILE: config.model.aws?.profile || '',
    AWS_ACCESS_KEY_ID: config.model.aws?.accessKeyId || '',
    AWS_SECRET_ACCESS_KEY: config.model.aws?.secretAccessKey || '',
    AWS_SESSION_TOKEN: config.model.aws?.sessionToken || '',
    BEDROCK_BASE_URL: config.model.aws?.bedrockBaseUrl || '',
  }

  if (config.model.authType === 'oauth') {
    env[`${config.model.provider.toUpperCase().replace(/-/g, '_')}_ACCOUNT`] = config.model.oauth?.accountLabel || ''
  }

  return { yaml: yamlConfig, env }
}

export function getConfig(): HermesConfig {
  let rawYaml: any = {}
  try {
    if (fs.existsSync(CONFIG_YAML)) {
      rawYaml = (yaml.load(fs.readFileSync(CONFIG_YAML, 'utf-8')) as any) || {}
    }
  } catch (err) {
    logger.warn('[hermes] Failed to read config.yaml:', err)
  }

  try {
    return readHermesConfigFromSources(rawYaml, readEnvFile(ENV_FILE))
  } catch (err) {
    logger.warn('[hermes] Failed to normalize config:', err)
    return createDefaultHermesConfig('anthropic')
  }
}

export function saveConfig(config: HermesConfig): { success: boolean; error?: string } {
  try {
    if (!fs.existsSync(HERMES_DIR)) {
      fs.mkdirSync(HERMES_DIR, { recursive: true })
    }

    let existing: any = {}
    if (fs.existsSync(CONFIG_YAML)) {
      try {
        existing = (yaml.load(fs.readFileSync(CONFIG_YAML, 'utf-8')) as any) || {}
      } catch {
        existing = {}
      }
    }

    const normalized = normalizeHermesConfigForSave(config)
    existing.model = { ...(existing.model || {}), ...(normalized.yaml.model || {}) }
    existing.agent = { ...(existing.agent || {}), ...(normalized.yaml.agent || {}) }
    existing.memory = { ...(existing.memory || {}), ...(normalized.yaml.memory || {}) }
    existing._ui = normalized.yaml._ui
    if (normalized.yaml.aws) {
      existing.aws = { ...(existing.aws || {}), ...normalized.yaml.aws }
    }

    fs.writeFileSync(CONFIG_YAML, yaml.dump(existing, { lineWidth: -1 }), 'utf-8')
    const mergedEnv = { ...readEnvFile(ENV_FILE), ...normalized.env }
    writeEnvFile(ENV_FILE, mergedEnv)

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

export function getCronJobs(): string[] {
  const cronDir = path.join(HERMES_DIR, 'cron')
  if (!fs.existsSync(cronDir)) return []
  try {
    return fs.readdirSync(cronDir).filter((f) =>
      f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json') || f.endsWith('.sh')
    )
  } catch {
    return []
  }
}

export function getDashboardUrl(): string | null {
  if (gatewayPid === null) return null
  try {
    process.kill(gatewayPid, 0)
    return 'http://localhost:7860'
  } catch {
    return null
  }
}
