import { ipcMain } from 'electron'
import {
  detectAll,
  detectOne,
  installTool,
  uninstallTool,
  upgradeTool,
  checkLatestVersions,
  listPipPackages,
  uninstallPipPackage,
  listNpmGlobalPackages,
  uninstallNpmGlobalPackage
} from '../services/local-env.service'
import {
  getCodingToolsEnabled,
  setCodingToolEnabled
} from '../store/settings.store'

export function registerLocalEnvIpc(): void {
  ipcMain.handle('local-env:detect-all', async () => {
    return detectAll()
  })

  ipcMain.handle('local-env:detect-one', async (_event, toolId: string) => {
    return detectOne(toolId)
  })

  ipcMain.handle('local-env:install', async (_event, toolId: string) => {
    return installTool(toolId)
  })

  ipcMain.handle('local-env:uninstall', async (_event, toolId: string) => {
    return uninstallTool(toolId)
  })

  ipcMain.handle('local-env:upgrade', async (_event, toolId: string) => {
    return upgradeTool(toolId)
  })

  ipcMain.handle('local-env:check-latest-versions', async (_event, toolIds: string[]) => {
    return checkLatestVersions(toolIds)
  })

  ipcMain.handle('local-env:list-pip-packages', async (_event, pythonPath?: string) => {
    return listPipPackages(pythonPath)
  })

  ipcMain.handle('local-env:uninstall-pip-package', async (_event, packageName: string, pythonPath?: string) => {
    return uninstallPipPackage(packageName, pythonPath)
  })

  ipcMain.handle('local-env:list-npm-packages', async () => {
    return listNpmGlobalPackages()
  })

  ipcMain.handle('local-env:uninstall-npm-package', async (_event, packageName: string) => {
    return uninstallNpmGlobalPackage(packageName)
  })

  ipcMain.handle('local-env:get-coding-tools-enabled', async () => {
    return getCodingToolsEnabled()
  })

  ipcMain.handle('local-env:set-coding-tool-enabled', async (_event, toolId: string, enabled: boolean) => {
    return setCodingToolEnabled(toolId, enabled)
  })
}
