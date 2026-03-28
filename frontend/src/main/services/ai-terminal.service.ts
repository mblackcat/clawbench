import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  aiTerminalStore,
  TerminalConnection,
  DBConnection,
  QuickCommand
} from '../store/ai-terminal.store'
import {
  createPtySession,
  writeToPty,
  resizePty,
  killPtySession,
  getPtySessionOutput,
  getRawPtyOutput,
  registerPtyOutputCallback,
  unregisterPtyOutputCallback
} from './pty-manager.service'
import { getAugmentedEnv, loadShellEnv } from './cli-detect.service'
import * as logger from '../utils/logger'

// ── SSH Config Parsing ──

interface SSHConfigEntry {
  host: string
  hostname?: string
  port?: number
  user?: string
  identityFile?: string
}

function getSSHConfigPath(): string {
  return path.join(os.homedir(), '.ssh', 'config')
}

/**
 * Parse ~/.ssh/config into an array of host entries.
 */
export function parseSSHConfig(): SSHConfigEntry[] {
  const configPath = getSSHConfigPath()
  if (!fs.existsSync(configPath)) return []

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const entries: SSHConfigEntry[] = []
    // currentGroup: all entries sharing the current Host block (supports "Host a b")
    let currentGroup: SSHConfigEntry[] = []

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue

      const match = line.match(/^(\S+)\s+(.+)$/)
      if (!match) continue

      const [, key, value] = match
      const lowerKey = key.toLowerCase()

      if (lowerKey === 'host') {
        // Host line may contain multiple space-separated patterns, e.g. "Host foo bar"
        const patterns = value.split(/\s+/).filter(p => !p.includes('*') && !p.includes('?'))
        if (patterns.length === 0) {
          currentGroup = []
          continue
        }
        currentGroup = patterns.map(p => ({ host: p }))
        entries.push(...currentGroup)
      } else if (currentGroup.length > 0) {
        switch (lowerKey) {
          case 'hostname':
            for (const g of currentGroup) g.hostname = value
            break
          case 'port':
            for (const g of currentGroup) g.port = parseInt(value, 10) || 22
            break
          case 'user':
            for (const g of currentGroup) g.user = value
            break
          case 'identityfile':
            for (const g of currentGroup) g.identityFile = path.resolve(value.replace(/^~/, os.homedir()))
            break
        }
      }
    }

    return entries
  } catch (err) {
    logger.error('Failed to parse SSH config:', err)
    return []
  }
}

/**
 * Sync SSH config entries into the terminal connections store.
 * Returns the updated connection list.
 */
export function syncSSHConfig(): TerminalConnection[] {
  const entries = parseSSHConfig()
  const existing = aiTerminalStore.get('terminalConnections')
  const now = Date.now()

  // Keep only manually created entries (non-SSH-config)
  const manual = existing.filter(c => !c.fromSSHConfig)

  // Build a lookup of old SSH-synced entries by name for ID/timestamp preservation
  const oldSSHByName = new Map<string, TerminalConnection>()
  for (const c of existing) {
    if (c.fromSSHConfig) oldSSHByName.set(c.name, c)
  }

  // Deduplicate parsed entries by host name (last definition wins)
  const seen = new Map<string, SSHConfigEntry>()
  for (const entry of entries) {
    seen.set(entry.host, entry)
  }

  // Create fresh SSH connections
  const sshConns: TerminalConnection[] = []
  for (const entry of seen.values()) {
    const old = oldSSHByName.get(entry.host)
    sshConns.push({
      id: old?.id || randomUUID(),
      name: entry.host,
      type: 'ssh',
      host: entry.hostname || entry.host,
      port: entry.port || 22,
      username: entry.user || '',
      authMethod: entry.identityFile ? 'key' : 'agent',
      privateKeyPath: entry.identityFile || '',
      fromSSHConfig: true,
      createdAt: old?.createdAt || now,
      updatedAt: now
    })
  }

  const result = [...manual, ...sshConns]
  aiTerminalStore.set('terminalConnections', result)
  aiTerminalStore.set('sshConfigSynced', true)
  return result
}

