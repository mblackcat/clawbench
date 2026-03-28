import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as logger from '../utils/logger'
import * as jdbService from './jdb.service'
import { getExportSettings, setExportSettings, addRecentFile } from '../store/copiper.store'
import type { JDBDatabase, JDBTableData, ColDef, RowData, JDBFileInfo } from './jdb.service'

// ── Local types for validation / export (avoid importing from renderer) ──

export interface ValidationIssue {
  level: 'error' | 'warning'
  tableName: string
  rowIndex: number
  rowId?: number | string
  columnName?: string
  message: string
}

export interface ExportConfig {
  formats: ('python' | 'json')[]
  outputDir?: string
  pythonHeader?: string
  tableNames?: string[]
  exportSubDir?: string
}

export interface ExportResult {
  tableName: string
  format: 'python' | 'json'
  outputPath: string
  success: boolean
  error?: string
  rowCount: number
  skipped?: boolean
  checkInfo?: string
  postProcessInfo?: string
}

export interface CopiperSettings {
  defaultFormats: ('python' | 'json')[]
  pythonHeader: string
  exportSubDir: string
}

// ── Database CRUD ──

export async function listDatabases(workspacePath: string): Promise<JDBFileInfo[]> {
  return jdbService.listJDBFiles(workspacePath)
}

export function loadDatabase(filePath: string): JDBDatabase {
  return jdbService.loadDatabase(filePath)
}

export function saveDatabase(filePath: string, data: JDBDatabase): void {
  jdbService.saveDatabase(filePath, data)
}

export function createDatabase(filePath: string, tableName: string): void {
  jdbService.createDatabase(filePath, tableName)
}

export function deleteDatabase(filePath: string): void {
  jdbService.deleteDatabase(filePath)
}

// ── Table operations ──

export function addTable(filePath: string, tableName: string): JDBDatabase {
  const db = jdbService.loadDatabase(filePath)
  if (db[tableName]) {
    throw new Error(`Table "${tableName}" already exists`)
  }
  db[tableName] = {
    columns: [
      {
        id: 'rdesc',
        name: 'rdesc',
        rname: '注释',
        type: 'str',
        j_type: 'str',
        req_or_opt: 'optional',
        c_type: 'rdesc',
        c_index: 0,
        src: ''
      },
      {
        id: 'id',
        name: 'id',
        rname: 'ID',
        type: 'int',
        j_type: 'int',
        req_or_opt: 'required',
        c_type: 'data',
        c_index: 1,
        src: '',
        is_key: true
      },
      {
        id: 'idx_name',
        name: 'idx_name',
        rname: '索引名',
        type: 'str',
        j_type: 'str',
        req_or_opt: 'required',
        c_type: 'data',
        c_index: 2,
        src: ''
      },
      {
        id: '_should_export',
        name: '_should_export',
        rname: '导出',
        type: 'bool',
        j_type: 'bool',
        req_or_opt: 'optional',
        default_v: true,
        c_type: 'sup',
        c_index: 3,
        src: ''
      }
    ],
    rows: []
  }
  jdbService.saveDatabase(filePath, db)
  return db
}

export function removeTable(filePath: string, tableName: string): JDBDatabase {
  const db = jdbService.loadDatabase(filePath)
  if (!db[tableName]) {
    throw new Error(`Table "${tableName}" does not exist`)
  }
  delete db[tableName]
  jdbService.saveDatabase(filePath, db)
  return db
}

export function renameTable(
  filePath: string,
  oldName: string,
  newName: string
): JDBDatabase {
  const db = jdbService.loadDatabase(filePath)
  if (!db[oldName]) {
    throw new Error(`Table "${oldName}" does not exist`)
  }
  if (db[newName]) {
    throw new Error(`Table "${newName}" already exists`)
  }
  // Preserve key order: rebuild the object
  const newDb: JDBDatabase = {}
  for (const key of Object.keys(db)) {
    if (key === oldName) {
      newDb[newName] = db[oldName]
    } else {
      newDb[key] = db[key]
    }
  }
  jdbService.saveDatabase(filePath, newDb)
  return newDb
}

// ── Column operations ──

export function addColumn(
  filePath: string,
  tableName: string,
  column: ColDef
): JDBDatabase {
  const db = jdbService.loadDatabase(filePath)
  const table = db[tableName]
  if (!table) throw new Error(`Table "${tableName}" does not exist`)
  table.columns.push(column)
  jdbService.saveDatabase(filePath, db)
  return db
}

export function updateColumn(
  filePath: string,
  tableName: string,
  columnId: string,
  updates: Partial<ColDef>
): JDBDatabase {
  const db = jdbService.loadDatabase(filePath)
  const table = db[tableName]
  if (!table) throw new Error(`Table "${tableName}" does not exist`)
  const idx = table.columns.findIndex((c) => c.id === columnId)
  if (idx === -1) throw new Error(`Column "${columnId}" not found`)
  table.columns[idx] = { ...table.columns[idx], ...updates }
  jdbService.saveDatabase(filePath, db)
  return db
}

export function removeColumn(
  filePath: string,
  tableName: string,
  columnId: string
): JDBDatabase {
  const db = jdbService.loadDatabase(filePath)
  const table = db[tableName]
  if (!table) throw new Error(`Table "${tableName}" does not exist`)
  // Find the column name before removing it
  const removedCol = table.columns.find((c) => c.id === columnId)
  table.columns = table.columns.filter((c) => c.id !== columnId)
  // Also remove the field from all rows
  if (removedCol) {
    for (const row of table.rows) {
      delete row[removedCol.name]
    }
  }
  jdbService.saveDatabase(filePath, db)
  return db
}

// ── Row operations ──

export function addRow(
  filePath: string,
  tableName: string,
  row: RowData
): JDBDatabase {
  const db = jdbService.loadDatabase(filePath)
  const table = db[tableName]
  if (!table) throw new Error(`Table "${tableName}" does not exist`)
  table.rows.push(row)
  jdbService.saveDatabase(filePath, db)
  return db
}

export function updateRow(
  filePath: string,
  tableName: string,
  rowIndex: number,
  updates: Partial<RowData>
): JDBDatabase {
  const db = jdbService.loadDatabase(filePath)
  const table = db[tableName]
  if (!table) throw new Error(`Table "${tableName}" does not exist`)
  if (rowIndex < 0 || rowIndex >= table.rows.length) {
    throw new Error(`Row index ${rowIndex} out of range`)
  }
  table.rows[rowIndex] = { ...table.rows[rowIndex], ...updates }
  jdbService.saveDatabase(filePath, db)
  return db
}

