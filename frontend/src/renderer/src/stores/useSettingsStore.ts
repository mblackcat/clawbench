import { create } from 'zustand'
import type { AiToolsConfig } from '../types/ipc'

export interface ModuleVisibility {
  aiChat: boolean
  aiAgents: boolean
  aiTerminal: boolean
  localEnv: boolean
  aiWorkbench: boolean
}

const DEFAULT_MODULE_VISIBILITY: ModuleVisibility = {
  aiChat: true,
  aiAgents: true,
  aiTerminal: true,
  localEnv: true,
  aiWorkbench: true
}

interface SettingsState {
  pythonPath: string
  language: string
  theme: string
  userAppDir: string
  autoUpdate: boolean
  localIdePath: string
  localTerminalPath: string
  moduleVisibility: ModuleVisibility
  appShortcutEnabled: boolean
  appShortcutModifier: string
  appOrder: string[]
  aiToolsConfig: AiToolsConfig | null
  loading: boolean
  fetchSettings: () => Promise<void>
  updateSetting: (key: string, value: unknown) => Promise<void>
  fetchAiToolsConfig: () => Promise<void>
  updateAiToolsConfig: (config: AiToolsConfig) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  pythonPath: '',
  language: 'zh-CN',
  theme: 'light',
  userAppDir: '',
  autoUpdate: true,
  localIdePath: '',
  localTerminalPath: '',
  moduleVisibility: DEFAULT_MODULE_VISIBILITY,
  appShortcutEnabled: true,
  appShortcutModifier: 'Control+Shift',
  appOrder: [],
  aiToolsConfig: null,
  loading: false,

  fetchSettings: async () => {
    set({ loading: true })
    try {
      const settings = await window.api.settings.get()
      set({
        pythonPath: (settings.pythonPath as string) ?? '',
        language: (settings.language as string) ?? 'zh-CN',
        theme: (settings.theme as string) ?? 'light',
        userAppDir: (settings.userAppDir as string) ?? '',
        autoUpdate: (settings.autoUpdate as boolean) ?? true,
        localIdePath: (settings.localIdePath as string) ?? '',
        localTerminalPath: (settings.localTerminalPath as string) ?? '',
        moduleVisibility: (settings.moduleVisibility as ModuleVisibility) ?? DEFAULT_MODULE_VISIBILITY,
        appShortcutEnabled: (settings.appShortcutEnabled as boolean) ?? true,
        appShortcutModifier: (settings.appShortcutModifier as string) ?? 'Control+Shift',
        appOrder: (settings.appOrder as string[]) ?? []
      })
    } finally {
      set({ loading: false })
    }
  },

  updateSetting: async (key: string, value: unknown) => {
    await window.api.settings.set(key, value)
    set((state) => ({ ...state, [key]: value }))
  },

  fetchAiToolsConfig: async () => {
    try {
      const config = await window.api.settings.getAiToolsConfig()
      set({ aiToolsConfig: config as AiToolsConfig })
    } catch {
      // ignore
    }
  },

  updateAiToolsConfig: async (config: AiToolsConfig) => {
    try {
      await window.api.settings.setAiToolsConfig(config)
      set({ aiToolsConfig: config })
    } catch {
      // ignore
    }
  },
}))
