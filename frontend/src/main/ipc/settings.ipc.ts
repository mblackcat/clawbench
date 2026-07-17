import { ipcMain, dialog, BrowserWindow, net, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import * as logger from '../utils/logger'
import { detectOne } from '../services/local-env.service'
import {
  getSettings,
  setSetting,
  validatePythonPath,
  getAiModelConfigs,
  saveAiModelConfig,
  deleteAiModelConfig,
  testAiModelConfig,
  getImageGenConfigs,
  saveImageGenConfig,
  deleteImageGenConfig
} from '../services/settings.service'
import { setLastChatModel, getLastChatModel, setLastBuiltinChatModel, getLastBuiltinChatModel, getLastChatModelSource, getChatPreferences, setChatPreferences, getAiToolsConfig, getAiToolsConfigRaw, setAiToolsConfig, getAgentSettings, setAgentSettings } from '../store/settings.store'
import { saveApiToken, clearApiToken } from '../store/api-credentials.store'
import { refreshGlobalShortcuts } from '../services/shortcut.service'
import { detectLarkCli, resetFeishuCliCache } from '../services/feishu-tools.service'
import { isFeishuUser, getFeishuPlatformAppId } from '../store/auth.store'
import { ensureFeishuPlatformAppId } from '../services/auth.service'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', async () => {
    return getSettings()
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
    const result = setSetting(key, value)
    if (key === 'appShortcutEnabled' || key === 'appShortcutModifier') {
      refreshGlobalShortcuts()
    }
    return result
  })

  ipcMain.handle('settings:validate-python', async (_event, pythonPath: string) => {
    return validatePythonPath(pythonPath)
  })

  ipcMain.handle('settings:detect-python', async () => {
    const result = await detectOne('python')
    if (result.installed && result.installations.length > 0) {
      return result.installations[0].path
    }
    return null
  })

  ipcMain.handle('settings:get-env-config', async () => {
    return {
      enableAccountLogin: import.meta.env.VITE_ENABLE_ACCOUNT_LOGIN !== 'false',
      enableLocalMode: import.meta.env.VITE_ENABLE_LOCAL_MODE === 'true'
    }
  })

  ipcMain.handle('settings:get-ai-models', async () => {
    return getAiModelConfigs()
  })

  ipcMain.handle('settings:save-ai-model', async (_event, config: any) => {
    return saveAiModelConfig(config)
  })

  ipcMain.handle('settings:delete-ai-model', async (_event, id: string) => {
    return deleteAiModelConfig(id)
  })

  ipcMain.handle('settings:test-ai-model', async (_event, config: any) => {
    return testAiModelConfig(config)
  })

  ipcMain.handle('settings:get-image-gen-configs', async () => {
    return getImageGenConfigs()
  })

  ipcMain.handle('settings:save-image-gen-config', async (_event, config: any) => {
    return saveImageGenConfig(config)
  })

  ipcMain.handle('settings:delete-image-gen-config', async (_event, id: string) => {
    return deleteImageGenConfig(id)
  })

  ipcMain.handle('settings:set-last-chat-model', async (_event, configId: string, modelId: string) => {
    setLastChatModel(configId, modelId)
  })

  ipcMain.handle('settings:get-last-chat-model', async () => {
    return getLastChatModel()
  })

  ipcMain.handle('settings:set-last-builtin-chat-model', async (_event, modelId: string) => {
    setLastBuiltinChatModel(modelId)
  })

  ipcMain.handle('settings:get-last-builtin-chat-model', async () => {
    return getLastBuiltinChatModel()
  })

  ipcMain.handle('settings:get-last-chat-model-source', async () => {
    return getLastChatModelSource()
  })

  ipcMain.handle('settings:get-chat-preferences', async () => {
    return getChatPreferences()
  })

  ipcMain.handle('settings:set-chat-preferences', async (_event, prefs: { chatMode?: string; toolsEnabled?: boolean; webSearchEnabled?: boolean }) => {
    setChatPreferences(prefs)
  })

  ipcMain.handle('credentials:save-api-token', async (_event, token: string) => {
    saveApiToken(token)
  })

  ipcMain.handle('credentials:clear-api-token', async () => {
    clearApiToken()
  })

  ipcMain.handle('settings:get-ai-tools-config', async () => {
    return getAiToolsConfig()
  })

  ipcMain.handle('settings:set-ai-tools-config', async (_event, config: any) => {
    setAiToolsConfig(config)
  })

  ipcMain.handle('settings:get-agent-settings', async () => {
    return getAgentSettings()
  })

  ipcMain.handle('settings:set-agent-settings', async (_event, settings: {
    customSystemPrompt?: string
    defaultToolApprovalMode?: string
    maxAgentToolSteps?: number
    assistantEnabled?: boolean
    setupRole?: string
  }) => {
    setAgentSettings(settings)
  })

  // Web search/fetch backends are zero-config (see web-search.service.ts).
  // Brave/Lightpanda install+test IPC removed — silent auto-detect only.

  // ── Official Lark/Feishu CLI (larksuite/cli → lark-cli) ──

  ipcMain.handle('settings:detect-feishu-cli', async () => {
    return detectLarkCli()
  })

  /** Whether current session can enable Feishu Kits (Feishu OAuth login) */
  ipcMain.handle('settings:feishu-kits-auth-status', async () => {
    // Best-effort: backfill platform App ID for sessions that logged in before appId was stored
    if (isFeishuUser()) {
      await ensureFeishuPlatformAppId()
    }
    return {
      isFeishuUser: isFeishuUser(),
      hasPlatformAppId: !!getFeishuPlatformAppId(),
    }
  })

  ipcMain.handle('settings:install-feishu-cli', async (event) => {
    const sender = event.sender
    const sendProgress = (percent: number, downloadedMB: string, totalMB: string, stage: string) => {
      try {
        if (!sender.isDestroyed()) {
          sender.send('settings:feishu-cli-install-progress', { percent, downloadedMB, totalMB, stage })
        }
      } catch { /* window closed */ }
    }

    // Already installed?
    try {
      const existing = await detectLarkCli()
      if (existing.found) {
        sendProgress(100, '0', '0', 'done')
        return { success: true, error: '', path: existing.path }
      }
    } catch { /* continue install */ }

    sendProgress(5, '0', '0', 'installing')
    logger.info('[lark-cli] Installing via npx @larksuite/cli@latest install')

    try {
      const { spawn } = require('child_process')
      const isWin = process.platform === 'win32'
      const cmd = isWin ? 'npx.cmd' : 'npx'
      const args = ['--yes', '@larksuite/cli@latest', 'install']

      const result = await new Promise<{ success: boolean; error: string; path: string }>((resolve) => {
        let stderr = ''
        let stdout = ''
        const child = spawn(cmd, args, {
          shell: true,
          env: process.env,
          windowsHide: true,
        })

        // Pseudo progress while npx downloads / installs
        let tick = 10
        const timer = setInterval(() => {
          if (tick < 90) {
            tick += 5
            sendProgress(tick, '0', '0', 'installing')
          }
        }, 1500)

        child.stdout?.on('data', (buf: Buffer) => {
          stdout += buf.toString()
          logger.info(`[lark-cli install] ${buf.toString().trim()}`)
        })
        child.stderr?.on('data', (buf: Buffer) => {
          stderr += buf.toString()
          logger.info(`[lark-cli install stderr] ${buf.toString().trim()}`)
        })
        child.on('error', (err: Error) => {
          clearInterval(timer)
          resolve({ success: false, error: err.message, path: '' })
        })
        child.on('close', async (code: number | null) => {
          clearInterval(timer)
          if (code !== 0) {
            resolve({
              success: false,
              error: stderr.trim() || stdout.trim() || `npx install exited with code ${code}`,
              path: '',
            })
            return
          }
          sendProgress(95, '0', '0', 'verifying')
          resetFeishuCliCache()
          const detected = await detectLarkCli()
          if (detected.found) {
            sendProgress(100, '0', '0', 'done')
            resolve({ success: true, error: '', path: detected.path })
          } else {
            // Install may have succeeded but PATH not refreshed in this process
            sendProgress(100, '0', '0', 'done')
            resolve({
              success: true,
              error: '',
              path: 'lark-cli (installed; restart app if path not detected)',
            })
          }
        })
      })

      if (!result.success) {
        sendProgress(-1, '0', '0', 'error')
      }
      return result
    } catch (err: any) {
      logger.error(`[lark-cli] Install failed: ${err.message}`)
      sendProgress(-1, '0', '0', 'error')
      return { success: false, error: err.message, path: '' }
    }
  })

  ipcMain.handle('dialog:select-directory', async (event) => {
    const window = require('electron').BrowserWindow.fromWebContents(event.sender)
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('dialog:select-app', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    const isMac = process.platform === 'darwin'
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: isMac
        ? [{ name: 'Applications', extensions: ['app'] }]
        : [{ name: 'Executables', extensions: ['exe', '*'] }],
      ...(isMac ? { defaultPath: '/Applications' } : {})
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:select-files', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return []
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('dialog:save-image', async (event, base64Data: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false

    const result = await dialog.showSaveDialog(window, {
      defaultPath: `image-${Date.now()}.png`,
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })

    if (result.canceled || !result.filePath) {
      return false
    }

    fs.writeFileSync(result.filePath, Buffer.from(base64Data, 'base64'))
    return true
  })
}