export function deleteRows(
  filePath: string,
  tableName: string,
  rowIndices: number[]
): JDBDatabase {
  const db = jdbService.loadDatabase(filePath)
  const table = db[tableName]
  if (!table) throw new Error(`Table "${tableName}" does not exist`)
  const indexSet = new Set(rowIndices)
  table.rows = table.rows.filter((_, i) => !indexSet.has(i))
  jdbService.saveDatabase(filePath, db)
  return db
}

// ── Validation ──

export function validateTable(
  filePath: string,
  tableName: string,
  allTables?: JDBDatabase
): ValidationIssue[] {
  const db = allTables || jdbService.loadDatabase(filePath)
  const table = db[tableName]
  if (!table) return [{ level: 'error', tableName, rowIndex: -1, message: `Table "${tableName}" not found` }]

  const issues: ValidationIssue[] = []
  const dataColumns = table.columns.filter((c) => c.c_type === 'data')
  const idSet = new Set<string | number>()

  for (let ri = 0; ri < table.rows.length; ri++) {
    const row = table.rows[ri]

    // ID uniqueness
    if (row.id !== undefined && row.id !== null && row.id !== '') {
      if (idSet.has(row.id)) {
        issues.push({
          level: 'error',
          tableName,
          rowIndex: ri,
          rowId: row.id,
          columnName: 'id',
          message: `Duplicate ID: ${row.id}`
        })
      }
      idSet.add(row.id)
    }

    for (const col of dataColumns) {
      const value = row[col.name]

      // Required field check
      if (col.req_or_opt === 'required' && (value === undefined || value === null || value === '')) {
        issues.push({
          level: 'error',
          tableName,
          rowIndex: ri,
          rowId: row.id,
          columnName: col.name,
          message: `Required field "${col.rname}" is empty`
        })
        continue
      }

      // Skip further checks if value is empty and field is optional
      if (value === undefined || value === null || value === '') continue

      // Type checking
      const baseType = col.j_type.split('/')[0].split(':')[0]
      switch (baseType) {
        case 'int': {
          const n = Number(value)
          if (!Number.isInteger(n)) {
            issues.push({
              level: 'error',
              tableName,
              rowIndex: ri,
              rowId: row.id,
              columnName: col.name,
              message: `"${col.rname}" should be an integer, got: ${value}`
            })
          }
          break
        }
        case 'float': {
          const n = Number(value)
          if (isNaN(n)) {
            issues.push({
              level: 'error',
              tableName,
              rowIndex: ri,
              rowId: row.id,
              columnName: col.name,
              message: `"${col.rname}" should be a number, got: ${value}`
            })
          }
          break
        }
        case 'index': {
          // Check if referenced value exists in source table
          if (allTables) {
            const srcTable = col.type.split('/')[1]
            if (srcTable && allTables[srcTable]) {
              const srcRows = allTables[srcTable].rows
              const exists = srcRows.some(
                (sr) => sr.idx_name === String(value) || String(sr.id) === String(value)
              )
              if (!exists) {
                issues.push({
                  level: 'warning',
                  tableName,
                  rowIndex: ri,
                  rowId: row.id,
                  columnName: col.name,
                  message: `Referenced value "${value}" not found in table "${srcTable}"`
                })
              }
            }
          }
          break
        }
        case 'indices': {
          if (allTables) {
            const srcTable = col.type.split('/')[1]
            if (srcTable && allTables[srcTable]) {
              const srcRows = allTables[srcTable].rows
              const vals = String(value).split('|').map((v) => v.trim()).filter(Boolean)
              for (const v of vals) {
                const exists = srcRows.some(
                  (sr) => sr.idx_name === v || String(sr.id) === v
                )
                if (!exists) {
                  issues.push({
                    level: 'warning',
                    tableName,
                    rowIndex: ri,
                    rowId: row.id,
                    columnName: col.name,
                    message: `Referenced value "${v}" not found in table "${srcTable}"`
                  })
                }
              }
            }
          }
          break
        }
      }
    }
  }

  return issues
}

// ── Export path calculation ──

/**
 * Determine the correct export output path for a table based on JDB file location.
 * JDB files are at: data/{rel_dir}/{filename}.jdb
 * Python output goes to: game/common/data/{rel_dir}/{tb_name}.py
 * JSON output goes to: game/common/data/{rel_dir}/{tb_name}.json
 */
function getExportPath(
  filePath: string,
  tableName: string,
  workspacePath: string,
  format: 'python' | 'json'
): string {
  const relToWorkspace = path.relative(workspacePath, filePath)
  const parts = relToWorkspace.split(path.sep)

  // Expected: data/{rel_dir_1}/{rel_dir_2}/.../{filename}.jdb
  // Use full relative path between 'data/' and the filename
  let relDir = ''
  if (parts.length >= 3 && parts[0] === 'data') {
    relDir = parts.slice(1, -1).join(path.sep)
  } else if (parts.length >= 2) {
    relDir = parts.slice(0, -1).join(path.sep)
  }

  const ext = format === 'python' ? '.py' : '.json'
  const outputDir = path.join(workspacePath, 'game', 'common', 'data', relDir)

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  return path.join(outputDir, `${tableName}${ext}`)
}

// ── xlog stub for Python check/post-process scripts ──

let _xlogStubDir: string | null = null

