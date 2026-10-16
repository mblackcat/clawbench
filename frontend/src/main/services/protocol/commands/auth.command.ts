import type { ProtocolCommandConfig, ProtocolExecutionContext, ProtocolExecutionResult } from '../types'
import { handleProtocolCallback } from '../../auth.service'
import { mainT } from '../../../utils/i18n'

/**
 * OAuth login callback: clawbench://auth/callback?code=...&state=...
 */
export const authCommand: ProtocolCommandConfig = {
  name: 'auth',
  aliases: ['oauth'],
  description: 'Handle the Feishu / third-party OAuth login callback',
  defaultSilent: false,
  handler: async (ctx: ProtocolExecutionContext): Promise<ProtocolExecutionResult> => {
    const win = ctx.showMainWindow()
    ctx.log('info', 'Handling OAuth callback protocol request')

    try {
      await handleProtocolCallback(ctx.request.rawUrl, win.webContents)
      ctx.log('info', 'OAuth protocol callback processed successfully')
      return { success: true, message: 'OAuth callback handled' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.log('error', 'Failed to handle protocol callback:', msg)
      ctx.notify(mainT('protocol.authCallbackFailed', msg), { type: 'error' })
      return { success: false, error: msg }
    }
  }
}
