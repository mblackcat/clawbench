import { shell, WebContents } from 'electron'
import {
  clearAuth,
  saveUser,
  getUser,
  saveJwtToken,
  getJwtToken,
  saveFeishuTokens,
  getFeishuAccessToken,
  getFeishuRefreshToken,
  getFeishuTokenExpiresAt,
  isFeishuUser,
  User
} from '../store/auth.store'
import * as logger from '../utils/logger'

// Backend API base URL（通过 electron-vite envPrefix 注入）
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'

interface AuthStatus {
  loggedIn: boolean
  user: User | null
  token?: string
}

// 用于 startLogin 的 Promise resolve/reject 回调
let loginResolve: ((value: AuthStatus) => void) | null = null
let loginReject: ((reason: Error) => void) | null = null
let loginTimeout: ReturnType<typeof setTimeout> | null = null

/**
 * Starts the OAuth login flow.
 * Opens browser to backend's Feishu OAuth endpoint.
 * Returns a Promise that resolves when the custom protocol callback is received.
 */
export function startLogin(webContents: WebContents): Promise<AuthStatus> {
  return new Promise((resolve, reject) => {
    // 清理之前未完成的登录
    if (loginResolve) {
      loginReject?.(new Error('Login cancelled: new login started'))
    }

    loginResolve = resolve
    loginReject = reject

    // 打开浏览器到后端飞书 OAuth 入口
    const authUrl = `${API_BASE_URL}/auth/feishu`
    logger.info(`Opening Feishu OAuth URL: ${authUrl}`)

    shell.openExternal(authUrl).catch((err) => {
      logger.error('Failed to open auth URL:', err)
      loginResolve = null
      loginReject = null
      reject(err)
    })

    // 5 分钟超时
    loginTimeout = setTimeout(() => {
      if (loginResolve) {
        loginReject?.(new Error('Login timed out'))
        loginResolve = null
        loginReject = null
      }
    }, 5 * 60 * 1000)
  })
}

/**
 * Handles the custom protocol callback from the browser.
 * Called when Electron receives clawbench://auth/callback?token=xxx
 */
export async function handleProtocolCallback(url: string, webContents?: WebContents): Promise<void> {
  try {
    const urlObj = new URL(url)
    const token = urlObj.searchParams.get('token')

    if (!token) {
      logger.error('Protocol callback: no token in URL')
      loginReject?.(new Error('No token received'))
      loginResolve = null
      loginReject = null
      return
    }

    logger.info('Protocol callback: received JWT token')

    // 保存 JWT token
    saveJwtToken(token)

    // 保存飞书 User Access Token（用于直接调用飞书 API）
    const uat = urlObj.searchParams.get('uat')
    const urt = urlObj.searchParams.get('urt')
    const uexp = urlObj.searchParams.get('uexp')
    if (uat) {
      saveFeishuTokens(uat, urt || '', parseInt(uexp || '7200', 10))
      logger.info('Protocol callback: saved Feishu UAT')
    }

    // 用 token 获取用户信息
    const user = await fetchUserInfo(token)

    if (user) {
      saveUser(user)
    }

    const status = getAuthStatus()

    // 通知 renderer
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('auth:status-changed', status)
    }

    // Resolve startLogin promise
    if (loginResolve) {
      if (loginTimeout) {
        clearTimeout(loginTimeout)
        loginTimeout = null
      }
      loginResolve(status)
      loginResolve = null
      loginReject = null
    }
  } catch (err) {
    logger.error('Protocol callback error:', err)
    if (loginReject) {
      loginReject(err as Error)
      loginResolve = null
      loginReject = null
    }
  }
}

/**
 * 使用 JWT token 从后端获取用户信息
 */
async function fetchUserInfo(token: string): Promise<User | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/users/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      logger.error(`Failed to fetch user info: ${response.status}`)
      return null
    }

    const data = await response.json()
    const userData = data.data

    return {
      id: userData.userId || '',
      name: userData.username || '',
      avatarUrl: userData.avatarUrl || '',
      email: userData.email || '',
      feishuId: userData.feishuOpenId || ''
    }
  } catch (err) {
    logger.error('Failed to fetch user info:', err)
    return null
  }
}

/**
 * Logs out the user by clearing stored auth data.
 */
export function logout(webContents?: WebContents): void {
  clearAuth()
  logger.info('User logged out')
  if (webContents && !webContents.isDestroyed()) {
    webContents.send('auth:status-changed', getAuthStatus())
  }
}

/**
 * Returns the current authentication status.
 */
export function getAuthStatus(): AuthStatus {
  const user = getUser()
  const token = getJwtToken()
  const loggedIn = !!token && !!user

  return { loggedIn, user: loggedIn ? user : null, token: loggedIn ? token : undefined }
}

/**
 * Get a valid Feishu User Access Token.
 * Auto-refreshes if expired. Returns empty string if not a Feishu user or refresh fails.
 */
export async function getValidFeishuAccessToken(): Promise<string> {
  if (!isFeishuUser()) return ''

  const token = getFeishuAccessToken()
  if (!token) return ''

  const expiresAt = getFeishuTokenExpiresAt()
  // Refresh if expires within 5 minutes
  if (expiresAt > 0 && Date.now() < expiresAt - 5 * 60 * 1000) {
    return token
  }

  // Try to refresh
  const refreshToken = getFeishuRefreshToken()
  if (!refreshToken) return token // return possibly expired token, let feishu-cli handle the error

  try {
    logger.info('Refreshing Feishu UAT...')
    const response = await fetch(`${API_BASE_URL}/auth/feishu/refresh-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })

    if (!response.ok) {
      logger.error(`Feishu token refresh failed: ${response.status}`)
      return token
    }

    const data = await response.json()
    if (data.success && data.data) {
      saveFeishuTokens(data.data.accessToken, data.data.refreshToken, data.data.expiresIn)
      logger.info('Feishu UAT refreshed successfully')
      return data.data.accessToken
    }
  } catch (err) {
    logger.error('Feishu token refresh error:', err)
  }

  return token
}
