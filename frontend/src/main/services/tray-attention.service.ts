import { BrowserWindow, Menu, Tray, nativeImage, app, Notification } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import * as logger from '../utils/logger'
import { mainT } from '../utils/i18n'
import { isAttentionSystemNotificationEnabled } from '../store/settings.store'

export interface TrayAttentionItem {
  id: string
  kind: 'completion' | 'action'
  source: 'workbench' | 'ai-chat' | 'ai-coding'
  targetId?: string
  workspaceId?: string
  workspaceName?: string
  sessionTitle?: string
  title: string
  body?: string
}

export interface TrayAttentionPayload {
  flash: boolean
  hasDot: boolean
  /** Pending alerts, listed in the tray context menu. */
  items?: TrayAttentionItem[]
  /** Set when a new alert was just raised: shown as an OS notification. */
  balloon?: { title: string; content: string }
}

const APP_NAME = 'ClawBench'

let tray: Tray | null = null
let baseIcon: Electron.NativeImage | null = null
let dotIcon: Electron.NativeImage | null = null
let flashIcon: Electron.NativeImage | null = null
let flashTimer: ReturnType<typeof setInterval> | null = null
let flashPhase = false
let currentState: { flash: boolean; hasDot: boolean } = { flash: false, hasDot: false }
let currentItems: TrayAttentionItem[] = []
// Avoid redundant native calls: setImage / setToolTip / setContextMenu are only
// issued when what they show actually changes.
let lastAppliedIconType: 'base' | 'dot' | 'flash' | null = null
let lastTooltip = ''
let lastMenuKey: string | null = null
let trayOptions: { onQuit: () => void } | null = null
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
    // A multi-size .ico would otherwise hand the tray its largest frame;
    // 32px keeps it crisp at 200% scaling and gives the dot overlay room.
    return trayIcon.resize({ width: 32, height: 32 })
  }

  return trayIcon.resize({ width: 16, height: 16 })
}

/** Base icon with a small red badge in the top-right corner ("has alerts"). */
function createDotIcon(base: Electron.NativeImage): Electron.NativeImage {
  try {
    if (base.isEmpty()) return base
    const { width: w, height: h } = base.getSize()
    const raw = base.toBitmap()
    if (!raw || raw.length !== w * h * 4) return base
    const bitmap = Buffer.from(raw)
    const r = Math.max(2, Math.round(w * 0.16))
    const cx = w - r
    const cy = Math.max(1, Math.round(r * 0.6))
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const distSq = (x - cx) * (x - cx) + (y - cy) * (y - cy)
        const idx = (y * w + x) * 4
        if (distSq <= r * r) {
          // #ff4d4f — toBitmap() is Skia N32 = BGRA on every desktop platform
          bitmap[idx] = 79
          bitmap[idx + 1] = 77
          bitmap[idx + 2] = 255
          bitmap[idx + 3] = 255
        } else if (distSq <= (r + 1.2) * (r + 1.2)) {
          // 1px light ring for contrast on dark trays
          bitmap[idx] = 255
          bitmap[idx + 1] = 255
          bitmap[idx + 2] = 255
          bitmap[idx + 3] = 240
        }
      }
    }
    return nativeImage.createFromBitmap(bitmap, { width: w, height: h })
  } catch (err) {
    logger.warn('Failed to create tray dot icon:', err)
    return base
  }
}

/**
 * Flash frames alternate between the dotted and the plain icon (same
 * dimensions, so the tray slot never jumps). Falls back to a translucent red
 * square when no icon could be loaded.
 */
function createFlashIcon(base: Electron.NativeImage): Electron.NativeImage {
  try {
    if (dotIcon && !dotIcon.isEmpty() && dotIcon !== base && !base.isEmpty()) {
      return flashPhase ? dotIcon : base
    }
    const size = base.getSize()
    const w = Math.max(size.width || 16, 16)
    const h = Math.max(size.height || 16, 16)
    const canvas = Buffer.alloc(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      canvas[o] = 79
      canvas[o + 1] = 77
      canvas[o + 2] = 255
      canvas[o + 3] = flashPhase ? 255 : 80
    }
    return nativeImage.createFromBitmap(canvas, { width: w, height: h })
  } catch {
    return base
  }
}

function truncateLabel(text: string, maxLength = 32): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= maxLength) return trimmed
  return trimmed.slice(0, maxLength - 1) + '…'
}

/**
 * OS notification for a freshly raised alert. Skipped when the user turned it
 * off in Settings, or when the app window is focused (the in-app dots, tab
 * glow and tray already cover that case).
 */
