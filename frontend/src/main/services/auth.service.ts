import { shell, WebContents, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import * as path from 'path'
import * as fs from 'fs'
import {
  clearAuth,
  saveUser,
  getUser,
  saveJwtToken,
  getJwtToken,
  saveFeishuTokens,
  saveFeishuPlatformAppId,
  getFeishuPlatformAppId,
  getFeishuAccessToken,
  getFeishuRefreshToken,
  getFeishuTokenExpiresAt,
  isFeishuUser,
  User
} from '../store/auth.store'
import * as logger from '../utils/logger'
import { mainT } from '../utils/i18n'
import { redactProtocolUrl } from './protocol/parser'

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
let activeAuthWindow: BrowserWindow | null = null

/**
 * Client nonce of the login currently in progress. Protocol callbacks are
 * only accepted while it is set, and when the backend echoes `state` it
 * must match — so a web page firing `clawbench://auth/callback?token=…`
 * cannot plant an attacker session.
 */
let pendingLoginState: string | null = null
let pendingStateTimer: ReturnType<typeof setTimeout> | null = null
const LOGIN_TTL_MS = 5 * 60 * 1000

function clearPendingLoginState(): void {
  pendingLoginState = null
  if (pendingStateTimer) {
    clearTimeout(pendingStateTimer)
    pendingStateTimer = null
  }
}

/** Starts (or, with `fresh`, restarts) a pending login and returns its nonce. */
function ensurePendingLoginState(fresh = false): string {
  if (pendingLoginState && !fresh) return pendingLoginState
  clearPendingLoginState()
  // 16 random bytes → 22 base64url chars (fits the backend's state column).
  pendingLoginState = randomBytes(16).toString('base64url')
  pendingStateTimer = setTimeout(clearPendingLoginState, LOGIN_TTL_MS)
  return pendingLoginState
}

/** Test helper: whether a login callback would currently be accepted. */
export function hasPendingLogin(): boolean {
  return !!pendingLoginState
}

/** Hosts the embedded login window may navigate to (besides the API origin). */
const AUTH_ALLOWED_HOST_SUFFIXES = ['feishu.cn', 'feishu.net', 'larksuite.com', 'larkoffice.com']

export function isAllowedAuthNavigation(targetUrl: string, apiBase: string = API_BASE_URL): boolean {
  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return false
  }
  try {
    if (target.origin === new URL(apiBase).origin) return true
  } catch {
    // malformed API base
  }
  if (target.protocol !== 'https:') return false
  const host = target.hostname.toLowerCase()
  return AUTH_ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

/** Custom protocol callback prefix (must match PROTOCOL in main/index.ts). */
const AUTH_CALLBACK_PREFIX = 'clawbench://auth/callback'

/**
 * Opens the Feishu OAuth page in an embedded modal window and intercepts the
 * custom-protocol redirect. Used as the last-resort fallback when no system
 * browser can be launched (e.g. broken protocol associations on Windows).
 */
export function openAuthModalWindow(url: string, webContents: WebContents): void {
  if (activeAuthWindow && !activeAuthWindow.isDestroyed()) {
    activeAuthWindow.focus()
    return
  }

  const parentWindow = BrowserWindow.fromWebContents(webContents) || undefined
  const authWin = new BrowserWindow({
    width: 600,
    height: 720,
    title: mainT('auth.modalWindowTitle'),
    parent: parentWindow,
    modal: !!parentWindow,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  activeAuthWindow = authWin
  // Callbacks from this window are only accepted for a pending login.
  ensurePendingLoginState()

  const checkRedirect = (targetUrl: string): boolean => {
    if (targetUrl.startsWith(AUTH_CALLBACK_PREFIX)) {
      handleProtocolCallback(targetUrl, webContents).catch((err) => {
        logger.error('Failed to handle modal protocol callback:', err)
      })
      if (!authWin.isDestroyed()) {
        authWin.close()
      }
      return true
    }
    return false
  }

  const guardNavigation = (event: Electron.Event, targetUrl: string): void => {
    if (checkRedirect(targetUrl)) {
      event.preventDefault()
      return
    }
    if (!isAllowedAuthNavigation(targetUrl)) {
      logger.warn(`Blocked auth window navigation to ${redactProtocolUrl(targetUrl)}`)
      event.preventDefault()
    }
  }
  authWin.webContents.on('will-navigate', guardNavigation)
  authWin.webContents.on('will-redirect', guardNavigation)
  authWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  authWin.on('closed', () => {
    if (activeAuthWindow === authWin) {
      activeAuthWindow = null
    }
  })

  authWin.loadURL(url).catch((err) => {
    logger.error('Failed to load auth URL in modal window:', err)
  })
}

function spawnDetached(command: string, args: string[], windowsHide = false): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(command, args, { windowsHide, detached: true, stdio: 'ignore' })
      let settled = false
      child.on('error', () => {
        if (!settled) {
          settled = true
          resolve(false)
        }
      })
      child.on('spawn', () => {
        if (!settled) {
          settled = true
          child.unref()
          resolve(true)
        }
      })
    } catch {
      resolve(false)
    }
  })
}