function ensureXlogStub(): string {
  if (_xlogStubDir) return _xlogStubDir
  _xlogStubDir = path.join(os.tmpdir(), 'clawbench-copiper-stubs')
  if (!fs.existsSync(_xlogStubDir)) {
    fs.mkdirSync(_xlogStubDir, { recursive: true })
  }
  const stubPath = path.join(_xlogStubDir, 'xlog.py')
  if (!fs.existsSync(stubPath)) {
    fs.writeFileSync(
      stubPath,
      [
        '# xlog stub for ClawBench CoPiper',
        'def debug(msg, *a, **kw): pass',
        'def info(msg, *a, **kw): pass',
        'def warn(msg, *a, **kw): pass',
        'def warning(msg, *a, **kw): pass',
        'def error(msg, *a, **kw): pass',
        'def critical(msg, *a, **kw): pass',
        'class _L:',
        '    debug=info=warn=warning=error=critical=staticmethod(lambda m,*a,**k:None)',
        'def logger(name=None, sink=None): return _L()',
      ].join('\n'),
      'utf-8'
    )
  }
  // Platform compatibility wrapper: fixes Windows-style backslash paths in os.path.join
  const runnerPath = path.join(_xlogStubDir, '_compat_runner.py')
  if (!fs.existsSync(runnerPath)) {
    fs.writeFileSync(
      runnerPath,
      [
        'import os, sys, runpy',
        'if os.sep != "\\\\":',
        '    _oj = os.path.join',
        '    def _compat_join(*a):',
        '        return _oj(*[x.replace(chr(92), os.sep) if isinstance(x, str) else x for x in a])',
        '    os.path.join = _compat_join',
        'if len(sys.argv) > 1:',
        '    script = sys.argv[1]',
        '    sys.argv = sys.argv[1:]',
        '    runpy.run_path(script, run_name="__main__")',
      ].join('\n'),
      'utf-8'
    )
  }
  return _xlogStubDir
}

// ── Custom check / post-process scripts ──

/**
 * Run a custom check or post-process Python script for a table.
 * Scripts live at: {workspacePath}/data/copiper/{scriptType}/{relDir}_{tbName}.py
 */
function runCustomScript(
  workspacePath: string,
  scriptType: 'check' | 'post_process',
  relDir: string,
  tbName: string,
  dbKey?: string
): { result: boolean; info: string; r_c_e: unknown[] } {
  const scriptPath = path.join(workspacePath, 'data', 'copiper', scriptType, `${relDir}_${tbName}.py`)
  if (!fs.existsSync(scriptPath)) {
    return { result: true, info: `No custom ${scriptType} script`, r_c_e: [] }
  }

  try {
    const { execSync } = require('child_process')
    const input = dbKey ? JSON.stringify({ db_key: dbKey }) : ''
    const xlogDir = ensureXlogStub()
    const env = {
      ...process.env,
      PYTHONPATH: [
        xlogDir,
        path.join(workspacePath, 'data'),
        path.join(workspacePath, 'data', 'xconvertor'),
        path.join(workspacePath, 'data', 'xconvertor', 'scripts'),
        path.join(workspacePath, 'data', 'copiper')
      ].join(path.delimiter),
      PYTHONIOENCODING: 'utf-8'
    }
    const result = execSync(`python3 "${path.join(xlogDir, '_compat_runner.py')}" "${scriptPath}"`, {
      input,
      env,
      cwd: workspacePath,
      encoding: 'utf-8',
      timeout: 30000
    })

    // Parse JSON result from stdout (first valid JSON line)
    for (const line of result.split('\n')) {
      try {
        const parsed = JSON.parse(line.trim())
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed
        }
      } catch {
        // not JSON, skip
      }
    }
    return { result: true, info: `Custom ${scriptType} completed`, r_c_e: [] }
  } catch (err: any) {
    logger.error(`Custom ${scriptType} script failed:`, err)
    return { result: true, info: `Custom ${scriptType} script error: ${err.message}`, r_c_e: [] }
  }
}

/**
 * Run the all.py post-process script that handles all tables at once.
 */
function runAllPostProcess(
  workspacePath: string
): { result: boolean; info: string; r_c_e: unknown[] } {
  const scriptPath = path.join(workspacePath, 'data', 'copiper', 'post_process', 'all.py')
  if (!fs.existsSync(scriptPath)) {
    return { result: true, info: '', r_c_e: [] }
  }

  try {
    const { execSync } = require('child_process')
    const xlogDir = ensureXlogStub()
    const env = {
      ...process.env,
      PYTHONPATH: [
        xlogDir,
        path.join(workspacePath, 'data'),
        path.join(workspacePath, 'data', 'xconvertor'),
        path.join(workspacePath, 'data', 'xconvertor', 'scripts'),
        path.join(workspacePath, 'data', 'copiper')
      ].join(path.delimiter),
      PYTHONIOENCODING: 'utf-8'
    }
    const result = execSync(`python3 "${path.join(xlogDir, '_compat_runner.py')}" "${scriptPath}"`, {
      env,
      cwd: workspacePath,
      encoding: 'utf-8',
      timeout: 120000
    })

    for (const line of result.split('\n')) {
      try {
        const parsed = JSON.parse(line.trim())
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed
        }
      } catch {
        // not JSON, skip
      }
    }
    return { result: true, info: 'all.py completed', r_c_e: [] }
  } catch (err: any) {
    logger.error('all.py post-process failed:', err)
    const stderr = err.stderr ? String(err.stderr).slice(0, 500) : err.message
    return { result: false, info: `all.py error: ${stderr}`, r_c_e: [] }
  }
}

// ── Export ──

