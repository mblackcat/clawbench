import Store from 'electron-store'
import { getUserAppsPath } from '../utils/paths'

export interface ModuleVisibility {
  aiChat: boolean
  copiper: boolean
  aiAgents: boolean
  openClaw: boolean
  aiTerminal: boolean
  localEnv: boolean
  aiCoding: boolean
}

export interface AIModelConfig {
  id: string
  name: string
  provider: 'openai' | 'openai-compatible' | 'openai-responses' | 'azure-openai' | 'google' | 'anthropic' | 'anthropic-compatible' | 'qwen' | 'doubao' | 'deepseek' | 'kimi'
  endpoint: string
  apiKey: string
  models: string[]
  enabled: boolean
  apiVersion?: string
  capabilities?: ('image-gen' | 'tool-use' | 'vision')[]
}

export interface ImageGenConfig {
  id: string
  name: string
  provider: 'dall-e' | 'stable-diffusion' | 'custom'
  endpoint: string
  apiKey: string
  defaultModel?: string
  defaultSize?: string
  enabled: boolean
}

interface SettingsSchema {
  pythonPath: string
  language: string
  theme: string
  userAppDir: string
  autoUpdate: boolean
  localIdePath: string
  localTerminalPath: string
  hasCompletedSetup: boolean
  aiModelConfigs: AIModelConfig[]
  imageGenConfigs: ImageGenConfig[]
  moduleVisibility: ModuleVisibility
  appShortcutEnabled: boolean
  appShortcutModifier: string
  appOrder: string[]
  lastChatModelConfigId: string
  lastChatModelId: string
  lastBuiltinChatModelId: string
  lastChatModelSource: string
  chatMode: string
  chatToolsEnabled: boolean
  chatWebSearchEnabled: boolean
  chatFeishuKitsEnabled: boolean
  aiToolsConfig: {
    webSearch: { provider: string; braveApiKey: string }
    webBrowse: { engine: string; lightpandaPath: string }
    feishuKits: { enabled: boolean; cliPath: string }
    toolBehavior: { maxToolSteps: number; maxSearchRounds: number; toolTimeoutMs: number }
  }
  customSystemPrompt: string
  defaultToolApprovalMode: string
  /**
   * @deprecated Unused by agent loop (always unbounded + anti-spin).
   * Kept for store schema compatibility; never gates tool rounds.
   */
  maxAgentToolSteps: number
  /** Master switch for AI assistant persona/memory/harness. Default true. */
  assistantEnabled: boolean
  /** Role chosen in setup wizard; drives soul persona templates. */
  setupRole: string
  /**
   * Per-tool enablement for AI Coding (keyed by Local Env toolId, e.g. 'claude-code').
   * Missing keys: claude-code + codex-cli default ON; all other coding tools default OFF.
   * Explicit user toggles are persisted and take precedence.
   */
  codingToolsEnabled: Record<string, boolean>
}

interface PublicSettings {
  pythonPath: string
  language: string
  theme: string
  userAppDir: string
  autoUpdate: boolean
  localIdePath: string
  localTerminalPath: string
  hasCompletedSetup: boolean
  aiModelConfigs: AIModelConfig[]
  imageGenConfigs: ImageGenConfig[]
  moduleVisibility: ModuleVisibility
  appShortcutEnabled: boolean
  appShortcutModifier: string
  appOrder: string[]
}