/**
 * Opens a URL in the user's default browser with robust fallbacks for Windows.
 * Avoids CO_E_APPNOTFOUND (0x800401F5) failures when protocol associations are broken.
 */
async function openBrowserUrl(url: string): Promise<void> {
  try {
    await shell.openExternal(url)
    return
  } catch (primaryErr: unknown) {
    logger.warn('shell.openExternal failed, attempting fallback browser launch:', primaryErr)
  }

  if (process.platform === 'win32') {
    // 1. cmd.exe /c start "" "<url>"
    if (await spawnDetached('cmd.exe', ['/c', 'start', '', url], true)) return

    // 2. Direct browser executables (Edge ships with Windows 10/11)
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
    const localAppData = process.env['LOCALAPPDATA'] || ''
    const candidates = [
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      localAppData && path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      localAppData && path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ].filter((p): p is string => !!p)

    for (const exe of candidates) {
      if (fs.existsSync(exe) && (await spawnDetached(exe, [url]))) return
    }

    // 3. rundll32 fallback
    if (await spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', url], true)) return

    throw new Error(mainT('auth.openBrowserFailedWin', url))
  }

  if (process.platform === 'darwin') {
    if (await spawnDetached('open', [url])) return
  }

  throw new Error(mainT('auth.openBrowserFailed', url))
}

/**
 * Backend Feishu OAuth entry for the current pending login (one is started
 * when none is pending). `client_state` is echoed back as `state` in the
 * deep-link callback.
 */
export function getFeishuAuthUrl(): string {
  const state = ensurePendingLoginState()
  return `${API_BASE_URL}/auth/feishu?client_state=${encodeURIComponent(state)}`
}

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
    if (loginTimeout) {
      clearTimeout(loginTimeout)
      loginTimeout = null
    }

    loginResolve = resolve
    loginReject = reject

    // Fresh nonce per login; the callback must carry it back.
    ensurePendingLoginState(true)

    // 打开浏览器到后端飞书 OAuth 入口
    const authUrl = getFeishuAuthUrl()
    logger.info(`Opening Feishu OAuth URL: ${redactProtocolUrl(authUrl)}`)

    openBrowserUrl(authUrl).catch((err: unknown) => {
      logger.warn('Failed to open external browser, falling back to embedded modal window:', err)
      try {
        openAuthModalWindow(authUrl, webContents)
      } catch (modalErr) {
        logger.error('Failed to open embedded modal window as fallback:', modalErr)
        if (loginReject === reject) {
          loginResolve = null
          loginReject = null
          clearPendingLoginState()
          if (loginTimeout) {
            clearTimeout(loginTimeout)
            loginTimeout = null
          }
        }
        reject(new Error(mainT('auth.openLoginWindowFailed', authUrl)))
      }
    })

    // 5 分钟超时
    loginTimeout = setTimeout(() => {
      clearPendingLoginState()
      if (loginResolve) {
        loginReject?.(new Error('Login timed out'))
        loginResolve = null
        loginReject = null
      }
    }, LOGIN_TTL_MS)
  })
}

/**
 * Cancels an in-flight Feishu OAuth wait started by startLogin().
 * Safe no-op when no login is pending.
 */
export function cancelLogin(): void {
  if (activeAuthWindow && !activeAuthWindow.isDestroyed()) {
    activeAuthWindow.close()
    activeAuthWindow = null
  }
  if (loginTimeout) {
    clearTimeout(loginTimeout)
    loginTimeout = null
  }
  clearPendingLoginState()
  if (!loginResolve && !loginReject) {
    return
  }
  loginReject?.(new Error('Login cancelled'))
  loginResolve = null
  loginReject = null
  logger.info('Feishu OAuth login cancelled by user')
}

/**
 * Normalizes a protocol callback URL: strips surrounding quotes (Windows passes
 * argv with quotes in some shells) and a trailing '/' appended by some browsers.
 */