export function exportTable(
  filePath: string,
  tableName: string,
  config: ExportConfig,
  workspacePath: string,
  allTables?: JDBDatabase,
  _skipPostProcess?: boolean
): ExportResult[] {
  const db = allTables || jdbService.loadDatabase(filePath)
  const table = db[tableName]
  if (!table) {
    return [{
      tableName,
      format: 'python',
      outputPath: '',
      success: false,
      error: `Table "${tableName}" not found`,
      rowCount: 0
    }]
  }

  // Determine relDir and tbName from file path
  const relToWorkspace = path.relative(workspacePath, filePath)
  const pathParts = relToWorkspace.split(path.sep)
  const relDir = pathParts.length >= 3 && pathParts[0] === 'data' ? pathParts[1] : ''
  const dbFileName = path.basename(filePath, '.jdb')
  const dbKey = relDir ? `${relDir}_${dbFileName}_${tableName}` : tableName

  // Load all workspace tables for cross-file reference resolution
  // If allTables was pre-loaded (from exportAll), skip redundant scan
  const allWorkspaceTables = allTables
    ? allTables
    : loadAllWorkspaceTables(workspacePath, jdbService.loadDatabase(filePath))

  // Build export data first to detect empty tables
  const exportedRows = buildExportRows(table, allWorkspaceTables)

  // Skip empty tables entirely (no check, no export, no post-process)
  if (exportedRows.length === 0) {
    return config.formats.map((format) => ({
      tableName,
      format,
      outputPath: '',
      success: true,
      skipped: true,
      rowCount: 0
    }))
  }

  // Run custom check (only for non-empty tables)
  const checkResult = runCustomScript(workspacePath, 'check', relDir, tableName, dbKey)
  const checkInfo = checkResult.info || ''
  if (!checkResult.result) {
    return [{
      tableName,
      format: config.formats[0] || 'python',
      outputPath: '',
      success: false,
      error: checkResult.info,
      rowCount: 0,
      checkInfo
    }]
  }

  const defaultData = buildDefaultData(table, allWorkspaceTables)
  const results: ExportResult[] = []

  for (const format of config.formats) {
    try {
      let outputPath: string

      if (config.outputDir) {
        // Explicit output dir specified - use it directly
        const subDir = config.exportSubDir || ''
        const exportDir = subDir ? path.join(config.outputDir, subDir) : config.outputDir
        if (!fs.existsSync(exportDir)) {
          fs.mkdirSync(exportDir, { recursive: true })
        }
        const ext = format === 'python' ? '.py' : '.json'
        outputPath = path.join(exportDir, `${tableName}${ext}`)
      } else {
        // Use convention-based path: game/common/data/{relDir}/{tableName}.ext
        outputPath = getExportPath(filePath, tableName, workspacePath, format)
      }

      if (format === 'python') {
        const content = generatePython(
          tableName,
          exportedRows,
          defaultData,
          relDir,
          dbFileName,
          config.pythonHeader
        )
        fs.writeFileSync(outputPath, content, 'utf-8')
        results.push({
          tableName,
          format: 'python',
          outputPath,
          success: true,
          rowCount: exportedRows.length,
          checkInfo
        })
      } else {
        const content = JSON.stringify({ data: exportedRows }, null, 2)
        fs.writeFileSync(outputPath, content, 'utf-8')
        results.push({
          tableName,
          format: 'json',
          outputPath,
          success: true,
          rowCount: exportedRows.length,
          checkInfo
        })
      }
    } catch (err: any) {
      logger.error(`Failed to export table ${tableName} as ${format}:`, err)
      results.push({
        tableName,
        format,
        outputPath: '',
        success: false,
        error: err.message,
        rowCount: 0,
        checkInfo
      })
    }
  }

  // Run post-process scripts (unless batch export handles this separately)
  if (!_skipPostProcess) {
    const postInfoParts: string[] = []

    // Run all.py first (default post-process for all tables)
    const allResult = runAllPostProcess(workspacePath)
    if (allResult.info) {
      postInfoParts.push(`[all] ${allResult.info}`)
    }

    // Then run table-specific post-process
    const postResult = runCustomScript(workspacePath, 'post_process', relDir, tableName, dbKey)
    if (postResult.info && !postResult.info.startsWith('No custom')) {
      postInfoParts.push(postResult.info)
    }

    const postProcessInfo = postInfoParts.join('; ')
    for (const r of results) {
      r.postProcessInfo = postProcessInfo
    }
  }

  return results
}

export function exportAll(
  filePath: string,
  config: ExportConfig,
  workspacePath: string
): ExportResult[] {
  const db = jdbService.loadDatabase(filePath)
  const tableNames = config.tableNames && config.tableNames.length > 0
    ? config.tableNames
    : Object.keys(db)

  // Preload all workspace tables once for cross-file reference resolution
  const allWorkspaceTables = loadAllWorkspaceTables(workspacePath, db)

  // Phase 1: Export all tables (skip per-table post-process)
  // Pass preloaded allWorkspaceTables instead of just db
  const results: ExportResult[] = []
  for (const tableName of tableNames) {
    const tableResults = exportTable(filePath, tableName, config, workspacePath, allWorkspaceTables, true)
    results.push(...tableResults)
  }

  // Phase 2: Run all.py post-process once for all tables
  const allPostResult = runAllPostProcess(workspacePath)

  // Phase 3: Run per-table post-process and attach info (skip for empty/skipped tables)
  const relToWorkspace = path.relative(workspacePath, filePath)
  const pathParts = relToWorkspace.split(path.sep)
  const relDir = pathParts.length >= 3 && pathParts[0] === 'data' ? pathParts[1] : ''
  const dbFileName = path.basename(filePath, '.jdb')

  for (const tableName of tableNames) {
    const tableResults = results.filter((r) => r.tableName === tableName)
    const allSkipped = tableResults.length > 0 && tableResults.every((r) => r.skipped)

    if (allSkipped) {
      // Mark skipped tables with Skipped info for both check and post-process
      for (const r of tableResults) {
        r.checkInfo = 'Skipped (empty table)'
        r.postProcessInfo = 'Skipped (empty table)'
      }
      continue
    }

    const dbKey = relDir ? `${relDir}_${dbFileName}_${tableName}` : tableName
    const postResult = runCustomScript(workspacePath, 'post_process', relDir, tableName, dbKey)

    const postInfoParts: string[] = []
    if (allPostResult.info) {
      postInfoParts.push(`[all] ${allPostResult.info}`)
    }
    if (postResult.info && !postResult.info.startsWith('No custom')) {
      postInfoParts.push(postResult.info)
    }
    const postProcessInfo = postInfoParts.join('; ')

    for (const r of tableResults) {
      r.postProcessInfo = postProcessInfo
    }
  }

  return results
}

// ── Table Infos (tb_infos.jdb) ──

export function getTableInfos(workspacePath: string): any[] {
  const infoPath = findTbInfosPath(workspacePath)
  if (!infoPath || !fs.existsSync(infoPath)) return []

  try {
    const db = jdbService.loadDatabase(infoPath)
    // tb_infos.jdb typically has a single table
    const firstTable = Object.values(db)[0]
    return firstTable ? firstTable.rows : []
  } catch (err) {
    logger.error('Failed to load tb_infos.jdb:', err)
    return []
  }
}

export function saveTableInfos(workspacePath: string, infos: any[]): void {
  const infoPath = findTbInfosPath(workspacePath)
  if (!infoPath) {
    logger.warn('tb_infos.jdb path not found for workspace:', workspacePath)
    return
  }

  try {
    const db = jdbService.loadDatabase(infoPath)
    const tableName = Object.keys(db)[0]
    if (tableName) {
      db[tableName].rows = infos
      jdbService.saveDatabase(infoPath, db)
    }
  } catch (err) {
    logger.error('Failed to save tb_infos.jdb:', err)
  }
}