export const settingsStore = new Store<SettingsSchema>({
  name: 'settings',
  schema: {
    hasCompletedSetup: {
      type: 'boolean',
      default: false
    },
    pythonPath: {
      type: 'string',
      default: ''
    },
    language: {
      type: 'string',
      default: 'zh-CN'
    },
    theme: {
      type: 'string',
      default: 'light'
    },
    userAppDir: {
      type: 'string',
      default: ''
    },
    autoUpdate: {
      type: 'boolean',
      default: true
    },
    localIdePath: {
      type: 'string',
      default: ''
    },
    localTerminalPath: {
      type: 'string',
      default: ''
    },
    aiModelConfigs: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          provider: { type: 'string' },
          endpoint: { type: 'string' },
          apiKey: { type: 'string' },
          models: { type: 'array', items: { type: 'string' } },
          enabled: { type: 'boolean' },
          apiVersion: { type: 'string' },
          capabilities: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    imageGenConfigs: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          provider: { type: 'string' },
          endpoint: { type: 'string' },
          apiKey: { type: 'string' },
          defaultModel: { type: 'string' },
          defaultSize: { type: 'string' },
          enabled: { type: 'boolean' }
        }
      }
    },
    moduleVisibility: {
      type: 'object',
      default: { aiChat: true, copiper: false, aiAgents: true, openClaw: false, aiTerminal: true, localEnv: true, aiCoding: true },
      properties: {
        aiChat: { type: 'boolean' },
        copiper: { type: 'boolean' },
        aiAgents: { type: 'boolean' },
        openClaw: { type: 'boolean' },
        aiTerminal: { type: 'boolean' },
        localEnv: { type: 'boolean' },
        aiCoding: { type: 'boolean' }
      }
    },
    appShortcutEnabled: {
      type: 'boolean',
      default: true
    },
    appShortcutModifier: {
      type: 'string',
      default: 'Control+Shift'
    },
    appOrder: {
      type: 'array',
      default: [],
      items: { type: 'string' }
    },
    lastChatModelConfigId: {
      type: 'string',
      default: ''
    },
    lastChatModelId: {
      type: 'string',
      default: ''
    },
    lastBuiltinChatModelId: {
      type: 'string',
      default: ''
    },
    lastChatModelSource: {
      type: 'string',
      default: ''
    },
    chatMode: {
      type: 'string',
      default: 'fast'
    },
    chatToolsEnabled: {
      type: 'boolean',
      default: true
    },
    chatWebSearchEnabled: {
      type: 'boolean',
      default: false
    },
    chatFeishuKitsEnabled: {
      type: 'boolean',
      default: false
    },
    aiToolsConfig: {
      type: 'object',
      default: {
        webSearch: { provider: 'duckduckgo', braveApiKey: '' },
        webBrowse: { engine: 'http', lightpandaPath: '' },
        feishuKits: { enabled: false, cliPath: '' },
        // maxToolSteps / maxSearchRounds are legacy dead fields (agent loop ignores them).
        toolBehavior: { maxToolSteps: 0, maxSearchRounds: 0, toolTimeoutMs: 60000 }
      },
      properties: {
        webSearch: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            braveApiKey: { type: 'string' }
          }
        },
        webBrowse: {
          type: 'object',
          properties: {
            engine: { type: 'string' },
            lightpandaPath: { type: 'string' }
          }
        },
        feishuKits: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            cliPath: { type: 'string' }
          }
        },
        toolBehavior: {
          type: 'object',
          properties: {
            maxToolSteps: { type: 'number' },
            maxSearchRounds: { type: 'number' },
            toolTimeoutMs: { type: 'number' }
          }
        }
      }
    },
    customSystemPrompt: {
      type: 'string',
      default: ''
    },
    defaultToolApprovalMode: {
      type: 'string',
      default: 'auto-approve-safe'
    },
    maxAgentToolSteps: {
      // 0 = unlimited tool steps per turn (default). Positive = soft safety cap only.
      type: 'number',
      default: 0
    },
    assistantEnabled: {
      type: 'boolean',
      default: true
    },
    setupRole: {
      type: 'string',
      default: ''
    },
    codingToolsEnabled: {
      type: 'object',
      default: {},
      additionalProperties: { type: 'boolean' }
    }
  }
})

/** Coding tools enabled by default when the user has not set an explicit preference */
export const DEFAULT_ENABLED_CODING_TOOL_IDS = new Set(['claude-code', 'codex-cli'])

/** Raw stored map (only explicit user overrides). Missing keys use defaults. */
export function getCodingToolsEnabled(): Record<string, boolean> {
  return settingsStore.get('codingToolsEnabled') ?? {}
}

/** Resolve enablement for a Local Env coding toolId */
export function isCodingToolEnabled(toolId: string): boolean {
  const map = getCodingToolsEnabled()
  if (Object.prototype.hasOwnProperty.call(map, toolId)) {
    return map[toolId] === true
  }
  return DEFAULT_ENABLED_CODING_TOOL_IDS.has(toolId)
}

export function setCodingToolEnabled(toolId: string, enabled: boolean): Record<string, boolean> {
  const map = { ...getCodingToolsEnabled(), [toolId]: enabled }
  settingsStore.set('codingToolsEnabled', map)
  return map
}

export function setCodingToolsEnabled(map: Record<string, boolean>): void {
  settingsStore.set('codingToolsEnabled', map)
}

export function getSettings(): PublicSettings {
  // 获取或初始化 userAppDir
  let userAppDir = settingsStore.get('userAppDir')
  
  // 如果为空或不存在，设置为默认值
  if (!userAppDir) {
    userAppDir = getUserAppsPath()
    settingsStore.set('userAppDir', userAppDir)
  }
  
  return {
    pythonPath: settingsStore.get('pythonPath'),
    language: settingsStore.get('language'),
    theme: settingsStore.get('theme'),
    userAppDir: userAppDir,
    autoUpdate: settingsStore.get('autoUpdate'),
    localIdePath: settingsStore.get('localIdePath'),
    localTerminalPath: settingsStore.get('localTerminalPath'),
    hasCompletedSetup: settingsStore.get('hasCompletedSetup') ?? false,
    aiModelConfigs: settingsStore.get('aiModelConfigs'),
    imageGenConfigs: settingsStore.get('imageGenConfigs'),
    moduleVisibility: settingsStore.get('moduleVisibility') ?? { aiChat: true, copiper: false, aiAgents: true, openClaw: false, aiTerminal: true, localEnv: true, aiCoding: true },
    appShortcutEnabled: settingsStore.get('appShortcutEnabled') ?? true,
    appShortcutModifier: settingsStore.get('appShortcutModifier') ?? 'Control+Shift',
    appOrder: settingsStore.get('appOrder') ?? []
  }
}

