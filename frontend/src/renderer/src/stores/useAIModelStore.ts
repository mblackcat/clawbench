import { create } from 'zustand'
import apiClient from '../services/apiClient'
import type { AIModel, AIModelConfig } from '../types/chat'
import { useAuthStore } from './useAuthStore'

interface AIModelState {
  builtinModels: AIModel[]
  localModels: AIModelConfig[]
  selectedModelId: string | null
  selectedModelSource: 'builtin' | 'local'
  selectedModelConfigId: string | null  // for local models, the config id

  fetchBuiltinModels: () => Promise<void>
  fetchLocalModels: () => Promise<void>
  selectModel: (id: string, source: 'builtin' | 'local', configId?: string) => void
  initializeSelectedModel: () => Promise<void>
}

export const useAIModelStore = create<AIModelState>((set) => ({
  builtinModels: [],
  localModels: [],
  selectedModelId: null,
  selectedModelSource: 'builtin',
  selectedModelConfigId: null,

  fetchBuiltinModels: async () => {
    // 本地模式下不加载远端内置模型
    if (useAuthStore.getState().isLocalMode) return
    try {
      const models = await apiClient.getBuiltinModels()
      set({ builtinModels: models })
    } catch (err) {
      console.error('Failed to fetch builtin models:', err)
    }
  },

  fetchLocalModels: async () => {
    try {
      const configs = await window.api.settings.getAiModels()
      set({ localModels: configs.filter((c: AIModelConfig) => c.enabled) })
    } catch (err) {
      console.error('Failed to fetch local models:', err)
    }
  },

  selectModel: (id: string, source: 'builtin' | 'local', configId?: string) => {
    set({ selectedModelId: id, selectedModelSource: source, selectedModelConfigId: configId || null })
    if (source === 'local' && configId) {
      window.api.settings.setLastChatModel(configId, id).catch(() => {})
    } else if (source === 'builtin') {
      window.api.settings.setLastBuiltinChatModel(id).catch(() => {})
    }
  },

  initializeSelectedModel: async () => {
    const { selectedModelId, builtinModels, localModels } = useAIModelStore.getState()
    // Already has a selection — skip
    if (selectedModelId) return

    const isLocal = useAuthStore.getState().isLocalMode

    // Read the last-used model source to restore the correct one first
    let lastSource = ''
    try {
      lastSource = await window.api.settings.getLastChatModelSource()
    } catch { /* ignore */ }

    // Try to restore last local model
    const tryRestoreLocal = async (): Promise<boolean> => {
      try {
        const last = await window.api.settings.getLastChatModel()
        if (last.configId && last.modelId) {
          const config = localModels.find((c) => c.id === last.configId)
          if (config && config.models.includes(last.modelId)) {
            useAIModelStore.getState().selectModel(last.modelId, 'local', last.configId)
            return true
          }
        }
      } catch { /* ignore */ }
      return false
    }

    // Try to restore last builtin model
    const tryRestoreBuiltin = async (): Promise<boolean> => {
      if (isLocal) return false
      try {
        const lastBuiltinId = await window.api.settings.getLastBuiltinChatModel()
        if (lastBuiltinId && builtinModels.find((m) => m.id === lastBuiltinId)) {
          useAIModelStore.getState().selectModel(lastBuiltinId, 'builtin')
          return true
        }
      } catch { /* ignore */ }
      return false
    }

    // Restore in the correct order based on last source
    if (lastSource === 'local') {
      if (await tryRestoreLocal()) return
      if (await tryRestoreBuiltin()) return
    } else {
      if (await tryRestoreBuiltin()) return
      if (await tryRestoreLocal()) return
    }

    // Fall back to first available model
    if (!isLocal && builtinModels.length > 0) {
      useAIModelStore.getState().selectModel(builtinModels[0].id, 'builtin')
      return
    }
    for (const config of localModels) {
      if (config.models.length > 0) {
        useAIModelStore.getState().selectModel(config.models[0], 'local', config.id)
        return
      }
    }
    // No valid model found — leave selection empty
  },
}))
