import { create } from 'zustand'
import { useWorkspaceStore } from './useWorkspaceStore'
import type {
  JDBFileInfo,
  JDBDatabase,
  ValidationIssue,
  ExportConfig,
  ExportResult,
  TableInfo,
  RowData
} from '../types/copiper'

interface CopiperState {
  // Data
  databases: JDBFileInfo[]
  activeFilePath: string | null
  activeDatabase: JDBDatabase | null
  activeTableName: string | null
  tableInfos: TableInfo[]
  referenceData: Record<string, Array<{ id: number | string; idx_name?: string }>>

  // UI state
  loading: boolean
  dirty: boolean
  saving: boolean
  exporting: boolean
  validationIssues: ValidationIssue[]
  searchText: string
  selectedRowIndices: number[]

  // Actions
  fetchDatabases: (workspacePath: string) => Promise<void>
  loadDatabase: (filePath: string) => Promise<void>
  selectTable: (tableName: string) => void
  loadReferenceData: () => Promise<void>

  // Local-first editing (modify memory, mark dirty)
  updateCell: (rowIndex: number, columnName: string, value: unknown) => void
  addRow: () => void
  deleteSelectedRows: () => void

  // Persistence
  saveCurrentDatabase: () => Promise<void>

  // Database operations (through IPC)
  createDatabase: (filePath: string, tableName: string) => Promise<void>
  deleteDatabase: (filePath: string) => Promise<void>
  addTable: (tableName: string) => Promise<void>
  removeTable: (tableName: string) => Promise<void>
  renameTable: (oldName: string, newName: string) => Promise<void>

  // Validation and export
  validateCurrentTable: () => Promise<void>
  exportCurrentTable: (config: ExportConfig) => Promise<ExportResult[]>
  exportAll: (config: ExportConfig) => Promise<ExportResult[]>

  // Table infos
  fetchTableInfos: (workspacePath: string) => Promise<void>

  // UI
  setSearchText: (text: string) => void
  setSelectedRowIndices: (indices: number[]) => void
  clearDirty: () => void
  markDirty: () => void
}