// ── Connection CRUD ──

export function getConnections(): TerminalConnection[] {
  return aiTerminalStore.get('terminalConnections')
}

export function createConnection(
  data: Omit<TerminalConnection, 'id' | 'createdAt' | 'updatedAt'>
): TerminalConnection {
  const now = Date.now()
  const conn: TerminalConnection = {
    ...data,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now
  }
  const connections = aiTerminalStore.get('terminalConnections')
  connections.push(conn)
  aiTerminalStore.set('terminalConnections', connections)
  logger.info(`[terminal] Connection created: ${conn.id} type=${data.type}`)
  return conn
}

export function updateConnection(
  id: string,
  updates: Partial<TerminalConnection>
): TerminalConnection | null {
  const connections = aiTerminalStore.get('terminalConnections')
  const idx = connections.findIndex(c => c.id === id)
  if (idx < 0) return null

  connections[idx] = { ...connections[idx], ...updates, updatedAt: Date.now() }
  aiTerminalStore.set('terminalConnections', connections)
  return connections[idx]
}

export function deleteConnection(id: string): boolean {
  const connections = aiTerminalStore.get('terminalConnections')
  const filtered = connections.filter(c => c.id !== id)
  if (filtered.length === connections.length) return false
  aiTerminalStore.set('terminalConnections', filtered)
  logger.info(`[terminal] Connection deleted: ${id}`)
  return true
}

// ── Quick Commands CRUD ──

export function getQuickCommands(): QuickCommand[] {
  return aiTerminalStore.get('quickCommands')
}

export function saveQuickCommand(data: Omit<QuickCommand, 'createdAt' | 'updatedAt'> & { id?: string }): QuickCommand {
  const commands = aiTerminalStore.get('quickCommands')
  const now = Date.now()

  if (data.id) {
    const idx = commands.findIndex(c => c.id === data.id)
    if (idx >= 0) {
      commands[idx] = { ...commands[idx], ...data, updatedAt: now }
      aiTerminalStore.set('quickCommands', commands)
      return commands[idx]
    }
  }

  const cmd: QuickCommand = {
    id: data.id || randomUUID(),
    name: data.name,
    commands: data.commands,
    targets: data.targets,
    createdAt: now,
    updatedAt: now
  }
  commands.push(cmd)
  aiTerminalStore.set('quickCommands', commands)
  return cmd
}

export function deleteQuickCommand(id: string): boolean {
  const commands = aiTerminalStore.get('quickCommands')
  const filtered = commands.filter(c => c.id !== id)
  if (filtered.length === commands.length) return false
  aiTerminalStore.set('quickCommands', filtered)
  return true
}

// ── Terminal Session Management ──

/**
 * Resolve the absolute path of the `ssh` binary.
 * Packaged Electron apps launched from Dock/Finder have a minimal PATH,
 * so we prefer the well-known `/usr/bin/ssh` and fall back to a PATH search.
 */
