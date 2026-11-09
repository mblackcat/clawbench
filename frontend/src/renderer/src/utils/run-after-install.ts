import type { SubAppManifest } from '../types/subapp'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useRunAfterInstallStore } from '../stores/useRunAfterInstallStore'
import { buildInitialAppParams } from './subapp-params'
import { normalizeExecuteResult, seedTaskFromExecuteResult } from './subapp-execute'

/**
 * manifest.run_after_install: execute the freshly installed app once.
 *
 * Best-effort and fire-and-forget — never throws, so a failed auto-run can't
 * turn a successful install into an error. Skipped when the flag is not
 * exactly `true` (legacy manifests), for non-app resources, or when no
 * workspace is active. When a required param has no default/saved value, the
 * params drawer is requested instead of running.
 * Normal runs are registered in the task panel by the global `task-started`
 * listener (AppLayout → useSubAppExecution); only early-terminal results are
 * seeded here.
 */
export async function runAfterInstallIfEnabled(
  appId: string,
  manifest?: Partial<SubAppManifest> | null
): Promise<void> {
  // Strict check: old manifests without the field (or any non-true value) never auto-run.
  if (manifest?.run_after_install !== true) return
  if (manifest.type && manifest.type !== 'app') return
  try {
    const paramDefs = manifest.params ?? []
    const params = buildInitialAppParams(appId, paramDefs)
    const missing = paramDefs.filter(
      (p) => p.required && (params[p.name] === undefined || params[p.name] === '')
    )
    if (missing.length > 0) {
      // Needs user input: open the favorites params drawer; the user submits to run.
      useRunAfterInstallStore.getState().requestParamsPrompt(appId)
      return
    }

    if (!useWorkspaceStore.getState().activeWorkspace) {
      console.info(`[run_after_install] skipped ${appId}: no active workspace`)
      return
    }

    const result = normalizeExecuteResult(await window.api.subapp.execute(appId, params))
    if (result.earlyTerminal) {
      seedTaskFromExecuteResult(result, appId, manifest.name ?? appId)
    }
  } catch (error) {
    console.warn(`[run_after_install] failed to run ${appId}:`, error)
  }
}