// ── Settings ──

export function getSettings(): CopiperSettings {
  return getExportSettings()
}

export function saveSettings(settings: Partial<CopiperSettings>): void {
  setExportSettings(settings)
}

// ── Internal helpers ──

/**
 * Recursively scan a directory for .jdb files (synchronous).
 */
function scanJDBFilesSync(dir: string): string[] {
  const results: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        results.push(...scanJDBFilesSync(fullPath))
      } else if (entry.name.endsWith('.jdb') && entry.name !== 'tb_infos.jdb') {
        results.push(fullPath)
      }
    }
  } catch {
    // skip inaccessible directories
  }
  return results
}

/**
 * Load all tables from all JDB files in workspace for cross-file reference resolution.
 */
function loadAllWorkspaceTables(workspacePath: string, currentDb?: JDBDatabase): JDBDatabase {
  const all: JDBDatabase = {}
  const dataDir = path.join(workspacePath, 'data')
  if (fs.existsSync(dataDir)) {
    const jdbPaths = scanJDBFilesSync(dataDir)
    for (const filePath of jdbPaths) {
      try {
        const db = jdbService.loadDatabase(filePath)
        Object.assign(all, db)
      } catch {
        // skip unreadable files
      }
    }
  }
  // Current DB overrides (may have unsaved in-memory changes)
  if (currentDb) Object.assign(all, currentDb)
  return all
}

/**
 * Load reference data (id + idx_name) for specific tables from across all JDB files.
 * Used by renderer for populating index column dropdowns.
 */
export function loadReferenceData(
  workspacePath: string,
  tableNames: string[]
): Record<string, Array<{ id: number | string; idx_name?: string }>> {
  const result: Record<string, Array<{ id: number | string; idx_name?: string }>> = {}
  const needed = new Set(tableNames)
  if (needed.size === 0) return result

  const dataDir = path.join(workspacePath, 'data')
  if (!fs.existsSync(dataDir)) return result

  const jdbPaths = scanJDBFilesSync(dataDir)
  for (const filePath of jdbPaths) {
    if (needed.size === 0) break
    try {
      const db = jdbService.loadDatabase(filePath)
      for (const tblName of Object.keys(db)) {
        if (needed.has(tblName)) {
          result[tblName] = db[tblName].rows.map((r) => ({
            id: r.id,
            idx_name: r.idx_name
          }))
          needed.delete(tblName)
        }
      }
    } catch {
      // skip
    }
  }
  return result
}

function findTbInfosPath(workspacePath: string): string | null {
  // Look for tb_infos.jdb in common locations
  const candidates = [
    path.join(workspacePath, 'data', 'tb_infos.jdb'),
    path.join(workspacePath, 'tb_infos.jdb'),
    path.join(workspacePath, 'config', 'tb_infos.jdb')
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0] // default path
}

// ── Export type parsing context ──

interface ExportContext {
  /** All tables from all JDB files (for cross-file reference resolution) */
  allTables: JDBDatabase
  /** src_from_to_map: srcTableName → { idx_name → id } */
  srcFromToMap: Record<string, Record<string, number | string>>
  /** src_to_from_map: srcTableName → { id → idx_name } */
  srcToFromMap: Record<string, Record<string, string>>
  /** all_tb_cols_infos: tableName → { colName → ColDef } (for kv/ckv struct lookup) */
  allColsInfo: Record<string, Record<string, ColDef>>
}

/**
 * Build the export context with all cross-reference mappings.
 */
function buildExportContext(allTables: JDBDatabase): ExportContext {
  const srcFromToMap: Record<string, Record<string, number | string>> = {}
  const srcToFromMap: Record<string, Record<string, string>> = {}
  const allColsInfo: Record<string, Record<string, ColDef>> = {}

  for (const [tableName, tableData] of Object.entries(allTables)) {
    // Build cols info map
    const colMap: Record<string, ColDef> = {}
    for (const col of tableData.columns) {
      colMap[col.name] = col
    }
    allColsInfo[tableName] = colMap

    // Build from/to maps: idx_name → id, id → idx_name
    const fromTo: Record<string, number | string> = {}
    const toFrom: Record<string, string> = {}
    for (const row of tableData.rows) {
      if (row._should_export === false) continue
      const idxName = row.idx_name != null ? String(row.idx_name) : ''
      const id = row.id
      if (idxName && id !== undefined && id !== null) {
        fromTo[idxName] = id as number | string
        toFrom[String(id)] = idxName
      }
    }
    if (Object.keys(fromTo).length > 0) {
      srcFromToMap[tableName] = fromTo
      srcToFromMap[tableName] = toFrom
    }
  }

  return { allTables, srcFromToMap, srcToFromMap, allColsInfo }
}

/**
 * Main dispatcher: parse a cell value according to its column j_type.
 * Mirrors the original CoPiper parse_row_kv logic.
 */
function parseValue(
  value: unknown,
  colDef: { j_type?: string; type?: string; src?: string; name?: string; default_v?: unknown },
  ctx: ExportContext
): unknown {
  if (value === undefined || value === null || value === '') return value

  const jType = colDef.j_type || ''
  if (!jType) return value

  // Dispatch order follows the original CoPiper parse_row_kv
  if (jType.startsWith('list:kv:')) {
    const kvName = jType.split(':').slice(-1)[0]
    const kvInfo = ctx.allColsInfo[kvName] || {}
    return parseKvList(value, kvInfo, ctx)
  }
  if (jType.startsWith('kv:')) {
    const kvName = jType.split(':').slice(-1)[0]
    const kvInfo = ctx.allColsInfo[kvName] || {}
    return parseKv(value, kvInfo, ctx)
  }
  if (jType.startsWith('list:ckv')) {
    return parseCkvList(value, colDef, ctx)
  }
  if (jType.startsWith('list:')) {
    return parseList(value, colDef, ctx)
  }
  if (jType.startsWith('ckv')) {
    return parseCkv(value, colDef, ctx)
  }
  if (jType === 'index') {
    const src = colDef.src || (colDef.type ? colDef.type.split('/')[1] : '')
    return resolveIndex(value, src, ctx)
  }
  if (jType === 'Istr' || jType === 'istr') {
    return parseIstr(value, ctx)
  }
  if (jType === 'int') return toInt(value)
  if (jType === 'float') return toFloat(value)
  if (jType === 'bool') return toBool(value)
  if (jType === 'dict') return parsePythonValue(value)
  if (jType === 'list') return parsePythonValue(value)
  if (jType === 'str') return String(value)
  if (jType.startsWith('utc_time')) {
    const tzStr = jType.includes(':') ? jType.split(':').slice(1).join(':') : 'UTC'
    return parseUtcTime(value, tzStr)
  }
  if (jType === 'Tstr' || jType === 'tstr') return parseTstr(value)

  return value
}

