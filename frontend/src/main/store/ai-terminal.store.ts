import Store from 'electron-store'

export interface TerminalConnection {
  id: string
  name: string
  type: 'local' | 'ssh'
  host?: string
  port?: number
  username?: string
  authMethod?: 'password' | 'key' | 'agent'
  privateKeyPath?: string
  password?: string
  startupCommand?: string
  fromSSHConfig?: boolean
  createdAt: number
  updatedAt: number
}

export interface DBConnection {
  id: string
  name: string
  type: 'mysql' | 'postgres' | 'mongodb' | 'sqlite'
  host?: string
  port?: number
  username?: string
  password?: string
  database?: string
  filePath?: string
  createdAt: number
  updatedAt: number
}

export interface QuickCommand {
  id: string
  name: string
  commands: string
  targets: string[]
  createdAt: number
  updatedAt: number
}

interface AITerminalSchema {
  terminalConnections: TerminalConnection[]
  dbConnections: DBConnection[]
  quickCommands: QuickCommand[]
  sshConfigSynced: boolean
}

export const aiTerminalStore = new Store<AITerminalSchema>({
  name: 'ai-terminal',
  schema: {
    terminalConnections: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string' },
          host: { type: 'string' },
          port: { type: 'number' },
          username: { type: 'string' },
          authMethod: { type: 'string' },
          privateKeyPath: { type: 'string' },
          password: { type: 'string' },
          startupCommand: { type: 'string' },
          fromSSHConfig: { type: 'boolean' },
          createdAt: { type: 'number' },
          updatedAt: { type: 'number' }
        }
      }
    },
    dbConnections: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string' },
          host: { type: 'string' },
          port: { type: 'number' },
          username: { type: 'string' },
          password: { type: 'string' },
          database: { type: 'string' },
          filePath: { type: 'string' },
          createdAt: { type: 'number' },
          updatedAt: { type: 'number' }
        }
      }
    },
    quickCommands: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          commands: { type: 'string' },
          targets: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'number' },
          updatedAt: { type: 'number' }
        }
      }
    },
    sshConfigSynced: {
      type: 'boolean',
      default: false
    }
  }
})
