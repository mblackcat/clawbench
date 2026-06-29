import log from 'electron-log/main'
log.initialize()

import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from 'electron'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerAllIpcHandlers } from './ipc'
import { handleProtocolCallback } from './services/auth.service'
import { initAutoUpdater, checkForUpdates } from './services/updater.service'
import {
  registerGlobalShortcuts,
  unregisterGlobalShortcuts
} from './services/shortcut.service'
import { settingsStore } from './store/settings.store'
import * as logger from './utils/logger'
import { migrateSettings } from './utils/migrate-settings'
import { initScheduler } from './services/scheduled-task.service'

const PROTOCOL = 'clawbench'
let tray: Tray | null = null
let isQuitting = false

// 注册自定义协议（必须在 app.ready 之前调用）
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    // Dev mode: resolve to absolute path so that Windows protocol handler
    // works correctly regardless of the launching working directory.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

// Windows/Linux: 确保单实例，第二个实例的参数通过 second-instance 事件传递
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
}

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}

function getResourcePath(fileName: string): string {
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'resources', fileName),
        join(process.resourcesPath, fileName),
        join(__dirname, '../../resources', fileName)
      ]
    : [
        join(__dirname, '../../resources', fileName),
        join(app.getAppPath(), 'resources', fileName)
      ]

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

function createTrayIcon(): Electron.NativeImage {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  let trayIcon = nativeImage.createFromPath(getResourcePath(iconFile))

  if (trayIcon.isEmpty() && iconFile !== 'icon.png') {
    trayIcon = nativeImage.createFromPath(getResourcePath('icon.png'))
  }

  if (process.platform === 'darwin') {
    return trayIcon.resize({ width: 18, height: 18 })
  }

  if (process.platform === 'win32') {
    return trayIcon
  }

  return trayIcon.resize({ width: 16, height: 16 })
}

function showMainWindow(): BrowserWindow {
  let mainWindow = getMainWindow()

  if (!mainWindow) {
    mainWindow = createWindow()
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }

  mainWindow.focus()

  return mainWindow
}

function quitApplication(): void {
  isQuitting = true
  app.quit()
}

function createTray(): void {
  if (tray) {
    return
  }

  const trayIcon = createTrayIcon()

  if (trayIcon.isEmpty()) {
    logger.warn('Tray icon is empty; check packaged resources.')
  }

  tray = new Tray(trayIcon)
  tray.setToolTip('ClawBench')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开界面',
        click: () => showMainWindow()
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => quitApplication()
      }
    ])
  )
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

/**
 * 处理自定义协议 URL
 */
function handleProtocolUrl(url: string): void {
  logger.info(`Received protocol URL: ${url}`)

  if (!app.isReady()) {
    app.whenReady().then(() => handleProtocolUrl(url))
    return
  }

  if (url.startsWith(`${PROTOCOL}://auth/callback`)) {
    const mainWindow = showMainWindow()
    handleProtocolCallback(url, mainWindow.webContents).catch((err) => {
      logger.error('Failed to handle protocol callback:', err)
    })
  }

  // Handle install protocol: clawbench://install/{appId}?name=...
  if (url.startsWith(`${PROTOCOL}://install/`)) {
    try {
      const urlObj = new URL(url)
      const pathParts = urlObj.pathname.replace(/^\/\//, '').split('/')
      const appId = decodeURIComponent(pathParts[1] || '')
      const appName = urlObj.searchParams.get('name') || appId

      if (appId) {
        const mainWindow = showMainWindow()
        mainWindow.webContents.send('protocol:install-app', { appId, name: appName })
        logger.info(`Protocol install: appId=${appId}, name=${appName}`)
      }
    } catch (err) {
      logger.error('Failed to parse install protocol URL:', err)
    }
  }
}

function createWindow(): BrowserWindow {
  const iconPath = getResourcePath('icon.png')
  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'

  const savedTheme = settingsStore.get('theme') as string || 'dark'

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    // 根据用户主题设置窗口底色，避免路由切换白屏闪烁
    backgroundColor: savedTheme === 'light' ? '#F5F6F8' : '#17171A',
    // macOS: 隐藏标题栏但保留红绿灯按钮（内嵌到内容区）
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : {}),
    // Windows: 完全无框，自定义窗口控制按钮
    ...(isWin ? { frame: false } : {}),
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Preload only touches contextBridge/ipcRenderer, so the renderer can run sandboxed
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  // Open external links in the default browser (http/https only — never
  // file:// or custom protocols, which could execute local content)
  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const protocol = new URL(details.url).protocol
      if (protocol === 'http:' || protocol === 'https:') {
        shell.openExternal(details.url)
      } else {
        logger.warn(`Blocked window.open to non-http(s) URL: ${details.url}`)
      }
    } catch {
      logger.warn(`Blocked window.open to unparseable URL: ${details.url}`)
    }
    return { action: 'deny' }
  })

  // Load the renderer: dev server URL in development, built files in production
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Open DevTools in development mode
  if (is.dev) {
    mainWindow.webContents.openDevTools()
  }

  return mainWindow
}

app.whenReady().then(() => {
  logger.info('Application starting...')

  // 设置 macOS Dock 图标
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(getResourcePath('icon.png'))
    app.dock.setIcon(dockIcon)
  }

  // 迁移旧设置
  migrateSettings()

  // Set app user model id for Windows
  electronApp.setAppUserModelId('com.lizhistudio.clawbench')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  createTray()
  registerAllIpcHandlers()
  registerGlobalShortcuts()
  initAutoUpdater()
  initScheduler()

  // Check for updates 8 seconds after startup to avoid slowing down launch
  setTimeout(() => {
    checkForUpdates().catch(() => {
      // Silently ignore startup check errors (dev mode, unsigned build, network, etc.)
    })
  }, 8000)

  logger.info('Application ready')

  app.on('activate', () => {
    showMainWindow()
  })
})

// macOS: 处理自定义协议 URL（通过 open-url 事件）
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleProtocolUrl(url)
})

// Windows/Linux: 第二个实例启动时，从 argv 中提取协议 URL
app.on('second-instance', (_event, argv) => {
  // Windows 上协议 URL 会作为最后一个参数传入
  const protocolUrl = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))
  if (protocolUrl) {
    handleProtocolUrl(protocolUrl)
  }

  showMainWindow()
})

app.on('window-all-closed', () => {
  // Keep the app alive in the system tray until the user explicitly exits.
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  tray?.destroy()
  tray = null
  unregisterGlobalShortcuts()
})
