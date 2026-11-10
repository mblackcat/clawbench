import Store from 'electron-store'
import { encryptSecretValue, decryptSecretValue } from '../utils/secret-storage'

export interface User {
  id: string
  name: string
  avatarUrl: string
  email: string
  feishuId: string
  /** Global role from backend (`users.role`); absent for legacy cached users. */
  role?: 'admin' | 'user'
}

interface AuthSchema {
  user: User | null
  jwtToken: string
  feishuAccessToken: string
  feishuRefreshToken: string
  feishuTokenExpiresAt: number // timestamp in ms
  /** Public platform Feishu App ID (no secret) used for lark-cli account context */
  feishuPlatformAppId: string
}

export const authStore = new Store<AuthSchema>({
  name: 'auth',
  schema: {
    user: {
      type: ['object', 'null'],
      default: null,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        avatarUrl: { type: 'string' },
        email: { type: 'string' },
        feishuId: { type: 'string' }
      }
    },
    jwtToken: {
      type: 'string',
      default: ''
    },
    feishuAccessToken: {
      type: 'string',
      default: ''
    },
    feishuRefreshToken: {
      type: 'string',
      default: ''
    },
    feishuTokenExpiresAt: {
      type: 'number',
      default: 0
    },
    feishuPlatformAppId: {
      type: 'string',
      default: ''
    }
  }
})

// Tokens are encrypted with the OS keystore (safeStorage) before being written
// to disk; see utils/secret-storage. A token that fails to decrypt reads as ''
// (treated as logged out).
const encryptValue = encryptSecretValue
const decryptValue = decryptSecretValue

export function clearAuth(): void {
  authStore.set('user', null)
  authStore.set('jwtToken', '')
  authStore.set('feishuAccessToken', '')
  authStore.set('feishuRefreshToken', '')
  authStore.set('feishuTokenExpiresAt', 0)
  authStore.set('feishuPlatformAppId', '')
}

export function saveUser(user: User): void {
  authStore.set('user', user)
}

export function getUser(): User | null {
  return authStore.get('user')
}

export function saveJwtToken(token: string): void {
  authStore.set('jwtToken', encryptValue(token))
}

export function getJwtToken(): string {
  return decryptValue(authStore.get('jwtToken'))
}

export function saveFeishuTokens(accessToken: string, refreshToken: string, expiresIn: number): void {
  authStore.set('feishuAccessToken', encryptValue(accessToken))
  authStore.set('feishuRefreshToken', encryptValue(refreshToken))
  authStore.set('feishuTokenExpiresAt', Date.now() + expiresIn * 1000)
}

export function getFeishuAccessToken(): string {
  return decryptValue(authStore.get('feishuAccessToken'))
}

export function getFeishuRefreshToken(): string {
  return decryptValue(authStore.get('feishuRefreshToken'))
}

export function getFeishuTokenExpiresAt(): number {
  return authStore.get('feishuTokenExpiresAt')
}

/** Check if the current user logged in via Feishu OAuth (has feishuId) */
export function isFeishuUser(): boolean {
  const user = getUser()
  return !!user?.feishuId
}

/** Public platform App ID for lark-cli (never stores App Secret) */
export function saveFeishuPlatformAppId(appId: string): void {
  if (appId) authStore.set('feishuPlatformAppId', appId)
}

export function getFeishuPlatformAppId(): string {
  return authStore.get('feishuPlatformAppId') || ''
}