function showAttentionNotification(title: string, content: string): void {
  if (!isAttentionSystemNotificationEnabled()) return
  const win = getMainWindow()
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return

  const notifTitle = title || APP_NAME
  const notifBody = content || mainT('tray.notifyDefaultBody')
  try {
    if (Notification.isSupported()) {
      const notif = new Notification({ title: notifTitle, body: notifBody, silent: false })
      notif.on('click', () => onTrayActivate())
      notif.show()
      return
    }
  } catch (err) {
    logger.warn('OS notification failed:', err)
  }
  // Older Windows without toast support: fall back to a tray balloon
  if (tray && process.platform === 'win32') {
    try {
      tray.displayBalloon({ title: notifTitle, content: notifBody, iconType: 'info' })
    } catch (err) {
      logger.warn('Tray balloon failed:', err)
    }
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
  const tip = currentState.flash
    ? `${APP_NAME} — ${mainT('tray.tooltipAction')}`
    : currentState.hasDot
      ? `${APP_NAME} — ${mainT('tray.tooltipDot')}`
      : APP_NAME
  if (tip === lastTooltip) return
  try {
    tray.setToolTip(tip)
    lastTooltip = tip
  } catch {
    // ignore tooltip failures
  }
}

function stopFlash(): void {
  if (flashTimer) {
    clearInterval(flashTimer)
    flashTimer = null
  }
  flashPhase = false
  const targetType = currentState.hasDot ? 'dot' : 'base'
  const targetImg = currentState.hasDot && dotIcon && !dotIcon.isEmpty() ? dotIcon : baseIcon
  if (tray && targetImg && !targetImg.isEmpty() && lastAppliedIconType !== targetType) {
    try {
      tray.setImage(targetImg)
      lastAppliedIconType = targetType
    } catch {
      // ignore icon set errors
    }
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
      lastAppliedIconType = 'flash'
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

function sendNavigate(target: { source: string; targetId?: string; workspaceId?: string }): void {
  try {
    const win = showMainWindow()
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('attention:navigate-to', target)
    }
  } catch (err) {
    logger.warn('Failed to navigate to attention item:', err)
  }
}

function attentionMenuLabel(item: TrayAttentionItem): string {
  if (item.source === 'ai-coding') {
    const ws = item.workspaceName || ''
    const sess = item.sessionTitle || item.title || ''
    return truncateLabel(ws && sess ? `${ws} - ${sess}` : ws || sess || item.title)
  }
  return truncateLabel(item.title)
}

function buildTrayMenu(): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: mainT('tray.open'),
      click: () => {
        try {
          showMainWindow()
        } catch (err) {
          logger.warn('Show main window failed:', err)
        }
      }
    }
  ]

  if (currentItems.length > 0) {
    template.push({ type: 'separator' })
    // Pending alerts, actions (need the user) first, each opening its target
    const ordered = [
      ...currentItems.filter((i) => i.kind === 'action'),
      ...currentItems.filter((i) => i.kind !== 'action')
    ]
    for (const item of ordered) {
      const label = attentionMenuLabel(item)
      template.push({
        label: item.kind === 'action' ? mainT('tray.itemAction', label) : label,
        click: () =>
          sendNavigate({ source: item.source, targetId: item.targetId, workspaceId: item.workspaceId })
      })
    }
  }

  template.push({ type: 'separator' })
  template.push({
    label: mainT('tray.quit'),
    click: () => {
      isQuitting = true
      trayOptions?.onQuit()
    }
  })

  return Menu.buildFromTemplate(template)
}

/**
 * Update tray attention visuals (badge, flash, context menu) and show an OS
 * notification for a newly raised alert. Called from renderer via IPC.
 */
export function setTrayAttentionState(payload: TrayAttentionPayload): void {
  const nextItems = Array.isArray(payload?.items) ? payload.items : []
  currentState = { flash: !!payload?.flash, hasDot: !!payload?.hasDot }
  currentItems = nextItems
  updateTooltip()

  const menuKey = nextItems
    .map((i) => `${i.id}:${i.kind}:${i.source}:${i.targetId || ''}:${i.workspaceName || ''}:${i.sessionTitle || ''}:${i.title}`)
    .join('|')
  if (tray && menuKey !== lastMenuKey) {
    try {
      tray.setContextMenu(buildTrayMenu())
      lastMenuKey = menuKey
    } catch (err) {
      logger.warn('Failed to update tray context menu:', err)
    }
  }

  if (currentState.flash) {
    startFlash()
  } else {
    stopFlash()
  }

  if (payload?.balloon) {
    showAttentionNotification(payload.balloon.title, payload.balloon.content)
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

  trayOptions = options
  lastTooltip = ''
  lastMenuKey = null
  baseIcon = createBaseIcon()
  if (baseIcon.isEmpty()) {
    logger.warn('Tray icon is empty; check packaged resources.')
  }
  dotIcon = createDotIcon(baseIcon)
  flashIcon = createFlashIcon(baseIcon)

  tray = new Tray(baseIcon.isEmpty() ? nativeImage.createEmpty() : baseIcon)
  lastAppliedIconType = 'base'
  updateTooltip()
  tray.setContextMenu(buildTrayMenu())
  lastMenuKey = ''

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
  dotIcon = null
  flashIcon = null
  lastAppliedIconType = null
  lastTooltip = ''
  lastMenuKey = null
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
