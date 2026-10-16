/**
 * Static checks used to keep the AI Terminal assistant's `run_sql_query`
 * tool read-only. They are a first gate only: MySQL / PostgreSQL queries
 * additionally run inside a READ ONLY transaction and SQLite statements must
 * report `readonly`, so the database itself enforces the guarantee.
 */

export type SqlDialect = 'mysql' | 'postgres' | 'sqlite'

export type ReadOnlyCheck = { ok: true } | { ok: false; reason: string }

/**
 * Removes comments and splits on top-level `;`, ignoring quoted strings,
 * quoted identifiers and PostgreSQL dollar-quoted bodies.
 * Returns the non-empty statements (trimmed, comments stripped).
 * MySQL-only syntax (`#` comments, backslash escapes in strings) is honoured
 * only for `mysql`, so other dialects are not mis-split in a permissive way.
 */
export function splitSqlStatements(sql: string, dialect: SqlDialect = 'mysql'): string[] {
  const mysql = dialect === 'mysql'
  const statements: string[] = []
  let current = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    const next = sql[i + 1]
    // -- line comment (and MySQL # comment)
    if ((ch === '-' && next === '-') || (mysql && ch === '#')) {
      while (i < n && sql[i] !== '\n') i++
      current += ' '
      continue
    }
    // /* block comment */
    if (ch === '/' && next === '*') {
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      current += ' '
      continue
    }
    // quoted strings / identifiers
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      current += ch
      i++
      while (i < n) {
        const c = sql[i]
        current += c
        i++
        if (mysql && c === '\\' && quote !== '`' && i < n) {
          current += sql[i]
          i++
          continue
        }
        if (c === quote) {
          if (sql[i] === quote) {
            current += sql[i]
            i++
            continue
          }
          break
        }
      }
      continue
    }
    // $tag$ ... $tag$ (PostgreSQL)
    if (ch === '$') {
      const m = /^\$[A-Za-z_]?[A-Za-z0-9_]*\$/.exec(sql.slice(i))
      if (m) {
        const tag = m[0]
        const end = sql.indexOf(tag, i + tag.length)
        const stop = end === -1 ? n : end + tag.length
        current += sql.slice(i, stop)
        i = stop
        continue
      }
    }
    if (ch === ';') {
      if (current.trim()) statements.push(current.trim())
      current = ''
      i++
      continue
    }
    current += ch
    i++
  }
  if (current.trim()) statements.push(current.trim())
  return statements
}

const READ_KEYWORDS: Record<SqlDialect, string[]> = {
  mysql: ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH', 'VALUES', 'TABLE'],
  postgres: ['SELECT', 'SHOW', 'EXPLAIN', 'WITH', 'VALUES', 'TABLE'],
  sqlite: ['SELECT', 'EXPLAIN', 'WITH', 'VALUES', 'PRAGMA']
}

const SQLITE_READ_PRAGMAS = [
  'table_info',
  'table_xinfo',
  'table_list',
  'index_list',
  'index_info',
  'index_xinfo',
  'foreign_key_list',
  'database_list',
  'collation_list',
  'function_list',
  'compile_options'
]

/** Checks that `sql` is a single statement of a read-only kind for `dialect`. */
export function checkReadOnlySql(sql: string, dialect: SqlDialect): ReadOnlyCheck {
  if (typeof sql !== 'string' || !sql.trim()) return { ok: false, reason: 'Empty query' }
  const statements = splitSqlStatements(sql, dialect)
  if (statements.length === 0) return { ok: false, reason: 'Empty query' }
  if (statements.length > 1) {
    return { ok: false, reason: 'Only a single statement is allowed in a read-only query' }
  }
  const stmt = statements[0]
  const keyword = (/^[(\s]*([A-Za-z]+)/.exec(stmt)?.[1] || '').toUpperCase()
  if (!READ_KEYWORDS[dialect].includes(keyword)) {
    return {
      ok: false,
      reason: `"${keyword || stmt.slice(0, 20)}" is not a read-only statement; use run_sql_write for changes`
    }
  }
  if (/\binto\s+(outfile|dumpfile)\b/i.test(stmt)) {
    return { ok: false, reason: 'SELECT ... INTO OUTFILE/DUMPFILE is not allowed' }
  }
  // Many PRAGMAs change state (journal_mode=…, even in function form), so
  // only schema-introspection pragmas are allowed, and never with "=".
  if (keyword === 'PRAGMA') {
    const name = (/^\s*pragma\s+(?:\w+\.)?(\w+)/i.exec(stmt)?.[1] || '').toLowerCase()
    if (stmt.includes('=') || !SQLITE_READ_PRAGMAS.includes(name)) {
      return { ok: false, reason: `PRAGMA ${name || ''} is not allowed in a read-only query`.trim() }
    }
  }
  return { ok: true }
}

export interface MongoReadQuery {
  collection: string
  op: 'find' | 'aggregate' | 'count'
  filter: Record<string, unknown>
  projection: Record<string, unknown>
  pipeline: Record<string, unknown>[]
  limit: number
}

const MONGO_MAX_LIMIT = 1000
const MONGO_WRITE_STAGES = ['$out', '$merge']

/**
 * Parses a read-only MongoDB request given as JSON:
 * `{ "collection": "users", "op": "find" | "aggregate" | "count", "filter": {}, "projection": {}, "pipeline": [], "limit": 100 }`.
 * Aggregations may not contain `$out` / `$merge` stages.
 */
export function parseMongoReadQuery(input: string): MongoReadQuery {
  let raw: unknown
  try {
    raw = JSON.parse(input)
  } catch {
    throw new Error(
      'MongoDB queries must be JSON: {"collection":"name","op":"find|aggregate|count","filter":{},"pipeline":[],"limit":100}'
    )
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('MongoDB query must be a JSON object')
  const q = raw as Record<string, unknown>
  const collection = typeof q.collection === 'string' ? q.collection.trim() : ''
  if (!collection) throw new Error('"collection" is required')
  const op = (typeof q.op === 'string' ? q.op : 'find').toLowerCase()
  const normalizedOp =
    op === 'find' ? 'find' : op === 'aggregate' ? 'aggregate' : op === 'count' || op === 'countdocuments' ? 'count' : null
  if (!normalizedOp) throw new Error(`Unsupported MongoDB op "${op}" (allowed: find, aggregate, count)`)
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  const filter = q.filter === undefined ? {} : q.filter
  const projection = q.projection === undefined ? {} : q.projection
  if (!isObj(filter)) throw new Error('"filter" must be an object')
  if (!isObj(projection)) throw new Error('"projection" must be an object')
  const pipeline = q.pipeline === undefined ? [] : q.pipeline
  if (!Array.isArray(pipeline) || !pipeline.every(isObj)) throw new Error('"pipeline" must be an array of stages')
  for (const stage of pipeline) {
    for (const key of Object.keys(stage)) {
      if (MONGO_WRITE_STAGES.includes(key)) throw new Error(`Aggregation stage ${key} writes data and is not allowed`)
    }
  }
  const limitNum = typeof q.limit === 'number' && Number.isFinite(q.limit) ? Math.floor(q.limit) : 100
  const limit = Math.min(Math.max(limitNum, 1), MONGO_MAX_LIMIT)
  return { collection, op: normalizedOp, filter, projection, pipeline, limit }
}
