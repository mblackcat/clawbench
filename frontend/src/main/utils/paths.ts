import { app } from 'electron'
import { join } from 'path'
import os from 'os'

/**
 * Returns the app's userData directory (platform-specific application data path).
 * Outside the Electron runtime (unit tests) falls back to a temp directory.
 */
export function getAppDataPath(): string {
  try {
    if (typeof app?.getPath === 'function') {
      return app.getPath('userData')
    }
  } catch {
    // fallback outside electron runtime
  }
  return join(os.tmpdir(), 'fernhollow-userdata')
}

/**
 * Returns the path to the bundled python-sdk.
 * In packaged mode, resources are in process.resourcesPath.
 * In development, they are relative to the project root.
 */
export function getPythonSdkPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'python-sdk')
  }
  return join(app.getAppPath(), 'python-sdk')
}

/**
 * Built-in default under userData for user-installed apps (`user-apps`).
 * Prefer {@link getUserAppsPath} at runtime — that honors a configured override.
 */
export function getDefaultUserAppsPath(): string {
  return join(getAppDataPath(), 'user-apps')
}

/**
 * Resolver for the configured user-apps directory (`settings.userAppDir`).
 *
 * Registered by `store/settings.store.ts` at module init. paths.ts must not
 * import the settings store itself: settings.store already imports paths.ts
 * (cycle), and importing electron-store here would break unit tests that only
 * need path helpers. A lazy `require()` is not an option either — the main
 * bundle keeps relative requires verbatim, so they fail at runtime.
 */
let userAppsDirResolver: (() => string | undefined | null) | null = null

export function registerUserAppsDirResolver(
  resolver: (() => string | undefined | null) | null
): void {
  userAppsDirResolver = resolver
}

/**
 * Returns the effective directory for user-installed apps.
 * Uses `settings.userAppDir` when set; otherwise {@link getDefaultUserAppsPath}.
 */
export function getUserAppsPath(): string {
  try {
    const configured = userAppsDirResolver?.()
    if (typeof configured === 'string' && configured.trim()) {
      return configured
    }
  } catch {
    // Store not ready yet during very early bootstrap
  }
  return getDefaultUserAppsPath()
}

/**
 * Returns the path to the bundled builtin template apps (seeded into
 * user-apps on startup). Same packaging layout as python-sdk.
 */
export function getBuiltinAppsPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'builtin-apps')
  }
  return join(app.getAppPath(), 'builtin-apps')
}

/**
 * Returns a temp directory path specific to the ClawBench application.
 */
export function getTempDir(): string {
  return join(os.tmpdir(), 'clawbench')
}

/**
 * Root directory of the dedicated workbench Python virtual environment.
 */
export function getWorkbenchVenvPath(): string {
  return join(getAppDataPath(), 'python-venv')
}

/**
 * Returns the path to the Python executable inside the workbench virtual environment.
 */
export function getWorkbenchVenvPythonPath(venvDir = getWorkbenchVenvPath()): string {
  return process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python')
}
