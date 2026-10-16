import { randomUUID } from 'crypto'
import * as os from 'os'
import { dialog } from 'electron'
import type { ProtocolCommandConfig, ProtocolExecutionContext, ProtocolExecutionResult } from '../types'
import * as subappService from '../../subapp.service'
import * as pythonRunnerService from '../../python-runner.service'
import { getActiveWorkspace } from '../../workspace.service'
import { getAllWorkspaces, type Workspace } from '../../../store/workspace.store'
import * as pathsUtils from '../../../utils/paths'
import * as marketplaceService from '../../im/marketplace.service'
import { AppDisabledError, BUILTIN_APP_ID_PREFIX, enrichBuiltinAppParams } from '../../project.service'
import { mainT } from '../../../utils/i18n'

function findInstalledApp(appId: string): subappService.SubAppInfo | undefined {
  return subappService.listSubApps().find((a) => a.manifest.id === appId || a.id === appId)
}

/**
 * Ask the user before installing (and then running) a marketplace app because
 * a URL said so. Protocol URLs can be fired by any web page, so this must never
 * happen silently — even for `silent=true` requests.
 */
async function confirmAutoInstall(ctx: ProtocolExecutionContext, appId: string): Promise<boolean> {
  try {
    const parent = ctx.getMainWindow()
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: [mainT('protocol.confirmInstallOk'), mainT('protocol.confirmCancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: mainT('protocol.confirmInstallTitle'),
      message: mainT('protocol.confirmInstallMessage', appId),
      detail: mainT('protocol.confirmInstallDetail')
    }
    const { response } =
      parent && !parent.isDestroyed()
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options)
    return response === 0
  } catch (err) {
    ctx.log('error', 'Failed to show install confirmation dialog:', err)
    return false
  }
}

/** Active workspace → first workspace → home directory. */
function resolveWorkspace(): Workspace {
  const active = getActiveWorkspace()
  if (active) return active
  const all = getAllWorkspaces()
  if (all.length > 0) return all[0]
  return {
    id: 'protocol-default-workspace',
    name: 'Home',
    path: os.homedir(),
    vcsType: 'none',
    createdAt: new Date().toISOString()
  }
}

/**
 * Launch a sub-app: clawbench://app?id=<appId>[&params={...}][&autoInstall=true][&silent=true]
 *
 * - Installed apps run directly (builtins still go through the admin kill-switch).
 * - Not installed + autoInstall: the user must confirm before it is downloaded
 *   from the marketplace and run.
 */