/**
 * Build export rows from a table, resolving index references and converting types.
 * Optional fields whose parsed value matches the default value are omitted.
 */
function buildExportRows(
  table: JDBTableData,
  allTables: JDBDatabase
): Record<string, unknown>[] {
  const ctx = buildExportContext(allTables)

  const exportCols = table.columns.filter(
    (c) => c.c_type !== 'rdesc' && c.c_type !== 'sup' && c.name !== 'idx_name'
  )

  // Pre-compute parsed default values for optional columns
  const optionalDefaults: Record<string, unknown> = {}
  for (const col of exportCols) {
    if (col.req_or_opt === 'optional' && col.default_v !== undefined && col.default_v !== null) {
      optionalDefaults[col.name] = parseValue(col.default_v, col, ctx)
    }
  }

  const rows: Record<string, unknown>[] = []

  for (const row of table.rows) {
    if (row._should_export === false) continue

    const exported: Record<string, unknown> = {}

    for (const col of exportCols) {
      const value = row[col.name]

      // Skip optional fields with empty values
      if (col.req_or_opt === 'optional' && (value === undefined || value === null || value === '')) {
        continue
      }

      const parsed = parseValue(value, col, ctx)

      // Skip optional fields whose value matches the default
      if (col.req_or_opt === 'optional' && col.name in optionalDefaults) {
        if (deepEqual(parsed, optionalDefaults[col.name])) {
          continue
        }
      }

      exported[col.name] = parsed
    }

    rows.push(exported)
  }

  return rows
}

/**
 * Build default data object from column definitions.
 */
function buildDefaultData(
  table: JDBTableData,
  allTables: JDBDatabase
): Record<string, unknown> {
  const ctx = buildExportContext(allTables)
  const defaults: Record<string, unknown> = {}
  const exportCols = table.columns.filter(
    (c) => c.c_type !== 'rdesc' && c.c_type !== 'sup' && c.name !== 'idx_name'
  )

  defaults['id'] = 'default'

  for (const col of exportCols) {
    if (col.name === 'id') continue
    if (col.default_v !== undefined && col.default_v !== null) {
      defaults[col.name] = parseValue(col.default_v, col, ctx)
    }
  }

  return defaults
}

// ── Type-specific parsers ──

/**
 * Resolve a single index reference: idx_name → id.
 * Tries numeric ID first, then idx_name lookup.
 */
function resolveIndex(
  value: unknown,
  srcTableName: string | undefined,
  ctx: ExportContext
): unknown {
  if (value === undefined || value === null || value === '') return value
  if (!srcTableName) return value

  const strVal = String(value).trim()

  // 1. Try direct ID lookup: if value is numeric, check if it exists as an ID
  const toFromMap = ctx.srcToFromMap[srcTableName]
  if (toFromMap) {
    const numVal = Number(strVal)
    if (!isNaN(numVal) && String(numVal) in toFromMap) {
      return numVal
    }
    // Also check string ID
    if (strVal in toFromMap) {
      return strVal
    }
  }

  // 2. Look up by idx_name
  const fromToMap = ctx.srcFromToMap[srcTableName]
  if (fromToMap && strVal in fromToMap) {
    return fromToMap[strVal]
  }

  // 3. Fallback: try direct lookup in source table rows
  const srcTable = ctx.allTables[srcTableName]
  if (srcTable) {
    const match = srcTable.rows.find((r) => r.idx_name === strVal)
    if (match) return match.id
    const numVal = Number(strVal)
    if (!isNaN(numVal)) {
      const idMatch = srcTable.rows.find((r) => r.id === numVal)
      if (idMatch) return numVal
    }
  }

  logger.warn(`Index "${strVal}" not found in source table "${srcTableName}"`)
  return value
}

/**
 * Parse istr: replace <TableName>[idx_name] patterns with resolved IDs.
 */
function parseIstr(value: unknown, ctx: ExportContext): unknown {
  if (value === undefined || value === null || value === '') return value
  const strVal = String(value)

  // Split by pipe for multi-value istr
  const parts = strVal.split('|')
  const outParts: string[] = []

  for (const part of parts) {
    // Match <TableName>[idx_name] patterns
    const regex = /<([^>]+)>\[([^\]]+)\]/g
    let result = part
    let match: RegExpExecArray | null
    while ((match = regex.exec(part)) !== null) {
      const srcTable = match[1]
      const idxName = match[2]
      const resolved = resolveIndex(idxName, srcTable, ctx)
      if (resolved !== undefined && resolved !== null) {
        result = result.replace(`<${srcTable}>[${idxName}]`, String(resolved))
      }
    }
    outParts.push(result)
  }

  return outParts.join('|')
}

/**
 * Parse list:* type — split by | and recursively parse each element.
 * e.g. list:int, list:index/Table, list:str, list:float, list:bool
 */
function parseList(
  value: unknown,
  colDef: { j_type?: string; src?: string; name?: string },
  ctx: ExportContext
): unknown[] {
  if (value === undefined || value === null || value === '') return []
  const jType = colDef.j_type || ''
  if (!jType.startsWith('list:')) return []

  // Extract element type: "list:int" → "int", "list:index" → "index"
  const elementType = jType.split(':').slice(1).join(':')

  // Split: if already array, use directly; otherwise split by |
  let elements: unknown[]
  if (Array.isArray(value)) {
    elements = value
  } else {
    elements = String(value).split('|')
  }

  const result: unknown[] = []
  for (const elem of elements) {
    if (elem === undefined || elem === null || elem === '') continue
    const childDef = { j_type: elementType, src: colDef.src, name: colDef.name }
    const parsed = parseValue(elem, childDef, ctx)
    if (parsed !== undefined && parsed !== null) {
      result.push(parsed)
    }
  }
  return result
}

