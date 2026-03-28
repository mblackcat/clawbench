import { ipcMain } from 'electron'
import * as copiperService from '../services/copiper.service'

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
}