export const useCopiperStore = create<CopiperState>((set, get) => ({
  databases: [],
  activeFilePath: null,
  activeDatabase: null,
  activeTableName: null,
  tableInfos: [],
  referenceData: {},

  loading: false,
  dirty: false,
  saving: false,
  exporting: false,
  validationIssues: [],
  searchText: '',
  selectedRowIndices: [],

  fetchDatabases: async (workspacePath: string) => {
    set({ loading: true })
    try {
      const databases = await window.api.copiper.listDatabases(workspacePath)
      set({ databases, loading: false })
    } catch (err) {
      console.error('Failed to fetch databases:', err)
      set({ loading: false })
    }
  },

  loadDatabase: async (filePath: string) => {
    set({ loading: true })
    try {
      const db = await window.api.copiper.loadDatabase(filePath)
      const tableNames = Object.keys(db)
      set({
        activeFilePath: filePath,
        activeDatabase: db,
        activeTableName: tableNames.length > 0 ? tableNames[0] : null,
        dirty: false,
        validationIssues: [],
        selectedRowIndices: [],
        loading: false
      })
      // Load cross-file reference data after database is set
      get().loadReferenceData()
    } catch (err) {
      console.error('Failed to load database:', err)
      set({ loading: false })
    }
  },

  selectTable: (tableName: string) => {
    set({
      activeTableName: tableName,
      selectedRowIndices: [],
      validationIssues: []
    })
  },

  loadReferenceData: async () => {
    const { activeDatabase } = get()
    if (!activeDatabase) return

    // Collect all source table names from index/indices columns across all tables
    const neededTables = new Set<string>()
    for (const table of Object.values(activeDatabase)) {
      for (const col of table.columns) {
        const type = col.type || ''
        const baseType = type.split('/')[0].split(':')[0]
        if ((baseType === 'index' || baseType === 'indices') && type.includes('/')) {
          const srcTable = col.src || type.split('/')[1]
          if (srcTable && !activeDatabase[srcTable]) {
            neededTables.add(srcTable)
          }
        }
      }
    }

    if (neededTables.size === 0) {
      set({ referenceData: {} })
      return
    }

    const workspacePath = useWorkspaceStore.getState().activeWorkspace?.path
    if (!workspacePath) return

    try {
      const refData = await window.api.copiper.loadReferenceData(
        workspacePath,
        Array.from(neededTables)
      )
      set({ referenceData: refData })
    } catch (err) {
      console.error('Failed to load reference data:', err)
    }
  },

  updateCell: (rowIndex: number, columnName: string, value: unknown) => {
    const { activeDatabase, activeTableName } = get()
    if (!activeDatabase || !activeTableName) return

    const table = activeDatabase[activeTableName]
    if (!table || rowIndex < 0 || rowIndex >= table.rows.length) return

    const newRows = [...table.rows]
    newRows[rowIndex] = { ...newRows[rowIndex], [columnName]: value }

    set({
      activeDatabase: {
        ...activeDatabase,
        [activeTableName]: { ...table, rows: newRows }
      },
      dirty: true
    })
  },

  addRow: () => {
    const { activeDatabase, activeTableName } = get()
    if (!activeDatabase || !activeTableName) return

    const table = activeDatabase[activeTableName]
    if (!table) return

    // Auto-increment id: find max numeric id and add 1
    let maxId = 0
    for (const row of table.rows) {
      const rowId = typeof row.id === 'number' ? row.id : parseInt(String(row.id), 10)
      if (!isNaN(rowId) && rowId > maxId) {
        maxId = rowId
      }
    }

    const newRow: RowData = { id: maxId + 1 }
    const newRows = [...table.rows, newRow]

    set({
      activeDatabase: {
        ...activeDatabase,
        [activeTableName]: { ...table, rows: newRows }
      },
      dirty: true
    })
  },

  deleteSelectedRows: () => {
    const { activeDatabase, activeTableName, selectedRowIndices } = get()
    if (!activeDatabase || !activeTableName || selectedRowIndices.length === 0) return

    const table = activeDatabase[activeTableName]
    if (!table) return

    const indicesToDelete = new Set(selectedRowIndices)
    const newRows = table.rows.filter((_, i) => !indicesToDelete.has(i))

    set({
      activeDatabase: {
        ...activeDatabase,
        [activeTableName]: { ...table, rows: newRows }
      },
      selectedRowIndices: [],
      dirty: true
    })
  },

  saveCurrentDatabase: async () => {
    const { activeFilePath, activeDatabase } = get()
    if (!activeFilePath || !activeDatabase) return

    set({ saving: true })
    try {
      await window.api.copiper.saveDatabase(activeFilePath, activeDatabase)
      set({ saving: false, dirty: false })
    } catch (err) {
      console.error('Failed to save database:', err)
      set({ saving: false })
      throw err
    }
  },

  createDatabase: async (filePath: string, tableName: string) => {
    try {
      await window.api.copiper.createDatabase(filePath, tableName)
      // Reload the new database
      const db = await window.api.copiper.loadDatabase(filePath)
      const tableNames = Object.keys(db)
      set({
        activeFilePath: filePath,
        activeDatabase: db,
        activeTableName: tableNames.length > 0 ? tableNames[0] : null,
        dirty: false,
        validationIssues: [],
        selectedRowIndices: []
      })
    } catch (err) {
      console.error('Failed to create database:', err)
      throw err
    }
  },

  deleteDatabase: async (filePath: string) => {
    try {
      await window.api.copiper.deleteDatabase(filePath)
      const { activeFilePath } = get()
      if (activeFilePath === filePath) {
        set({
          activeFilePath: null,
          activeDatabase: null,
          activeTableName: null,
          dirty: false,
          validationIssues: [],
          selectedRowIndices: []
        })
      }
    } catch (err) {
      console.error('Failed to delete database:', err)
      throw err
    }
  },

  addTable: async (tableName: string) => {
    const { activeFilePath } = get()
    if (!activeFilePath) return

    try {
      const db = await window.api.copiper.addTable(activeFilePath, tableName)
      set({
        activeDatabase: db,
        activeTableName: tableName,
        dirty: false,
        validationIssues: [],
        selectedRowIndices: []
      })
    } catch (err) {
      console.error('Failed to add table:', err)
      throw err
    }
  },

  removeTable: async (tableName: string) => {
    const { activeFilePath, activeTableName } = get()
    if (!activeFilePath) return

    try {
      const db = await window.api.copiper.removeTable(activeFilePath, tableName)
      const tableNames = Object.keys(db)
      set({
        activeDatabase: db,
        activeTableName:
          activeTableName === tableName
            ? tableNames.length > 0
              ? tableNames[0]
              : null
            : activeTableName,
        dirty: false,
        validationIssues: [],
        selectedRowIndices: []
      })
    } catch (err) {
      console.error('Failed to remove table:', err)
      throw err
    }
  },

  renameTable: async (oldName: string, newName: string) => {
    const { activeFilePath, activeTableName } = get()
    if (!activeFilePath) return

    try {
      const db = await window.api.copiper.renameTable(activeFilePath, oldName, newName)
      set({
        activeDatabase: db,
        activeTableName: activeTableName === oldName ? newName : activeTableName
      })
    } catch (err) {
      console.error('Failed to rename table:', err)
      throw err
    }
  },

  validateCurrentTable: async () => {
    const { activeFilePath, activeTableName, activeDatabase } = get()
    if (!activeFilePath || !activeTableName) return

    try {
      const issues = await window.api.copiper.validateTable(
        activeFilePath,
        activeTableName,
        activeDatabase ?? undefined
      )
      set({ validationIssues: issues })
    } catch (err) {
      console.error('Failed to validate table:', err)
    }
  },

  exportCurrentTable: async (config: ExportConfig) => {
    const { activeFilePath, activeTableName, activeDatabase } = get()
    if (!activeFilePath || !activeTableName) return []

    // Get workspace path
    const workspacePath = config.outputDir || useWorkspaceStore.getState().activeWorkspace?.path || ''
    if (!workspacePath) throw new Error('No workspace selected')

    set({ exporting: true })
    try {
      const results = await window.api.copiper.exportTable(
        activeFilePath,
        activeTableName,
        config,
        workspacePath,
        activeDatabase ?? undefined
      )
      set({ exporting: false })
      return results
    } catch (err) {
      console.error('Failed to export table:', err)
      set({ exporting: false })
      throw err
    }
  },

  exportAll: async (config: ExportConfig) => {
    const { activeFilePath } = get()
    if (!activeFilePath) return []

    // Get workspace path
    const workspacePath = config.outputDir || useWorkspaceStore.getState().activeWorkspace?.path || ''
    if (!workspacePath) throw new Error('No workspace selected')

    set({ exporting: true })
    try {
      const results = await window.api.copiper.exportAll(
        activeFilePath,
        config,
        workspacePath
      )
      set({ exporting: false })
      return results
    } catch (err) {
      console.error('Failed to export all:', err)
      set({ exporting: false })
      throw err
    }
  },

  fetchTableInfos: async (workspacePath: string) => {
    try {
      const infos = await window.api.copiper.getTableInfos(workspacePath)
      set({ tableInfos: infos })
    } catch (err) {
      console.error('Failed to fetch table infos:', err)
    }
  },

  setSearchText: (text: string) => {
    set({ searchText: text })
  },

  setSelectedRowIndices: (indices: number[]) => {
    set({ selectedRowIndices: indices })
  },

  clearDirty: () => {
    set({ dirty: false })
  },

  markDirty: () => {
    if (!get().dirty) {
      set({ dirty: true })
    }
  }
}))
