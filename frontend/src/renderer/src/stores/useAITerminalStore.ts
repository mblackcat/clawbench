import { create } from 'zustand'
import type {
  TerminalConnection,
  TerminalTab,
  QuickCommand,
  TerminalAIMessage,
  SidePanelMode,
  DBConnection,
  DBTab,
  DBTableColumn,
  DBQueryResult
} from '../types/ai-terminal'

interface AITerminalState {
  // Connections
  connections: TerminalConnection[]
  // Open tabs
  openTabs: TerminalTab[]
  activeTabId: string | null
  // Side panel
  sideMode: SidePanelMode
  // Quick commands
  quickCommands: QuickCommand[]
  // AI chat per-tab
  aiMessages: Record<string, TerminalAIMessage[]>
  aiStreaming: boolean
  aiTaskId: string | null
  // Selected text from terminal
  selectedText: string

  // ── DB Mode ──
  dbConnections: DBConnection[]
  dbConnectionStatus: Record<string, 'connected' | 'disconnected' | 'testing'>
  openDBTabs: DBTab[]
  activeDBTabId: string | null
  dbTableData: Record<string, DBQueryResult>
  dbTableSchemas: Record<string, DBTableColumn[]>
  dbTables: Record<string, string[]>
  dbDatabases: Record<string, string[]>
  dbSelectedDatabase: Record<string, string>
  // Pending SQL from bottom panel executor
  pendingSQL: Record<string, string>

  // Connection actions
  fetchConnections: () => Promise<void>
  syncSSHConfig: () => Promise<void>
  createConnection: (data: Omit<TerminalConnection, 'id' | 'createdAt' | 'updatedAt'>) => Promise<TerminalConnection>
  updateConnection: (id: string, updates: Partial<TerminalConnection>) => Promise<void>
  deleteConnection: (id: string) => Promise<void>

  // Tab actions
  openTerminal: (connectionId: string, name: string) => Promise<string>
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string | null) => void
  reconnectTab: (tabId: string) => Promise<string | null>

  // Quick commands
  fetchQuickCommands: () => Promise<void>
  saveQuickCommand: (data: Partial<QuickCommand>) => Promise<void>
  deleteQuickCommand: (id: string) => Promise<void>
  executeQuickCommand: (cmdId: string) => void

  // AI
  setSelectedText: (text: string) => void
  addAIMessage: (tabId: string, msg: TerminalAIMessage) => void
  setAIStreaming: (streaming: boolean) => void
  setAITaskId: (taskId: string | null) => void
  clearAIMessages: (tabId: string) => void

  // Side mode
  setSideMode: (mode: SidePanelMode) => void

  // ── DB Actions ──
  fetchDBConnections: () => Promise<void>
  createDBConnection: (data: Omit<DBConnection, 'id' | 'createdAt' | 'updatedAt'>) => Promise<DBConnection>
  updateDBConnection: (id: string, updates: Partial<DBConnection>) => Promise<void>
  deleteDBConnection: (id: string) => Promise<void>
  testDBConnection: (config: Omit<DBConnection, 'id' | 'createdAt' | 'updatedAt'>) => Promise<{ success: boolean; error?: string }>
  connectDB: (connId: string) => Promise<{ success: boolean; error?: string }>
  disconnectDB: (connId: string) => Promise<void>
  fetchDBDatabases: (connId: string) => Promise<void>
  useDBDatabase: (connId: string, database: string) => Promise<void>
  fetchDBTables: (connId: string) => Promise<void>
  fetchDBTableSchema: (connId: string, tableName: string) => Promise<void>
  openDBTable: (connId: string, tableName: string) => void
  openDBQuery: (connId: string, initialSQL?: string) => void
  closeDBTab: (tabId: string) => void
  setActiveDBTab: (tabId: string | null) => void
  queryDB: (tabId: string, sql: string) => Promise<DBQueryResult>
  executeDBSql: (tabId: string, sql: string) => Promise<{ affectedRows: number; executionTimeMs: number }>
  updateDBCellData: (tabId: string, changes: any[]) => Promise<void>

  // ── Row-level DB Actions ──
  getDBTableCount: (connId: string, tableName: string) => Promise<number>
  queryDBPage: (connId: string, tableName: string, page: number, pageSize: number) => Promise<DBQueryResult>
  insertDBRow: (connId: string, tableName: string, rowData: Record<string, any>) => Promise<void>
  deleteDBRow: (connId: string, tableName: string, primaryKeys: Record<string, any>) => Promise<void>
  updateDBRow: (connId: string, tableName: string, primaryKeys: Record<string, any>, changes: Record<string, any>) => Promise<void>

  // Listeners
  initListeners: () => () => void
}

