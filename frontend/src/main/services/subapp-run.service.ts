/**
 * Shared pre-run pipeline for every sub-app launch path (workbench execute,
 * global shortcut, IM bridge, scheduler, protocol URL, AI internal tools):
 *
 * 1. strip host-reserved `__`-prefixed keys from caller-supplied params
 * 2. builtin admin kill-switch gate + `__project` / `__app_config` injection
 * 3. `__user` injection for builtin apps
 * 4. Python resolution for the app (app venv first) — may create the
 *    workbench venv on first use
 * 5. requirements.txt install into that same interpreter (best-effort)
 *
 * Callers keep their own result contracts; this module only reports
 * success / failure and streams progress lines through `onOutput`.
 */
import { getUser } from '../store/auth.store'
import { mainT } from '../utils/i18n'
import * as logger from '../utils/logger'
import {
  AppDisabledError,
  BUILTIN_APP_ID_PREFIX,
  enrichBuiltinAppParams
} from './project.service'
import {
  resolvePythonCommand,
  getI18nPayload,
  type PythonResolution
} from './python-runner.service'
import { installAppRequirements, type PythonEnvOutput } from './python-venv.service'

export interface SubAppRunTarget {
  /** Manifest id. */
  appId: string
  appName: string
  appPath: string
}

export interface SubAppRunFailure {
  ok: false
  /** `disabled` = admin kill-switch; `failed` = anything else. */
  status: 'disabled' | 'failed'
  stage: 'gate' | 'python'
  message: string
  i18nKey?: string
  i18nArgs?: string[]
}

export type SubAppGateResult = { ok: true; params: Record<string, unknown> } | SubAppRunFailure

export type SubAppPythonResult = { ok: true; python: PythonResolution } | SubAppRunFailure

export type SubAppPrepareResult =
  | { ok: true; params: Record<string, unknown>; python: PythonResolution }
  | SubAppRunFailure

/**
 * Removes `__`-prefixed keys: they are reserved for host injection
 * (`__project`, `__app_config`, `__user`) and must never come from callers
 * such as URLs, chat messages or AI tools.
 */
export function stripReservedParams(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {}
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (key.startsWith('__')) continue
    clean[key] = value
  }
  return clean
}

/** Steps 1–3: reserved-key stripping, builtin gate, config and user injection. */
export async function gateSubAppRun(
  target: SubAppRunTarget,
  params?: unknown
): Promise<SubAppGateResult> {
  let effective = stripReservedParams(params)
  if (!target.appId.startsWith(BUILTIN_APP_ID_PREFIX)) {
    return { ok: true, params: effective }
  }
  try {
    effective = await enrichBuiltinAppParams(target.appId, target.appName, effective)
  } catch (err) {
    if (err instanceof AppDisabledError) {
      return {
        ok: false,
        status: 'disabled',
        stage: 'gate',
        message: err.message,
        i18nKey: err.i18nKey,
        i18nArgs: err.i18nArgs
      }
    }
    return {
      ok: false,
      status: 'failed',
      stage: 'gate',
      message: err instanceof Error ? err.message : String(err)
    }
  }
  const user = getUser()
  if (user) {
    effective.__user = {
      userId: user.id,
      username: user.name,
      email: user.email || '',
      feishuId: user.feishuId || ''
    }
  }
  return { ok: true, params: effective }
}

/** Steps 4–5: resolve the interpreter, then install requirements into it. */
export async function prepareSubAppPython(
  target: SubAppRunTarget,
  onOutput?: PythonEnvOutput
): Promise<SubAppPythonResult> {
  let python: PythonResolution
  try {
    python = await resolvePythonCommand(target.appPath, { onOutput })
    logger.info(
      `Using ${python.source} Python for sub-app ${target.appId}: ${python.path} (${python.version})`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const i18n = getI18nPayload(err)
    logger.error(`Failed to resolve Python for sub-app ${target.appId}:`, message)
    return {
      ok: false,
      status: 'failed',
      stage: 'python',
      message,
      i18nKey: i18n.i18nKey,
      i18nArgs: i18n.i18nArgs
    }
  }

  // Best-effort: a failed install should not block apps that may still work.
  try {
    const req = await installAppRequirements(target.appPath, { pythonPath: python.path, onOutput })
    if (!req.success && req.error) {
      logger.warn(`Requirements install failed for ${target.appId}:`, req.error)
      onOutput?.(mainT('pythonVenv.requirementsFailed', lastLine(req.error)), 'warn')
    }
  } catch (err) {
    logger.warn(`Failed to verify requirements for ${target.appId}:`, err)
  }

  return { ok: true, python }
}

/** Full pipeline (steps 1–5). */
export async function prepareSubAppRun(
  target: SubAppRunTarget,
  params?: unknown,
  onOutput?: PythonEnvOutput
): Promise<SubAppPrepareResult> {
  const gate = await gateSubAppRun(target, params)
  if (!gate.ok) return gate
  const py = await prepareSubAppPython(target, onOutput)
  if (!py.ok) return py
  return { ok: true, params: gate.params, python: py.python }
}

function lastLine(text: string): string {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim())
  return lines[lines.length - 1] ?? text
}
