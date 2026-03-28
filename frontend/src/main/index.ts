import log from 'electron-log/main'
log.initialize()

import { app, BrowserWindow, nativeImage, shell } from 'electron'
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

/**
 * 处理自定义协议 URL
 */
function handleProtocolUrl(url: string): void {
  logger.info(`Received protocol URL: ${url}`)

  if (url.startsWith(`${PROTOCOL}://auth/callback`)) {
    const mainWindow = getMainWindow()
    handleProtocolCallback(url, mainWindow?.webContents).catch((err) => {
      logger.error('Failed to handle protocol callback:', err)
    })

    // 聚焦窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  }
}

function createWindow(): BrowserWindow {
  const iconPath = join(__dirname, '../../resources/icon.png')
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
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
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
    const dockIcon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
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
    // On macOS re-create a window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
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

  // 聚焦主窗口
  const mainWindow = getMainWindow()
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  // On macOS, apps typically stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  unregisterGlobalShortcuts()
})
