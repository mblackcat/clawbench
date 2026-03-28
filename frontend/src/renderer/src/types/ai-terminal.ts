// AI Terminal module types

/** Terminal connection type */
export type TerminalConnectionType = 'local' | 'ssh'

/** SSH authentication method */
export type SSHAuthMethod = 'password' | 'key' | 'agent'

/** DB connection type (phase 2) */
export type DBConnectionType = 'mysql' | 'postgres' | 'mongodb' | 'sqlite'

/** Terminal connection configuration */
export interface TerminalConnection {
  id: string
  name: string
  type: TerminalConnectionType
  // SSH fields
  host?: string
  port?: number
  username?: string
  authMethod?: SSHAuthMethod
  privateKeyPath?: string
  password?: string
  // General
  startupCommand?: string
  /** Whether this connection was synced from ~/.ssh/config */
  fromSSHConfig?: boolean
  createdAt: number
  updatedAt: number
}

/** DB connection configuration (phase 2) */
export interface DBConnection {
  id: string
  name: string
  type: DBConnectionType
  host?: string
  port?: number
  username?: string
  password?: string
  database?: string
  filePath?: string
  createdAt: number
  updatedAt: number
}

/** Quick Bar command */
export interface QuickCommand {
  id: string
  name: string
  /** Combined commands, separated by \n */
  commands: string
  /** Empty = all targets; otherwise specific connection IDs */
  targets: string[]
  createdAt: number
  updatedAt: number
}

/** Terminal tab status */
export type TerminalTabStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

/** Open terminal tab */
export interface TerminalTab {
  id: string
  connectionId: string
  title: string
  status: TerminalTabStatus
  createdAt: number
}

/** AI message in terminal context */
export interface TerminalAIMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string
  toolCalls?: Array<{
    id: string
    name: string
    input: Record<string, any>
    result?: string
    isError?: boolean
  }>
  timestamp: number
}

/** Side panel mode */
export type SidePanelMode = 'terminal' | 'db'

// ── DB Mode Types (Phase 2) ──

/** DB table column schema */
export interface DBTableColumn {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  defaultValue?: string
  extra?: string // AUTO_INCREMENT, etc.
}

/** DB query result */
export interface DBQueryResult {
  columns: string[]
  rows: Record<string, any>[]
  affectedRows?: number
  executionTimeMs: number
}

/** DB tab type */
export type DBTabType = 'table' | 'query'

/** DB tab status */
export type DBTabStatus = 'connected' | 'disconnected' | 'error'

/** Open DB tab */
export interface DBTab {
  id: string
  connectionId: string
  title: string
  type: DBTabType
  tableName?: string
  status: DBTabStatus
  createdAt: number
}

/** DB connection status */
export type DBConnectionStatus = 'connected' | 'disconnected' | 'testing'
