import type { ProtocolCommandConfig, ProtocolExecutionContext, ProtocolExecutionResult } from '../types'
import { mainT } from '../../../utils/i18n'

/**
 * Bring up the workbench and locate / preview an app (share links and the
 * backend landing page `/open/app/:appId`):
 *   clawbench://open-app[?id=<appId>]   (aliases: share, preview-app)
 *
 * This command NEVER runs or installs anything. The main process only shows
 * the window and stores the request; the renderer navigates to the app card
 * (installed → favorites + param drawer, not installed → Discover detail
 * drawer), where running / installing still needs the user's normal click.
 *
 * On cold start the renderer has no listener yet, so the request is kept here
 * and pulled by the renderer (`protocol:take-pending-open-app`); the
 * `protocol:open-app` event is only a nudge.
 */

export interface PendingOpenAppRequest {
  appId: string
  requestedAt: number
}

/** Same charset as manifest / marketplace application ids. */
const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function isValidOpenAppId(appId: string): boolean {
  return APP_ID_PATTERN.test(appId)
}

/** Pending lifetime: long enough for a cold start + login. */
const PENDING_TTL_MS = 10 * 60 * 1000

let pendingOpenApp: PendingOpenAppRequest | null = null

/** Take (and consume) the stored open request; expired requests are dropped. */
export function takePendingOpenApp(): PendingOpenAppRequest | null {
  const pending = pendingOpenApp
  pendingOpenApp = null
  if (!pending || Date.now() - pending.requestedAt > PENDING_TTL_MS) return null
  return pending
}

export const openAppCommand: ProtocolCommandConfig = {
  name: 'open-app',
  aliases: ['share', 'preview-app'],
  description: 'Show the workbench and preview an app (never runs it)',
  defaultSilent: false,
  handler: async (ctx: ProtocolExecutionContext): Promise<ProtocolExecutionResult> => {
    // A preview is pointless in the background: always bring the window up,
    // even when the URL says silent=true.
    let win: ReturnType<ProtocolExecutionContext['getMainWindow']> = null
    try {
      win = ctx.silent ? ctx.showMainWindow() : ctx.getMainWindow()
    } catch (err) {
      ctx.log('warn', 'Could not show main window for open-app:', err)
    }

    const appId = String(ctx.params.id || '').trim()
    if (!appId) {
      ctx.log('info', 'open-app without id: workbench shown only')
      return { success: true, message: 'Workbench shown' }
    }

    if (!isValidOpenAppId(appId)) {
      const msg = mainT('protocol.invalidAppId')
      ctx.log('warn', `Rejected open-app with malformed id (length ${appId.length})`)
      ctx.notify(msg, { type: 'error' })
      return { success: false, error: 'INVALID_APP_ID' }
    }

    pendingOpenApp = { appId, requestedAt: Date.now() }
    ctx.log('info', `Protocol open-app requested: appId=${appId}`)

    if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
      win.webContents.send('protocol:open-app', { appId })
    }

    return { success: true, message: `Open app requested: ${appId}`, data: { appId } }
  }
}