export function normalizeCallbackUrl(url: string): string {
  const cleanUrl = url.trim().replace(/^["']+|["']+$/g, '').trim()
  return cleanUrl.includes('?') ? cleanUrl.replace(/\/+$/, '') : cleanUrl
}

/**
 * Handles the custom protocol callback from the browser.
 * Called when Electron receives clawbench://auth/callback?token=xxx
 */
export async function handleProtocolCallback(url: string, webContents?: WebContents): Promise<void> {
  // Only a login started from this app may complete. Rejections here do not
  // touch the pending login, so a hostile URL cannot cancel the real one.
  if (!pendingLoginState) {
    logger.warn('Protocol callback ignored: no login in progress')
    throw new Error(mainT('auth.noPendingLogin'))
  }
  let callbackState: string | null = null
  try {
    callbackState = new URL(normalizeCallbackUrl(url)).searchParams.get('state')
  } catch {
    // parsed again below; malformed URLs fail there
  }
  if (callbackState !== null && callbackState.replace(/\/+$/, '') !== pendingLoginState) {
    logger.warn('Protocol callback ignored: state mismatch')
    throw new Error(mainT('auth.stateMismatch'))
  }
  if (callbackState === null) {
    // Older backends do not echo the client state yet.
    logger.warn('Protocol callback without state (legacy backend); accepted for the pending login')
  }

  try {
    const urlObj = new URL(normalizeCallbackUrl(url))
    const getParam = (name: string): string | null =>
      urlObj.searchParams.get(name)?.replace(/\/+$/, '') || null
    const token = getParam('token')

    if (!token) {
      logger.error('Protocol callback: no token in URL')
      loginReject?.(new Error('No token received'))
      loginResolve = null
      loginReject = null
      return
    }

    logger.info('Protocol callback: received JWT token')
    clearPendingLoginState()

    // 保存 JWT token
    saveJwtToken(token)

    // 保存飞书 User Access Token（用于直接调用飞书 API / lark-cli）
    const uat = getParam('uat')
    const urt = getParam('urt')
    const uexp = getParam('uexp')
    if (uat) {
      const expiresInSec = parseInt(uexp || '7200', 10)
      saveFeishuTokens(uat, urt || '', Number.isFinite(expiresInSec) ? expiresInSec : 7200)
      logger.info('Protocol callback: saved Feishu UAT')
    }
    // Public platform App ID for lark-cli (no secret)
    const appId = getParam('appId')
    if (appId) {
      saveFeishuPlatformAppId(appId)
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
    const userData = data?.data
    if (!userData || typeof userData !== 'object') {
      logger.error('Malformed user info response: missing data field')
      return null
    }

    return {
      id: userData.userId || '',
      name: userData.username || '',
      avatarUrl: userData.avatarUrl || '',
      email: userData.email || '',
      feishuId: userData.feishuOpenId || '',
      role: userData.role === 'admin' ? 'admin' : 'user'
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
 * Ensure platform Feishu App ID is available for lark-cli.
 * Prefer value saved at OAuth login; if missing (e.g. pre-upgrade session),
 * fetch public config from backend. Never stores app secret.
 */
export async function ensureFeishuPlatformAppId(): Promise<string> {
  const existing = getFeishuPlatformAppId()
  if (existing) return existing

  try {
    logger.info('Platform App ID missing locally — fetching public-config')
    const response = await fetch(`${API_BASE_URL}/auth/feishu/public-config`)
    if (!response.ok) {
      logger.error(`Feishu public-config failed: ${response.status}`)
      return ''
    }
    const body = (await response.json()) as { success?: boolean; data?: { appId?: string } }
    const appId = body?.data?.appId
    if (typeof appId === 'string' && appId) {
      saveFeishuPlatformAppId(appId)
      logger.info('Platform App ID saved from public-config')
      return appId
    }
    logger.warn('Feishu public-config returned empty appId')
  } catch (err) {
    logger.error('Failed to fetch Feishu public-config:', err)
  }
  return ''
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
      // 校验飞书刷新响应字段，缺失/类型错误时保留旧 token（与既有失败路径一致）
      const { accessToken, refreshToken, expiresIn } = data.data
      if (typeof accessToken !== 'string' || !accessToken || typeof expiresIn !== 'number') {
        logger.error('Malformed Feishu refresh response: missing accessToken/expiresIn')
        return token
      }
      saveFeishuTokens(accessToken, typeof refreshToken === 'string' ? refreshToken : '', expiresIn)
      logger.info('Feishu UAT refreshed successfully')
      return accessToken
    }
  } catch (err) {
    logger.error('Feishu token refresh error:', err)
  }

  return token
}
