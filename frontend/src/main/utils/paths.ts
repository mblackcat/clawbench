import { app } from 'electron'
import { join } from 'path'
import os from 'os'

/**
 * Returns the app's userData directory (platform-specific application data path).
 */
export function getAppDataPath(): string {
  return app.getPath('userData')
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
 * Returns the path in userData for user-installed apps.
 */
export function getUserAppsPath(): string {
  return join(getAppDataPath(), 'user-apps')
}

/**
 * Returns a temp directory path specific to the ClawBench application.
 */
export function getTempDir(): string {
  return join(os.tmpdir(), 'clawbench')
}
