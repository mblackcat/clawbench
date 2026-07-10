import Store from 'electron-store'
import { safeStorage } from 'electron'
import * as logger from '../utils/logger'

export interface User {
  id: string
  name: string
  avatarUrl: string
  email: string
  feishuId: string
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
// to disk. Values written by older versions are plaintext — they stay readable
// and get encrypted the next time they are saved.
const ENC_PREFIX = 'enc:v1:'

function encryptValue(value: string): string {
  if (!value) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
    }
  } catch (err) {
    logger.warn('safeStorage unavailable, storing token without OS encryption:', err)
  }
  return value
}

function decryptValue(stored: string): string {
  if (!stored) return ''
  if (!stored.startsWith(ENC_PREFIX)) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
  } catch (err) {
    logger.error('Failed to decrypt stored token, treating as logged out:', err)
    return ''
  }
}

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