export const useAITerminalStore = create<AITerminalState>((set, get) => ({
  connections: [],
  openTabs: [],
  activeTabId: null,
  sideMode: 'terminal',
  quickCommands: [],
  aiMessages: {},
  aiStreaming: false,
  aiTaskId: null,
  selectedText: '',

  // DB state
  dbConnections: [],
  dbConnectionStatus: {},
  openDBTabs: [],
  activeDBTabId: null,
  dbTableData: {},
  dbTableSchemas: {},
  dbTables: {},
  dbDatabases: {},
  dbSelectedDatabase: {},
  pendingSQL: {},

  fetchConnections: async () => {
    const connections = await window.api.aiTerminal.getConnections()
    set({ connections })
  },

  syncSSHConfig: async () => {
    const connections = await window.api.aiTerminal.syncSSHConfig()
    set({ connections })
  },

  createConnection: async (data) => {
    const conn = await window.api.aiTerminal.createConnection(data as any)
    await get().fetchConnections()
    return conn
  },

  updateConnection: async (id, updates) => {
    await window.api.aiTerminal.updateConnection(id, updates as any)
    await get().fetchConnections()
  },

  deleteConnection: async (id) => {
    await window.api.aiTerminal.deleteConnection(id)
    await get().fetchConnections()
  },

  openTerminal: async (connectionId, name) => {
    const sessionId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const tab: TerminalTab = {
      id: sessionId,
      connectionId,
      title: name,
      status: 'connecting',
      createdAt: Date.now()
    }

    set(state => ({
      openTabs: [...state.openTabs, tab],
      activeTabId: sessionId
    }))

    try {
      const result = await window.api.aiTerminal.openTerminal(connectionId, sessionId)
      if (result.success) {
        set(state => ({
          openTabs: state.openTabs.map(t =>
            t.id === sessionId ? { ...t, status: 'connected' as const } : t
          )
        }))
      } else {
        // Remove the failed tab and throw so callers can show error feedback
        set(state => ({
          openTabs: state.openTabs.filter(t => t.id !== sessionId),
          activeTabId: state.activeTabId === sessionId
            ? (state.openTabs.filter(t => t.id !== sessionId).pop()?.id ?? null)
            : state.activeTabId
        }))
        throw new Error(result.error || 'Failed to open terminal')
      }
    } catch (err) {
      // Also handle IPC-level errors (e.g. node-pty load failure)
      const currentTabs = get().openTabs
      if (currentTabs.some(t => t.id === sessionId)) {
        set(state => ({
          openTabs: state.openTabs.filter(t => t.id !== sessionId),
          activeTabId: state.activeTabId === sessionId
            ? (state.openTabs.filter(t => t.id !== sessionId).pop()?.id ?? null)
            : state.activeTabId
        }))
      }
      throw err
    }

    return sessionId
  },

  closeTab: (tabId) => {
    window.api.aiTerminal.closeTerminal(tabId)
    set(state => {
      const newTabs = state.openTabs.filter(t => t.id !== tabId)
      const newActiveId = state.activeTabId === tabId
        ? (newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null)
        : state.activeTabId
      const newAiMessages = { ...state.aiMessages }
      delete newAiMessages[tabId]
      return {
        openTabs: newTabs,
        activeTabId: newActiveId,
        aiMessages: newAiMessages
      }
    })
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  reconnectTab: async (tabId) => {
    const tab = get().openTabs.find(t => t.id === tabId)
    if (!tab) return null

    const { connectionId, title } = tab

    // Close old PTY silently
    window.api.aiTerminal.closeTerminal(tabId)

    // Generate new session ID
    const newSessionId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Update tab with new id and connecting status
    set(state => ({
      openTabs: state.openTabs.map(t =>
        t.id === tabId ? { ...t, id: newSessionId, status: 'connecting' as const } : t
      ),
      activeTabId: state.activeTabId === tabId ? newSessionId : state.activeTabId
    }))

    try {
      const result = await window.api.aiTerminal.openTerminal(connectionId, newSessionId)
      if (result.success) {
        set(state => ({
          openTabs: state.openTabs.map(t =>
            t.id === newSessionId ? { ...t, status: 'connected' as const } : t
          )
        }))
      } else {
        set(state => ({
          openTabs: state.openTabs.map(t =>
            t.id === newSessionId ? { ...t, status: 'disconnected' as const } : t
          )
        }))
        return null
      }
    } catch {
      set(state => ({
        openTabs: state.openTabs.map(t =>
          t.id === newSessionId ? { ...t, status: 'disconnected' as const } : t
        )
      }))
      return null
    }

    return newSessionId
  },

  fetchQuickCommands: async () => {
    const quickCommands = await window.api.aiTerminal.getQuickCommands()
    set({ quickCommands })
  },

  saveQuickCommand: async (data) => {
    await window.api.aiTerminal.saveQuickCommand(data as any)
    await get().fetchQuickCommands()
  },

  deleteQuickCommand: async (id) => {
    await window.api.aiTerminal.deleteQuickCommand(id)
    await get().fetchQuickCommands()
  },

  executeQuickCommand: (cmdId) => {
    const { quickCommands, activeTabId } = get()
    const cmd = quickCommands.find(c => c.id === cmdId)
    if (!cmd || !activeTabId) return
    window.api.aiTerminal.executeQuickCommand(activeTabId, cmd.commands)
  },

  setSelectedText: (text) => set({ selectedText: text }),

  addAIMessage: (tabId, msg) => {
    set(state => ({
      aiMessages: {
        ...state.aiMessages,
        [tabId]: [...(state.aiMessages[tabId] || []), msg]
      }
    }))
  },

  setAIStreaming: (streaming) => set({ aiStreaming: streaming }),
  setAITaskId: (taskId) => set({ aiTaskId: taskId }),

  clearAIMessages: (tabId) => {
    set(state => ({
      aiMessages: {
        ...state.aiMessages,
        [tabId]: []
      }
    }))
  },

  setSideMode: (mode) => set({ sideMode: mode }),

  // ══════════════════════════════════════════════════════
  // ── DB Actions ──
  // ══════════════════════════════════════════════════════

  fetchDBConnections: async () => {
    const dbConnections = await window.api.aiTerminal.getDBConnections()
    set({ dbConnections })
  },

  createDBConnection: async (data) => {
    const conn = await window.api.aiTerminal.createDBConnection(data as any)
    await get().fetchDBConnections()
    return conn
  },

  updateDBConnection: async (id, updates) => {
    await window.api.aiTerminal.updateDBConnection(id, updates as any)
    await get().fetchDBConnections()
  },

  deleteDBConnection: async (id) => {
    await window.api.aiTerminal.deleteDBConnection(id)
    set(state => {
      const newStatus = { ...state.dbConnectionStatus }
      delete newStatus[id]
      const newTables = { ...state.dbTables }
      delete newTables[id]
      return { dbConnectionStatus: newStatus, dbTables: newTables }
    })
    await get().fetchDBConnections()
  },

  testDBConnection: async (config) => {
    return window.api.aiTerminal.testDBConnection(config as any)
  },

  connectDB: async (connId) => {
    set(state => ({
      dbConnectionStatus: { ...state.dbConnectionStatus, [connId]: 'testing' }
    }))
    const result = await window.api.aiTerminal.connectDB(connId)
    set(state => ({
      dbConnectionStatus: {
        ...state.dbConnectionStatus,
        [connId]: result.success ? 'connected' : 'disconnected'
      }
    }))
    if (result.success) {
      await get().fetchDBDatabases(connId)
    }
    return result
  },

  disconnectDB: async (connId) => {
    await window.api.aiTerminal.disconnectDB(connId)
    set(state => ({
      dbConnectionStatus: { ...state.dbConnectionStatus, [connId]: 'disconnected' }
    }))
  },

  fetchDBDatabases: async (connId) => {
    try {
      const databases = await window.api.aiTerminal.getDBDatabases(connId)
      set(state => ({
        dbDatabases: { ...state.dbDatabases, [connId]: databases }
      }))
      // Auto-select configured database if available
      const conn = get().dbConnections.find(c => c.id === connId)
      if (conn?.database && databases.includes(conn.database)) {
        await get().useDBDatabase(connId, conn.database)
      }
    } catch {
      // ignore
    }
  },

  useDBDatabase: async (connId, database) => {
    try {
      await window.api.aiTerminal.useDBDatabase(connId, database)
      set(state => ({
        dbSelectedDatabase: { ...state.dbSelectedDatabase, [connId]: database }
      }))
      // Fetch tables for the selected database
      await get().fetchDBTables(connId)
    } catch (err: any) {
      throw err
    }
  },

  fetchDBTables: async (connId) => {
    try {
      const tables = await window.api.aiTerminal.getDBTables(connId)
      set(state => ({
        dbTables: { ...state.dbTables, [connId]: tables }
      }))
    } catch {
      // ignore
    }
  },

  fetchDBTableSchema: async (connId, tableName) => {
    try {
      const schema = await window.api.aiTerminal.getDBTableSchema(connId, tableName)
      const key = `${connId}:${tableName}`
      set(state => ({
        dbTableSchemas: { ...state.dbTableSchemas, [key]: schema }
      }))
    } catch {
      // ignore
    }
  },

  openDBTable: (connId, tableName) => {
    const tabId = `db-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const conn = get().dbConnections.find(c => c.id === connId)
    const tab: DBTab = {
      id: tabId,
      connectionId: connId,
      title: `${conn?.name || 'DB'} > ${tableName}`,
      type: 'table',
      tableName,
      status: 'connected',
      createdAt: Date.now()
    }
    set(state => ({
      openDBTabs: [...state.openDBTabs, tab],
      activeDBTabId: tabId
    }))
  },

  openDBQuery: (connId, initialSQL) => {
    // Reuse existing query tab for same connection if initialSQL provided
    if (initialSQL) {
      const existing = get().openDBTabs.find(t => t.connectionId === connId && t.type === 'query')
      if (existing) {
        set(state => ({
          activeDBTabId: existing.id,
          pendingSQL: { ...state.pendingSQL, [existing.id]: initialSQL }
        }))
        return
      }
    }
    const tabId = `dbq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const conn = get().dbConnections.find(c => c.id === connId)
    const tab: DBTab = {
      id: tabId,
      connectionId: connId,
      title: `${conn?.name || 'DB'} - SQL`,
      type: 'query',
      status: 'connected',
      createdAt: Date.now()
    }
    const pendingUpdate = initialSQL ? { [tabId]: initialSQL } : {}
    set(state => ({
      openDBTabs: [...state.openDBTabs, tab],
      activeDBTabId: tabId,
      pendingSQL: { ...state.pendingSQL, ...pendingUpdate }
    }))
  },

  closeDBTab: (tabId) => {
    set(state => {
      const newTabs = state.openDBTabs.filter(t => t.id !== tabId)
      const newActiveId = state.activeDBTabId === tabId
        ? (newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null)
        : state.activeDBTabId
      const newData = { ...state.dbTableData }
      delete newData[tabId]
      return {
        openDBTabs: newTabs,
        activeDBTabId: newActiveId,
        dbTableData: newData
      }
    })
  },

  setActiveDBTab: (tabId) => set({ activeDBTabId: tabId }),

  queryDB: async (tabId, sql) => {
    const tab = get().openDBTabs.find(t => t.id === tabId)
    if (!tab) throw new Error('Tab not found')
    const result = await window.api.aiTerminal.queryDB(tab.connectionId, sql)
    set(state => ({
      dbTableData: { ...state.dbTableData, [tabId]: result }
    }))
    return result
  },

  executeDBSql: async (tabId, sql) => {
    const tab = get().openDBTabs.find(t => t.id === tabId)
    if (!tab) throw new Error('Tab not found')
    return window.api.aiTerminal.executeDB(tab.connectionId, sql)
  },

  updateDBCellData: async (tabId, changes) => {
    const tab = get().openDBTabs.find(t => t.id === tabId)
    if (!tab || !tab.tableName) return
    await window.api.aiTerminal.updateDBTableData(tab.connectionId, tab.tableName, changes)
  },

  // ── Row-level DB Actions ──

  getDBTableCount: async (connId, tableName) => {
    const conn = get().dbConnections.find(c => c.id === connId)
    if (!conn) return 0
    if (conn.type === 'mongodb') {
      // Use a query with limit 0 to get count approximation - not ideal but works
      const result = await window.api.aiTerminal.queryMongoCollection(connId, tableName, {}, {}, 0)
      return result?.rows?.length ?? 0
    }
    const q = conn.type === 'mysql' ? '`' : '"'
    const result = await window.api.aiTerminal.queryDB(connId, `SELECT COUNT(*) AS cnt FROM ${q}${tableName}${q}`)
    const row = result?.rows?.[0]
    if (!row) return 0
    // Different drivers return count differently
    return Number(row.cnt ?? row['COUNT(*)'] ?? row['count'] ?? 0)
  },

  queryDBPage: async (connId, tableName, page, pageSize) => {
    const conn = get().dbConnections.find(c => c.id === connId)
    if (!conn) throw new Error('Connection not found')
    if (conn.type === 'mongodb') {
      const skip = (page - 1) * pageSize
      // MongoDB doesn't support skip via current API, use limit
      return window.api.aiTerminal.queryMongoCollection(connId, tableName, {}, {}, pageSize)
    }
    const q = conn.type === 'mysql' ? '`' : '"'
    const offset = (page - 1) * pageSize
    const sql = `SELECT * FROM ${q}${tableName}${q} LIMIT ${pageSize} OFFSET ${offset}`
    return window.api.aiTerminal.queryDB(connId, sql)
  },

  insertDBRow: async (connId, tableName, rowData) => {
    const conn = get().dbConnections.find(c => c.id === connId)
    if (!conn) throw new Error('Connection not found')
    if (conn.type === 'mongodb') {
      await window.api.aiTerminal.insertMongoDocument(connId, tableName, rowData)
      return
    }
    const q = conn.type === 'mysql' ? '`' : '"'
    const cols = Object.keys(rowData)
    const colStr = cols.map(c => `${q}${c}${q}`).join(', ')
    const valStr = cols.map(c => {
      const v = rowData[c]
      if (v === null || v === undefined || v === '') return 'NULL'
      if (typeof v === 'number') return String(v)
      if (typeof v === 'boolean') return v ? '1' : '0'
      return `'${String(v).replace(/'/g, "''")}'`
    }).join(', ')
    await window.api.aiTerminal.executeDB(connId, `INSERT INTO ${q}${tableName}${q} (${colStr}) VALUES (${valStr})`)
  },

  deleteDBRow: async (connId, tableName, primaryKeys) => {
    const conn = get().dbConnections.find(c => c.id === connId)
    if (!conn) throw new Error('Connection not found')
    if (conn.type === 'mongodb') {
      await window.api.aiTerminal.deleteMongoDocuments(connId, tableName, primaryKeys)
      return
    }
    const q = conn.type === 'mysql' ? '`' : '"'
    const where = Object.entries(primaryKeys).map(([k, v]) => {
      if (v === null) return `${q}${k}${q} IS NULL`
      if (typeof v === 'number') return `${q}${k}${q} = ${v}`
      return `${q}${k}${q} = '${String(v).replace(/'/g, "''")}'`
    }).join(' AND ')
    // MySQL supports DELETE LIMIT, PG/SQLite do not
    const limitClause = conn.type === 'mysql' ? ' LIMIT 1' : ''
    await window.api.aiTerminal.executeDB(connId, `DELETE FROM ${q}${tableName}${q} WHERE ${where}${limitClause}`)
  },

  updateDBRow: async (connId, tableName, primaryKeys, changes) => {
    const conn = get().dbConnections.find(c => c.id === connId)
    if (!conn) throw new Error('Connection not found')
    if (conn.type === 'mongodb') {
      await window.api.aiTerminal.updateMongoDocument(connId, tableName, primaryKeys, changes)
      return
    }
    const q = conn.type === 'mysql' ? '`' : '"'
    const setClause = Object.entries(changes).map(([k, v]) => {
      if (v === null || v === undefined || v === '') return `${q}${k}${q} = NULL`
      if (typeof v === 'number') return `${q}${k}${q} = ${v}`
      if (typeof v === 'boolean') return `${q}${k}${q} = ${v ? 1 : 0}`
      return `${q}${k}${q} = '${String(v).replace(/'/g, "''")}'`
    }).join(', ')
    const where = Object.entries(primaryKeys).map(([k, v]) => {
      if (v === null) return `${q}${k}${q} IS NULL`
      if (typeof v === 'number') return `${q}${k}${q} = ${v}`
      return `${q}${k}${q} = '${String(v).replace(/'/g, "''")}'`
    }).join(' AND ')
    await window.api.aiTerminal.executeDB(connId, `UPDATE ${q}${tableName}${q} SET ${setClause} WHERE ${where}`)
  },

  initListeners: () => {
    const unsubExit = window.api.aiTerminal.onTerminalExit(({ sessionId }) => {
      set(state => ({
        openTabs: state.openTabs.map(t =>
          t.id === sessionId ? { ...t, status: 'disconnected' as const } : t
        )
      }))
    })

    return () => {
      unsubExit()
    }
  }
}))
