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
 * Default directory under userData for user-installed apps (`user-apps`).
 */
export function getDefaultUserAppsPath(): string {
  return join(getAppDataPath(), 'user-apps')
}

/**
 * Returns the install root for user-installed apps: always `{userData}/user-apps`.
 *
 * Note: `settings.userAppDir` is NOT the install root — it is the developer
 * shared-app discovery directory (see `developer:discover-shared-apps`).
 */
export function getUserAppsPath(): string {
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
