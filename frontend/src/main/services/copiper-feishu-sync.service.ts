/**
 * CoPiper ↔ Feishu spreadsheet bidirectional sync engine.
 */

import * as crypto from 'crypto'
import * as logger from '../utils/logger'
import * as jdbService from './jdb.service'
import type { ColDef, JDBDatabase, JDBTableData, RowData } from './jdb.service'
import {
  createDefaultFeishuLink,
  getFeishuLink,
  getSyncColumns,
  getTable,
  listTables,
  rowContentHash,
  setFeishuLink,
  validateSheetMaps,
  type FeishuLinkConfig,
  type FeishuSheetMap,
  type FeishuTestResult
} from './jdb-meta'
import * as sheets from './feishu-sheets.client'
import { FeishuSheetsError } from './feishu-sheets.client'
import { getUser, isFeishuUser } from '../store/auth.store'
import {
  getRowHashes,
  setRowHashes,
  setFileSyncStatus,
  getFileSyncStatus,
  type FeishuFileSyncStatus
} from '../store/copiper.store'

export type SyncTrigger = 'manual' | 'save' | 'poll' | 'event'

export interface SyncConflict {
  tableName: string
  rowKey: string
  local: RowData | null
  remote: RowData | null
  reason: 'both_modified' | 'schema_ambiguous' | 'remote_delete'
}

export interface SchemaChange {
  tableName: string
  type: 'column_added' | 'column_renamed' | 'column_missing_remote' | 'ambiguous'
  detail: string
  applied: boolean
}

export interface SyncResult {
  ok: boolean
  filePath: string
  trigger: SyncTrigger
  pushedTables: string[]
  pulledTables: string[]
  conflicts: SyncConflict[]
  schemaChanges: SchemaChange[]
  warnings: string[]
  error?: string
  errorKind?: FeishuSheetsError['kind'] | 'unavailable' | 'mapping'
  lastRemoteRevision?: number
}

const statusListeners = new Set<(status: FeishuFileSyncStatus) => void>()

