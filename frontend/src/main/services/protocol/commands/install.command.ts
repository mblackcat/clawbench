import type { ProtocolCommandConfig, ProtocolExecutionContext, ProtocolExecutionResult } from '../types'
import { mainT } from '../../../utils/i18n'

/**
 * Show the marketplace install prompt for an app in the renderer:
 * clawbench://install/{appId}?name=...
 *
 * Only *asks* the renderer to prompt — nothing is installed without the user
 * confirming in the UI.
 */
export const installCommand: ProtocolCommandConfig = {
  name: 'install',
  aliases: ['market-install'],
  description: 'Open the install prompt for a marketplace app',
  defaultSilent: false,
  handler: async (ctx: ProtocolExecutionContext): Promise<ProtocolExecutionResult> => {
    const appId = String(ctx.params.id || '').trim()
    if (!appId) {
      const errMsg = mainT('protocol.missingAppId')
      ctx.log('error', errMsg)
      ctx.notify(errMsg, { type: 'error' })
      return { success: false, error: 'MISSING_APP_ID' }
    }

    const appName = String(ctx.params.name || appId).trim()
    ctx.log('info', `Protocol install requested: appId=${appId}, name=${appName}, silent=${ctx.silent}`)

    if (ctx.silent) {
      ctx.notify(mainT('protocol.installRequested', appName), { type: 'info' })
    }
    const win = ctx.silent ? ctx.getMainWindow() : ctx.showMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('protocol:install-app', { appId, name: appName })
    }

    return {
      success: true,
      message: `Install prompt sent for ${appId}`,
      data: { appId, name: appName }
    }
  }
}
