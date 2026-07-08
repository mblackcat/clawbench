import { create } from 'zustand'
import type { User } from '../types/auth'
import apiClient, { ApiClientError } from '../services/apiClient'
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
  /** 登录态失效（运行期 401）时强制登出：清 token + 跳登录页，不调用后端 logout。 */
  expireSession: () => void
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
      // 0. 检查本地模式（持久化在 localStorage）—— 本地模式无需校验 token
      if (localStorage.getItem('clawbench_local_mode') === 'true') {
        set({
          loggedIn: true,
          isLocalMode: true,
          authMethod: 'local',
          user: { id: 'local', name: '本地用户', avatarUrl: '' },
        })
        return
      }

      // 1. 找到候选登录态：飞书（main process）优先，其次密码（localStorage）
      //    注意：main process 的 getAuthStatus() 只判断 token 是否“存在”，
      //    不校验是否过期，因此这里必须再用 token 调一次 /users/me 验证有效性。
      let candidateToken: string | null = null
      let candidateMethod: 'feishu' | 'password' | null = null

      const status = await window.api.auth.getStatus()
      if (status.loggedIn && status.user && status.token) {
        candidateToken = status.token
        candidateMethod = 'feishu'
      } else if (apiClient.isLoggedIn()) {
        candidateToken = apiClient.getToken()
        candidateMethod = 'password'
      }

      // 2. 用候选 token 实际请求后端校验。
      //    - 校验通过：进入应用。
      //    - 401：明确登录态失效 → 清除凭证，由 RequireAuth 跳转登录页。
      //    - 其它错误（网络不可达/5xx）：不清凭证。飞书有缓存 user 时乐观进入，
      //      密码模式无缓存 user 无法构造，则保持未登录态。
      if (candidateToken && candidateMethod) {
        apiClient.setToken(candidateToken)
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
            authMethod: candidateMethod,
          })
          return
        } catch (e) {
          const isAuthError = e instanceof ApiClientError && e.isAuthError()
          if (isAuthError) {
            // token 已失效：清除本地与主进程凭证
            apiClient.clearToken()
            if (candidateMethod === 'feishu') {
              try { await window.api.auth.logout() } catch { /* ignore */ }
            }
          } else if (candidateMethod === 'feishu' && status.user) {
            // 后端暂时不可达：保留飞书凭证，乐观进入（API 调用会按需报错）
            set({ loggedIn: true, user: status.user, authMethod: 'feishu' })
            return
          }
          // 密码模式网络错误 / 无缓存用户：落入未登录态
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

  expireSession: () => {
    // 幂等：未登录或本地模式下直接忽略，避免重复弹窗/跳转
    const { loggedIn, isLocalMode, authMethod } = useAuthStore.getState()
    if (!loggedIn || isLocalMode) return

    // 清除 renderer 侧 token（不调用后端 logout，因为 token 已失效）
    apiClient.clearToken()
    // 飞书登录还需清除主进程存储的凭证，避免下次启动又拿到过期 token
    if (authMethod === 'feishu') {
      try { window.api.auth.logout() } catch { /* ignore */ }
    }
    // 置为未登录 → RequireAuth 会把当前页重定向到 /login
    set({ loggedIn: false, isLocalMode: false, user: null, authMethod: null })
  },
}))