/**
 * Parse ckv (conditional key-value) type.
 * Value is a Python dict string with a `cls` field identifying the structure.
 */
function parseCkv(
  value: unknown,
  colDef: { j_type?: string },
  ctx: ExportContext
): unknown {
  if (value === undefined || value === null || value === '') return value

  const dictVal = parsePythonValue(value)
  if (!dictVal || typeof dictVal !== 'object' || Array.isArray(dictVal)) return dictVal

  const obj = dictVal as Record<string, unknown>
  const jType = colDef.j_type || ''

  // Extract ckv struct key name from j_type: "ckv:WeaponType" → "WeaponType"
  const ckvKey = jType.includes(':') ? jType.split(':').slice(-1)[0] : ''

  // Find class name
  const clsName = obj['cls'] as string | undefined
  if (!clsName) return obj

  // Build output with the ckv key pointing to class name
  const outDict: Record<string, unknown> = {}
  if (ckvKey) {
    outDict[ckvKey] = clsName
  }

  // Look up column definitions for the class
  const clsColsInfo = ctx.allColsInfo[clsName] || {}

  for (const [k, v] of Object.entries(obj)) {
    if (k === 'cls') continue
    if (k in outDict) continue

    const fieldColDef = clsColsInfo[k]
    if (fieldColDef) {
      outDict[k] = parseValue(v, fieldColDef, ctx)
    } else {
      outDict[k] = v
    }
  }

  // Fill in defaults for missing fields (only data columns, skip system columns)
  for (const [colName, colInfo] of Object.entries(clsColsInfo)) {
    if (colInfo.c_type && colInfo.c_type !== 'data') continue
    if (colName === 'idx_name' || colName === 'id' || colName === 'rdesc') continue
    if (colName in outDict) continue
    if (colInfo.default_v !== undefined && colInfo.default_v !== null) {
      outDict[colName] = parseDefaultValue(colInfo.default_v, colInfo, ctx)
    }
  }

  return outDict
}

/**
 * Parse list of ckv objects.
 */
function parseCkvList(
  value: unknown,
  colDef: { j_type?: string },
  ctx: ExportContext
): unknown[] {
  if (value === undefined || value === null || value === '') return []

  const listVal = parsePythonValue(value)
  if (!Array.isArray(listVal)) return []

  const result: unknown[] = []
  for (const item of listVal) {
    const parsed = parseCkv(item, colDef, ctx)
    if (parsed !== undefined && parsed !== null) {
      result.push(parsed)
    }
  }
  return result
}

/**
 * Parse kv (key-value) type.
 * Uses column definitions from the named structure to recursively parse values.
 */
function parseKv(
  value: unknown,
  kvInfo: Record<string, ColDef>,
  ctx: ExportContext
): unknown {
  if (value === undefined || value === null || value === '') return value

  let dictVal: unknown
  if (typeof value === 'object' && !Array.isArray(value)) {
    dictVal = value
  } else {
    dictVal = parsePythonValue(value)
  }

  if (!dictVal || typeof dictVal !== 'object' || Array.isArray(dictVal)) return dictVal

  const obj = dictVal as Record<string, unknown>
  const outDict: Record<string, unknown> = {}

  for (const [k, v] of Object.entries(obj)) {
    const fieldDef = kvInfo[k]
    if (fieldDef) {
      outDict[k] = parseValue(v, fieldDef, ctx)
    } else {
      outDict[k] = v
    }
  }

  // Fill in defaults for missing fields (only data columns, skip system columns)
  for (const [colName, colInfo] of Object.entries(kvInfo)) {
    if (colInfo.c_type && colInfo.c_type !== 'data') continue
    if (colName === 'idx_name' || colName === 'id' || colName === 'rdesc') continue
    if (colName in outDict) continue
    if (colInfo.default_v !== undefined && colInfo.default_v !== null) {
      outDict[colName] = parseDefaultValue(colInfo.default_v, colInfo, ctx)
    }
  }

  return outDict
}

/**
 * Parse list of kv objects. If a field has is_key, convert to dict with key_int or string key.
 */
function parseKvList(
  value: unknown,
  kvInfo: Record<string, ColDef>,
  ctx: ExportContext
): unknown {
  if (value === undefined || value === null || value === '') return []

  let listVal: unknown
  if (Array.isArray(value)) {
    listVal = value
  } else {
    listVal = parsePythonValue(value)
  }

  if (!Array.isArray(listVal)) return []

  const parsedList: Record<string, unknown>[] = []
  for (const item of listVal) {
    const parsed = parseKv(item, kvInfo, ctx)
    if (parsed !== undefined && parsed !== null && typeof parsed === 'object') {
      parsedList.push(parsed as Record<string, unknown>)
    }
  }

  // Check if any column has is_key — if so, convert list to keyed dict
  let keyColName = ''
  for (const [name, info] of Object.entries(kvInfo)) {
    if (info.is_key) {
      keyColName = name
      break
    }
  }

  if (keyColName && parsedList.length > 0) {
    const outDict: Record<string, unknown> = {}
    for (const kv of parsedList) {
      const keyVal = kv[keyColName]
      if (typeof keyVal === 'number') {
        outDict[`key_int\`${keyVal}\``] = kv
      } else if (keyVal !== undefined && keyVal !== null) {
        outDict[String(keyVal)] = kv
      }
    }
    return outDict
  }

  return parsedList
}

/**
 * Parse utc_time: convert datetime string to Unix timestamp.
 * Supports "YYYY-MM-DD HH:MM:SS" format with timezone offset.
 */
