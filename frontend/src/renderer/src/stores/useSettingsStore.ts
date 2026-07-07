import { create } from 'zustand'
import type { AiToolsConfig } from '../types/ipc'
import {
  DEFAULT_MODULE_VISIBILITY,
  normalizeModuleVisibility,
  type ModuleVisibility
} from '../constants/module-visibility'

export type { ModuleVisibility } from '../constants/module-visibility'

interface SettingsState {
  pythonPath: string
  language: string
  theme: string
  userAppDir: string
  autoUpdate: boolean
  localIdePath: string
  localTerminalPath: string
  hasCompletedSetup: boolean
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
  completeSetup: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  pythonPath: '',
  language: 'zh-CN',
  theme: 'light',
  userAppDir: '',
  autoUpdate: true,
  localIdePath: '',
  localTerminalPath: '',
  hasCompletedSetup: false,
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
        hasCompletedSetup: (settings.hasCompletedSetup as boolean) ?? false,
        moduleVisibility: normalizeModuleVisibility(settings.moduleVisibility),
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

  completeSetup: async () => {
    await window.api.settings.set('hasCompletedSetup', true)
    set({ hasCompletedSetup: true })
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
