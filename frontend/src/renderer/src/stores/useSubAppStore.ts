import { create } from 'zustand'
import type { SubAppManifest } from '../types/subapp'

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
  fetchApps: () => Promise<void>
  getFilteredApps: (vcsType: string) => SubAppManifest[]
}

export const useSubAppStore = create<SubAppState>((set, get) => ({
  apps: [],
  appInfos: [],
  loading: false,

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
