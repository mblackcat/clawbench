import { create } from 'zustand'
import type { AiToolsConfig } from '../types/ipc'
import {
  DEFAULT_MODULE_VISIBILITY,
  normalizeModuleVisibility,
  type ModuleVisibility
} from '../constants/module-visibility'
import {
  APP_MODE_STORAGE_KEY,
  DEFAULT_APP_MODE,
  parseStoredAppMode,
  type AppMode
} from '../constants/app-mode'

export type { ModuleVisibility } from '../constants/module-visibility'
export type { AppMode } from '../constants/app-mode'

/** Read the persisted app mode; falls back to the default on any error. */
function readStoredAppMode(): AppMode {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_APP_MODE
    return parseStoredAppMode(localStorage.getItem(APP_MODE_STORAGE_KEY))
  } catch {
    return DEFAULT_APP_MODE
  }
}

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
  /** App shell mode: 通用 (general) hides the sider; 研发 (pro) shows it. */
  appMode: AppMode
  loading: boolean
  fetchSettings: () => Promise<void>
  updateSetting: (key: string, value: unknown) => Promise<void>
  fetchAiToolsConfig: () => Promise<void>
  updateAiToolsConfig: (config: AiToolsConfig) => Promise<void>
  completeSetup: () => Promise<void>
  setAppMode: (mode: AppMode) => void
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
  // Initialize from localStorage so the very first render (before
  // fetchSettings resolves) already reflects the persisted mode — otherwise
  // the sider would flash visible/hidden on boot.
  appMode: readStoredAppMode(),
  // Starts true: RootRedirect gates on this before the very first render
  // decides whether to send the user to /setup, so it must reflect
  // "not fetched yet" from the start instead of defaulting to false.
  loading: true,

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
        appOrder: (settings.appOrder as string[]) ?? [],
        // Re-read mode from localStorage in case it changed in another window.
        appMode: readStoredAppMode()
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

  setAppMode: (mode) => {
    try {
      localStorage.setItem(APP_MODE_STORAGE_KEY, mode)
    } catch {
      // ignore persistence errors (private mode / quota)
    }
    set({ appMode: mode })
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