function resolveSSHBinary(env: Record<string, string>): string {
  // macOS / Linux: ssh is almost always at /usr/bin/ssh
  const wellKnown = '/usr/bin/ssh'
  if (process.platform !== 'win32' && fs.existsSync(wellKnown)) {
    return wellKnown
  }
  // Windows: node-pty doesn't search PATH, so resolve ssh.exe explicitly
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows'
    const winSSH = path.join(systemRoot, 'System32', 'OpenSSH', 'ssh.exe')
    if (fs.existsSync(winSSH)) return winSSH
    // Search PATH manually
    const pathDirs = (env.Path || env.PATH || '').split(';')
    for (const dir of pathDirs) {
      if (!dir) continue
      const candidate = path.join(dir, 'ssh.exe')
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return 'ssh'
}

/**
 * Open a terminal for a given connection.
 * Returns a session ID that maps to a PTY instance.
 *
 * NOTE: This is async because we need to ensure the shell environment
 * (PATH, SSH_AUTH_SOCK, etc.) is loaded before spawning the PTY.
 */
export async function openTerminal(
  connectionId: string,
  sessionId: string,
  onExit?: (sid: string, exitCode: number) => void
): Promise<{ success: boolean; error?: string }> {
  const connections = aiTerminalStore.get('terminalConnections')
  const conn = connections.find(c => c.id === connectionId)

  if (!conn && connectionId !== 'local') {
    return { success: false, error: '连接配置不存在' }
  }

  // Ensure shell environment (SSH_AUTH_SOCK, full PATH, etc.) is loaded
  // before spawning — critical for packaged apps launched from Dock/Finder
  await loadShellEnv().catch(() => { /* fallback to process.env */ })

  let command: string
  let args: string[] = []
  let cwd = os.homedir()

  const env = getAugmentedEnv() as Record<string, string>

  if (!conn || conn.type === 'local') {
    // Local terminal
    command = process.platform === 'win32'
      ? 'cmd.exe'
      : (process.env.SHELL || '/bin/bash')
  } else {
    // SSH connection via system ssh command — use absolute path
    command = resolveSSHBinary(env)
    args = ['-o', 'StrictHostKeyChecking=accept-new']

    if (conn.port && conn.port !== 22) {
      args.push('-p', String(conn.port))
    }

    if (conn.privateKeyPath) {
      // Resolve ~ prefix and normalize path separators for Windows compatibility
      const keyPath = path.resolve(conn.privateKeyPath.replace(/^~/, os.homedir()))
      args.push('-i', keyPath)
    }

    const userHost = conn.username
      ? `${conn.username}@${conn.host}`
      : (conn.host || conn.name)
    args.push(userHost)
  }

  try {
    createPtySession(sessionId, command, args, cwd, env, onExit)
    const termType = (!conn || conn.type === 'local') ? 'local' : 'ssh'
    logger.info(`[terminal] Terminal opened: session=${sessionId} conn=${connectionId} type=${termType} cmd=${command}`)
    return { success: true }
  } catch (err: any) {
    logger.error(`[terminal] Failed to open terminal: session=${sessionId} conn=${connectionId} cmd=${command}`, err)
    return { success: false, error: err.message || String(err) }
  }
}

export function writeTerminal(sessionId: string, data: string): void {
  writeToPty(sessionId, data)
}

export function resizeTerminal(sessionId: string, cols: number, rows: number): void {
  resizePty(sessionId, cols, rows)
}

export function closeTerminal(sessionId: string): void {
  killPtySession(sessionId)
  logger.info(`[terminal] Terminal closed: session=${sessionId}`)
}

export function getTerminalOutput(sessionId: string): string {
  return getPtySessionOutput(sessionId)
}

export function getRawTerminalOutput(sessionId: string): string {
  return getRawPtyOutput(sessionId)
}

/**
 * Execute a quick command by writing each line to the terminal with delays.
 */
export function executeQuickCommand(sessionId: string, commandStr: string): void {
  const lines = commandStr.split('\n').filter(l => l.trim())
  let i = 0

  function sendNext(): void {
    if (i >= lines.length) return
    writeToPty(sessionId, lines[i] + '\r')
    i++
    if (i < lines.length) {
      setTimeout(sendNext, 300)
    }
  }

  sendNext()
}

// ── AI Terminal Execution ──

/**
 * Execute a command in the terminal and wait for output to stabilize.
 * Returns the terminal output after stabilization.
 */
export function executeCommandAndWait(
  sessionId: string,
  command: string,
  timeoutMs = 15000
): Promise<string> {
  return new Promise((resolve) => {
    // Write the command
    writeToPty(sessionId, command + '\r')

    let settled = false

    // Register a stabilization callback
    registerPtyOutputCallback(sessionId, () => {
      if (settled) return
      settled = true
      unregisterPtyOutputCallback(sessionId)
      resolve(getPtySessionOutput(sessionId))
    })

    // Timeout fallback
    setTimeout(() => {
      if (settled) return
      settled = true
      unregisterPtyOutputCallback(sessionId)
      resolve(getPtySessionOutput(sessionId))
    }, timeoutMs)
  })
}

// ══════════════════════════════════════════════════════
// ── DB Mode (Phase 2) ──
// ══════════════════════════════════════════════════════

/** Active DB connection pools/instances */
const dbPools = new Map<string, any>()

// ── DB Connection CRUD ──

export function getDBConnections(): DBConnection[] {
  return aiTerminalStore.get('dbConnections')
}

export function createDBConnection(
  data: Omit<DBConnection, 'id' | 'createdAt' | 'updatedAt'>
): DBConnection {
  const now = Date.now()
  const conn: DBConnection = {
    ...data,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now
  }
  const connections = aiTerminalStore.get('dbConnections')
  connections.push(conn)
  aiTerminalStore.set('dbConnections', connections)
  return conn
}

export function updateDBConnection(
  id: string,
  updates: Partial<DBConnection>
): DBConnection | null {
  const connections = aiTerminalStore.get('dbConnections')
  const idx = connections.findIndex(c => c.id === id)
  if (idx < 0) return null
  connections[idx] = { ...connections[idx], ...updates, updatedAt: Date.now() }
  aiTerminalStore.set('dbConnections', connections)
  return connections[idx]
}

export function deleteDBConnection(id: string): boolean {
  // Disconnect if active
  disconnectDB(id)
  const connections = aiTerminalStore.get('dbConnections')
  const filtered = connections.filter(c => c.id !== id)
  if (filtered.length === connections.length) return false
  aiTerminalStore.set('dbConnections', filtered)
  return true
}

// ── DB Connect / Disconnect ──

function getDBConnectionConfig(id: string): DBConnection | null {
  return aiTerminalStore.get('dbConnections').find(c => c.id === id) || null
}

export async function connectDB(id: string): Promise<{ success: boolean; error?: string }> {
  const config = getDBConnectionConfig(id)
  if (!config) return { success: false, error: '连接配置不存在' }

  // If already connected, return success
  if (dbPools.has(id)) return { success: true }

  try {
    switch (config.type) {
      case 'mysql': {
        const mysql = require('mysql2/promise')
        const pool = mysql.createPool({
          host: config.host || 'localhost',
          port: config.port || 3306,
          user: config.username || 'root',
          password: config.password || '',
          database: config.database || undefined,
          waitForConnections: true,
          connectionLimit: 5,
          charset: 'utf8mb4'
        })
        // Test connection
        const conn = await pool.getConnection()
        conn.release()
        dbPools.set(id, { type: 'mysql', pool })
        break
      }
      case 'postgres': {
        const { Pool } = require('pg')
        const pool = new Pool({
          host: config.host || 'localhost',
          port: config.port || 5432,
          user: config.username || 'postgres',
          password: config.password || '',
          database: config.database || 'postgres',
          max: 5
        })
        // Test connection
        const client = await pool.connect()
        client.release()
        dbPools.set(id, { type: 'postgres', pool })
        break
      }
      case 'mongodb': {
        const { MongoClient } = require('mongodb')
        const uri = config.host?.startsWith('mongodb')
          ? config.host
          : `mongodb://${config.username ? `${config.username}:${config.password}@` : ''}${config.host || 'localhost'}:${config.port || 27017}`
        const client = new MongoClient(uri)
        await client.connect()
        dbPools.set(id, { type: 'mongodb', client, database: config.database || 'test' })
        break
      }
      case 'sqlite': {
        const Database = require('better-sqlite3')
        const filePath = config.filePath || ':memory:'
        const db = new Database(filePath)
        dbPools.set(id, { type: 'sqlite', db })
        break
      }
      default:
        return { success: false, error: `不支持的数据库类型: ${config.type}` }
    }
    logger.info(`[terminal] DB connected: ${id} type=${config.type}`)
    return { success: true }
  } catch (err: any) {
    logger.error(`DB connect failed [${config.type}]:`, err)
    return { success: false, error: err.message || String(err) }
  }
}

export async function disconnectDB(id: string): Promise<void> {
  const entry = dbPools.get(id)
  if (!entry) return

  try {
    switch (entry.type) {
      case 'mysql':
        await entry.pool.end()
        break
      case 'postgres':
        await entry.pool.end()
        break
      case 'mongodb':
        await entry.client.close()
        break
      case 'sqlite':
        entry.db.close()
        break
    }
  } catch (err) {
    logger.error('DB disconnect error:', err)
  }
  dbPools.delete(id)
  logger.info(`[terminal] DB disconnected: ${id}`)
}

export async function testDBConnection(
  config: Omit<DBConnection, 'id' | 'createdAt' | 'updatedAt'>
): Promise<{ success: boolean; error?: string }> {
  const tempId = `test-${Date.now()}`
  const tempConfig: DBConnection = {
    ...config,
    id: tempId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  // Temporarily store so connectDB can find it
  const connections = aiTerminalStore.get('dbConnections')
  connections.push(tempConfig)
  aiTerminalStore.set('dbConnections', connections)

  const result = await connectDB(tempId)

  // Clean up
  await disconnectDB(tempId)
  const cleaned = aiTerminalStore.get('dbConnections').filter(c => c.id !== tempId)
  aiTerminalStore.set('dbConnections', cleaned)

  if (!result.success) {
    logger.error(`[terminal] DB test failed: ${config.type}`)
  }
  return result
}

// ── DB Databases ──

export async function getDBDatabases(id: string): Promise<string[]> {
  const entry = dbPools.get(id)
  if (!entry) throw new Error('数据库未连接')

  switch (entry.type) {
    case 'mysql': {
      const [rows] = await entry.pool.query('SHOW DATABASES')
      return (rows as any[]).map(r => Object.values(r)[0] as string)
    }
    case 'postgres': {
      const { rows } = await entry.pool.query(
        "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
      )
      return rows.map((r: any) => r.datname)
    }
    case 'mongodb': {
      const adminDb = entry.client.db().admin()
      const result = await adminDb.listDatabases()
      return result.databases.map((d: any) => d.name).sort()
    }
    case 'sqlite': {
      // SQLite is single-database, return the file name or "main"
      const config = getDBConnectionConfig(id)
      return [config?.filePath || ':memory:']
    }
    default:
      return []
  }
}

export async function useDBDatabase(id: string, database: string): Promise<void> {
  const entry = dbPools.get(id)
  if (!entry) throw new Error('数据库未连接')

  switch (entry.type) {
    case 'mysql': {
      await entry.pool.query(`USE \`${database}\``)
      break
    }
    case 'postgres': {
      // PostgreSQL cannot switch database on existing connection — need to reconnect
      const config = getDBConnectionConfig(id)
      if (!config) throw new Error('连接配置不存在')
      await entry.pool.end()
      const { Pool } = require('pg')
      const pool = new Pool({
        host: config.host || 'localhost',
        port: config.port || 5432,
        user: config.username || 'postgres',
        password: config.password || '',
        database: database,
        max: 5
      })
      const client = await pool.connect()
      client.release()
      dbPools.set(id, { type: 'postgres', pool })
      break
    }
    case 'mongodb': {
      entry.database = database
      break
    }
    case 'sqlite': {
      // SQLite is single-database, nothing to switch
      break
    }
  }
}

// ── DB Query / Execute ──

export async function getDBTables(id: string): Promise<string[]> {
  const entry = dbPools.get(id)
  if (!entry) throw new Error('数据库未连接')

  switch (entry.type) {
    case 'mysql': {
      const [rows] = await entry.pool.query('SHOW TABLES')
      return (rows as any[]).map(r => Object.values(r)[0] as string)
    }
    case 'postgres': {
      const { rows } = await entry.pool.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
      )
      return rows.map((r: any) => r.tablename)
    }
    case 'mongodb': {
      const db = entry.client.db(entry.database)
      const collections = await db.listCollections().toArray()
      return collections.map((c: any) => c.name).sort()
    }
    case 'sqlite': {
      const rows = entry.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all()
      return rows.map((r: any) => r.name)
    }
    default:
      return []
  }
}

export async function getDBTableSchema(
  id: string,
  tableName: string
): Promise<Array<{ name: string; type: string; nullable: boolean; primaryKey: boolean; defaultValue?: string; extra?: string }>> {
  const entry = dbPools.get(id)
  if (!entry) throw new Error('数据库未连接')

  switch (entry.type) {
    case 'mysql': {
      const [rows] = await entry.pool.query('DESCRIBE ??', [tableName])
      return (rows as any[]).map(r => ({
        name: r.Field,
        type: r.Type,
        nullable: r.Null === 'YES',
        primaryKey: r.Key === 'PRI',
        defaultValue: r.Default,
        extra: r.Extra || undefined
      }))
    }
    case 'postgres': {
      const { rows } = await entry.pool.query(`
        SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
               CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN true ELSE false END as is_pk
        FROM information_schema.columns c
        LEFT JOIN information_schema.key_column_usage kcu
          ON c.table_name = kcu.table_name AND c.column_name = kcu.column_name
        LEFT JOIN information_schema.table_constraints tc
          ON kcu.constraint_name = tc.constraint_name AND tc.constraint_type = 'PRIMARY KEY'
        WHERE c.table_name = $1 AND c.table_schema = 'public'
        ORDER BY c.ordinal_position
      `, [tableName])
      return rows.map((r: any) => ({
        name: r.column_name,
        type: r.data_type,
        nullable: r.is_nullable === 'YES',
        primaryKey: r.is_pk === true,
        defaultValue: r.column_default || undefined
      }))
    }
    case 'mongodb': {
      // MongoDB is schemaless; sample a document to infer fields
      const db = entry.client.db(entry.database)
      const sample = await db.collection(tableName).findOne()
      if (!sample) return []
      return Object.entries(sample).map(([key, value]) => ({
        name: key,
        type: typeof value === 'object' && value !== null
          ? (Array.isArray(value) ? 'array' : (value.constructor?.name || 'object'))
          : typeof value,
        nullable: true,
        primaryKey: key === '_id'
      }))
    }
    case 'sqlite': {
      const rows = entry.db.prepare(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`).all()
      return (rows as any[]).map(r => ({
        name: r.name,
        type: r.type || 'TEXT',
        nullable: r.notnull === 0,
        primaryKey: r.pk === 1,
        defaultValue: r.dflt_value || undefined
      }))
    }
    default:
      return []
  }
}

export async function queryDB(
  id: string,
  sql: string
): Promise<{ columns: string[]; rows: Record<string, any>[]; executionTimeMs: number }> {
  const entry = dbPools.get(id)
  if (!entry) throw new Error('数据库未连接')

  const start = Date.now()

  switch (entry.type) {
    case 'mysql': {
      const [rows, fields] = await entry.pool.query(sql)
      const columns = (fields as any[])?.map((f: any) => f.name) || (Array.isArray(rows) && rows.length > 0 ? Object.keys(rows[0]) : [])
      return { columns, rows: rows as Record<string, any>[], executionTimeMs: Date.now() - start }
    }
    case 'postgres': {
      const result = await entry.pool.query(sql)
      const columns = result.fields?.map((f: any) => f.name) || []
      return { columns, rows: result.rows, executionTimeMs: Date.now() - start }
    }
    case 'sqlite': {
      const stmt = entry.db.prepare(sql)
      if (sql.trim().toUpperCase().startsWith('SELECT') || sql.trim().toUpperCase().startsWith('PRAGMA') || sql.trim().toUpperCase().startsWith('WITH')) {
        const rows = stmt.all()
        const columns = rows.length > 0 ? Object.keys(rows[0]) : []
        return { columns, rows, executionTimeMs: Date.now() - start }
      } else {
        const info = stmt.run()
        return { columns: ['changes'], rows: [{ changes: info.changes }], executionTimeMs: Date.now() - start }
      }
    }
    default:
      throw new Error(`queryDB 不支持类型: ${entry.type}`)
  }
}

export async function executeDB(
  id: string,
  sql: string
): Promise<{ affectedRows: number; executionTimeMs: number }> {
  const entry = dbPools.get(id)
  if (!entry) throw new Error('数据库未连接')

  const start = Date.now()

  switch (entry.type) {
    case 'mysql': {
      const [result] = await entry.pool.execute(sql)
      return { affectedRows: (result as any).affectedRows || 0, executionTimeMs: Date.now() - start }
    }
    case 'postgres': {
      const result = await entry.pool.query(sql)
      return { affectedRows: result.rowCount || 0, executionTimeMs: Date.now() - start }
    }
    case 'sqlite': {
      const info = entry.db.prepare(sql).run()
      return { affectedRows: info.changes, executionTimeMs: Date.now() - start }
    }
    default:
      throw new Error(`executeDB 不支持类型: ${entry.type}`)
  }
}

export async function updateDBTableData(
  id: string,
  tableName: string,
  changes: Array<{ row: Record<string, any>; column: string; oldValue: any; newValue: any; primaryKeys: Record<string, any> }>
): Promise<{ affectedRows: number }> {
  const entry = dbPools.get(id)
  if (!entry) throw new Error('数据库未连接')

  let totalAffected = 0

  for (const change of changes) {
    const pkEntries = Object.entries(change.primaryKeys)
    if (pkEntries.length === 0) throw new Error('更新需要主键信息')

    switch (entry.type) {
      case 'mysql': {
        const whereClause = pkEntries.map(([k]) => `\`${k}\` = ?`).join(' AND ')
        const sql = `UPDATE \`${tableName}\` SET \`${change.column}\` = ? WHERE ${whereClause}`
        const params = [change.newValue, ...pkEntries.map(([, v]) => v)]
        const [result] = await entry.pool.execute(sql, params)
        totalAffected += (result as any).affectedRows || 0
        break
      }
      case 'postgres': {
        const whereClause = pkEntries.map(([k], i) => `"${k}" = $${i + 2}`).join(' AND ')
        const sql = `UPDATE "${tableName}" SET "${change.column}" = $1 WHERE ${whereClause}`
        const params = [change.newValue, ...pkEntries.map(([, v]) => v)]
        const result = await entry.pool.query(sql, params)
        totalAffected += result.rowCount || 0
        break
      }
      case 'sqlite': {
        const whereClause = pkEntries.map(([k]) => `"${k}" = ?`).join(' AND ')
        const sql = `UPDATE "${tableName}" SET "${change.column}" = ? WHERE ${whereClause}`
        const params = [change.newValue, ...pkEntries.map(([, v]) => v)]
        const info = entry.db.prepare(sql).run(...params)
        totalAffected += info.changes
        break
      }
    }
  }

  return { affectedRows: totalAffected }
}

