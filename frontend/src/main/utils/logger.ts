import log from 'electron-log/main'
import { BrowserWindow } from 'electron'

// 日志文件大小上限 5MB，保留 3 个旧文件
log.transports.file.maxSize = 5 * 1024 * 1024
log.transports.file.rotationFormat = '{yyyy}-{mm}-{dd}_{index}'

// Forward [module] tagged logs to renderer for the Logs panel
function forwardToRenderer(level: string, args: unknown[]): void {
  const msg = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ')
  // Only forward logs with a [module] prefix to avoid noise
  if (!msg.startsWith('[')) return
  const entry = { level, message: msg, timestamp: Date.now() }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('system:log', entry)
    }
  }
}

export function info(...args: unknown[]): void {
  log.info(...args)
  forwardToRenderer('info', args)
}
export function warn(...args: unknown[]): void {
  log.warn(...args)
  forwardToRenderer('warn', args)
}
export function error(...args: unknown[]): void {
  log.error(...args)
  forwardToRenderer('error', args)
}
export function debug(...args: unknown[]): void {
  log.debug(...args)
}
