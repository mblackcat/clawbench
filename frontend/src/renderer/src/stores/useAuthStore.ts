import { create } from 'zustand'
import type { User } from '../types/auth'
import apiClient from '../services/apiClient'
import { localStorageManager } from '../services/localStorageManager'

interface AuthState {
  loggedIn: boolean
  isLocalMode: boolean
  user: User | null
  loading: boolean
  initialized: boolean
  error: string | null
  authMethod: 'feishu' | 'password' | 'local' | null

  checkAuth: () => Promise<void>
  loginWithFeishu: () => Promise<void>
  loginWithPassword: (username: string, password: string) => Promise<void>
  registerAndLogin: (username: string, password: string) => Promise<void>
  loginWithLocalMode: () => void
  logout: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  loggedIn: false,
  isLocalMode: false,
  user: null,
  loading: false,
  initialized: false,
  error: null,
  authMethod: null,

  checkAuth: async () => {
    set({ loading: true, error: null })
    try {
      // 0. 检查本地模式（持久化在 localStorage）
      if (localStorage.getItem('clawbench_local_mode') === 'true') {
        set({
          loggedIn: true,
          isLocalMode: true,
          authMethod: 'local',
          user: { id: 'local', name: '本地用户', avatarUrl: '' },
        })
        return
      }

      // 1. 检查飞书 auth（通过 IPC 获取 main process 存储的状态）
      const status = await window.api.auth.getStatus()
      if (status.loggedIn && status.user && status.token) {
        // 飞书登录：将 JWT 设置到 apiClient
        apiClient.setToken(status.token)
        set({
          loggedIn: true,
          user: status.user,
          authMethod: 'feishu',
        })
        return
      }

      // 2. 检查密码 auth（JWT token 在 localStorage 中）
      if (apiClient.isLoggedIn()) {
        try {
          const apiUser = await apiClient.getCurrentUser()
          set({
            loggedIn: true,
            user: {
              id: apiUser.userId,
              name: apiUser.username,
              username: apiUser.username,
              avatarUrl: (apiUser as any).avatarUrl || '',
              email: apiUser.email,
            },
            authMethod: 'password',
          })
          return
        } catch {
          // Token invalid, clear it
          apiClient.clearToken()
        }
      }

      set({ loggedIn: false, user: null, authMethod: null })
    } finally {
      set({ loading: false, initialized: true })
    }
  },

  loginWithFeishu: async () => {
    set({ loading: true, error: null })
    try {
      // startLogin 会打开浏览器，等待 custom protocol 回调后 resolve
      const status = await window.api.auth.startLogin()

      if (status.loggedIn && status.token) {
        // 将 JWT 设置到 renderer 的 apiClient
        apiClient.setToken(status.token)
      }

      set({
        loggedIn: status.loggedIn,
        user: status.user ?? null,
        authMethod: 'feishu',
      })

      if (status.loggedIn) {
        localStorageManager.saveLoginMethod('feishu')
      }
    } catch (e: any) {
      set({ error: e.message || '飞书登录失败' })
    } finally {
      set({ loading: false })
    }
  },

  loginWithPassword: async (username: string, password: string) => {
    set({ loading: true, error: null })
    try {
      await apiClient.login({ username, password })
      const apiUser = await apiClient.getCurrentUser()
      set({
        loggedIn: true,
        user: {
          id: apiUser.userId,
          name: apiUser.username,
          username: apiUser.username,
          avatarUrl: (apiUser as any).avatarUrl || '',
          email: apiUser.email,
        },
        authMethod: 'password',
      })
      localStorageManager.saveLoginMethod('password')
      localStorageManager.saveCredentials(username, password)
    } catch (e: any) {
      set({ error: e.message || '登录失败' })
      throw e
    } finally {
      set({ loading: false })
    }
  },

  registerAndLogin: async (username: string, password: string) => {
    set({ loading: true, error: null })
    try {
      await apiClient.register({ username, password })
      await apiClient.login({ username, password })
      const apiUser = await apiClient.getCurrentUser()
      set({
        loggedIn: true,
        user: {
          id: apiUser.userId,
          name: apiUser.username,
          username: apiUser.username,
          avatarUrl: (apiUser as any).avatarUrl || '',
          email: apiUser.email,
        },
        authMethod: 'password',
      })
      localStorageManager.saveLoginMethod('password')
      localStorageManager.saveCredentials(username, password)
    } catch (e: any) {
      set({ error: e.message || '注册失败' })
      throw e
    } finally {
      set({ loading: false })
    }
  },

  loginWithLocalMode: () => {
    localStorage.setItem('clawbench_local_mode', 'true')
    set({
      loggedIn: true,
      isLocalMode: true,
      authMethod: 'local',
      user: { id: 'local', name: '本地用户', avatarUrl: '' },
    })
  },

  logout: async () => {
    set({ loading: true, error: null })
    try {
      const { authMethod } = useAuthStore.getState()
      // 本地模式退出
      if (authMethod === 'local') {
        localStorage.removeItem('clawbench_local_mode')
        set({ loggedIn: false, isLocalMode: false, user: null, authMethod: null })
        return
      }
      // 对于飞书登录：清除 main process 状态
      if (authMethod === 'feishu') {
        await window.api.auth.logout()
      }
      // 对于所有登录方式：清除 apiClient token
      try { await apiClient.logout() } catch { /* ignore */ }
      set({ loggedIn: false, isLocalMode: false, user: null, authMethod: null })
    } finally {
      set({ loading: false })
    }
  },

  clearError: () => set({ error: null }),
}))
