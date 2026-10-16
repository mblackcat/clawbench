import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({
  saveJwtToken: vi.fn(),
  saveUser: vi.fn(),
  saveFeishuTokens: vi.fn(),
  saveFeishuPlatformAppId: vi.fn()
}))

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(async () => {}) },
  BrowserWindow: undefined,
  app: undefined
}))
vi.mock('../../store/auth.store', () => ({
  clearAuth: vi.fn(),
  saveUser: store.saveUser,
  getUser: vi.fn(() => null),
  saveJwtToken: store.saveJwtToken,
  getJwtToken: vi.fn(() => null),
  saveFeishuTokens: store.saveFeishuTokens,
  saveFeishuPlatformAppId: store.saveFeishuPlatformAppId,
  getFeishuPlatformAppId: vi.fn(() => ''),
  getFeishuAccessToken: vi.fn(() => ''),
  getFeishuRefreshToken: vi.fn(() => ''),
  getFeishuTokenExpiresAt: vi.fn(() => 0),
  isFeishuUser: vi.fn(() => false)
}))
vi.mock('../../utils/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../../utils/i18n', () => ({ mainT: (k: string) => k }))

import {
  startLogin,
  cancelLogin,
  getFeishuAuthUrl,
  handleProtocolCallback,
  hasPendingLogin,
  isAllowedAuthNavigation
} from '../auth.service'

const webContents = { isDestroyed: () => false, send: vi.fn() } as never

function stateOf(url: string): string {
  return new URL(url).searchParams.get('client_state') || ''
}

beforeEach(() => {
  cancelLogin()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
  store.saveJwtToken.mockReset()
})

describe('auth protocol callback hardening', () => {
  it('ignores callbacks when no login is pending', async () => {
    expect(hasPendingLogin()).toBe(false)
    await expect(
      handleProtocolCallback('clawbench://auth/callback?token=evil', webContents)
    ).rejects.toThrow('auth.noPendingLogin')
    expect(store.saveJwtToken).not.toHaveBeenCalled()
  })

  it('rejects a mismatching state without cancelling the real login', async () => {
    const pending = startLogin(webContents)
    pending.catch(() => {})
    const state = stateOf(getFeishuAuthUrl())
    expect(state).toMatch(/^[A-Za-z0-9_-]{22}$/)

    await expect(
      handleProtocolCallback('clawbench://auth/callback?token=evil&state=wrongwrongwrong', webContents)
    ).rejects.toThrow('auth.stateMismatch')
    expect(store.saveJwtToken).not.toHaveBeenCalled()
    expect(hasPendingLogin()).toBe(true)

    await handleProtocolCallback(`clawbench://auth/callback?token=good&state=${state}`, webContents)
    expect(store.saveJwtToken).toHaveBeenCalledWith('good')
    await expect(pending).resolves.toBeDefined()
    expect(hasPendingLogin()).toBe(false)
  })

  it('accepts a legacy callback without state only while a login is pending', async () => {
    const pending = startLogin(webContents)
    pending.catch(() => {})
    await handleProtocolCallback('clawbench://auth/callback?token=legacy', webContents)
    expect(store.saveJwtToken).toHaveBeenCalledWith('legacy')
    await expect(
      handleProtocolCallback('clawbench://auth/callback?token=again', webContents)
    ).rejects.toThrow('auth.noPendingLogin')
  })

  it('starts a new nonce per login and drops it on cancel', () => {
    startLogin(webContents).catch(() => {})
    const first = stateOf(getFeishuAuthUrl())
    startLogin(webContents).catch(() => {})
    const second = stateOf(getFeishuAuthUrl())
    expect(first).not.toBe(second)
    cancelLogin()
    expect(hasPendingLogin()).toBe(false)
  })
})

describe('isAllowedAuthNavigation', () => {
  const api = 'https://api.example.com/api/v1'
  it('allows the API origin and Feishu/Lark https hosts only', () => {
    expect(isAllowedAuthNavigation('https://api.example.com/api/v1/auth/feishu', api)).toBe(true)
    expect(isAllowedAuthNavigation('https://open.feishu.cn/open-apis/authen', api)).toBe(true)
    expect(isAllowedAuthNavigation('https://accounts.larksuite.com/x', api)).toBe(true)
    expect(isAllowedAuthNavigation('http://open.feishu.cn/x', api)).toBe(false)
    expect(isAllowedAuthNavigation('https://evilfeishu.cn/x', api)).toBe(false)
    expect(isAllowedAuthNavigation('https://feishu.cn.evil.com/x', api)).toBe(false)
    expect(isAllowedAuthNavigation('file:///etc/passwd', api)).toBe(false)
    expect(isAllowedAuthNavigation('not a url', api)).toBe(false)
  })
})
