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
vi.mock('../notification', () => ({ showProtocolNotification: vi.fn() }))

import { protocolRegistry } from '../registry'
import { handleProtocolUrl, isProtocolSilent, setProtocolWindowProvider } from '../index'
import type { ProtocolCommandConfig, ProtocolExecutionContext } from '../types'
import * as subappService from '../../subapp.service'
import * as pythonRunnerService from '../../python-runner.service'
import * as marketplaceService from '../../im/marketplace.service'

describe('Protocol Router and Registry', () => {
  let mockMainWindow: unknown
  let showMainWindowCalled = false

  beforeEach(() => {
    vi.restoreAllMocks()
    mockShowMessageBox.mockReset()
    protocolRegistry.reset()
    showMainWindowCalled = false

    mockMainWindow = {
      isMinimized: vi.fn().mockReturnValue(false),
      isVisible: vi.fn().mockReturnValue(true),
      isDestroyed: vi.fn().mockReturnValue(false),
      show: vi.fn(),
      restore: vi.fn(),
      focus: vi.fn(),
      webContents: {
        send: vi.fn()
      }
    }

    setProtocolWindowProvider({
      getMainWindow: () => mockMainWindow as BrowserWindow,
      showMainWindow: () => {
        showMainWindowCalled = true
        return mockMainWindow as BrowserWindow
      }
    })
  })

  describe('Registry extensibility', () => {
    it('initializes with default commands and no shell command', () => {
      const names = protocolRegistry.getAll().map((c) => c.name)
      expect(names).toContain('app')
      expect(names).toContain('auth')
      expect(names).toContain('install')
      // A URL-triggered shell command would be remote code execution.
      expect(names).not.toContain('cmd')
      expect(protocolRegistry.find('exec')).toBeUndefined()
      expect(protocolRegistry.find('command')).toBeUndefined()
    })

    it('rejects cmd URLs as unknown commands', async () => {
      const result = await handleProtocolUrl('clawbench://cmd?command=calc.exe&silent=true')
      expect(result.success).toBe(false)
      expect(result.error).toBe('UNKNOWN_COMMAND')
    })

    it('resolves commands by name and aliases', () => {
      expect(protocolRegistry.find('app')?.name).toBe('app')
      expect(protocolRegistry.find('run-app')?.name).toBe('app')
      expect(protocolRegistry.find('subapp')?.name).toBe('app')
      expect(protocolRegistry.find('market-install')?.name).toBe('install')
    })

    it('allows registering new custom commands dynamically', async () => {
      const customHandler = vi.fn().mockResolvedValue({ success: true, data: 'custom-done' })
      const customConfig: ProtocolCommandConfig = {
        name: 'custom-action',
        aliases: ['my-action'],
        description: 'Dynamically added command',
        defaultSilent: false,
        handler: customHandler
      }

      protocolRegistry.register(customConfig)
      expect(protocolRegistry.find('custom-action')).toBe(customConfig)
      expect(protocolRegistry.find('my-action')).toBe(customConfig)

      const result = await handleProtocolUrl('clawbench://custom-action?foo=bar&silent=true')
      expect(result.success).toBe(true)
      expect(customHandler).toHaveBeenCalled()
      const ctx = customHandler.mock.calls[0][0] as ProtocolExecutionContext
      expect(ctx.params.foo).toBe('bar')
      expect(ctx.silent).toBe(true)
      expect(showMainWindowCalled).toBe(false)
    })
  })

  describe('Silent vs Non-Silent Window Activation', () => {
    it('isProtocolSilent correctly inspects silent flag', () => {
      expect(isProtocolSilent('clawbench://app?id=test&silent=true')).toBe(true)
      expect(isProtocolSilent('clawbench://app?id=test&silent=1')).toBe(true)
      expect(isProtocolSilent('clawbench://app?id=test&silent=false')).toBe(false)
      expect(isProtocolSilent('clawbench://app?id=test')).toBe(false)
    })

    it('calls showMainWindow when silent is false', async () => {
      protocolRegistry.register({ name: 'test-window-action', handler: vi.fn().mockResolvedValue({ success: true }) })
      await handleProtocolUrl('clawbench://test-window-action?silent=false')
      expect(showMainWindowCalled).toBe(true)
    })

    it('does NOT call showMainWindow when silent is true', async () => {
      protocolRegistry.register({ name: 'test-silent-action', handler: vi.fn().mockResolvedValue({ success: true }) })
      await handleProtocolUrl('clawbench://test-silent-action?silent=true')
      expect(showMainWindowCalled).toBe(false)
    })
  })

  describe('appCommand execution', () => {
    const mockManifest = {
      id: 'com.example.tool',
      name: 'Example Tool',
      version: '1.0.0',
      description: 'Test',
      entry: 'main.py'
    }

    it('fails when id is missing', async () => {
      const result = await handleProtocolUrl('clawbench://app?silent=true')
      expect(result.success).toBe(false)
      expect(result.error).toBe('MISSING_APP_ID')
    })

    it('executes directly when app is installed locally', async () => {
      vi.spyOn(subappService, 'listSubApps').mockReturnValue([
        { id: mockManifest.id, manifest: mockManifest, path: '/mock/apps/tool', source: 'user' }
      ])
      vi.spyOn(pythonRunnerService, 'resolvePythonCommand').mockResolvedValue({
        path: '/usr/bin/python3',
        version: '3.11.0',
        source: 'system'
      })
      const executeSubAppSpy = vi.spyOn(pythonRunnerService, 'executeSubApp').mockImplementation(() => {})

      const result = await handleProtocolUrl('clawbench://app?id=com.example.tool&silent=true')
      expect(result.success).toBe(true)
      expect(result.data).toHaveProperty('appId', 'com.example.tool')
      expect(executeSubAppSpy).toHaveBeenCalled()
      expect(mockShowMessageBox).not.toHaveBeenCalled()
      expect(showMainWindowCalled).toBe(false)
    })

    it('refuses to run non-app resources (skills/prompts)', async () => {
      vi.spyOn(subappService, 'listSubApps').mockReturnValue([
        {
          id: 'skill.x',
          manifest: { ...mockManifest, id: 'skill.x', type: 'ai-skill', entry: 'SKILL.md' },
          path: '/mock/apps/skill',
          source: 'user'
        }
      ])
      const executeSubAppSpy = vi.spyOn(pythonRunnerService, 'executeSubApp').mockImplementation(() => {})
      const result = await handleProtocolUrl('clawbench://app?id=skill.x&silent=true')
      expect(result.success).toBe(false)
      expect(result.error).toBe('NOT_RUNNABLE')
      expect(executeSubAppSpy).not.toHaveBeenCalled()
    })

    it('fails when app is not installed and autoInstall is false', async () => {
      vi.spyOn(subappService, 'listSubApps').mockReturnValue([])
      const installSpy = vi.spyOn(marketplaceService, 'installMarketApp')

      const result = await handleProtocolUrl('clawbench://app?id=com.not.installed&autoInstall=false&silent=true')
      expect(result.success).toBe(false)
      expect(result.error).toBe('APP_NOT_INSTALLED')
      expect(installSpy).not.toHaveBeenCalled()
    })

    it('does not install when the user declines the confirmation', async () => {
      vi.spyOn(subappService, 'listSubApps').mockReturnValue([])
      const installSpy = vi.spyOn(marketplaceService, 'installMarketApp')
      mockShowMessageBox.mockResolvedValue({ response: 1 })

      const result = await handleProtocolUrl('clawbench://app?id=com.market.tool&autoInstall=true&silent=true')
      expect(mockShowMessageBox).toHaveBeenCalled()
      expect(installSpy).not.toHaveBeenCalled()
      expect(result.success).toBe(false)
      expect(result.error).toBe('USER_CANCELLED')
    })

    it('installs from marketplace and runs after the user confirms', async () => {
      const marketManifest = { ...mockManifest, id: 'com.market.tool', name: 'Market Tool' }
      let installed = false
      vi.spyOn(subappService, 'listSubApps').mockImplementation(() =>
        installed
          ? [{ id: 'com.market.tool', manifest: marketManifest, path: '/mock/apps/market-tool', source: 'user' }]
          : []
      )
      const installSpy = vi.spyOn(marketplaceService, 'installMarketApp').mockImplementation(async () => {
        installed = true
        return { success: true, name: 'Market Tool' }
      })
      vi.spyOn(pythonRunnerService, 'resolvePythonCommand').mockResolvedValue({
        path: '/usr/bin/python3',
        version: '3.11.0',
        source: 'system'
      })
      const executeSubAppSpy = vi.spyOn(pythonRunnerService, 'executeSubApp').mockImplementation(() => {})
      mockShowMessageBox.mockResolvedValue({ response: 0 })

      const result = await handleProtocolUrl('clawbench://app?id=com.market.tool&autoInstall=true&silent=true')
      expect(mockShowMessageBox).toHaveBeenCalled()
      expect(installSpy).toHaveBeenCalledWith('com.market.tool')
      expect(result.success).toBe(true)
      expect(executeSubAppSpy).toHaveBeenCalled()
    })
  })

  describe('installCommand', () => {
    it('forwards the install prompt to the renderer', async () => {
      const result = await handleProtocolUrl('clawbench://install/com.mycorp.tool?name=Tool')
      expect(result.success).toBe(true)
      const send = (mockMainWindow as { webContents: { send: ReturnType<typeof vi.fn> } }).webContents.send
      expect(send).toHaveBeenCalledWith('protocol:install-app', { appId: 'com.mycorp.tool', name: 'Tool' })
    })
  })
})
