import { create } from 'zustand'
import type {
  ToolDetectionResult,
  PackageManagerInfo,
  ToolInstallResult,
  LocalEnvDetectionResult
} from '../types/local-env'

// ── localStorage cache helpers ──

const CACHE_KEY = 'clawbench:localEnv'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

interface CacheEntry {
  data: LocalEnvDetectionResult
  timestamp: number
}

function loadCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const entry: CacheEntry = JSON.parse(raw)
    if (Date.now() - entry.timestamp > CACHE_TTL) return null
    return entry
  } catch {
    return null
  }
}

function saveCache(data: LocalEnvDetectionResult): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }))
  } catch { /* ignore quota errors */ }
}

// Hydrate from localStorage on module load
const cached = loadCache()

// ── Store ──

interface LocalEnvState {
  tools: ToolDetectionResult[]
  packageManagers: PackageManagerInfo | null
  platform: string
  detecting: boolean
  refreshingOne: Record<string, boolean>
  installing: Record<string, boolean>
  lastDetectedAt: number | null

  detectAll: (force?: boolean) => Promise<void>
  detectOne: (toolId: string) => Promise<void>
  installTool: (toolId: string) => Promise<ToolInstallResult>
}

export const useLocalEnvStore = create<LocalEnvState>((set, get) => ({
  tools: cached?.data.tools ?? [],
  packageManagers: cached?.data.packageManagers ?? null,
  platform: cached?.data.platform ?? '',
  detecting: false,
  refreshingOne: {},
  installing: {},
  lastDetectedAt: cached?.timestamp ?? null,

  detectAll: async (force = false) => {
    // Use cached data if available and not forcing a refresh
    if (!force && get().lastDetectedAt !== null) return

    set({ detecting: true })
    try {
      const result = await window.api.localEnv.detectAll()
      saveCache(result)
      set({
        tools: result.tools,
        packageManagers: result.packageManagers,
        platform: result.platform,
        detecting: false,
        lastDetectedAt: Date.now()
      })
    } catch (err) {
      console.error('Failed to detect local environment:', err)
      set({ detecting: false })
    }
  },

  detectOne: async (toolId: string) => {
    set((s) => ({ refreshingOne: { ...s.refreshingOne, [toolId]: true } }))
    try {
      const result = await window.api.localEnv.detectOne(toolId)
      set((s) => {
        const tools = s.tools.map((t) => (t.toolId === toolId ? result : t))
        // Keep localStorage in sync
        saveCache({ tools, packageManagers: s.packageManagers!, platform: s.platform })
        return { tools, refreshingOne: { ...s.refreshingOne, [toolId]: false } }
      })
    } catch (err) {
      console.error(`Failed to detect ${toolId}:`, err)
      set((s) => ({ refreshingOne: { ...s.refreshingOne, [toolId]: false } }))
    }
  },

  installTool: async (toolId: string) => {
    set({ installing: { ...get().installing, [toolId]: true } })
    try {
      const result = await window.api.localEnv.install(toolId)
      set({ installing: { ...get().installing, [toolId]: false } })
      if (result.success && !result.openedBrowser) {
        // Re-detect only this tool after successful install
        await get().detectOne(toolId)
      }
      return result
    } catch (err: any) {
      console.error(`Failed to install ${toolId}:`, err)
      set({ installing: { ...get().installing, [toolId]: false } })
      return { success: false, error: err.message }
    }
  }
}))
