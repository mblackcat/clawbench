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

  ipcMain.handle('settings:set-agent-settings', async (_event, settings: { customSystemPrompt?: string; defaultToolApprovalMode?: string; maxAgentToolSteps?: number }) => {
    setAgentSettings(settings)
  })

  ipcMain.handle('settings:test-brave-api-key', async (_event, apiKey: string) => {
    try {
      const response = await net.fetch(
        'https://api.search.brave.com/res/v1/web/search?q=test&count=1',
        {
          headers: {
            'X-Subscription-Token': apiKey,
            'Accept': 'application/json',
            'Cache-Control': 'no-cache'
          }
        }
      )
      if (response.ok) {
        return { success: true, message: 'API Key 验证成功' }
      }
      return { success: false, message: `验证失败: HTTP ${response.status}` }
    } catch (err: any) {
      return { success: false, message: `连接失败: ${err.message}` }
    }
  })

  ipcMain.handle('settings:detect-lightpanda', async () => {
    const candidates = [
      '/usr/local/bin/lightpanda',
      path.join(process.env.HOME || '~', '.lightpanda', 'lightpanda'),
      path.join(process.env.HOME || '~', '.local', 'bin', 'lightpanda'),
      '/opt/homebrew/bin/lightpanda'
    ]
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          fs.accessSync(p, fs.constants.X_OK)
          return { found: true, path: p }
        }
      } catch { /* not executable */ }
    }
    return { found: false, path: '' }
  })

  ipcMain.handle('settings:install-lightpanda', async (event) => {
    const isMac = process.platform === 'darwin'
    const isLinux = process.platform === 'linux'
    const arch = process.arch // 'arm64' or 'x64'
    const sender = event.sender

    const sendProgress = (percent: number, downloadedMB: string, totalMB: string, stage: string) => {
      try {
        if (!sender.isDestroyed()) {
          sender.send('settings:lightpanda-install-progress', { percent, downloadedMB, totalMB, stage })
        }
      } catch { /* window closed */ }
    }

    let binaryName: string
    if (isMac && arch === 'arm64') {
      binaryName = 'lightpanda-aarch64-macos'
    } else if (isMac && arch === 'x64') {
      binaryName = 'lightpanda-x86_64-macos'
    } else if (isLinux) {
      binaryName = 'lightpanda-x86_64-linux'
    } else {
      return { success: false, error: 'Unsupported platform. Lightpanda supports macOS and Linux.', path: '' }
    }

    const downloadUrl = `https://github.com/lightpanda-io/browser/releases/download/nightly/${binaryName}`
    const installDir = path.join(process.env.HOME || '~', '.lightpanda')
    const installPath = path.join(installDir, 'lightpanda')

    try {
      // Create install dir
      if (!fs.existsSync(installDir)) {
        fs.mkdirSync(installDir, { recursive: true })
      }

      // Check if already installed and up-to-date (compare remote size with local file)
      if (fs.existsSync(installPath)) {
        try {
          const headRes = await net.fetch(downloadUrl, { method: 'HEAD', redirect: 'follow' })
          if (headRes.ok) {
            const remoteSize = parseInt(headRes.headers.get('content-length') || '0', 10)
            const localSize = fs.statSync(installPath).size
            if (remoteSize > 0 && remoteSize === localSize) {
              logger.info(`[Lightpanda] Already up-to-date (${localSize} bytes), skipping download`)
              sendProgress(100, '0', '0', 'done')
              return { success: true, error: '', path: installPath }
            }
            logger.info(`[Lightpanda] Size mismatch (local=${localSize}, remote=${remoteSize}), re-downloading`)
          }
        } catch { /* can't check, proceed with download */ }
      }

      logger.info(`[Lightpanda] Downloading from ${downloadUrl}`)
      sendProgress(0, '0', '?', 'connecting')

      // Download binary with progress tracking
      const response = await net.fetch(downloadUrl, { redirect: 'follow' })
      if (!response.ok) {
        logger.error(`[Lightpanda] Download failed: HTTP ${response.status}`)
        return { success: false, error: `Download failed: HTTP ${response.status}`, path: '' }
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
      const totalMB = contentLength > 0 ? (contentLength / 1024 / 1024).toFixed(1) : '?'
      logger.info(`[Lightpanda] File size: ${totalMB} MB`)
      sendProgress(0, '0', totalMB, 'downloading')

      const reader = response.body?.getReader()
      if (!reader) {
        return { success: false, error: 'Failed to get response stream', path: '' }
      }

      const chunks: Uint8Array[] = []
      let receivedBytes = 0
      let lastProgressTime = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        receivedBytes += value.length

        // Throttle progress events to every 200ms
        const now = Date.now()
        if (now - lastProgressTime > 200) {
          lastProgressTime = now
          const downloadedMB = (receivedBytes / 1024 / 1024).toFixed(1)
          const percent = contentLength > 0 ? Math.round((receivedBytes / contentLength) * 100) : -1
          sendProgress(percent, downloadedMB, totalMB, 'downloading')
        }
      }

      // Concatenate chunks and write
      sendProgress(100, (receivedBytes / 1024 / 1024).toFixed(1), totalMB, 'writing')
      logger.info(`[Lightpanda] Download complete, ${(receivedBytes / 1024 / 1024).toFixed(1)} MB, writing to ${installPath}`)

      const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)))
      fs.writeFileSync(installPath, buffer)
      fs.chmodSync(installPath, 0o755)

      sendProgress(100, (receivedBytes / 1024 / 1024).toFixed(1), totalMB, 'done')
      logger.info(`[Lightpanda] Installed successfully at ${installPath}`)

      return { success: true, error: '', path: installPath }
    } catch (err: any) {
      logger.error(`[Lightpanda] Install failed: ${err.message}`)
      sendProgress(-1, '0', '0', 'error')
      return { success: false, error: err.message, path: '' }
    }
  })

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
