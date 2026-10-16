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
import { prepareSubAppRun, stripReservedParams } from '../../subapp-run.service'
import { mainT } from '../../../utils/i18n'

function findInstalledApp(appId: string): subappService.SubAppInfo | undefined {
  return subappService.listSubApps().find((a) => a.manifest.id === appId || a.id === appId)
}

/** Pretty, length-capped rendering of URL-supplied params for the prompt. */
export function formatProtocolParams(params: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) return mainT('protocol.noParams')
  let text: string
  try {
    text = JSON.stringify(params, null, 2)
  } catch {
    text = String(params)
  }
  return text.length > 1200 ? `${text.slice(0, 1200)}\n…` : text
}

/**
 * Ask the user before running (and, for `autoInstall`, first installing) an
 * app because a URL said so. Protocol URLs can be fired by any web page, so
 * this is shown for every request — `silent=true` does not skip it. The main
 * window is shown first when it is hidden so the dialog cannot end up behind
 * an invisible parent; without any window a parentless dialog is used.
 */
async function confirmProtocolRun(
  ctx: ProtocolExecutionContext,
  opts: { install: boolean; appId: string; appName: string; params: Record<string, unknown> }
): Promise<boolean> {
  try {
    let parent = ctx.getMainWindow()
    if (!parent || parent.isDestroyed() || !parent.isVisible()) {
      try {
        parent = ctx.showMainWindow()
      } catch (winErr) {
        ctx.log('warn', 'Could not show main window for the confirmation dialog:', winErr)
        parent = null
      }
    }
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: [
        mainT(opts.install ? 'protocol.confirmInstallOk' : 'protocol.confirmRunOk'),
        mainT('protocol.confirmCancel')
      ],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: mainT(opts.install ? 'protocol.confirmInstallTitle' : 'protocol.confirmRunTitle'),
      message: opts.install
        ? mainT('protocol.confirmInstallMessage', opts.appName)
        : mainT('protocol.confirmRunMessage', opts.appName),
      detail: mainT('protocol.confirmRunDetail', opts.appId, formatProtocolParams(opts.params))
    }
    const { response } =
      parent && !parent.isDestroyed()
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options)
    return response === 0
  } catch (err) {
    ctx.log('error', 'Failed to show protocol confirmation dialog:', err)
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
 * - Every run is confirmed by the user in a native dialog showing the app
 *   name, id and the parsed parameters (also for silent=true).
 * - Not installed + autoInstall: a single install-and-run confirmation, then
 *   download from the marketplace.
 * - URL params lose reserved `__` keys; builtins go through the admin
 *   kill-switch via the shared prepareSubAppRun pipeline.
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

    // `__`-prefixed keys are reserved for host injection (__project,
    // __app_config, __user) and must never come from a URL.
    const rawParams = ctx.params.appParams
    const urlParams = stripReservedParams(
      typeof rawParams === 'object' && rawParams !== null ? rawParams : {}
    )

    let appInfo = findInstalledApp(appId)
    // Set once the user approved the combined install-and-run prompt.
    let confirmed = false

    if (!appInfo) {
      if (!ctx.params.autoInstall) {
        const msg = mainT('protocol.appNotInstalled', appId)
        ctx.log('error', `[AppNotFound] ${msg}. Add "autoInstall=true" to offer a download.`)
        ctx.notify(msg, { type: 'error' })
        return { success: false, error: 'APP_NOT_INSTALLED' }
      }

      if (!(await confirmProtocolRun(ctx, { install: true, appId, appName: appId, params: urlParams }))) {
        ctx.log('info', `User declined protocol auto-install of ${appId}`)
        return { success: false, error: 'USER_CANCELLED' }
      }
      confirmed = true

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

    // An installed app still needs explicit consent: the URL chooses both the
    // app and its parameters. (The install prompt above already covered both.)
    if (!confirmed) {
      const ok = await confirmProtocolRun(ctx, {
        install: false,
        appId: manifest.id,
        appName: manifest.name,
        params: urlParams
      })
      if (!ok) {
        ctx.log('info', `User declined protocol run of ${manifest.id}`)
        return { success: false, error: 'USER_CANCELLED' }
      }
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
    const webContents = targetWin.webContents
    webContents.send('subapp:task-started', {
      taskId,
      appId: manifest.id,
      appName: manifest.name
    })

    // Shared pre-run pipeline: builtin kill-switch + injection, Python for
    // this app (app venv first), requirements into that interpreter.
    const prep = await prepareSubAppRun(
      { appId: manifest.id, appName: manifest.name, appPath: appInfo.path },
      urlParams,
      (message, level) => {
        if (!webContents.isDestroyed()) {
          webContents.send('subapp:output', { taskId, type: 'output', level, message, timestamp: Date.now() })
        }
      }
    )
    if (!prep.ok) {
      const notice =
        prep.stage === 'python' ? mainT('protocol.pythonUnavailable', prep.message) : prep.message
      ctx.log('error', `Cannot start ${manifest.id} (${prep.stage}): ${prep.message}`)
      ctx.notify(notice, { type: 'error' })
      if (!webContents.isDestroyed()) {
        webContents.send('subapp:task-status', {
          taskId,
          status: prep.status,
          success: false,
          summary: prep.message,
          summaryI18nKey: prep.i18nKey,
          summaryI18nArgs: prep.i18nArgs
        })
      }
      return {
        success: false,
        error:
          prep.status === 'disabled'
            ? 'APP_DISABLED'
            : prep.stage === 'python'
              ? 'PYTHON_UNAVAILABLE'
              : prep.message
      }
    }
    ctx.log('info', `Resolved Python for ${appId}: ${prep.python.path} (${prep.python.version})`)

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
        prep.params,
        workspace,
        prep.python.path,
        sdkPath,
        webContents
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
