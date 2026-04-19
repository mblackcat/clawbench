// frontend/src/renderer/src/stores/useHermesStore.ts
import { create } from 'zustand'
import type { HermesConfig } from '../types/hermes'

interface HermesState {
  installCheck: { installed: boolean; version?: string } | null
  serviceStatus: 'running' | 'stopped' | 'unknown'
  config: HermesConfig | null
  configLoading: boolean
  dirty: boolean
  installing: boolean
  installLog: string[]
  uninstalling: boolean
  saving: boolean
  cronJobs: string[]

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
  fetchCronJobs: () => Promise<void>
}

export const useHermesStore = create<HermesState>((set, get) => ({
  installCheck: null,
  serviceStatus: 'unknown',
  config: null,
  configLoading: false,
  dirty: false,
  installing: false,
  installLog: [],
  uninstalling: false,
  saving: false,
  cronJobs: [],

  checkInstalled: async () => {
    try {
      const result = await window.api.hermes.checkInstalled()
      set({ installCheck: result })
    } catch {
      set({ installCheck: { installed: false } })
    }
  },

  installHermes: async () => {
    set({ installing: true, installLog: [] })
    const unsubscribe = window.api.hermes.onInstallProgress((line: string) => {
      set((s) => ({ installLog: [...s.installLog, line] }))
    })
    try {
      const result = await window.api.hermes.install()
      unsubscribe()
      if (result.success) {
        const check = await window.api.hermes.checkInstalled()
        set({ installCheck: check, installing: false })
        return { success: true }
      }
      set({ installing: false })
      return { success: false, error: result.error }
    } catch (err: any) {
      unsubscribe()
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
    set({
      config: {
        ...current,
        ...patch,
        model: patch.model ? { ...current.model, ...patch.model } : current.model,
        channels: patch.channels ? { ...current.channels, ...patch.channels } : current.channels,
        agent: patch.agent ? { ...current.agent, ...patch.agent } : current.agent,
      },
      dirty: true,
    })
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
  },

  fetchCronJobs: async () => {
    try {
      const jobs = await window.api.hermes.getCronJobs()
      set({ cronJobs: jobs })
    } catch {
      set({ cronJobs: [] })
    }
  }
}))
