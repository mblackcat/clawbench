import { BrowserWindow, Menu, Tray, nativeImage, app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import * as logger from '../utils/logger'

let tray: Tray | null = null
let baseIcon: Electron.NativeImage | null = null
let flashIcon: Electron.NativeImage | null = null
let flashTimer: ReturnType<typeof setInterval> | null = null
let flashPhase = false
let currentState: { flash: boolean; hasDot: boolean } = { flash: false, hasDot: false }
let isQuitting = false

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

function createBaseIcon(): Electron.NativeImage {
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

/** Semi-transparent / inverted-ish icon for flash off-phase */
function createFlashIcon(base: Electron.NativeImage): Electron.NativeImage {
  try {
    const size = base.getSize()
    const w = Math.max(size.width || 16, 16)
    const h = Math.max(size.height || 16, 16)
    // Simple solid accent square as alternate frame (visible blink on all platforms)
    const canvas = Buffer.alloc(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      // Red-ish badge color
      canvas[o] = 230
      canvas[o + 1] = 60
      canvas[o + 2] = 60
      canvas[o + 3] = flashPhase ? 255 : 80
    }
    // Prefer compositing: use empty/dimmed base when available
    if (!base.isEmpty()) {
      // Alternate between full icon and a slightly smaller/dim copy
      return flashPhase ? base : base.resize({ width: Math.max(1, Math.floor(w * 0.85)), height: Math.max(1, Math.floor(h * 0.85)) })
    }
    return nativeImage.createFromBuffer(canvas, { width: w, height: h })
  } catch {
    return base
  }
}

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}

function showMainWindow(): BrowserWindow {
  let mainWindow = getMainWindow()

  if (!mainWindow) {
    // Window creation is owned by index.ts; fall back to first available later
    const windows = BrowserWindow.getAllWindows()
    mainWindow = windows[0] ?? null
  }

  if (!mainWindow) {
    throw new Error('No main window available')
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

function updateTooltip(): void {
  if (!tray) return
  if (currentState.flash) {
    tray.setToolTip('ClawBench — 需要确认')
  } else if (currentState.hasDot) {
    tray.setToolTip('ClawBench — 有新提醒')
  } else {
    tray.setToolTip('ClawBench')
  }
}

function stopFlash(): void {
  if (flashTimer) {
    clearInterval(flashTimer)
    flashTimer = null
  }
  flashPhase = false
  if (tray && baseIcon && !baseIcon.isEmpty()) {
    tray.setImage(baseIcon)
  }
  // Stop taskbar flash
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.flashFrame(false)
  }
}

function startFlash(): void {
  if (flashTimer || !tray || !baseIcon) return

  flashPhase = false
  flashTimer = setInterval(() => {
    if (!tray || !baseIcon) return
    flashPhase = !flashPhase
    try {
      tray.setImage(createFlashIcon(baseIcon))
    } catch {
      // ignore icon swap errors
    }
  }, 500)

  // Flash Windows taskbar / macOS attention
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.bounce('informational')
    } else {
      win.flashFrame(true)
    }
  }
}

/**
 * Update tray attention visuals. Called from renderer via IPC.
 */
export function setTrayAttentionState(state: { flash: boolean; hasDot: boolean }): void {
  currentState = state
  updateTooltip()

  if (state.flash) {
    startFlash()
  } else {
    stopFlash()
  }
}

/**
 * Handle left-click: show window; if there is any attention, ask renderer to open first.
 */
function onTrayActivate(): void {
  try {
    const win = showMainWindow()
    if (currentState.flash || currentState.hasDot) {
      if (!win.webContents.isDestroyed()) {
        win.webContents.send('attention:activate-first')
      }
    }
  } catch (err) {
    logger.warn('Tray activate failed:', err)
  }
}

export function createAppTray(options: {
  onQuit: () => void
}): Tray {
  if (tray) return tray

  baseIcon = createBaseIcon()
  if (baseIcon.isEmpty()) {
    logger.warn('Tray icon is empty; check packaged resources.')
  }
  flashIcon = createFlashIcon(baseIcon)

  tray = new Tray(baseIcon.isEmpty() ? nativeImage.createEmpty() : baseIcon)
  tray.setToolTip('ClawBench')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开界面',
        click: () => {
          try {
            showMainWindow()
          } catch (err) {
            logger.warn('Show main window failed:', err)
          }
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          options.onQuit()
        }
      }
    ])
  )

  // Left click: open + jump to first attention when any
  tray.on('click', () => onTrayActivate())
  tray.on('double-click', () => onTrayActivate())

  return tray
}

export function destroyAppTray(): void {
  stopFlash()
  tray?.destroy()
  tray = null
  baseIcon = null
  flashIcon = null
}

export function getIsQuitting(): boolean {
  return isQuitting
}

export function setIsQuitting(value: boolean): void {
  isQuitting = value
}

export function getTray(): Tray | null {
  return tray
}
