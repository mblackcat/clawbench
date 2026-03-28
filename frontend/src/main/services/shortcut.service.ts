import { globalShortcut, BrowserWindow, Notification } from 'electron'
import { randomUUID } from 'crypto'
import { settingsStore } from '../store/settings.store'
import { listSubApps } from './subapp.service'
import { executeSubApp } from './python-runner.service'
import { getActiveWorkspace } from './workspace.service'
import { getPythonSdkPath } from '../utils/paths'
import * as logger from '../utils/logger'

/** Currently registered accelerator strings so we can unregister them later. */
let registeredAccelerators: string[] = []

/**
 * Returns the main BrowserWindow (first window), or null.
 */
function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}

/**
 * Handles a global shortcut trigger for the given 1-based index.
 */
function handleShortcutTrigger(index: number): void {
  let userApps = listSubApps().filter((a) => a.source === 'user')

  // Sort by persisted appOrder so shortcut numbers match the UI
  const appOrder = (settingsStore.get('appOrder') ?? []) as string[]
  if (appOrder.length > 0) {
    const orderMap = new Map(appOrder.map((id, i) => [id, i]))
    userApps.sort((a, b) => {
      const ia = orderMap.get(a.id) ?? Infinity
      const ib = orderMap.get(b.id) ?? Infinity
      return ia - ib
    })
  }

  if (index > userApps.length) return

  const appInfo = userApps[index - 1]
  const manifest = appInfo.manifest
  const win = getMainWindow()

  if (!win) {
    // No window available (macOS: all windows closed but app still running).
    // Don't try to recreate — just notify the user.
    if (Notification.isSupported()) {
      new Notification({
        title: manifest.name,
        body: '请先打开应用窗口'
      }).show()
    }
    return
  }

  // If app needs params or confirm_before_run, bring window to front
  const hasParams = manifest.params && (manifest.params as unknown[]).length > 0
  if (hasParams || manifest.confirm_before_run) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (Notification.isSupported()) {
      new Notification({
        title: manifest.name,
        body: '需要配置参数，请在应用界面中操作'
      }).show()
    }
    return
  }

  // Execute directly with empty params
  const workspace = getActiveWorkspace()
  if (!workspace) {
    logger.warn('Global shortcut: no active workspace')
    if (Notification.isSupported()) {
      new Notification({
        title: manifest.name,
        body: '请先选择一个工作区'
      }).show()
    }
    return
  }

  const taskId = randomUUID()
  const pythonPath = (settingsStore.get('pythonPath') as string) || 'python3'
  const sdkPath = getPythonSdkPath()

  executeSubApp(
    taskId,
    manifest.name,
    appInfo.path,
    manifest.entry,
    {},
    workspace,
    pythonPath,
    sdkPath,
    win.webContents
  )

  // Notify renderer about the new task
  win.webContents.send('subapp:task-started', {
    taskId,
    appId: manifest.id,
    appName: manifest.name
  })

  // OS notification
  if (Notification.isSupported()) {
    new Notification({
      title: manifest.name,
      body: '应用已启动'
    }).show()
  }

  logger.info(`Global shortcut triggered: ${manifest.name} (taskId: ${taskId})`)
}

/**
 * Registers global shortcuts based on current settings.
 */
export function registerGlobalShortcuts(): void {
  const enabled = settingsStore.get('appShortcutEnabled') ?? true
  if (!enabled) return

  const modifier = settingsStore.get('appShortcutModifier') ?? 'Control+Shift'

  for (let i = 1; i <= 9; i++) {
    const accelerator = `${modifier}+${i}`
    try {
      const digit = i
      const ok = globalShortcut.register(accelerator, () => {
        handleShortcutTrigger(digit)
      })
      if (ok) {
        registeredAccelerators.push(accelerator)
      } else {
        logger.warn(`Failed to register global shortcut: ${accelerator}`)
      }
    } catch (err) {
      logger.warn(`Error registering global shortcut ${accelerator}:`, err)
    }
  }

  logger.info(`Global shortcuts registered with modifier: ${modifier}`)
}

/**
 * Unregisters all previously registered shortcuts and re-registers them.
 * Call after shortcut settings change.
 */
export function refreshGlobalShortcuts(): void {
  unregisterGlobalShortcuts()
  registerGlobalShortcuts()
}

/**
 * Unregisters all global shortcuts registered by this module.
 */
export function unregisterGlobalShortcuts(): void {
  for (const accel of registeredAccelerators) {
    try {
      globalShortcut.unregister(accel)
    } catch {
      // ignore
    }
  }
  registeredAccelerators = []
}
