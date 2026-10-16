import { create } from 'zustand'
import type { NavGroup, NavLink } from '../types/api'
import { apiClient } from '../services/apiClient'
import { useSettingsStore } from './useSettingsStore'
import { useAuthStore } from './useAuthStore'

/**
 * 项目导航栏（工作台首页收藏夹）状态。
 *
 * 配置来自服务端当前 activeProject；本地模式或未选项目时保持空列表，
 * 拉取失败也不打扰用户（导航栏是装饰性入口，静默降级为不展示）。
 */
interface ProjectNavState {
  groups: NavGroup[]
  links: NavLink[]
  loading: boolean
  /** 已尝试过拉取（用于区分"空配置"与"还没拉过"） */
  loaded: boolean
  fetchNav: () => Promise<void>
  /** 打开链接并上报点击（失败不阻塞打开） */
  recordClick: (linkId: string) => void
  clear: () => void
}

export const useProjectNavStore = create<ProjectNavState>((set, get) => ({
  groups: [],
  links: [],
  loading: false,
  loaded: false,

  fetchNav: async () => {
    const { isLocalMode } = useAuthStore.getState()
    const activeProject = useSettingsStore.getState().activeProject
    if (isLocalMode || !activeProject?.projectId) {
      set({ groups: [], links: [], loading: false, loaded: true })
      return
    }

    set({ loading: true })
    try {
      const { groups, links } = await apiClient.getProjectNav(activeProject.projectId)
      set({
        groups: [...groups].sort((a, b) => a.sortOrder - b.sortOrder),
        links: [...links].sort((a, b) => a.sortOrder - b.sortOrder),
        loaded: true
      })
    } catch {
      // 离线 / 无权限：不展示导航栏，不弹错
      set({ groups: [], links: [], loaded: true })
    } finally {
      set({ loading: false })
    }
  },

  recordClick: (linkId: string) => {
    const activeProject = useSettingsStore.getState().activeProject
    if (!activeProject?.projectId) return

    // 乐观更新本地计数，后台上报
    set({
      links: get().links.map((l) =>
        l.linkId === linkId ? { ...l, clickCount: l.clickCount + 1 } : l
      )
    })
    apiClient.recordNavLinkClick(activeProject.projectId, linkId).catch(() => {
      // 上报失败不影响打开链接
    })
  },

  clear: () => set({ groups: [], links: [], loading: false, loaded: false })
}))