export function getAiModelConfigs(): AIModelConfig[] {
  // Normalize legacy provider value: 'claude' was renamed to 'anthropic'
  return settingsStore.get('aiModelConfigs').map((c) =>
    (c.provider as string) === 'claude' ? { ...c, provider: 'anthropic' as const } : c
  )
}

export function setAiModelConfigs(configs: AIModelConfig[]): void {
  settingsStore.set('aiModelConfigs', configs)
}

export function getLastChatModel(): { configId: string; modelId: string } {
  return {
    configId: settingsStore.get('lastChatModelConfigId') || '',
    modelId: settingsStore.get('lastChatModelId') || ''
  }
}

export function setLastChatModel(configId: string, modelId: string): void {
  settingsStore.set('lastChatModelConfigId', configId)
  settingsStore.set('lastChatModelId', modelId)
  settingsStore.set('lastChatModelSource', 'local')
}

export function getLastBuiltinChatModel(): string {
  return settingsStore.get('lastBuiltinChatModelId') || ''
}

export function setLastBuiltinChatModel(modelId: string): void {
  settingsStore.set('lastBuiltinChatModelId', modelId)
  settingsStore.set('lastChatModelSource', 'builtin')
}

export function getLastChatModelSource(): string {
  return settingsStore.get('lastChatModelSource') || ''
}

export function getChatPreferences(): { chatMode: string; toolsEnabled: boolean; webSearchEnabled: boolean; feishuKitsEnabled: boolean } {
  return {
    chatMode: settingsStore.get('chatMode') || 'fast',
    toolsEnabled: settingsStore.get('chatToolsEnabled') ?? true,
    webSearchEnabled: settingsStore.get('chatWebSearchEnabled') ?? false,
    feishuKitsEnabled: settingsStore.get('chatFeishuKitsEnabled') ?? false
  }
}

export function setChatPreferences(prefs: { chatMode?: string; toolsEnabled?: boolean; webSearchEnabled?: boolean; feishuKitsEnabled?: boolean }): void {
  if (prefs.chatMode !== undefined) settingsStore.set('chatMode', prefs.chatMode)
  if (prefs.toolsEnabled !== undefined) settingsStore.set('chatToolsEnabled', prefs.toolsEnabled)
  if (prefs.webSearchEnabled !== undefined) settingsStore.set('chatWebSearchEnabled', prefs.webSearchEnabled)
  if (prefs.feishuKitsEnabled !== undefined) settingsStore.set('chatFeishuKitsEnabled', prefs.feishuKitsEnabled)
}

export function getAiToolsConfig() {
  const config = settingsStore.get('aiToolsConfig')
  // Mask API key for security
  const masked = { ...config, webSearch: { ...config.webSearch } }
  if (masked.webSearch.braveApiKey) {
    const key = masked.webSearch.braveApiKey
    masked.webSearch.braveApiKey = key.length > 4 ? '****' + key.slice(-4) : '****'
  }
  return masked
}

export function getAiToolsConfigRaw() {
  return settingsStore.get('aiToolsConfig')
}

export function setAiToolsConfig(config: SettingsSchema['aiToolsConfig']): void {
  settingsStore.set('aiToolsConfig', config)
}

export function getImageGenConfigs(): ImageGenConfig[] {
  return settingsStore.get('imageGenConfigs')
}

export function setImageGenConfigs(configs: ImageGenConfig[]): void {
  settingsStore.set('imageGenConfigs', configs)
}

export function getSetting<K extends keyof SettingsSchema>(key: K): SettingsSchema[K] {
  return settingsStore.get(key)
}

export function setSetting<K extends keyof SettingsSchema>(
  key: K,
  value: SettingsSchema[K]
): void {
  settingsStore.set(key, value)
}

export function resetSettings(): void {
  settingsStore.clear()
}

export interface AgentSettings {
  customSystemPrompt: string
  defaultToolApprovalMode: string
  maxAgentToolSteps: number
  assistantEnabled: boolean
  setupRole: string
}

export function getAgentSettings(): AgentSettings {
  return {
    customSystemPrompt: settingsStore.get('customSystemPrompt') || '',
    defaultToolApprovalMode: settingsStore.get('defaultToolApprovalMode') || 'auto-approve-safe',
    maxAgentToolSteps: settingsStore.get('maxAgentToolSteps') ?? 0,
    // Default true when missing (older stores)
    assistantEnabled: settingsStore.get('assistantEnabled') !== false,
    setupRole: settingsStore.get('setupRole') || ''
  }
}

export function setAgentSettings(settings: Partial<AgentSettings>): void {
  if (settings.customSystemPrompt !== undefined) settingsStore.set('customSystemPrompt', settings.customSystemPrompt)
  if (settings.defaultToolApprovalMode !== undefined) settingsStore.set('defaultToolApprovalMode', settings.defaultToolApprovalMode)
  if (settings.maxAgentToolSteps !== undefined) settingsStore.set('maxAgentToolSteps', settings.maxAgentToolSteps)
  if (settings.assistantEnabled !== undefined) settingsStore.set('assistantEnabled', settings.assistantEnabled)
  if (settings.setupRole !== undefined) settingsStore.set('setupRole', settings.setupRole)
}
