import Store from 'electron-store'
import { getUserAppsPath } from '../utils/paths'

export interface ModuleVisibility {
  aiChat: boolean
  copiper: boolean
  openClaw: boolean
  aiTerminal: boolean
  localEnv: boolean
  aiWorkbench: boolean
}

export interface AIModelConfig {
  id: string
  name: string
  provider: 'openai' | 'openai-compatible' | 'azure-openai' | 'google' | 'claude' | 'anthropic-compatible' | 'qwen' | 'doubao' | 'deepseek' | 'kimi'
  endpoint: string
  apiKey: string
  models: string[]
  enabled: boolean
  apiVersion?: string
  capabilities?: ('image-gen' | 'tool-use')[]
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
  maxAgentToolSteps: number
}

interface PublicSettings {
  pythonPath: string
  language: string
  theme: string
  userAppDir: string
  autoUpdate: boolean
  localIdePath: string
  localTerminalPath: string
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
    pythonPath: {
      type: 'string',
      default: 'python3'
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
      default: { aiChat: true, copiper: false, openClaw: false, aiTerminal: true, localEnv: true, aiWorkbench: true },
      properties: {
        aiChat: { type: 'boolean' },
        copiper: { type: 'boolean' },
        openClaw: { type: 'boolean' },
        aiTerminal: { type: 'boolean' },
        localEnv: { type: 'boolean' },
        aiWorkbench: { type: 'boolean' }
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
        toolBehavior: { maxToolSteps: 10, maxSearchRounds: 5, toolTimeoutMs: 60000 }
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
      type: 'number',
      default: 15
    }
  }
})

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
    aiModelConfigs: settingsStore.get('aiModelConfigs'),
    imageGenConfigs: settingsStore.get('imageGenConfigs'),
    moduleVisibility: settingsStore.get('moduleVisibility') ?? { aiChat: true, copiper: false, openClaw: false, aiTerminal: true, localEnv: false, aiWorkbench: true },
    appShortcutEnabled: settingsStore.get('appShortcutEnabled') ?? true,
    appShortcutModifier: settingsStore.get('appShortcutModifier') ?? 'Control+Shift',
    appOrder: settingsStore.get('appOrder') ?? []
  }
}

export function getAiModelConfigs(): AIModelConfig[] {
  return settingsStore.get('aiModelConfigs')
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

export function getAgentSettings(): { customSystemPrompt: string; defaultToolApprovalMode: string; maxAgentToolSteps: number } {
  return {
    customSystemPrompt: settingsStore.get('customSystemPrompt') || '',
    defaultToolApprovalMode: settingsStore.get('defaultToolApprovalMode') || 'auto-approve-safe',
    maxAgentToolSteps: settingsStore.get('maxAgentToolSteps') ?? 15
  }
}

export function setAgentSettings(settings: { customSystemPrompt?: string; defaultToolApprovalMode?: string; maxAgentToolSteps?: number }): void {
  if (settings.customSystemPrompt !== undefined) settingsStore.set('customSystemPrompt', settings.customSystemPrompt)
  if (settings.defaultToolApprovalMode !== undefined) settingsStore.set('defaultToolApprovalMode', settings.defaultToolApprovalMode)
  if (settings.maxAgentToolSteps !== undefined) settingsStore.set('maxAgentToolSteps', settings.maxAgentToolSteps)
}
