import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import * as logger from '../utils/logger'
import { getSetting } from '../store/settings.store'

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:3001/api/v1'

const UPDATE_URL = `${API_BASE_URL.replace(/\/$/, '')}/releases`

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}

function send(channel: string, data?: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

let initialized = false

export function initAutoUpdater(): void {
  if (is.dev) {
    logger.info('Auto-updater: disabled in development mode')
    return
  }
  if (initialized) return
  initialized = true

  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_URL })
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowDowngrade = false
    // Wire electron-updater's internal logger to ours for diagnostics
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    autoUpdater.logger = logger as any
    // Disable code-signature verification for unsigned/ad-hoc builds.
    // Each ad-hoc build has a different signing identity so cross-build
    // verification always fails. Safe for internal/self-hosted distribution.
    if (process.platform === 'darwin') {
      ;(autoUpdater as unknown as { verifyUpdateCodeSignature: boolean }).verifyUpdateCodeSignature = false
    }

    autoUpdater.on('checking-for-update', () => {
      logger.info('Auto-updater: checking for update')
      send('updater:checking')
    })

    autoUpdater.on('update-available', (info) => {
      logger.info(`Auto-updater: update available — v${info.version}`)
      send('updater:available', { version: info.version, releaseDate: info.releaseDate })
    })

    autoUpdater.on('update-not-available', () => {
      logger.info('Auto-updater: up to date')
      send('updater:not-available')
    })

    autoUpdater.on('download-progress', (progress) => {
      send('updater:progress', { percent: Math.round(progress.percent) })
    })

    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`Auto-updater: update downloaded — v${info.version}`)
      send('updater:downloaded', { version: info.version })
    })

    autoUpdater.on('error', (err) => {
      logger.error('Auto-updater error:', err.message)
      send('updater:error', { message: err.message })
    })

    logger.info(`Auto-updater: initialized, feed URL: ${UPDATE_URL}`)
  } catch (err) {
    logger.error('Auto-updater: initialization failed', err)
  }
}

export async function checkForUpdates(): Promise<void> {
  if (is.dev) {
    throw new Error('Auto-updater is not available in development mode')
  }
  const autoUpdate = getSetting('autoUpdate')
  if (!autoUpdate) {
    throw new Error('Auto-update is disabled in settings')
  }
  await autoUpdater.checkForUpdates()
}

/**
 * Manual check — always allowed regardless of autoUpdate setting.
 */
export async function manualCheckForUpdates(): Promise<void> {
  if (is.dev) {
    throw new Error('Auto-updater is not available in development mode')
  }
  await autoUpdater.checkForUpdates()
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
