import * as fs from 'fs'
import * as path from 'path'
import * as logger from '../utils/logger'

// ── Local type definitions (mirror renderer types for main process use) ──

export interface ColDef {
  id: string
  name: string
  rname: string
  type: string
  j_type: string
  req_or_opt: string
  default_v?: unknown
  c_type: string
  c_index: number
  rdesc?: string
  note?: string
  formula?: string
  src: string
  options?: string | string[]
  cs?: string
  is_key?: boolean
}

export interface RowData {
  id: number | string
  idx_name?: string
  _should_export?: boolean
  _deprecated?: boolean
  [key: string]: unknown
}

export interface JDBTableData {
  columns: ColDef[]
  rows: RowData[]
}

export type JDBDatabase = Record<string, JDBTableData>

export interface JDBFileInfo {
  fileName: string
  filePath: string
  relativePath: string
  size: number
  modifiedAt: number
  tableNames: string[]
}

// ── Public API ──

/**
 * Recursively scan a directory for .jdb files and read table names from each.
 */
export async function listJDBFiles(dir: string): Promise<JDBFileInfo[]> {
  const results: JDBFileInfo[] = []
  try {
    await scanDirectory(dir, dir, results)
  } catch (err) {
    logger.error('Failed to scan JDB files in', dir, err)
  }
  return results
}

/**
 * Read and parse a .jdb file. Normalizes column options from pipe-separated
 * strings to arrays.
 */
export function loadDatabase(filePath: string): JDBDatabase {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const data: JDBDatabase = JSON.parse(raw)

  // Normalize column options
  for (const tableName of Object.keys(data)) {
    const table = data[tableName]
    if (!table.columns) table.columns = []
    if (!table.rows) table.rows = []

    for (const col of table.columns) {
      if (typeof col.options === 'string' && col.options.length > 0) {
        col.options = col.options.split('|').map((o) => o.trim())
      }
    }
  }

  return data
}

/**
 * Atomic write: write to a .tmp file then rename to target path.
 */
export function saveDatabase(filePath: string, data: JDBDatabase): void {
  const tmpPath = filePath + '.tmp'
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    // Clean up tmp file on failure
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch {
      // ignore cleanup errors
    }
    throw err
  }
}

/**
 * Create a new .jdb file with one empty table.
 * Default columns: rdesc header, id, idx_name, _should_export.
 */
export function createDatabase(filePath: string, tableName: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const data: JDBDatabase = {
    [tableName]: {
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
  }

  saveDatabase(filePath, data)
  logger.info('Created JDB file:', filePath)
}

/**
 * Delete a .jdb file.
 */
export function deleteDatabase(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
    logger.info('Deleted JDB file:', filePath)
  }
}

/**
 * Quick-read a .jdb file and return its table names.
 */
export function getTableNames(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const data = JSON.parse(raw)
  return Object.keys(data)
}

// ── Internal helpers ──

async function scanDirectory(
  baseDir: string,
  currentDir: string,
  results: JDBFileInfo[]
): Promise<void> {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name)

    if (entry.isDirectory()) {
      // Skip hidden directories and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      await scanDirectory(baseDir, fullPath, results)
    } else if (entry.isFile() && entry.name.endsWith('.jdb')) {
      try {
        const stat = fs.statSync(fullPath)
        const tableNames = getTableNames(fullPath)
        results.push({
          fileName: entry.name,
          filePath: fullPath,
          relativePath: path.relative(baseDir, fullPath),
          size: stat.size,
          modifiedAt: stat.mtimeMs,
          tableNames
        })
      } catch (err) {
        logger.warn('Failed to read JDB file:', fullPath, err)
      }
    }
  }
}
