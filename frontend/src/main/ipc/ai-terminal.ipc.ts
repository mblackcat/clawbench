import { ipcMain, BrowserWindow } from 'electron'
import * as aiTerminalService from '../services/ai-terminal.service'
import { loadShellEnv } from '../services/cli-detect.service'
import * as logger from '../utils/logger'

export function registerAITerminalIpc(): void {
  // Pre-load shell environment so SSH inherits user profile variables
  // (SSH_AUTH_SOCK, full PATH, custom env from .zshrc/.bashrc)
  loadShellEnv().catch(() => { /* fallback to process.env */ })
  // ── Terminal Connections ──

  ipcMain.handle('ai-terminal:get-connections', () => {
    return aiTerminalService.getConnections()
  })

  ipcMain.handle('ai-terminal:create-connection', (_event, data) => {
    return aiTerminalService.createConnection(data)
  })

  ipcMain.handle('ai-terminal:update-connection', (_event, id: string, updates) => {
    return aiTerminalService.updateConnection(id, updates)
  })

  ipcMain.handle('ai-terminal:delete-connection', (_event, id: string) => {
    return aiTerminalService.deleteConnection(id)
  })

  ipcMain.handle('ai-terminal:sync-ssh-config', () => {
    return aiTerminalService.syncSSHConfig()
  })

  // ── Terminal Session Management ──

  ipcMain.handle('ai-terminal:open-terminal', async (_event, connectionId: string, sessionId: string) => {
    const onExit = (sid: string, exitCode: number) => {
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('ai-terminal:exit', { sessionId: sid, exitCode })
      })
    }
    return aiTerminalService.openTerminal(connectionId, sessionId, onExit)
  })

  ipcMain.handle('ai-terminal:close-terminal', (_event, sessionId: string) => {
    aiTerminalService.closeTerminal(sessionId)
  })

  ipcMain.handle('ai-terminal:write-terminal', (_event, sessionId: string, data: string) => {
    aiTerminalService.writeTerminal(sessionId, data)
  })

  ipcMain.handle('ai-terminal:resize-terminal', (_event, sessionId: string, cols: number, rows: number) => {
    aiTerminalService.resizeTerminal(sessionId, cols, rows)
  })

  ipcMain.handle('ai-terminal:get-terminal-output', (_event, sessionId: string) => {
    return aiTerminalService.getTerminalOutput(sessionId)
  })

  ipcMain.handle('ai-terminal:get-raw-terminal-output', (_event, sessionId: string) => {
    return aiTerminalService.getRawTerminalOutput(sessionId)
  })

  // ── Quick Commands ──

  ipcMain.handle('ai-terminal:get-quick-commands', () => {
    return aiTerminalService.getQuickCommands()
  })

  ipcMain.handle('ai-terminal:save-quick-command', (_event, data) => {
    return aiTerminalService.saveQuickCommand(data)
  })

  ipcMain.handle('ai-terminal:delete-quick-command', (_event, id: string) => {
    return aiTerminalService.deleteQuickCommand(id)
  })

  ipcMain.handle('ai-terminal:execute-quick-command', (_event, sessionId: string, commands: string) => {
    aiTerminalService.executeQuickCommand(sessionId, commands)
  })

  // ── AI Execution ──

  ipcMain.handle('ai-terminal:ai-execute-command', async (_event, sessionId: string, command: string) => {
    try {
      const output = await aiTerminalService.executeCommandAndWait(sessionId, command)
      return { success: true, output }
    } catch (err: any) {
      logger.error('AI terminal execute failed:', err)
      return { success: false, error: err.message || String(err) }
    }
  })

  // ══════════════════════════════════════════════════════
  // ── DB Mode ──
  // ══════════════════════════════════════════════════════

  ipcMain.handle('ai-terminal:get-db-connections', () => {
    return aiTerminalService.getDBConnections()
  })

  ipcMain.handle('ai-terminal:create-db-connection', (_event, data) => {
    return aiTerminalService.createDBConnection(data)
  })

  ipcMain.handle('ai-terminal:update-db-connection', (_event, id: string, updates) => {
    return aiTerminalService.updateDBConnection(id, updates)
  })

  ipcMain.handle('ai-terminal:delete-db-connection', (_event, id: string) => {
    return aiTerminalService.deleteDBConnection(id)
  })

  ipcMain.handle('ai-terminal:test-db-connection', async (_event, config) => {
    return aiTerminalService.testDBConnection(config)
  })

  ipcMain.handle('ai-terminal:connect-db', async (_event, id: string) => {
    return aiTerminalService.connectDB(id)
  })

  ipcMain.handle('ai-terminal:disconnect-db', async (_event, id: string) => {
    await aiTerminalService.disconnectDB(id)
  })

  ipcMain.handle('ai-terminal:is-db-connected', (_event, id: string) => {
    return aiTerminalService.isDBConnected(id)
  })

  ipcMain.handle('ai-terminal:get-db-tables', async (_event, id: string) => {
    return aiTerminalService.getDBTables(id)
  })

  ipcMain.handle('ai-terminal:get-db-databases', async (_event, id: string) => {
    return aiTerminalService.getDBDatabases(id)
  })

  ipcMain.handle('ai-terminal:use-db-database', async (_event, id: string, database: string) => {
    return aiTerminalService.useDBDatabase(id, database)
  })

  ipcMain.handle('ai-terminal:get-db-table-schema', async (_event, id: string, tableName: string) => {
    return aiTerminalService.getDBTableSchema(id, tableName)
  })

  ipcMain.handle('ai-terminal:query-db', async (_event, id: string, sql: string) => {
    return aiTerminalService.queryDB(id, sql)
  })

  ipcMain.handle('ai-terminal:execute-db', async (_event, id: string, sql: string) => {
    return aiTerminalService.executeDB(id, sql)
  })

  ipcMain.handle('ai-terminal:update-db-table-data', async (_event, id: string, tableName: string, changes: any[]) => {
    return aiTerminalService.updateDBTableData(id, tableName, changes)
  })

  // MongoDB specific
  ipcMain.handle('ai-terminal:query-mongo-collection', async (_event, id: string, collection: string, filter: any, projection: any, limit: number) => {
    return aiTerminalService.queryMongoCollection(id, collection, filter, projection, limit)
  })

  ipcMain.handle('ai-terminal:update-mongo-document', async (_event, id: string, collection: string, filter: any, update: any) => {
    return aiTerminalService.updateMongoDocument(id, collection, filter, update)
  })

  ipcMain.handle('ai-terminal:insert-mongo-document', async (_event, id: string, collection: string, doc: any) => {
    return aiTerminalService.insertMongoDocument(id, collection, doc)
  })

  ipcMain.handle('ai-terminal:delete-mongo-documents', async (_event, id: string, collection: string, filter: any) => {
    return aiTerminalService.deleteMongoDocuments(id, collection, filter)
  })

  // Schema modification
  ipcMain.handle('ai-terminal:add-db-column', async (_event, id: string, tableName: string, columnName: string, columnType: string, nullable: boolean, defaultValue?: string) => {
    await aiTerminalService.addDBColumn(id, tableName, columnName, columnType, nullable, defaultValue)
  })

  ipcMain.handle('ai-terminal:drop-db-column', async (_event, id: string, tableName: string, columnName: string) => {
    await aiTerminalService.dropDBColumn(id, tableName, columnName)
  })

  ipcMain.handle('ai-terminal:rename-db-column', async (_event, id: string, tableName: string, oldName: string, newName: string) => {
    await aiTerminalService.renameDBColumn(id, tableName, oldName, newName)
  })
}