function parseUtcTime(value: unknown, timezoneStr: string = 'UTC'): unknown {
  if (value === undefined || value === null || value === '') return value
  if (typeof value === 'number') return value

  let strVal = String(value).trim()
  // Remove wrapper format like "utc+0(2025-09-18 16:00:00)"
  strVal = strVal.replace(/^utc\+\d+\(/, '').replace(/\)$/, '')

  try {
    // Parse "YYYY-MM-DD HH:MM:SS"
    const match = strVal.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/)
    if (!match) {
      // Try as numeric timestamp
      const num = Number(strVal)
      if (!isNaN(num)) return num
      return value
    }

    const [, year, month, day, hour, min, sec] = match
    const date = new Date(Date.UTC(
      parseInt(year), parseInt(month) - 1, parseInt(day),
      parseInt(hour), parseInt(min), parseInt(sec)
    ))

    // Apply timezone offset
    let offsetMs = 0
    const tz = timezoneStr.trim()
    const tzUpper = tz.toUpperCase()
    if (tzUpper !== 'UTC' && tz !== '0') {
      // Parse "UTC+8", "UTC-5", "+8", "+08:00", "-5" etc.
      const offsetMatch = tz.replace(/^UTC/i, '').match(/^([+-]?)(\d+)(?::(\d+))?$/)
      if (offsetMatch) {
        const sign = offsetMatch[1] === '-' ? -1 : 1
        const hours = parseInt(offsetMatch[2])
        const minutes = parseInt(offsetMatch[3] || '0')
        offsetMs = sign * (hours * 3600000 + minutes * 60000)
      }
    }

    // The datetime string is in the given timezone, so subtract offset to get UTC
    return Math.floor((date.getTime() - offsetMs) / 1000)
  } catch {
    logger.warn(`Failed to parse utc_time: ${strVal}`)
    return value
  }
}

/**
 * Parse tstr (template string): transform CoPiper template syntax to brace format.
 */
function parseTstr(value: unknown): unknown {
  if (value === undefined || value === null || typeof value !== 'string') return value

  // Pattern: match `...][" and replace with {, then replace remaining ` with }
  const pattern = /`[^`]*?\]\[/g
  if (pattern.test(value)) {
    let result = value.replace(/`[^`]*?\]\[/g, '{')
    result = result.replace(/`/g, '}')
    return result
  }
  return value
}

/**
 * Parse a Python-style value string to JS value.
 * Handles dicts, lists, True/False/None, single quotes.
 */
function parsePythonValue(value: unknown): unknown {
  if (value === undefined || value === null) return value
  if (typeof value === 'object') return value // already parsed

  const strVal = String(value).trim()
  if (strVal === '') return value

  try {
    // Convert Python-style to JSON: single quotes → double quotes, True/False/None
    let jsonStr = strVal
      .replace(/'/g, '"')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null')
    return JSON.parse(jsonStr)
  } catch {
    return value
  }
}

/**
 * Parse a default value using its column definition.
 */
function parseDefaultValue(
  defaultVal: unknown,
  colInfo: ColDef,
  ctx: ExportContext
): unknown {
  if (defaultVal === undefined || defaultVal === null) return defaultVal
  const strVal = String(defaultVal)
  if (strVal === '[]') return []
  if (strVal === '{}') return {}
  if (strVal === 'false' || strVal === 'False') return false
  if (strVal === 'true' || strVal === 'True') return true
  if (strVal === '0') return 0
  if (strVal === '""') return ''
  return parseValue(defaultVal, colInfo, ctx)
}

/**
 * Deep equality check for comparing parsed export values with defaults.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== typeof b) return false

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }

  if (typeof a === 'object') {
    const keysA = Object.keys(a as Record<string, unknown>)
    const keysB = Object.keys(b as Record<string, unknown>)
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
      if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
    }
    return true
  }

  return false
}

function toInt(value: unknown): number {
  if (typeof value === 'number') return Math.floor(value)
  const s = String(value).trim()
  // Support hex: 0x1A2B
  if (s.startsWith('0x') || s.startsWith('0X')) {
    const n = parseInt(s, 16)
    return isNaN(n) ? 0 : n
  }
  const n = parseInt(s, 10)
  return isNaN(n) ? 0 : n
}

function toFloat(value: unknown): number {
  if (typeof value === 'number') return value
  const n = parseFloat(String(value))
  return isNaN(n) ? 0 : n
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1'
  return !!value
}

/**
 * Escape a string to use unicode escaping for non-ASCII characters.
 */
function unicodeEscape(str: string): string {
  let result = ''
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code > 127) {
      result += '\\u' + code.toString(16).padStart(4, '0')
    } else {
      result += str[i]
    }
  }
  return result
}

/**
 * Convert a JS value to Python literal string representation.
 */
function toPythonLiteral(value: unknown, indent: number = 0): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return `"${unicodeEscape(value)}"`

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const pad = '    '.repeat(indent + 1)
    const closePad = '    '.repeat(indent)
    const items = value.map((v, i) =>
      `${pad}${toPythonLiteral(v, indent + 1)}${i < value.length - 1 ? ',' : ''}`
    )
    return `[\n${items.join('\n')}\n${closePad}]`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const pad = '    '.repeat(indent + 1)
    const closePad = '    '.repeat(indent)
    const items = entries.map(
      ([k, v], i) => {
        // Handle key_int`N` markers: convert to bare integer keys
        const keyIntMatch = k.match(/^key_int`(.+)`$/)
        const keyStr = keyIntMatch ? keyIntMatch[1] : `"${unicodeEscape(k)}"`
        return `${pad}${keyStr}: ${toPythonLiteral(v, indent + 1)}${i < entries.length - 1 ? ',' : ''}`
      }
    )
    return `{\n${items.join('\n')}\n${closePad}}`
  }

  return String(value)
}

/**
 * Generate Python export file content.
 */
function generatePython(
  tableName: string,
  rows: Record<string, unknown>[],
  defaultData: Record<string, unknown>,
  relDir: string,
  fileName: string,
  headerTemplate?: string
): string {
  const header =
    headerTemplate ||
    '# Auto generated by CoPiper, do not edit it. Unless you know what you are doing for sure.'

  const lines: string[] = []
  lines.push(header)
  lines.push('')
  lines.push('')
  lines.push(`# \u6570\u636e\u6765\u6e90: ${relDir}/${fileName}.xlsx, ${tableName}`)
  lines.push('')

  // DefaultData
  lines.push(`DefaultData = ${toPythonLiteral(defaultData, 0)}`)
  lines.push('')

  // DataList
  if (rows.length === 0) {
    lines.push('DataList = []')
  } else {
    lines.push('DataList = [')
    for (let i = 0; i < rows.length; i++) {
      const comma = i < rows.length - 1 ? ',' : ''
      lines.push(`    ${toPythonLiteral(rows[i], 1)}${comma}`)
    }
    lines.push(']')
  }
  lines.push('')

  return lines.join('\n')
}
