import Store from 'electron-store'
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
    }
  }
})

export function clearAuth(): void {
  authStore.set('user', null)
  authStore.set('jwtToken', '')
  authStore.set('feishuAccessToken', '')
  authStore.set('feishuRefreshToken', '')
  authStore.set('feishuTokenExpiresAt', 0)
}

export function saveUser(user: User): void {
  authStore.set('user', user)
}

export function getUser(): User | null {
  return authStore.get('user')
}

export function saveJwtToken(token: string): void {
  authStore.set('jwtToken', token)
}

export function getJwtToken(): string {
  return authStore.get('jwtToken')
}

export function saveFeishuTokens(accessToken: string, refreshToken: string, expiresIn: number): void {
  authStore.set('feishuAccessToken', accessToken)
  authStore.set('feishuRefreshToken', refreshToken)
  authStore.set('feishuTokenExpiresAt', Date.now() + expiresIn * 1000)
}

export function getFeishuAccessToken(): string {
  return authStore.get('feishuAccessToken')
}

export function getFeishuRefreshToken(): string {
  return authStore.get('feishuRefreshToken')
}

export function getFeishuTokenExpiresAt(): number {
  return authStore.get('feishuTokenExpiresAt')
}

/** Check if the current user logged in via Feishu OAuth (has feishuId) */
export function isFeishuUser(): boolean {
  const user = getUser()
  return !!user?.feishuId
}
