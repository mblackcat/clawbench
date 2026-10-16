import { ipcMain } from 'electron'
import { BUILTIN_APP_ID_PREFIX } from '../services/project.service'
import { markBuiltinAppRemoved, clearBuiltinAppRemoved } from '../services/builtin-apps.service'

/**
 * Builtin-app bookkeeping that complements `subapp:uninstall` / installs:
 * a deleted builtin is remembered so startup seeding doesn't reinstall it.
 */
export function registerBuiltinAppsIpc(): void {
  ipcMain.handle('builtin:mark-removed', async (_event, appId: unknown) => {
    if (typeof appId !== 'string' || !appId.startsWith(BUILTIN_APP_ID_PREFIX)) return { success: false }
    markBuiltinAppRemoved(appId)
    return { success: true }
  })
  ipcMain.handle('builtin:clear-removed', async (_event, appId: unknown) => {
    if (typeof appId !== 'string' || !appId.startsWith(BUILTIN_APP_ID_PREFIX)) return { success: false }
    clearBuiltinAppRemoved(appId)
    return { success: true }
  })
}