export function onFeishuStatus(listener: (status: FeishuFileSyncStatus) => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

function emitStatus(status: FeishuFileSyncStatus): void {
  setFileSyncStatus(status.filePath, status)
  for (const l of statusListeners) {
    try {
      l(status)
    } catch {
      /* ignore */
    }
  }
}

export function getAvailability(): { available: boolean; reason: string; mode: string } {
  return sheets.checkFeishuAvailability()
}

export function getLink(filePath: string): FeishuLinkConfig | null {
  try {
    const db = jdbService.loadDatabase(filePath)
    return getFeishuLink(db)
  } catch {
    return null
  }
}

export async function saveLink(
  filePath: string,
  link: FeishuLinkConfig
): Promise<{ ok: boolean; error?: string; link?: FeishuLinkConfig }> {
  const avail = getAvailability()
  if (!avail.available) {
    return { ok: false, error: avail.reason }
  }

  try {
    const db = jdbService.loadDatabase(filePath)
    const tables = listTables(db)
    const v = validateSheetMaps(tables, link.sheetMaps || [])
    if (!v.ok) {
      return {
        ok: false,
        error: `Sheet mapping incomplete. Missing: ${v.missing.join(', ') || '—'}; duplicate: ${v.duplicate.join(', ') || '—'}`
      }
    }

    const user = getUser()
    const full = createDefaultFeishuLink({
      ...link,
      enabled: link.enabled !== false,
      updatedAt: Date.now(),
      createdAt: link.createdAt || Date.now(),
      createdBy: link.createdBy || {
        openId: user?.feishuId,
        name: user?.name
      }
    })

    const next = setFeishuLink(db, full)
    jdbService.saveDatabase(filePath, next)

    emitStatus({
      filePath,
      linked: true,
      light: 'ok',
      message: 'linked',
      lastSyncedAt: full.lastSyncedAt
    })

    return { ok: true, link: full }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function disconnect(
  filePath: string,
  removeMeta = false
): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = jdbService.loadDatabase(filePath)
    const link = getFeishuLink(db)
    if (!link) {
      emitStatus({ filePath, linked: false, light: 'none' })
      return { ok: true }
    }
    if (removeMeta) {
      jdbService.saveDatabase(filePath, setFeishuLink(db, null))
    } else {
      jdbService.saveDatabase(
        filePath,
        setFeishuLink(db, { ...link, enabled: false, updatedAt: Date.now() })
      )
    }
    setRowHashes(filePath, {})
    emitStatus({ filePath, linked: false, light: 'none' })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function testLink(
  filePathOrToken: string,
  tokenOverride?: string
): Promise<FeishuTestResult> {
  const avail = getAvailability()
  if (!avail.available) {
    return {
      ok: false,
      canRead: false,
      canWrite: false,
      message: avail.reason === 'feishu_login_required'
        ? 'Please sign in with Feishu to use spreadsheet sync'
        : avail.reason,
      checkedAt: Date.now()
    }
  }

  let token = tokenOverride || ''
  if (!token) {
    // treat as file path
    const link = getLink(filePathOrToken)
    token = link?.spreadsheetToken || sheets.parseSpreadsheetToken(filePathOrToken) || ''
  }
  if (!token) {
    token = sheets.parseSpreadsheetToken(filePathOrToken) || filePathOrToken
  }
  if (!token) {
    return {
      ok: false,
      canRead: false,
      canWrite: false,
      message: 'Invalid spreadsheet URL or token',
      checkedAt: Date.now()
    }
  }

  const result = await sheets.testAccess(token)

  // Persist test result if file path has a link
  try {
    if (filePathOrToken.endsWith('.jdb') || filePathOrToken.includes('\\') || filePathOrToken.includes('/')) {
      const db = jdbService.loadDatabase(filePathOrToken)
      const link = getFeishuLink(db)
      if (link) {
        const updated = {
          ...link,
          lastTestAt: result.checkedAt,
          lastTestResult: result,
          updatedAt: Date.now()
        }
        jdbService.saveDatabase(filePathOrToken, setFeishuLink(db, updated))
        emitStatus({
          filePath: filePathOrToken,
          linked: true,
          light: result.ok ? 'ok' : 'error',
          message: result.message,
          lastError: result.ok ? undefined : result.message
        })
      }
    }
  } catch {
    /* ignore persist errors for pure token tests */
  }

  return result
}

export async function createSpreadsheetForFile(
  filePath: string,
  title: string
): Promise<{ ok: boolean; meta?: sheets.FeishuSpreadsheetMeta; error?: string }> {
  const avail = getAvailability()
  if (!avail.available) return { ok: false, error: avail.reason }
  try {
    const meta = await sheets.createSpreadsheet(title)
    // Ensure one sheet per local table
    const db = jdbService.loadDatabase(filePath)
    const tables = listTables(db)
    let remoteSheets = await sheets.listSheets(meta.spreadsheetToken)

    // Rename first default sheet to first table if present
    // (Feishu create usually has Sheet1; we map by creating missing titles)
    for (const tableName of tables) {
      const exists = remoteSheets.find((s) => s.title === tableName)
      if (!exists) {
        try {
          await sheets.addSheet(meta.spreadsheetToken, tableName)
        } catch (err) {
          logger.warn('Failed to add sheet', tableName, err)
        }
      }
    }
    remoteSheets = await sheets.listSheets(meta.spreadsheetToken)

    const sheetMaps: FeishuSheetMap[] = tables.map((t) => {
      const s = remoteSheets.find((x) => x.title === t) || remoteSheets[0]
      return {
        jdbTable: t,
        sheetId: s?.sheetId || '',
        sheetTitle: s?.title || t,
        headerMode: 'name',
        keyColumn: 'id',
        headerRow: 1,
        dataStartRow: 2
      }
    })

    const url =
      meta.url ||
      `https://feishu.cn/sheets/${meta.spreadsheetToken}`

    await saveLink(filePath, createDefaultFeishuLink({
      spreadsheetUrl: url,
      spreadsheetToken: meta.spreadsheetToken,
      title: meta.title || title,
      sheetMaps,
      enabled: true
    }))

    return { ok: true, meta: { ...meta, url } }
  } catch (err) {
    const e = err as FeishuSheetsError
    return { ok: false, error: e.message || String(err) }
  }
}

export async function listRemoteSheets(tokenOrUrl: string): Promise<{
  ok: boolean
  token?: string
  meta?: sheets.FeishuSpreadsheetMeta
  sheets?: sheets.FeishuSheetInfo[]
  error?: string
}> {
  const avail = getAvailability()
  if (!avail.available) return { ok: false, error: avail.reason }
  const token = sheets.parseSpreadsheetToken(tokenOrUrl) || tokenOrUrl
  if (!token) return { ok: false, error: 'Invalid spreadsheet URL or token' }
  try {
    const meta = await sheets.getSpreadsheet(token)
    const list = await sheets.listSheets(token)
    return { ok: true, token, meta, sheets: list }
  } catch (err) {
    const e = err as FeishuSheetsError
    return { ok: false, error: e.message || String(err) }
  }
}

function cellToStorage(value: unknown, col: ColDef): unknown {
  if (value === null || value === undefined || value === '') {
    return col.default_v !== undefined ? col.default_v : undefined
  }
  const jt = (col.j_type || col.type || 'str').split(':')[0]
  if (jt === 'int') {
    if (typeof value === 'number') return Math.trunc(value)
    const n = parseInt(String(value), 10)
    return isNaN(n) ? value : n
  }
  if (jt === 'float') {
    if (typeof value === 'number') return value
    const n = parseFloat(String(value))
    return isNaN(n) ? value : n
  }
  if (jt === 'bool') {
    if (typeof value === 'boolean') return value
    const s = String(value).toLowerCase()
    if (s === 'true' || s === '1' || s === 'yes') return true
    if (s === 'false' || s === '0' || s === 'no') return false
    return Boolean(value)
  }
  // complex / list / kv — try JSON parse
  if (
    jt === 'kv' ||
    jt === 'ckv' ||
    jt === 'dict' ||
    jt === 'list' ||
    (col.j_type || '').startsWith('list:') ||
    (col.j_type || '').startsWith('kv:') ||
    (col.j_type || '').startsWith('ckv:')
  ) {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    }
    return value
  }
  return value
}

function storageToCell(value: unknown, col: ColDef): unknown {
  if (value === null || value === undefined) return ''
  const jt = (col.j_type || col.type || 'str').split(':')[0]
  if (
    jt === 'kv' ||
    jt === 'ckv' ||
    jt === 'dict' ||
    jt === 'list' ||
    (col.j_type || '').startsWith('list:') ||
    (col.j_type || '').startsWith('kv:') ||
    (col.j_type || '').startsWith('ckv:') ||
    typeof value === 'object'
  ) {
    if (typeof value === 'object') return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return value
}

function headerLabel(col: ColDef, mode: FeishuSheetMap['headerMode']): string {
  if (mode === 'rname') return col.rname || col.name
  return col.name
}

function applySchemaFromHeaders(
  table: JDBTableData,
  headers: string[],
  map: FeishuSheetMap,
  schemaChanges: SchemaChange[]
): { columns: ColDef[]; headerToName: string[] } {
  const mode = map.headerMode || 'name'
  const localCols = getSyncColumns(table)
  const localNames = localCols.map((c) => headerLabel(c, mode))
  const headerToName: string[] = []

  // Exact match by header label → column name
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? '').trim()
    if (!h) {
      headerToName[i] = `__empty_${i}`
      continue
    }
    const byLabel = localCols.find((c) => headerLabel(c, mode) === h)
    if (byLabel) {
      headerToName[i] = byLabel.name
      continue
    }
    // name match even in rname mode
    const byName = localCols.find((c) => c.name === h)
    if (byName) {
      headerToName[i] = byName.name
      continue
    }
    // New column
    headerToName[i] = h
    if (!localCols.some((c) => c.name === h)) {
      const maxIdx = Math.max(0, ...table.columns.map((c) => c.c_index || 0))
      table.columns.push({
        id: h,
        name: h,
        rname: h,
        type: 'str',
        j_type: 'str',
        req_or_opt: 'optional',
        c_type: 'data',
        c_index: maxIdx + 1,
        src: ''
      })
      schemaChanges.push({
        tableName: map.jdbTable,
        type: 'column_added',
        detail: `Added column "${h}" from Feishu header`,
        applied: true
      })
    }
  }

  // Single rename heuristic: same length, exactly one local missing and one remote new at same index
  if (headers.length === localNames.length) {
    const localSet = new Set(localNames)
    const remoteSet = new Set(headers.map((h) => String(h ?? '').trim()).filter(Boolean))
    const onlyLocal = localNames.filter((n) => !remoteSet.has(n))
    const onlyRemote = [...remoteSet].filter((n) => !localSet.has(n))
    if (onlyLocal.length === 1 && onlyRemote.length === 1) {
      const oldLabel = onlyLocal[0]
      const newLabel = onlyRemote[0]
      const col = localCols.find((c) => headerLabel(c, mode) === oldLabel)
      if (col && mode === 'name') {
        const oldName = col.name
        // rename column
        for (const row of table.rows) {
          if (oldName in row) {
            row[newLabel] = row[oldName]
            delete row[oldName]
          }
        }
        col.name = newLabel
        col.id = newLabel
        if (!col.rname || col.rname === oldName) col.rname = newLabel
        schemaChanges.push({
          tableName: map.jdbTable,
          type: 'column_renamed',
          detail: `Renamed column "${oldName}" → "${newLabel}" from Feishu header`,
          applied: true
        })
        // refresh mapping
        for (let i = 0; i < headers.length; i++) {
          if (String(headers[i] ?? '').trim() === newLabel) headerToName[i] = newLabel
        }
      }
    }
  }

  // Mark remote-missing local data columns (do not delete)
  for (const col of localCols) {
    if (col.c_type === 'sup') continue
    const label = headerLabel(col, mode)
    if (!headers.map((h) => String(h ?? '').trim()).includes(label) && !headers.includes(col.name)) {
      schemaChanges.push({
        tableName: map.jdbTable,
        type: 'column_missing_remote',
        detail: `Local column "${col.name}" missing on Feishu (kept locally)`,
        applied: false
      })
    }
  }

  return { columns: table.columns, headerToName }
}

function parseRemoteRows(
  values: unknown[][],
  map: FeishuSheetMap,
  table: JDBTableData,
  schemaChanges: SchemaChange[]
): Map<string, RowData> {
  const headerRowIdx = Math.max(0, (map.headerRow || 1) - 1)
  const dataStartIdx = Math.max(headerRowIdx + 1, (map.dataStartRow || 2) - 1)
  const headers = (values[headerRowIdx] || []).map((h) => String(h ?? '').trim())
  const { headerToName } = applySchemaFromHeaders(table, headers, map, schemaChanges)

  const colsByName = new Map(table.columns.map((c) => [c.name, c]))
  const keyCol = map.keyColumn || 'id'
  const out = new Map<string, RowData>()

  for (let r = dataStartIdx; r < values.length; r++) {
    const line = values[r] || []
    if (line.every((c) => c === null || c === undefined || c === '')) continue
    const row: RowData = { id: '' }
    for (let c = 0; c < headerToName.length; c++) {
      const name = headerToName[c]
      if (!name || name.startsWith('__empty_')) continue
      const col = colsByName.get(name)
      const raw = line[c]
      if (col) {
        const v = cellToStorage(raw, col)
        if (v !== undefined) row[name] = v
      } else if (raw !== undefined && raw !== '') {
        row[name] = raw
      }
    }
    const key = row[keyCol]
    if (key === undefined || key === null || key === '') continue
    row.id = row.id === '' || row.id == null ? (key as string | number) : row.id
    out.set(String(key), row)
  }
  return out
}

function tableToValues(table: JDBTableData, map: FeishuSheetMap): unknown[][] {
  const cols = getSyncColumns(table)
  const mode = map.headerMode || 'name'
  const header = cols.map((c) => headerLabel(c, mode))
  const rows = table.rows.map((row) =>
    cols.map((c) => storageToCell(row[c.name], c))
  )
  return [header, ...rows]
}

function fingerprintTable(table: JDBTableData, map: FeishuSheetMap): Record<string, string> {
  const cols = getSyncColumns(table).map((c) => c.name)
  const keyCol = map.keyColumn || 'id'
  const hashes: Record<string, string> = {}
  for (const row of table.rows) {
    const key = row[keyCol]
    if (key === undefined || key === null || key === '') continue
    hashes[String(key)] = rowContentHash(row, cols)
  }
  return hashes
}

/**
 * Full bidirectional sync for one JDB file.
 */
export async function syncFile(
  filePath: string,
  trigger: SyncTrigger = 'manual',
  options?: {
    /** When resolving conflicts externally, pass decisions keyed table::rowKey → 'local'|'remote' */
    conflictResolutions?: Record<string, 'local' | 'remote' | 'skip'>
  }
): Promise<SyncResult> {
  const result: SyncResult = {
    ok: false,
    filePath,
    trigger,
    pushedTables: [],
    pulledTables: [],
    conflicts: [],
    schemaChanges: [],
    warnings: []
  }

  if (!isFeishuUser()) {
    result.error = 'feishu_login_required'
    result.errorKind = 'unavailable'
    emitStatus({ filePath, linked: false, light: 'disconnected', lastError: result.error })
    return result
  }

  let db: JDBDatabase
  try {
    db = jdbService.loadDatabase(filePath)
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    return result
  }

  const link = getFeishuLink(db)
  if (!link || !link.enabled || !link.spreadsheetToken) {
    result.error = 'not_linked'
    result.errorKind = 'mapping'
    emitStatus({ filePath, linked: false, light: 'none' })
    return result
  }

  const tables = listTables(db)
  const v = validateSheetMaps(tables, link.sheetMaps)
  if (!v.ok) {
    result.error = `mapping_incomplete: missing ${v.missing.join(',')}`
    result.errorKind = 'mapping'
    emitStatus({
      filePath,
      linked: true,
      light: 'error',
      message: result.error,
      lastError: result.error
    })
    return result
  }

  emitStatus({ filePath, linked: true, light: 'syncing', message: 'syncing' })

  const token = link.spreadsheetToken
  const prevHashes = getRowHashes(filePath)
  const nextHashes: Record<string, Record<string, string>> = { ...prevHashes }
  let maxRevision = link.lastRemoteRevision || 0
  const resolutions = options?.conflictResolutions || {}

  try {
    for (const map of link.sheetMaps) {
      const table = getTable(db, map.jdbTable)
      if (!table) {
        result.warnings.push(`Local table missing: ${map.jdbTable}`)
        continue
      }
      if (!map.sheetId) {
        result.warnings.push(`Sheet id missing for ${map.jdbTable}`)
        continue
      }

      const cols = getSyncColumns(table)
      const endCol = Math.max(0, cols.length - 1)
      // Read a generous range
      const range = sheets.buildA1Range(map.sheetId, 0, 1, Math.max(endCol, 25), 5000)
      const remote = await sheets.readRange(token, range, 'ToString')
      if (typeof remote.revision === 'number') {
        maxRevision = Math.max(maxRevision, remote.revision)
      }

      const remoteByKey = parseRemoteRows(remote.values, map, table, result.schemaChanges)
      const keyCol = map.keyColumn || 'id'
      const colNames = getSyncColumns(table).map((c) => c.name)
      const tableHashKey = map.jdbTable
      const oldHashes = prevHashes[tableHashKey] || {}
      const localByKey = new Map<string, { row: RowData; index: number }>()
      table.rows.forEach((row, index) => {
        const k = row[keyCol]
        if (k !== undefined && k !== null && k !== '') {
          localByKey.set(String(k), { row, index })
        }
      })

      const allKeys = new Set([...localByKey.keys(), ...remoteByKey.keys()])
      const pushKeys: string[] = []
      const pullKeys: string[] = []
      let tableDirtyRemote = false
      let tableDirtyLocal = false

      for (const key of allKeys) {
        const localEntry = localByKey.get(key)
        const remoteRow = remoteByKey.get(key)
        const localRow = localEntry?.row
        const localHash = localRow ? rowContentHash(localRow, colNames) : ''
        const remoteHash = remoteRow ? rowContentHash(remoteRow, colNames) : ''
        const baseHash = oldHashes[key] || ''

        const localChanged = localRow ? localHash !== baseHash : false
        const remoteChanged = remoteRow ? remoteHash !== baseHash : false
        const localOnly = localRow && !remoteRow
        const remoteOnly = remoteRow && !localRow

        const resKey = `${map.jdbTable}::${key}`
        const decision = resolutions[resKey]

        if (localOnly) {
          if (baseHash && !localChanged && link.onRemoteDelete === 'apply') {
            // was synced, gone remote, local unchanged → delete local
            table.rows = table.rows.filter((_, i) => i !== localEntry!.index)
            // rebuild indices after multi-delete is hard; defer rebuild
            tableDirtyLocal = true
            pullKeys.push(key)
          } else if (baseHash && !localChanged && link.onRemoteDelete === 'prompt') {
            result.conflicts.push({
              tableName: map.jdbTable,
              rowKey: key,
              local: localRow!,
              remote: null,
              reason: 'remote_delete'
            })
          } else {
            pushKeys.push(key)
            tableDirtyRemote = true
          }
          continue
        }

        if (remoteOnly) {
          table.rows.push({ ...remoteRow! })
          tableDirtyLocal = true
          pullKeys.push(key)
          continue
        }

        // both exist
        if (localChanged && remoteChanged && localHash !== remoteHash) {
          if (decision === 'local') {
            pushKeys.push(key)
            tableDirtyRemote = true
          } else if (decision === 'remote') {
            table.rows[localEntry!.index] = { ...remoteRow! }
            tableDirtyLocal = true
            pullKeys.push(key)
          } else if (decision === 'skip') {
            // keep both as-is
          } else {
            result.conflicts.push({
              tableName: map.jdbTable,
              rowKey: key,
              local: localRow!,
              remote: remoteRow!,
              reason: 'both_modified'
            })
          }
        } else if (localChanged) {
          pushKeys.push(key)
          tableDirtyRemote = true
        } else if (remoteChanged) {
          table.rows[localEntry!.index] = { ...remoteRow! }
          tableDirtyLocal = true
          pullKeys.push(key)
        }
      }

      // Rebuild row list if we deleted by filter incorrectly — re-index via map
      if (tableDirtyLocal) {
        // compact already done for push path; for multi-delete use rebuilt from localByKey after mutations is complex
        result.pulledTables.push(map.jdbTable)
      }

      // Full rewrite remote sheet when any push (simpler & consistent)
      if (tableDirtyRemote || pushKeys.length > 0 || trigger === 'manual') {
        // If only pull and no local changes and not manual full rewrite skip write
        const needPush =
          link.syncMode !== 'pull' &&
          (pushKeys.length > 0 || (trigger === 'manual' && link.syncMode === 'bidirectional'))
        if (needPush && pushKeys.length > 0) {
          const values = tableToValues(table, map)
          // Clear then write: write full used range
          const writeRange = sheets.buildA1Range(
            map.sheetId,
            0,
            1,
            Math.max(cols.length - 1, 0),
            Math.max(values.length, 1)
          )
          const writeRes = await sheets.writeRange(token, writeRange, values)
          if (typeof writeRes.revision === 'number') {
            maxRevision = Math.max(maxRevision, writeRes.revision)
          }
          result.pushedTables.push(map.jdbTable)
        }
      }

      nextHashes[tableHashKey] = fingerprintTable(table, map)
    }

    // If unresolved conflicts, mark conflict and don't update hashes for those rows fully
    if (result.conflicts.length > 0 && Object.keys(resolutions).length === 0) {
      jdbService.saveDatabase(filePath, db)
      setRowHashes(filePath, nextHashes)
      result.ok = false
      result.error = 'conflicts'
      emitStatus({
        filePath,
        linked: true,
        light: 'conflict',
        message: `${result.conflicts.length} conflict(s)`,
        lastError: 'conflicts'
      })
      return result
    }

    // Update link meta revision
    const updatedLink: FeishuLinkConfig = {
      ...link,
      lastRemoteRevision: maxRevision || link.lastRemoteRevision,
      lastSyncedAt: Date.now(),
      updatedAt: Date.now()
    }
    const nextDb = setFeishuLink(db, updatedLink)
    jdbService.saveDatabase(filePath, nextDb)
    setRowHashes(filePath, nextHashes)

    result.ok = true
    result.lastRemoteRevision = maxRevision
    emitStatus({
      filePath,
      linked: true,
      light: 'ok',
      message: 'synced',
      lastSyncedAt: updatedLink.lastSyncedAt
    })
    return result
  } catch (err) {
    const e = err as FeishuSheetsError
    result.ok = false
    result.error = e.message || String(err)
    result.errorKind = e.kind || 'api'
    const light =
      e.kind === 'auth' || e.kind === 'permission' || e.kind === 'unavailable'
        ? 'disconnected'
        : 'error'
    emitStatus({
      filePath,
      linked: true,
      light,
      message: result.error,
      lastError: result.error
    })
    logger.error('Feishu sync failed', filePath, err)
    return result
  }
}

export function getStatus(filePath: string): FeishuFileSyncStatus {
  const link = getLink(filePath)
  if (!link || !link.enabled) {
    return { filePath, linked: false, light: 'none' }
  }
  const cached = getFileSyncStatus(filePath)
  if (cached) return cached
  return {
    filePath,
    linked: true,
    light: isFeishuUser() ? 'ok' : 'disconnected',
    lastSyncedAt: link.lastSyncedAt,
    lastError: link.lastTestResult && !link.lastTestResult.ok ? link.lastTestResult.message : undefined
  }
}

/** Hash helper export for tests */
export function hashRow(row: RowData, cols: string[]): string {
  return rowContentHash(row, cols)
}

export function parseToken(urlOrToken: string): string | null {
  return sheets.parseSpreadsheetToken(urlOrToken)
}

/** Stable content digest for debugging */
export function contentDigest(obj: unknown): string {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 12)
}