export const appCommand: ProtocolCommandConfig = {
  name: 'app',
  aliases: ['run-app', 'subapp', 'start-app'],
  description: 'Run an installed (or, after confirmation, marketplace) app',
  defaultSilent: false,
  handler: async (ctx: ProtocolExecutionContext): Promise<ProtocolExecutionResult> => {
    const appId = String(ctx.params.id || '').trim()
    if (!appId) {
      const errMsg = mainT('protocol.missingAppId')
      ctx.log('error', errMsg)
      ctx.notify(errMsg, { type: 'error' })
      return { success: false, error: 'MISSING_APP_ID' }
    }

    ctx.log(
      'info',
      `Handling app protocol request: id="${appId}", silent=${ctx.silent}, autoInstall=${ctx.params.autoInstall}`
    )

    let appInfo = findInstalledApp(appId)

    if (!appInfo) {
      if (!ctx.params.autoInstall) {
        const msg = mainT('protocol.appNotInstalled', appId)
        ctx.log('error', `[AppNotFound] ${msg}. Add "autoInstall=true" to offer a download.`)
        ctx.notify(msg, { type: 'error' })
        return { success: false, error: 'APP_NOT_INSTALLED' }
      }

      if (!(await confirmAutoInstall(ctx, appId))) {
        ctx.log('info', `User declined protocol auto-install of ${appId}`)
        return { success: false, error: 'USER_CANCELLED' }
      }

      ctx.log('info', `App "${appId}" not found locally; installing from marketplace...`)
      if (ctx.silent) ctx.notify(mainT('protocol.installing', appId), { type: 'info' })

      const installResult = await marketplaceService.installMarketApp(appId)
      if (!installResult.success) {
        const failMsg = mainT('protocol.autoInstallFailed', installResult.error || appId)
        ctx.log('error', failMsg)
        ctx.notify(failMsg, { type: 'error' })
        return { success: false, error: installResult.error || 'AUTO_INSTALL_FAILED' }
      }

      appInfo = findInstalledApp(appId)
      if (!appInfo) {
        const errorMsg = mainT('protocol.appMissingAfterInstall', appId)
        ctx.log('error', errorMsg)
        ctx.notify(errorMsg, { type: 'error' })
        return { success: false, error: 'APP_NOT_FOUND_AFTER_INSTALL' }
      }
      ctx.log('info', `Installed app: ${appInfo.manifest.name} (${appId})`)
    }

    const manifest = appInfo.manifest
    // Skills / prompts / links are not runnable.
    if (manifest.type && manifest.type !== 'app') {
      const msg = mainT('protocol.notRunnable', manifest.name)
      ctx.log('error', msg)
      ctx.notify(msg, { type: 'error' })
      return { success: false, error: 'NOT_RUNNABLE' }
    }
    ctx.log('info', `Found app to launch: "${manifest.name}" (${manifest.id}) v${manifest.version}`)

    const rawParams = ctx.params.appParams ?? {}
    let runParams: Record<string, unknown> =
      typeof rawParams === 'object' && rawParams !== null ? (rawParams as Record<string, unknown>) : {}

    // Builtins honor the admin kill-switch exactly like an in-app run.
    if (manifest.id.startsWith(BUILTIN_APP_ID_PREFIX)) {
      try {
        runParams = await enrichBuiltinAppParams(manifest.id, manifest.name, runParams)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        ctx.log('error', `Builtin app ${manifest.id} blocked: ${msg}`)
        ctx.notify(msg, { type: 'error' })
        return { success: false, error: err instanceof AppDisabledError ? 'APP_DISABLED' : msg }
      }
    }

    let pythonPath: string
    try {
      const python = await pythonRunnerService.resolvePythonCommand()
      pythonPath = python.path
      ctx.log('info', `Resolved Python for ${appId}: ${python.path} (${python.version})`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      ctx.log('error', `Python unavailable: ${message}`)
      ctx.notify(mainT('protocol.pythonUnavailable', message), { type: 'error' })
      return { success: false, error: 'PYTHON_UNAVAILABLE' }
    }

    const workspace = resolveWorkspace()
    const taskId = randomUUID()
    let sdkPath = ''
    try {
      sdkPath = pathsUtils.getPythonSdkPath()
    } catch {
      sdkPath = ''
    }

    let targetWin = ctx.getMainWindow()
    if (!targetWin || targetWin.isDestroyed()) targetWin = ctx.showMainWindow()
    targetWin.webContents.send('subapp:task-started', {
      taskId,
      appId: manifest.id,
      appName: manifest.name
    })

    if (ctx.silent) ctx.notify(mainT('protocol.runningInBackground', manifest.name), { type: 'info' })

    ctx.log(
      'info',
      `Executing subapp task: ${taskId}, entry: ${manifest.entry}, silent: ${ctx.silent}, workspace: ${workspace.path}`
    )

    try {
      pythonRunnerService.executeSubApp(
        taskId,
        manifest.id,
        manifest.name,
        manifest.version,
        appInfo.path,
        manifest.entry,
        runParams,
        workspace,
        pythonPath,
        sdkPath,
        targetWin.webContents
      )
      return {
        success: true,
        message: `App launched: ${manifest.name}`,
        data: { taskId, appId: manifest.id, name: manifest.name, silent: ctx.silent }
      }
    } catch (execErr) {
      const errMsg = execErr instanceof Error ? execErr.message : String(execErr)
      ctx.log('error', `Failed to execute subapp ${manifest.id}:`, errMsg)
      ctx.notify(mainT('protocol.launchFailed', errMsg), { type: 'error' })
      return { success: false, error: errMsg }
    }
  }
}
