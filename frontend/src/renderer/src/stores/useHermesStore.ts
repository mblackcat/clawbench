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
