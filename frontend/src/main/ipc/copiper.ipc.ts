import { ipcMain } from 'electron'
import * as copiperService from '../services/copiper.service'
import * as feishuSync from '../services/copiper-feishu-sync.service'
import * as feishuWatcher from '../services/copiper-feishu-watcher.service'
import type { FeishuLinkConfig } from '../services/jdb-meta'

export function registerCopiperIpc(): void {
  ipcMain.handle('copiper:list-databases', async (_event, workspacePath: string) => {
    return copiperService.listDatabases(workspacePath)
  })

  ipcMain.handle('copiper:load-database', async (_event, filePath: string) => {
    return copiperService.loadDatabase(filePath)
  })

  ipcMain.handle('copiper:save-database', async (_event, filePath: string, data: any) => {
    return copiperService.saveDatabase(filePath, data)
  })

  ipcMain.handle('copiper:create-database', async (_event, filePath: string, tableName: string) => {
    return copiperService.createDatabase(filePath, tableName)
  })

  ipcMain.handle('copiper:delete-database', async (_event, filePath: string) => {
    return copiperService.deleteDatabase(filePath)
  })

  ipcMain.handle('copiper:add-table', async (_event, filePath: string, tableName: string) => {
    return copiperService.addTable(filePath, tableName)
  })

  ipcMain.handle('copiper:remove-table', async (_event, filePath: string, tableName: string) => {
    return copiperService.removeTable(filePath, tableName)
  })

  ipcMain.handle(
    'copiper:rename-table',
    async (_event, filePath: string, oldName: string, newName: string) => {
      return copiperService.renameTable(filePath, oldName, newName)
    }
  )

  ipcMain.handle(
    'copiper:add-column',
    async (_event, filePath: string, tableName: string, column: any) => {
      return copiperService.addColumn(filePath, tableName, column)
    }
  )

  ipcMain.handle(
    'copiper:update-column',
    async (_event, filePath: string, tableName: string, columnId: string, updates: any) => {
      return copiperService.updateColumn(filePath, tableName, columnId, updates)
    }
  )

  ipcMain.handle(
    'copiper:remove-column',
    async (_event, filePath: string, tableName: string, columnId: string) => {
      return copiperService.removeColumn(filePath, tableName, columnId)
    }
  )

  ipcMain.handle(
    'copiper:add-row',
    async (_event, filePath: string, tableName: string, row: any) => {
      return copiperService.addRow(filePath, tableName, row)
    }
  )

  ipcMain.handle(
    'copiper:update-row',
    async (_event, filePath: string, tableName: string, rowIndex: number, updates: any) => {
      return copiperService.updateRow(filePath, tableName, rowIndex, updates)
    }
  )

  ipcMain.handle(
    'copiper:delete-rows',
    async (_event, filePath: string, tableName: string, rowIndices: number[]) => {
      return copiperService.deleteRows(filePath, tableName, rowIndices)
    }
  )

  ipcMain.handle(
    'copiper:validate-table',
    async (_event, filePath: string, tableName: string, allTables?: any) => {
      return copiperService.validateTable(filePath, tableName, allTables)
    }
  )

  ipcMain.handle(
    'copiper:export-table',
    async (
      _event,
      filePath: string,
      tableName: string,
      config: any,
      workspacePath: string,
      allTables?: any
    ) => {
      return copiperService.exportTable(filePath, tableName, config, workspacePath, allTables)
    }
  )

  ipcMain.handle(
    'copiper:export-all',
    async (_event, filePath: string, config: any, workspacePath: string) => {
      return copiperService.exportAll(filePath, config, workspacePath)
    }
  )

  ipcMain.handle('copiper:get-table-infos', async (_event, workspacePath: string) => {
    return copiperService.getTableInfos(workspacePath)
  })

  ipcMain.handle('copiper:save-table-infos', async (_event, workspacePath: string, infos: any[]) => {
    return copiperService.saveTableInfos(workspacePath, infos)
  })

  ipcMain.handle('copiper:get-settings', async () => {
    return copiperService.getSettings()
  })

  ipcMain.handle('copiper:save-settings', async (_event, settings: any) => {
    return copiperService.saveSettings(settings)
  })

  ipcMain.handle(
    'copiper:load-reference-data',
    async (_event, workspacePath: string, tableNames: string[]) => {
      return copiperService.loadReferenceData(workspacePath, tableNames)
    }
  )

  // ── Feishu spreadsheet link & sync ──

  ipcMain.handle('copiper:feishu-availability', async () => {
    return feishuSync.getAvailability()
  })

  ipcMain.handle('copiper:feishu-get-link', async (_event, filePath: string) => {
    return feishuSync.getLink(filePath)
  })

  ipcMain.handle(
    'copiper:feishu-save-link',
    async (_event, filePath: string, link: FeishuLinkConfig) => {
      const result = await feishuSync.saveLink(filePath, link)
      if (result.ok && link.enabled) {
        feishuWatcher.startWatching(filePath)
      } else if (result.ok && !link.enabled) {
        feishuWatcher.stopWatching(filePath)
      }
      return result
    }
  )

  ipcMain.handle(
    'copiper:feishu-disconnect',
    async (_event, filePath: string, removeMeta?: boolean) => {
      const result = await feishuSync.disconnect(filePath, !!removeMeta)
      feishuWatcher.stopWatching(filePath)
      return result
    }
  )

  ipcMain.handle(
    'copiper:feishu-test',
    async (_event, filePathOrToken: string, tokenOverride?: string) => {
      return feishuSync.testLink(filePathOrToken, tokenOverride)
    }
  )

  ipcMain.handle(
    'copiper:feishu-create-spreadsheet',
    async (_event, filePath: string, title: string) => {
      const result = await feishuSync.createSpreadsheetForFile(filePath, title)
      if (result.ok) feishuWatcher.startWatching(filePath)
      return result
    }
  )

  ipcMain.handle('copiper:feishu-list-sheets', async (_event, tokenOrUrl: string) => {
    return feishuSync.listRemoteSheets(tokenOrUrl)
  })

  ipcMain.handle(
    'copiper:feishu-sync-now',
    async (
      _event,
      filePath: string,
      conflictResolutions?: Record<string, 'local' | 'remote' | 'skip'>
    ) => {
      const result = await feishuSync.syncFile(filePath, 'manual', { conflictResolutions })
      return result
    }
  )

  ipcMain.handle('copiper:feishu-get-status', async (_event, filePath: string) => {
    return feishuSync.getStatus(filePath)
  })

  ipcMain.handle('copiper:feishu-refresh-watchers', async (_event, workspacePath: string) => {
    feishuWatcher.refreshWorkspaceWatchers(workspacePath)
    return { ok: true }
  })

  ipcMain.handle('copiper:feishu-parse-token', async (_event, urlOrToken: string) => {
    return feishuSync.parseToken(urlOrToken)
  })
}
