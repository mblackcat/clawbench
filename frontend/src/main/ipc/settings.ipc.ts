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
import { getIMConfig } from '../services/ai-workbench.service'
import { refreshGlobalShortcuts } from '../services/shortcut.service'

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

  ipcMain.handle('settings:detect-feishu-cli', async () => {
    const candidates = [
      '/usr/local/bin/feishu-cli',
      path.join(process.env.HOME || '~', '.local', 'bin', 'feishu-cli'),
      '/opt/homebrew/bin/feishu-cli'
    ]
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          fs.accessSync(p, fs.constants.X_OK)
          return { found: true, path: p }
        }
      } catch { /* not executable */ }
    }
    // Also try which
    try {
      const { execFile: execFileCb } = require('child_process')
      const { promisify } = require('util')
      const execFileAsync = promisify(execFileCb)
      const { stdout } = await execFileAsync('which', ['feishu-cli'])
      const found = stdout.trim()
      if (found) return { found: true, path: found }
    } catch { /* not found */ }
    return { found: false, path: '' }
  })

  ipcMain.handle('settings:write-feishu-cli-config', async () => {
    try {
      const imConfig = getIMConfig()
      const { appId, appSecret } = imConfig.feishu
      if (!appId || !appSecret) {
        return { success: false, error: 'IM Feishu credentials not configured' }
      }

      const configDir = path.join(process.env.HOME || '~', '.feishu-cli')
      const configPath = path.join(configDir, 'config.yaml')

      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true })
      }

      const yaml = [
        '# feishu-cli config (auto-generated by ClawBench)',
        `app_id: "${appId}"`,
        `app_secret: "${appSecret}"`,
        'base_url: "https://open.feishu.cn"',
        'owner_email: ""',
        'transfer_ownership: false',
        'debug: false',
        '',
        'export:',
        '  download_images: true',
        '  assets_dir: "./assets"',
        '',
        'import:',
        '  upload_images: true',
      ].join('\n')

      fs.writeFileSync(configPath, yaml, 'utf-8')
      logger.info(`[feishu-cli] Config written to ${configPath}`)
      return { success: true, error: '', path: configPath }
    } catch (err: any) {
      logger.error(`[feishu-cli] Failed to write config: ${err.message}`)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('settings:check-feishu-cli-config', async () => {
    try {
      const configPath = path.join(process.env.HOME || '~', '.feishu-cli', 'config.yaml')
      if (!fs.existsSync(configPath)) return { exists: false, hasCredentials: false }
      const content = fs.readFileSync(configPath, 'utf-8')
      const hasId = /app_id:\s*"[^"]+"/m.test(content) && !/app_id:\s*""/m.test(content)
      return { exists: true, hasCredentials: hasId }
    } catch {
      return { exists: false, hasCredentials: false }
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

    // Determine platform asset name (mirrors install.sh logic)
    const osName = process.platform === 'darwin' ? 'darwin' : 'linux'
    const archName = process.arch === 'arm64' ? 'arm64' : 'amd64'
    const installDir = path.join(process.env.HOME || '~', '.local', 'bin')
    const installPath = path.join(installDir, 'feishu-cli')

    try {
      // 1. Get latest release version from GitHub API
      sendProgress(0, '0', '?', 'resolving')
      logger.info('[feishu-cli] Fetching latest release version...')

      const releaseRes = await net.fetch('https://api.github.com/repos/riba2534/feishu-cli/releases/latest', { redirect: 'follow' })
      if (!releaseRes.ok) {
        return { success: false, error: `GitHub API error: HTTP ${releaseRes.status}`, path: '' }
      }
      const releaseData = await releaseRes.json() as { tag_name: string }
      const version = releaseData.tag_name // e.g. "v1.12.0"
      if (!version) {
        return { success: false, error: 'Could not determine latest version', path: '' }
      }
      logger.info(`[feishu-cli] Latest version: ${version}`)

      // 1b. Check if already installed at same version — skip download
      if (fs.existsSync(installPath)) {
        try {
          const { execFile: execCb } = require('child_process')
          const execAsync = require('util').promisify(execCb)
          const { stdout: verOut } = await execAsync(installPath, ['--version'], { timeout: 5000 })
          const installedVer = (verOut as string).match(/v[\d.]+/)?.[0]
          if (installedVer && installedVer === version) {
            logger.info(`[feishu-cli] Already at latest version ${version}, skipping download`)
            sendProgress(100, '0', '0', 'done')
            return { success: true, error: '', path: installPath }
          }
          logger.info(`[feishu-cli] Installed version ${installedVer} differs from ${version}, updating`)
        } catch { /* can't determine version, re-download */ }
      }

      // 2. Download tarball
      const assetName = `feishu-cli_${version}_${osName}-${archName}.tar.gz`
      const downloadUrl = `https://github.com/riba2534/feishu-cli/releases/download/${version}/${assetName}`

      logger.info(`[feishu-cli] Downloading ${downloadUrl}`)
      sendProgress(5, '0', '?', 'downloading')

      const dlRes = await net.fetch(downloadUrl, { redirect: 'follow' })
      if (!dlRes.ok) {
        return { success: false, error: `Download failed: HTTP ${dlRes.status} for ${assetName}`, path: '' }
      }

      const contentLength = parseInt(dlRes.headers.get('content-length') || '0', 10)
      const totalMB = contentLength > 0 ? (contentLength / 1024 / 1024).toFixed(1) : '?'
      sendProgress(5, '0', totalMB, 'downloading')

      const reader = dlRes.body?.getReader()
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
        const now = Date.now()
        if (now - lastProgressTime > 200) {
          lastProgressTime = now
          const downloadedMB = (receivedBytes / 1024 / 1024).toFixed(1)
          const percent = contentLength > 0 ? Math.round((receivedBytes / contentLength) * 90) : -1
          sendProgress(percent, downloadedMB, totalMB, 'downloading')
        }
      }

      logger.info(`[feishu-cli] Downloaded ${(receivedBytes / 1024 / 1024).toFixed(1)} MB`)

      // 3. Extract tarball and install binary
      sendProgress(92, (receivedBytes / 1024 / 1024).toFixed(1), totalMB, 'extracting')

      // Write tarball to a temp dir, extract with tar
      const extractDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'feishu-cli-'))
      const tarPath = path.join(extractDir, assetName)
      const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)))
      fs.writeFileSync(tarPath, buffer)

      const { execFile: execFileCb } = require('child_process')
      const { promisify } = require('util')
      const execFileAsync = promisify(execFileCb)

      await execFileAsync('tar', ['xzf', tarPath, '-C', extractDir])

      // Find the binary in extracted files (may be nested in a subdirectory)
      let extractedBin = path.join(extractDir, 'feishu-cli')
      if (!fs.existsSync(extractedBin)) {
        // Check inside subdirectory: archive structure is <assetBase>/feishu-cli
        const assetBase = assetName.replace('.tar.gz', '')
        extractedBin = path.join(extractDir, assetBase, 'feishu-cli')
      }
      if (!fs.existsSync(extractedBin)) {
        // Last resort: recursive search
        const findBin = (dir: string): string | null => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            if (entry.isFile() && entry.name === 'feishu-cli') return full
            if (entry.isDirectory()) { const r = findBin(full); if (r) return r }
          }
          return null
        }
        const found = findBin(extractDir)
        if (found) extractedBin = found
      }
      if (!fs.existsSync(extractedBin)) {
        logger.error(`[feishu-cli] Binary not found in archive. Contents: ${fs.readdirSync(extractDir)}`)
        fs.rmSync(extractDir, { recursive: true, force: true })
        return { success: false, error: 'Binary not found in archive', path: '' }
      }

      // 4. Move to install dir
      sendProgress(96, '0', '0', 'installing')
      if (!fs.existsSync(installDir)) {
        fs.mkdirSync(installDir, { recursive: true })
      }
      fs.copyFileSync(extractedBin, installPath)
      fs.chmodSync(installPath, 0o755)

      // Clean up temp
      fs.rmSync(extractDir, { recursive: true, force: true })

      sendProgress(100, '0', '0', 'done')
      logger.info(`[feishu-cli] Installed successfully at ${installPath}`)

      // Reset cache in feishu-tools service
      try {
        const { resetFeishuCliCache } = require('../services/feishu-tools.service')
        resetFeishuCliCache()
      } catch { /* ignore */ }

      return { success: true, error: '', path: installPath }
    } catch (err: any) {
      logger.error(`[feishu-cli] Install failed: ${err.message}`)
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
