import * as logger from '../utils/logger'
import { detectAll } from './local-env.service'
import { listSubApps, getManifest } from './subapp.service'
import { getSessions } from './ai-workbench.service'
import { getDBConnections, queryDB, getDBTables } from './ai-terminal.service'

// ============ Tool Provider Interface ============

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
}

export interface ToolResult {
  content: string
  isError: boolean
}

export interface InternalToolProvider {
  name: string
  listTools(): Promise<ToolDefinition[]>
  executeTool(toolName: string, input: Record<string, any>): Promise<ToolResult>
}

// ============ Tool Registry ============

class InternalToolRegistry {
  private providers = new Map<string, InternalToolProvider>()
  private toolToProvider = new Map<string, string>()

  register(provider: InternalToolProvider): void {
    this.providers.set(provider.name, provider)
    logger.info(`[internal-tools] Registered provider: ${provider.name}`)
  }

  async listAllTools(): Promise<ToolDefinition[]> {
    const allTools: ToolDefinition[] = []
    for (const [providerName, provider] of this.providers) {
      try {
        const tools = await provider.listTools()
        for (const tool of tools) {
          allTools.push(tool)
          this.toolToProvider.set(tool.name, providerName)
        }
      } catch (err) {
        logger.error(`[internal-tools] Failed to list tools from ${providerName}:`, err)
      }
    }
    return allTools
  }

  async executeTool(toolName: string, input: Record<string, any>): Promise<ToolResult> {
    const providerName = this.toolToProvider.get(toolName)
    if (!providerName) {
      return { content: `Unknown tool: ${toolName}`, isError: true }
    }

    const provider = this.providers.get(providerName)
    if (!provider) {
      return { content: `Provider not found: ${providerName}`, isError: true }
    }

    try {
      return await provider.executeTool(toolName, input)
    } catch (err: any) {
      return { content: `Tool execution error: ${err.message}`, isError: true }
    }
  }
}

// ============ Module Providers ============

class LocalEnvToolProvider implements InternalToolProvider {
  name = 'local-env'

  async listTools(): Promise<ToolDefinition[]> {
    return [{
      name: 'get_dev_environment',
      description: 'Returns installation status and versions of development tools (Python, Node.js, Git, Docker, etc.) on the local machine.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    }]
  }

  async executeTool(_toolName: string, _input: Record<string, any>): Promise<ToolResult> {
    try {
      const result = await detectAll()
      const summary = result.tools.map((t: any) => {
        const status = t.installed ? `${t.version}` : 'not installed'
        return `${t.name}: ${status}`
      }).join('\n')
      return { content: `Platform: ${result.platform}\n${summary}`, isError: false }
    } catch (err: any) {
      return { content: `Failed to detect environment: ${err.message}`, isError: true }
    }
  }
}

class WorkbenchToolProvider implements InternalToolProvider {
  name = 'workbench'

  async listTools(): Promise<ToolDefinition[]> {
    return [{
      name: 'list_workbench_apps',
      description: 'Lists all installed Python sub-apps (ClawBench workbench apps) with their names and parameter descriptions.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    }]
  }

  async executeTool(_toolName: string, _input: Record<string, any>): Promise<ToolResult> {
    try {
      const apps = await listSubApps()
      if (!apps || apps.length === 0) {
        return { content: 'No installed workbench apps found.', isError: false }
      }
      const lines = await Promise.all(apps.map(async (app: any) => {
        try {
          const manifest = await getManifest(app.id)
          const params = manifest?.params?.map((p: any) => `${p.name}(${p.type})`).join(', ') || 'none'
          return `- ${manifest?.name || app.id}: params=[${params}]`
        } catch {
          return `- ${app.id}`
        }
      }))
      return { content: lines.join('\n'), isError: false }
    } catch (err: any) {
      return { content: `Failed to list apps: ${err.message}`, isError: true }
    }
  }
}

class CodingToolProvider implements InternalToolProvider {
  name = 'coding'

  async listTools(): Promise<ToolDefinition[]> {
    return [{
      name: 'list_coding_sessions',
      description: 'Lists current AI coding sessions (Claude Code, Codex, Gemini CLI) with their status and workspace.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    }]
  }

  async executeTool(_toolName: string, _input: Record<string, any>): Promise<ToolResult> {
    try {
      const sessions = await getSessions()
      if (!sessions || sessions.length === 0) {
        return { content: 'No active coding sessions.', isError: false }
      }
      const lines = sessions.map((s: any) =>
        `- [${s.tool || 'unknown'}] ${s.workspace || 'no workspace'}: ${s.status || 'unknown'}`
      )
      return { content: lines.join('\n'), isError: false }
    } catch (err: any) {
      return { content: `Failed to list sessions: ${err.message}`, isError: true }
    }
  }
}

class TerminalToolProvider implements InternalToolProvider {
  name = 'terminal'

  async listTools(): Promise<ToolDefinition[]> {
    return [
      {
        name: 'list_db_connections',
        description: 'Lists configured database connections (MySQL, PostgreSQL, MongoDB, SQLite).',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'query_database',
        description: 'Execute a read-only SQL query on a connected database. Only SELECT queries are allowed.',
        inputSchema: {
          type: 'object',
          properties: {
            connectionId: { type: 'string', description: 'Database connection ID' },
            query: { type: 'string', description: 'SQL SELECT query to execute' },
          },
          required: ['connectionId', 'query'],
        },
      },
    ]
  }

  async executeTool(toolName: string, input: Record<string, any>): Promise<ToolResult> {
    if (toolName === 'list_db_connections') {
      try {
        const connections = await getDBConnections()
        if (!connections || connections.length === 0) {
          return { content: 'No database connections configured.', isError: false }
        }
        const lines = connections.map((c: any) =>
          `- [${c.id}] ${c.type} ${c.name || c.host || c.path || ''}`
        )
        return { content: lines.join('\n'), isError: false }
      } catch (err: any) {
        return { content: `Failed to list connections: ${err.message}`, isError: true }
      }
    }

    if (toolName === 'query_database') {
      const { connectionId, query } = input
      if (!connectionId || !query) {
        return { content: 'Missing connectionId or query', isError: true }
      }

      // Safety: reject non-SELECT queries
      const UNSAFE_KEYWORDS = /\b(DROP|DELETE|INSERT|UPDATE|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC)\b/i
      if (UNSAFE_KEYWORDS.test(query)) {
        return { content: 'Only read-only SELECT queries are allowed.', isError: true }
      }

      try {
        const result = await queryDB(connectionId, query)
        return {
          content: JSON.stringify(result, null, 2).slice(0, 8000),
          isError: false,
        }
      } catch (err: any) {
        return { content: `Query failed: ${err.message}`, isError: true }
      }
    }

    return { content: `Unknown tool: ${toolName}`, isError: true }
  }
}

// ============ Singleton Registry ============

export const internalToolRegistry = new InternalToolRegistry()

/**
 * Initialize all internal tool providers.
 * Called once at app startup.
 */
export function initInternalTools(): void {
  internalToolRegistry.register(new LocalEnvToolProvider())
  internalToolRegistry.register(new WorkbenchToolProvider())
  internalToolRegistry.register(new CodingToolProvider())
  internalToolRegistry.register(new TerminalToolProvider())
  logger.info('[internal-tools] All providers registered')
}
