import { create } from 'zustand'
import type { SubAppManifest } from '../types/subapp'
import { applicationManager, type UpdateInfo } from '../services/applicationManager'
import { useAuthStore } from './useAuthStore'

interface SubAppInfo {
  id: string
  manifest: SubAppManifest
  path: string
  source: 'user'
}

interface SubAppState {
  apps: SubAppManifest[]
  appInfos: SubAppInfo[]  // 保留完整的 SubAppInfo
  loading: boolean
  /** 已安装应用的更新信息，key 为本地 manifest.id */
  updateMap: Record<string, UpdateInfo>
  checkingUpdates: boolean
  fetchApps: () => Promise<void>
  /** 联网时检查已安装应用是否有新版本（基于磁盘扫描的 manifest） */
  checkForUpdates: () => Promise<void>
  /** 清空更新标记（卸载/刷新时调用） */
  clearUpdates: () => void
  getFilteredApps: (vcsType: string) => SubAppManifest[]
}

export const useSubAppStore = create<SubAppState>((set, get) => ({
  apps: [],
  appInfos: [],
  loading: false,
  updateMap: {},
  checkingUpdates: false,

  fetchApps: async () => {
    set({ loading: true })
    try {
      const result = await window.api.subapp.list()
      // 保存完整的 SubAppInfo
      set({ appInfos: result as SubAppInfo[] })
      // 提取 manifest 用于向后兼容
      const apps = result.map((item: SubAppManifest | SubAppInfo) =>
        'manifest' in item ? item.manifest : item
      )
      set({ apps })
    } finally {
      set({ loading: false })
    }
  },

  checkForUpdates: async () => {
    // 仅联网模式检查
    if (useAuthStore.getState().isLocalMode) return
    const { appInfos } = get()
    if (appInfos.length === 0) {
      set({ updateMap: {} })
      return
    }
    set({ checkingUpdates: true })
    try {
      const map = await applicationManager.checkInstalledAppUpdates(appInfos)
      const updateMap: Record<string, UpdateInfo> = {}
      map.forEach((info, id) => {
        updateMap[id] = info
      })
      set({ updateMap })
    } catch (e) {
      // 非关键路径，静默失败
      console.error('Failed to check installed app updates:', e)
    } finally {
      set({ checkingUpdates: false })
    }
  },

  clearUpdates: () => set({ updateMap: {} }),

  getFilteredApps: (vcsType: string) => {
    const { apps } = get()
    return apps.filter((app) => {
      if (!app.supported_workspace_types || app.supported_workspace_types.length === 0) {
        return true
      }
      return app.supported_workspace_types.includes(vcsType)
    })
  }
}))
