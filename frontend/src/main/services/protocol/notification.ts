import { Notification } from 'electron'
import { getTray } from '../tray-attention.service'
import * as logger from '../../utils/logger'
import type { ProtocolNotificationOptions, ProtocolNotificationType } from './types'

const DEFAULT_TITLE = 'ClawBench'

/** Map a notification type to the tray balloon icon type. */
function toBalloonIconType(type?: ProtocolNotificationType): 'info' | 'warning' | 'error' {
  if (type === 'error') return 'error'
  if (type === 'warn') return 'warning'
  return 'info'
}

/**
 * Show a tray / system notification for a protocol request.
 *
 * 1. Windows: tray balloon (bottom-right) when a tray exists.
 * 2. All platforms: native Electron Notification when supported.
 */
export function showProtocolNotification(
  message: string,
  options: ProtocolNotificationOptions = {}
): void {
  const title = options.title || DEFAULT_TITLE
  const type = options.type || 'info'

  try {
    const tray = getTray()
    if (tray && process.platform === 'win32') {
      tray.displayBalloon({
        iconType: toBalloonIconType(type),
        title,
        content: message
      })
    }
  } catch (err) {
    logger.debug('[Protocol] Tray displayBalloon error (safe to ignore):', err)
  }

  try {
    if (typeof Notification?.isSupported === 'function' && Notification.isSupported()) {
      new Notification({ title, body: message, silent: false }).show()
    }
  } catch (err) {
    logger.debug('[Protocol] System notification error:', err)
  }
}