// ── MongoDB specific ──

export async function getDBCollections(id: string): Promise<string[]> {
  return getDBTables(id) // Same implementation for MongoDB
}

export async function queryMongoCollection(
  id: string,
  collection: string,
  filter: Record<string, any> = {},
  projection: Record<string, any> = {},
  limit = 100
): Promise<{ columns: string[]; rows: Record<string, any>[]; executionTimeMs: number }> {
  const entry = dbPools.get(id)
  if (!entry || entry.type !== 'mongodb') throw new Error('MongoDB 未连接')

  const start = Date.now()
  const db = entry.client.db(entry.database)
  const docs = await db.collection(collection)
    .find(filter)
    .project(Object.keys(projection).length > 0 ? projection : undefined)
    .limit(limit)
    .toArray()

  // Convert ObjectId to string for display
  const rows = docs.map((doc: any) => {
    const row: Record<string, any> = {}
    for (const [k, v] of Object.entries(doc)) {
      row[k] = v && typeof v === 'object' && v.constructor?.name === 'ObjectId' ? v.toString() : v
    }
    return row
  })

  const columns = rows.length > 0
    ? [...new Set(rows.flatMap(r => Object.keys(r)))]
    : []

  return { columns, rows, executionTimeMs: Date.now() - start }
}

export async function updateMongoDocument(
  id: string,
  collection: string,
  filter: Record<string, any>,
  update: Record<string, any>
): Promise<{ modifiedCount: number }> {
  const entry = dbPools.get(id)
  if (!entry || entry.type !== 'mongodb') throw new Error('MongoDB 未连接')

  const db = entry.client.db(entry.database)
  const result = await db.collection(collection).updateMany(filter, { $set: update })
  return { modifiedCount: result.modifiedCount }
}

