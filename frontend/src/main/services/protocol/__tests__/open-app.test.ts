import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'

const mockShowMessageBox = vi.fn()
// Outside the Electron runtime `electron` resolves to the binary path, so its
// named exports are undefined; vitest's strict mocks need them declared.
vi.mock('electron', () => ({
  app: undefined,
  BrowserWindow: undefined,
  Notification: undefined,
  Tray: undefined,
  Menu: undefined,
  nativeImage: undefined,
  shell: undefined,
  ipcMain: undefined,
  safeStorage: undefined,
  net: undefined,
  dialog: { showMessageBox: (...args: unknown[]) => mockShowMessageBox(...args) }
}))
const mockNotify = vi.fn()
vi.mock('../notification', () => ({ showProtocolNotification: (...a: unknown[]) => mockNotify(...a) }))

import { protocolRegistry } from '../registry'
import { handleProtocolUrl, setProtocolWindowProvider } from '../index'
import { parseProtocolUrl } from '../parser'
import { takePendingOpenApp, isValidOpenAppId } from '../commands/open-app.command'
import * as pythonRunnerService from '../../python-runner.service'
import * as marketplaceService from '../../im/marketplace.service'

describe('open-app protocol command (share links)', () => {
  let send: ReturnType<typeof vi.fn>
  let isLoading: boolean
  let showMainWindowCalls = 0

  beforeEach(() => {
    vi.restoreAllMocks()
    mockShowMessageBox.mockReset()
    mockNotify.mockReset()
    protocolRegistry.reset()
    takePendingOpenApp() // drain leftovers between tests
    send = vi.fn()
    isLoading = false
    showMainWindowCalls = 0
    const win = {
      isDestroyed: () => false,
      isMinimized: () => false,
      isVisible: () => true,
      webContents: { send, isLoading: () => isLoading }
    }
    setProtocolWindowProvider({
      getMainWindow: () => win as unknown as BrowserWindow,
      showMainWindow: () => {
        showMainWindowCalls++
        return win as unknown as BrowserWindow
      }
    })
  })

  it('parses share urls into open-app with id, incl. aliases', () => {
    const parsed = parseProtocolUrl('clawbench://open-app?id=com.acme.tool')
    expect(parsed.action).toBe('open-app')
    expect(parsed.params.id).toBe('com.acme.tool')
    expect(protocolRegistry.find('share')?.name).toBe('open-app')
    expect(protocolRegistry.find('preview-app')?.name).toBe('open-app')
  })

  it('shows window, stores pending request once, and notifies renderer', async () => {
    const result = await handleProtocolUrl('clawbench://open-app?id=com.acme.tool')
    expect(result.success).toBe(true)
    expect(showMainWindowCalls).toBeGreaterThan(0)
    expect(send).toHaveBeenCalledWith('protocol:open-app', { appId: 'com.acme.tool' })

    expect(takePendingOpenApp()?.appId).toBe('com.acme.tool')
    expect(takePendingOpenApp()).toBeNull()
  })

  it('never runs, installs or prompts — it only navigates', async () => {
    const runSpy = vi.spyOn(pythonRunnerService, 'executeSubApp')
    const installSpy = vi.spyOn(marketplaceService, 'installMarketApp')
    await handleProtocolUrl(
      'clawbench://open-app?id=com.acme.tool&autoInstall=true&params=%7B%22a%22%3A1%7D'
    )
    expect(runSpy).not.toHaveBeenCalled()
    expect(installSpy).not.toHaveBeenCalled()
    expect(mockShowMessageBox).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('protocol:open-app', { appId: 'com.acme.tool' })
  })

  it('keeps request pending without event while renderer is still loading (cold start)', async () => {
    isLoading = true
    await handleProtocolUrl('clawbench://open-app?id=cb.user.my-app')
    expect(send).not.toHaveBeenCalled()
    expect(takePendingOpenApp()?.appId).toBe('cb.user.my-app')
  })

  it('still brings window to front when silent=true is passed', async () => {
    await handleProtocolUrl('clawbench://open-app?id=com.acme.tool&silent=true')
    expect(showMainWindowCalls).toBe(1)
  })

  it('without id only shows the workbench and stores nothing', async () => {
    const result = await handleProtocolUrl('clawbench://open-app')
    expect(result.success).toBe(true)
    expect(showMainWindowCalls).toBe(1)
    expect(send).not.toHaveBeenCalled()
    expect(takePendingOpenApp()).toBeNull()
  })

  it('decodes encoded ids', async () => {
    await handleProtocolUrl(
      `clawbench://open-app?id=${encodeURIComponent('com.clawbench.builtin.update-project')}`
    )
    expect(takePendingOpenApp()?.appId).toBe('com.clawbench.builtin.update-project')
  })

  it.each([
    '../../etc/passwd',
    '"><img src=x onerror=alert(1)>',
    'a b',
    '应用',
    '-leading-dash',
    'x'.repeat(129)
  ])('rejects malformed id %j without storing or forwarding it', async (bad) => {
    const result = await handleProtocolUrl(`clawbench://open-app?id=${encodeURIComponent(bad)}`)
    expect(result.success).toBe(false)
    expect(result.error).toBe('INVALID_APP_ID')
    expect(send).not.toHaveBeenCalled()
    expect(takePendingOpenApp()).toBeNull()
    expect(mockNotify).toHaveBeenCalled()
  })

  it('validates ids like manifest / marketplace ids', () => {
    expect(isValidOpenAppId('com.acme.tool')).toBe(true)
    expect(isValidOpenAppId('0b5e7a2c-1f3d-4c1e-9a7b-2d8e6f4a1c3b')).toBe(true)
    expect(isValidOpenAppId('')).toBe(false)
    expect(isValidOpenAppId('a/b')).toBe(false)
  })

  it('drops expired pending requests', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      await handleProtocolUrl('clawbench://open-app?id=com.acme.tool')
      vi.setSystemTime(new Date('2026-01-01T00:11:00Z'))
      expect(takePendingOpenApp()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
