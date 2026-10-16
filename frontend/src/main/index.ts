import log from 'electron-log/main'
log.initialize()

import { app, BrowserWindow, nativeImage, nativeTheme, shell } from 'electron'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerAllIpcHandlers } from './ipc'
import {
  handleProtocolUrl as routeProtocolUrl,
  isProtocolSilent,
  redactProtocolUrl,
  setProtocolWindowProvider
} from './services/protocol'
import { initAutoUpdater, checkForUpdates } from './services/updater.service'
import {
  registerGlobalShortcuts,
  unregisterGlobalShortcuts
} from './services/shortcut.service'
import { settingsStore } from './store/settings.store'
import * as logger from './utils/logger'
import { migrateSettings, scheduleEnvAutoDetect } from './utils/migrate-settings'
import { resolveWindowBackground } from './utils/window-background'
import { initScheduler } from './services/scheduled-task.service'
import { initAppScheduler } from './services/app-schedule.service'
import { startMemoryUpdater } from './services/memory-updater.service'
import { flushPendingUsageEvents } from './services/usage-tracking.service'
import { seedBuiltinApps } from './services/builtin-apps.service'
import { initWorkbenchVenvInBackground } from './services/python-venv.service'
import { warmProjectCommonAppsCache } from './services/project.service'
import {
  createAppTray,
  destroyAppTray,
  setIsQuitting,
  getIsQuitting
} from './services/tray-attention.service'
import { setMainWindowGetter as setFeishuWatcherMainWindow } from './services/copiper-feishu-watcher.service'
import { closeAllSDKSessions } from './services/sdk-session-manager.service'
import { closeAllCodexSessions } from './services/codex-session-manager.service'
import { killAllPtySessions } from './services/pty-manager.service'

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

/** First `clawbench://` URL in an argv list (Windows/Linux pass it as an argument). */
function extractProtocolUrl(args: string[]): string | undefined {
  for (const raw of args) {
    if (typeof raw !== 'string') continue
    const clean = raw.trim().replace(/^["']|["']$/g, '').trim()
    if (clean.startsWith(`${PROTOCOL}://`)) return clean
  }
  return undefined
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
  setIsQuitting(true)
  app.quit()
}

/**
 * 处理自定义协议 URL
 */
function handleProtocolUrl(url: string): void {
  // Never let a malformed / hostile URL break startup or the event loop.
  try {
    logger.info(`Received protocol URL: ${redactProtocolUrl(url)}`)

    if (!app.isReady()) {
      app.whenReady().then(() => handleProtocolUrl(url))
      return
    }

    // Let the renderer finish loading first so pushed events (task-started,
    // protocol:install-app, auth results) have a listener.
    const win = getMainWindow()
    if (win && !win.isDestroyed() && win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => handleProtocolUrl(url))
      return
    }

    // Routed through the protocol command registry (app / auth / install).
    routeProtocolUrl(url).catch((err) => {
      logger.error('Failed to handle protocol URL:', err)
    })
  } catch (err) {
    logger.error('Failed to handle protocol URL:', err)
  }
}

/** Silent flag of a cold-start protocol URL; any parse problem means "not silent". */
function isColdStartSilent(url: string | undefined): boolean {
  if (!url) return false
  try {
    return isProtocolSilent(url)
  } catch (err) {
    logger.warn('Failed to read silent flag from protocol URL:', err)
    return false
  }
}

function createWindow(options?: { showOnReady?: boolean }): BrowserWindow {
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
    backgroundColor: resolveWindowBackground(savedTheme, nativeTheme.shouldUseDarkColors),
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

  // A silent protocol launch (clawbench://...&silent=true) keeps the window hidden.
  const showOnReady = options?.showOnReady ?? true
  mainWindow.on('ready-to-show', () => {
    if (showOnReady) mainWindow.show()
  })

  mainWindow.on('close', (event) => {
    if (!getIsQuitting()) {
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

  // Seed bundled builtin template apps into user-apps (no-op when none bundled)
  try {
    seedBuiltinApps()
  } catch (err) {
    logger.warn('Failed to seed builtin apps:', err)
  }

  // Set app user model id for Windows
  electronApp.setAppUserModelId('com.lizhistudio.clawbench')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setProtocolWindowProvider({ getMainWindow, showMainWindow })

  // Cold start launched by a protocol URL (Windows/Linux pass it in argv)
  let coldStartProtocolUrl: string | undefined
  try {
    coldStartProtocolUrl = extractProtocolUrl(process.argv)
  } catch (err) {
    logger.warn('Failed to read protocol URL from argv:', err)
  }
  const isColdSilent = isColdStartSilent(coldStartProtocolUrl)

  const firstWindow = createWindow({ showOnReady: !isColdSilent })
  // One-time terminal/IDE detection shells out synchronously — keep it off the
  // startup path and run it once the window has painted.
  firstWindow.once('ready-to-show', () => scheduleEnvAutoDetect())
  createAppTray({ onQuit: quitApplication })
  registerAllIpcHandlers()
  if (coldStartProtocolUrl) {
    handleProtocolUrl(coldStartProtocolUrl)
  }
  setFeishuWatcherMainWindow(() => getMainWindow())
  registerGlobalShortcuts()
  // Warm project common-apps cache so disabled builtins stay hidden for shortcuts
  warmProjectCommonAppsCache().catch((err) =>
    logger.warn('Failed to warm project common-apps cache:', err)
  )
  initAutoUpdater()
  initScheduler()
  initAppScheduler()
  // Long-term memory self-update (skipped when assistant master switch is off)
  startMemoryUpdater()

  // Check for updates 8 seconds after startup to avoid slowing down launch
  setTimeout(() => {
    checkForUpdates().catch(() => {
      // Silently ignore startup check errors (dev mode, unsigned build, network, etc.)
    })
  }, 8000)

  // Retry any execution reports that failed to upload last session (no-op if not logged in)
  flushPendingUsageEvents().catch((err) => {
    logger.warn('Failed to flush pending usage events:', err)
  })

  // Prepare the dedicated workbench Python venv in the background if needed
  initWorkbenchVenvInBackground()

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
  // A protocol URL is routed (the router shows the window unless silent);
  // a plain relaunch (double-click) just shows and focuses the window.
  const protocolUrl = extractProtocolUrl(argv)
  if (protocolUrl) {
    handleProtocolUrl(protocolUrl)
  } else {
    showMainWindow()
  }
})

app.on('window-all-closed', () => {
  // Keep the app alive in the system tray until the user explicitly exits.
})

app.on('before-quit', () => {
  setIsQuitting(true)
  // AI Coding: close Claude SDK / Codex app-server sessions so their child
  // processes (MCP servers etc.) don't outlive the app.
  closeAllSDKSessions()
  closeAllCodexSessions()
  // Electron does not reap child processes on exit: kill every PTY session
  // tree (AI Coding / AI Terminal) while the event loop is still up.
  killAllPtySessions()
})

app.on('will-quit', () => {
  destroyAppTray()
  unregisterGlobalShortcuts()
})