export async function insertMongoDocument(
  id: string,
  collection: string,
  doc: Record<string, any>
): Promise<{ insertedId: string }> {
  const entry = dbPools.get(id)
  if (!entry || entry.type !== 'mongodb') throw new Error('MongoDB 未连接')

  const db = entry.client.db(entry.database)
  const result = await db.collection(collection).insertOne(doc)
  return { insertedId: result.insertedId.toString() }
}

export async function deleteMongoDocuments(
  id: string,
  collection: string,
  filter: Record<string, any>
): Promise<{ deletedCount: number }> {
  const entry = dbPools.get(id)
  if (!entry || entry.type !== 'mongodb') throw new Error('MongoDB 未连接')

  const db = entry.client.db(entry.database)
  const result = await db.collection(collection).deleteMany(filter)
  return { deletedCount: result.deletedCount }
}

// ── Relational Schema Modification ──

export async function addDBColumn(
  id: string,
  tableName: string,
  columnName: string,
  columnType: string,
  nullable = true,
  defaultValue?: string
): Promise<void> {
  const entry = dbPools.get(id)
  if (!entry) throw new Error('数据库未连接')

  const nullStr = nullable ? 'NULL' : 'NOT NULL'
  const defStr = defaultValue !== undefined ? ` DEFAULT ${defaultValue}` : ''

  switch (entry.type) {
    case 'mysql':
      await entry.pool.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnType} ${nullStr}${defStr}`)
      break
    case 'postgres':
      await entry.pool.query(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${columnType} ${nullStr}${defStr}`)
      break
    case 'sqlite':
      entry.db.prepare(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${columnType}${defStr}`).run()
      break
    default:
      throw new Error('MongoDB 不支持 ALTER TABLE')
  }
}

export async function dropDBColumn(
  id: string,
  tableName: string,
  columnName: string
): Promise<void> {
  const entry = dbPools.get(id)
  if (!entry) throw new Error('数据库未连接')

  switch (entry.type) {
    case 'mysql':
      await entry.pool.execute(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``)
      break
    case 'postgres':
      await entry.pool.query(`ALTER TABLE "${tableName}" DROP COLUMN "${columnName}"`)
      break
    case 'sqlite':
      entry.db.prepare(`ALTER TABLE "${tableName}" DROP COLUMN "${columnName}"`).run()
      break
    default:
      throw new Error('MongoDB 不支持 ALTER TABLE')
  }
}

export async function renameDBColumn(
  id: string,
  tableName: string,
  oldName: string,
  newName: string
): Promise<void> {
  const entry = dbPools.get(id)
  if (!entry) throw new Error('数据库未连接')

  switch (entry.type) {
    case 'mysql':
      // MySQL 8.0+ supports RENAME COLUMN
      await entry.pool.execute(`ALTER TABLE \`${tableName}\` RENAME COLUMN \`${oldName}\` TO \`${newName}\``)
      break
    case 'postgres':
      await entry.pool.query(`ALTER TABLE "${tableName}" RENAME COLUMN "${oldName}" TO "${newName}"`)
      break
    case 'sqlite':
      entry.db.prepare(`ALTER TABLE "${tableName}" RENAME COLUMN "${oldName}" TO "${newName}"`).run()
      break
    default:
      throw new Error('MongoDB 不支持 ALTER TABLE')
  }
}

/** Check if a DB connection is active */
export function isDBConnected(id: string): boolean {
  return dbPools.has(id)
}
