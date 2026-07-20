/**
 * CoPiper JDB file metadata helpers.
 *
 * `.jdb` root keys are normally table names. The reserved key `__copiper__`
 * holds file-level metadata (Feishu link, etc.) for team sharing and must be
 * filtered out of all table iterations.
 */

import type { ColDef, JDBTableData, RowData } from './jdb.service'

/** Reserved top-level key in .jdb JSON — never treat as a data table */
export const COPIPER_META_KEY = '__copiper__' as const

export type FeishuSyncMode = 'bidirectional' | 'push' | 'pull'
export type FeishuHeaderMode = 'name' | 'rname'
export type FeishuOnRemoteDelete = 'prompt' | 'apply' | 'ignore'

export interface FeishuSheetMap {
  /** Local JDB table name */
  jdbTable: string
  /** Feishu sheet_id */
  sheetId: string
  /** Feishu sheet title (display / recreate hint) */
  sheetTitle: string
  /** Header cell content: column `name` or `rname` */
  headerMode: FeishuHeaderMode
  /** Row key column (default id) */
  keyColumn: string
  /** 1-based header row */
  headerRow: number
  /** 1-based first data row */
  dataStartRow: number
}

export interface FeishuTestResult {
  ok: boolean
  canRead: boolean
  canWrite: boolean
  message: string
  checkedAt: number
}

export interface FeishuLinkConfig {
  spreadsheetUrl: string
  spreadsheetToken: string
  title?: string
  enabled: boolean
  syncMode: FeishuSyncMode
  /** Poll interval seconds (min 10) */
  pollIntervalSec: number
  sheetMaps: FeishuSheetMap[]
  onRemoteDelete?: FeishuOnRemoteDelete
  /** Shared last known remote revision (team-visible) */
  lastRemoteRevision?: number
  lastTestAt?: number
  lastTestResult?: FeishuTestResult | null
  lastSyncedAt?: number
  createdAt?: number
  updatedAt?: number
  createdBy?: { openId?: string; name?: string }
}

export interface CopiperFileMeta {
  version: number
  feishu?: FeishuLinkConfig | null
}

/** Loose file shape: tables + optional reserved meta */
export type JDBFileRoot = Record<string, JDBTableData | CopiperFileMeta>

export function isTableKey(key: string): boolean {
  return key !== COPIPER_META_KEY
}

export function listTables(db: JDBFileRoot | Record<string, unknown> | null | undefined): string[] {
  if (!db || typeof db !== 'object') return []
  return Object.keys(db).filter(isTableKey)
}

export function getMeta(db: JDBFileRoot | Record<string, unknown> | null | undefined): CopiperFileMeta | null {
  if (!db || typeof db !== 'object') return null
  const raw = (db as JDBFileRoot)[COPIPER_META_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  // Reject table-shaped accident
  if ('columns' in raw && 'rows' in raw && !('version' in raw) && !('feishu' in raw)) {
    return null
  }
  return raw as CopiperFileMeta
}

export function getFeishuLink(
  db: JDBFileRoot | Record<string, unknown> | null | undefined
): FeishuLinkConfig | null {
  const meta = getMeta(db)
  if (!meta?.feishu || typeof meta.feishu !== 'object') return null
  return meta.feishu
}

export function getTable(
  db: JDBFileRoot | Record<string, unknown>,
  tableName: string
): JDBTableData | undefined {
  if (!isTableKey(tableName)) return undefined
  const t = db[tableName]
  if (!t || typeof t !== 'object') return undefined
  if (!('columns' in t) || !('rows' in t)) return undefined
  return t as JDBTableData
}

/** Tables only — strips meta for export / cross-file maps */
export function tablesOnly(db: JDBFileRoot | Record<string, unknown>): Record<string, JDBTableData> {
  const out: Record<string, JDBTableData> = {}
  for (const name of listTables(db)) {
    const t = getTable(db, name)
    if (t) out[name] = t
  }
  return out
}

export function setMeta(
  db: JDBFileRoot | Record<string, unknown>,
  meta: CopiperFileMeta
): JDBFileRoot {
  return {
    ...db,
    [COPIPER_META_KEY]: meta
  } as JDBFileRoot
}

export function setFeishuLink(
  db: JDBFileRoot | Record<string, unknown>,
  link: FeishuLinkConfig | null
): JDBFileRoot {
  const prev = getMeta(db) || { version: 1 }
  const next: CopiperFileMeta = {
    ...prev,
    version: prev.version || 1,
    feishu: link
  }
  return setMeta(db, next)
}

export function clearFeishuLink(db: JDBFileRoot | Record<string, unknown>): JDBFileRoot {
  return setFeishuLink(db, null)
}

export function createDefaultFeishuLink(
  partial: Partial<FeishuLinkConfig> & Pick<FeishuLinkConfig, 'spreadsheetUrl' | 'spreadsheetToken'>
): FeishuLinkConfig {
  const now = Date.now()
  return {
    spreadsheetUrl: partial.spreadsheetUrl,
    spreadsheetToken: partial.spreadsheetToken,
    title: partial.title,
    enabled: partial.enabled ?? true,
    syncMode: partial.syncMode ?? 'bidirectional',
    pollIntervalSec: Math.max(10, partial.pollIntervalSec ?? 15),
    sheetMaps: partial.sheetMaps ?? [],
    onRemoteDelete: partial.onRemoteDelete ?? 'prompt',
    lastRemoteRevision: partial.lastRemoteRevision,
    lastTestAt: partial.lastTestAt,
    lastTestResult: partial.lastTestResult ?? null,
    lastSyncedAt: partial.lastSyncedAt,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    createdBy: partial.createdBy
  }
}

/** Validate every local table has exactly one sheet map */
export function validateSheetMaps(
  tableNames: string[],
  maps: FeishuSheetMap[]
): { ok: boolean; missing: string[]; duplicate: string[] } {
  const byTable = new Map<string, number>()
  for (const m of maps) {
    byTable.set(m.jdbTable, (byTable.get(m.jdbTable) || 0) + 1)
  }
  const missing = tableNames.filter((t) => !byTable.has(t))
  const duplicate = [...byTable.entries()].filter(([, n]) => n > 1).map(([t]) => t)
  return { ok: missing.length === 0 && duplicate.length === 0, missing, duplicate }
}

/** Exportable columns for Feishu (skip rdesc) */
export function getSyncColumns(table: JDBTableData): ColDef[] {
  return (table.columns || [])
    .filter((c) => c.c_type !== 'rdesc')
    .slice()
    .sort((a, b) => (a.c_index ?? 0) - (b.c_index ?? 0))
}

export function rowContentHash(row: RowData, columnNames: string[]): string {
  const payload: Record<string, unknown> = {}
  for (const name of columnNames) {
    payload[name] = row[name]
  }
  // Stable JSON
  return simpleHash(stableStringify(payload))
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

function simpleHash(s: string): string {
  // FNV-1a 32-bit
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
