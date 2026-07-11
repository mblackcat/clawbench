import { randomUUID } from 'crypto'
import * as logger from '../utils/logger'
import { detectAll } from './local-env.service'
import { listSubApps, getManifest, getSubAppPath } from './subapp.service'
import {
  getSessions,
  getWorkspaces,
  createSession,
  launchSession,
  writeToSession,
} from './ai-coding.service'
import type { AIToolType } from '../store/ai-coding.store'
import {
  getDBConnections,
  queryDB,
  executeDB,
  isDBConnected,
  getConnections as getTerminalConnections,
  executeCommandAndWait,
} from './ai-terminal.service'
import { executeSubAppWithCallbacks, resolvePythonCommand } from './python-runner.service'
import { getActiveWorkspace } from './workspace.service'
import { listRecentMarketApps, searchMarketApps, installMarketApp } from './im/marketplace.service'
import { getPythonSdkPath } from '../utils/paths'
import { executeCommand } from './tool-executor.service'
import {
  applyAgentFileUpdate,
  readMemory,
  writeToolsHarness,
} from './agent-memory.service'

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
    // Rebuild map each list so newly registered tools are found
    this.toolToProvider.clear()
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
    // Ensure map is populated
    if (this.toolToProvider.size === 0) {
      await this.listAllTools()
    }
    const providerName = this.toolToProvider.get(toolName)
    if (!providerName) {
      // Try refresh once (tools may have been registered after last list)
      await this.listAllTools()
      const retry = this.toolToProvider.get(toolName)
      if (!retry) {
        return { content: `Unknown tool: ${toolName}`, isError: true }
      }
      return this.executeTool(toolName, input)
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
    return [
      {
        name: 'list_workbench_apps',
        description: 'Lists all installed Python sub-apps (ClawBench workbench apps) with their names and parameter descriptions.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'run_workbench_app',
        description: 'Run an installed workbench app by id. Pass params as a flat object matching the app manifest. Returns the execution summary.',
        inputSchema: {
          type: 'object',
          properties: {
            appId: { type: 'string', description: 'App id (manifest id)' },
            params: { type: 'object', description: 'Parameter map for the app' },
          },
          required: ['appId'],
        },
      },
      {
        name: 'search_market_apps',
        description: 'Search published marketplace apps by keyword (empty keyword = recent apps).',
        inputSchema: {
          type: 'object',
          properties: {
            keywords: { type: 'string', description: 'Search keywords (optional)' },
          },
          required: [],
        },
      },
      {
        name: 'install_market_app',
        description: 'Install a published marketplace app by applicationId.',
        inputSchema: {
          type: 'object',
          properties: {
            applicationId: { type: 'string', description: 'Marketplace application id' },
          },
          required: ['applicationId'],
        },
      },
    ]
  }

  async executeTool(toolName: string, input: Record<string, any>): Promise<ToolResult> {
    if (toolName === 'list_workbench_apps') {
      try {
        const apps = await listSubApps()
        if (!apps || apps.length === 0) {
          return { content: 'No installed workbench apps found.', isError: false }
        }
        const lines = await Promise.all(apps.map(async (app: any) => {
          try {
            const manifest = await getManifest(app.id)
            const params = manifest?.params?.map((p: any) => `${p.name}(${p.type})`).join(', ') || 'none'
            return `- id=${manifest?.id || app.id} name=${manifest?.name || app.id}: params=[${params}]`
          } catch {
            return `- ${app.id}`
          }
        }))
        return { content: lines.join('\n'), isError: false }
      } catch (err: any) {
        return { content: `Failed to list apps: ${err.message}`, isError: true }
      }
    }

    if (toolName === 'run_workbench_app') {
      return this.runApp(String(input.appId || ''), (input.params && typeof input.params === 'object') ? input.params : {})
    }

    if (toolName === 'search_market_apps') {
      try {
        const keywords = (input.keywords || '').trim()
        const apps = keywords ? await searchMarketApps(keywords) : await listRecentMarketApps()
        if (!apps.length) return { content: 'No marketplace apps found.', isError: false }
        const lines = apps.map((a) =>
          `- ${a.applicationId}: ${a.name} — ${(a.description || '').slice(0, 120)}`
        )
        return { content: lines.join('\n'), isError: false }
      } catch (err: any) {
        return { content: `Marketplace search failed: ${err.message}`, isError: true }
      }
    }

    if (toolName === 'install_market_app') {
      const applicationId = String(input.applicationId || '').trim()
      if (!applicationId) return { content: 'applicationId is required', isError: true }
      const result = await installMarketApp(applicationId)
      if (!result.success) return { content: `Install failed: ${result.error}`, isError: true }
      return { content: `Installed: ${result.name || applicationId}`, isError: false }
    }

    return { content: `Unknown tool: ${toolName}`, isError: true }
  }

  private async runApp(appId: string, params: Record<string, unknown>): Promise<ToolResult> {
    if (!appId) return { content: 'appId is required', isError: true }

    const apps = listSubApps()
    const app = apps.find((a) => a.manifest.id === appId || a.manifest.name === appId)
    if (!app) {
      return { content: `App not found: ${appId}. Use list_workbench_apps first.`, isError: true }
    }

    const appPath = getSubAppPath(app.manifest.id)
    if (!appPath) return { content: `Cannot resolve path for ${app.manifest.id}`, isError: true }

    let pythonPath: string
    try {
      const python = await resolvePythonCommand()
      pythonPath = python.path
    } catch (err: any) {
      return { content: `Python not available: ${err.message}`, isError: true }
    }

    const active = getActiveWorkspace()
    const workspace = active
      ? { id: active.id, name: active.name, path: active.path }
      : { id: 'tool', name: 'Tool Task', path: '' }

    const sdkPath = getPythonSdkPath()
    const taskId = randomUUID()
    const outputLines: string[] = []

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          content: `App still running (timeout). Partial output:\n${outputLines.slice(-20).join('\n')}`,
          isError: false,
        })
      }, 120_000)

      executeSubAppWithCallbacks(
        taskId,
        app.manifest.name,
        appPath,
        app.manifest.entry,
        params,
        workspace,
        pythonPath,
        sdkPath,
        {
          onOutput: (message) => {
            outputLines.push(message)
            if (outputLines.length > 40) outputLines.shift()
          },
          onComplete: (success, summary) => {
            clearTimeout(timeout)
            const tail = outputLines.slice(-12).join('\n')
            resolve({
              content: `${success ? 'OK' : 'FAILED'}: ${summary}\n${tail}`.trim(),
              isError: !success,
            })
          },
        }
      )
    })
  }
}

class CodingToolProvider implements InternalToolProvider {
  name = 'coding'

  async listTools(): Promise<ToolDefinition[]> {
    return [
      {
        name: 'list_coding_workspaces',
        description: 'Lists AI Coding workspaces (id, title, working directory).',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'list_coding_sessions',
        description: 'Lists current AI coding sessions (Claude Code, Codex, Gemini CLI) with status and workspace.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'create_coding_session',
        description: 'Create and launch a coding session in a workspace, optionally sending an initial prompt. toolType: claude | codex | gemini | opencode | qwen.',
        inputSchema: {
          type: 'object',
          properties: {
            workspaceId: { type: 'string', description: 'Coding workspace id (from list_coding_workspaces)' },
            toolType: { type: 'string', description: 'claude | codex | gemini | opencode | qwen' },
            initialPrompt: { type: 'string', description: 'Optional first message sent after launch' },
            source: { type: 'string', description: 'local or im (default local)' },
          },
          required: ['workspaceId', 'toolType'],
        },
      },
    ]
  }

  async executeTool(toolName: string, input: Record<string, any>): Promise<ToolResult> {
    if (toolName === 'list_coding_workspaces') {
      try {
        const workspaces = getWorkspaces()
        if (!workspaces.length) return { content: 'No coding workspaces. Create one in AI Coding UI.', isError: false }
        const lines = workspaces.map((w) => `- [${w.id}] ${w.title} → ${w.workingDir}`)
        return { content: lines.join('\n'), isError: false }
      } catch (err: any) {
        return { content: `Failed to list workspaces: ${err.message}`, isError: true }
      }
    }

    if (toolName === 'list_coding_sessions') {
      try {
        const sessions = getSessions()
        if (!sessions || sessions.length === 0) {
          return { content: 'No active coding sessions.', isError: false }
        }
        const workspaces = getWorkspaces()
        const wsMap = new Map(workspaces.map((w) => [w.id, w.title]))
        const lines = sessions.map((s) =>
          `- [${s.id}] tool=${s.toolType} status=${s.status} workspace=${wsMap.get(s.workspaceId) || s.workspaceId} source=${s.source}`
        )
        return { content: lines.join('\n'), isError: false }
      } catch (err: any) {
        return { content: `Failed to list sessions: ${err.message}`, isError: true }
      }
    }

    if (toolName === 'create_coding_session') {
      const workspaceId = String(input.workspaceId || '')
      const toolType = String(input.toolType || '').toLowerCase() as AIToolType
      const initialPrompt = input.initialPrompt ? String(input.initialPrompt) : ''
      const source = input.source === 'im' ? 'im' : 'local'
      const valid: AIToolType[] = ['claude', 'codex', 'gemini', 'opencode', 'qwen', 'terminal']
      if (!workspaceId) return { content: 'workspaceId is required', isError: true }
      if (!valid.includes(toolType)) {
        return { content: `Invalid toolType. Use one of: ${valid.join(', ')}`, isError: true }
      }
      const ws = getWorkspaces().find((w) => w.id === workspaceId)
      if (!ws) return { content: `Workspace not found: ${workspaceId}`, isError: true }

      try {
        const session = createSession(workspaceId, toolType, source)
        const launch = await launchSession(session.id)
        if (!launch.success) {
          return { content: `Session created (${session.id}) but launch failed: ${launch.error}`, isError: true }
        }
        if (initialPrompt.trim()) {
          // Give the session a moment to start
          await new Promise((r) => setTimeout(r, 1500))
          const write = await writeToSession(session.id, initialPrompt)
          if (!write.success) {
            return {
              content: `Session ${session.id} launched in ${ws.title}, but initial prompt failed: ${write.error}`,
              isError: false,
            }
          }
        }
        return {
          content: `Coding session created and launched.\nid=${session.id}\ntool=${toolType}\nworkspace=${ws.title} (${ws.workingDir})${initialPrompt ? '\ninitialPrompt=sent' : ''}`,
          isError: false,
        }
      } catch (err: any) {
        return { content: `create_coding_session failed: ${err.message}`, isError: true }
      }
    }

    return { content: `Unknown tool: ${toolName}`, isError: true }
  }
}

class TerminalToolProvider implements InternalToolProvider {
  name = 'terminal'

  async listTools(): Promise<ToolDefinition[]> {
    return [
      {
        name: 'list_terminal_connections',
        description: 'Lists saved terminal (SSH/local) connection profiles.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'run_shell_command',
        description: 'Run a one-shot shell command on the local machine (or optional cwd). Prefer non-destructive commands. For long interactive sessions use AI Terminal UI.',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to run' },
            cwd: { type: 'string', description: 'Optional working directory' },
          },
          required: ['command'],
        },
      },
      {
        name: 'run_terminal_command',
        description: 'Write a command to an existing AI Terminal PTY session and wait for output. Requires sessionId from an open terminal tab.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Open terminal session id' },
            command: { type: 'string', description: 'Command to send' },
            timeoutMs: { type: 'number', description: 'Wait timeout (default 15000)' },
          },
          required: ['sessionId', 'command'],
        },
      },
      {
        name: 'list_db_connections',
        description: 'Lists configured database connections (MySQL, PostgreSQL, MongoDB, SQLite).',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'query_database',
        description: 'Execute a read-only SQL query on a connected database. Only SELECT/WITH/PRAGMA allowed.',
        inputSchema: {
          type: 'object',
          properties: {
            connectionId: { type: 'string', description: 'Database connection ID' },
            query: { type: 'string', description: 'SQL SELECT query to execute' },
          },
          required: ['connectionId', 'query'],
        },
      },
      {
        name: 'execute_database',
        description: 'Execute a non-SELECT SQL statement (INSERT/UPDATE/DELETE). Destructive DDL (DROP/TRUNCATE/ALTER) is blocked unless confirmDestructive=true and the user explicitly asked.',
        inputSchema: {
          type: 'object',
          properties: {
            connectionId: { type: 'string', description: 'Database connection ID' },
            sql: { type: 'string', description: 'SQL to execute' },
            confirmDestructive: { type: 'boolean', description: 'Must be true for DROP/TRUNCATE/ALTER' },
          },
          required: ['connectionId', 'sql'],
        },
      },
    ]
  }

  async executeTool(toolName: string, input: Record<string, any>): Promise<ToolResult> {
    if (toolName === 'list_terminal_connections') {
      try {
        const connections = getTerminalConnections()
        if (!connections.length) return { content: 'No terminal connections saved.', isError: false }
        const lines = connections.map((c: any) =>
          `- [${c.id}] ${c.name || c.host || 'local'} type=${c.type || 'unknown'}`
        )
        return { content: lines.join('\n'), isError: false }
      } catch (err: any) {
        return { content: `Failed to list terminal connections: ${err.message}`, isError: true }
      }
    }

    if (toolName === 'run_shell_command') {
      const command = String(input.command || '').trim()
      if (!command) return { content: 'command is required', isError: true }
      const dangerous = /\b(rm\s+-rf\s+\/|format\s+[a-z]:|mkfs\.|dd\s+if=)/i
      if (dangerous.test(command)) {
        return { content: 'Blocked potentially catastrophic command.', isError: true }
      }
      try {
        const result = await executeCommand(command, input.cwd ? String(input.cwd) : undefined)
        return {
          content: (result.output || result.error || '').slice(0, 8000) || '(no output)',
          isError: !!result.isError,
        }
      } catch (err: any) {
        return { content: `Command failed: ${err.message}`, isError: true }
      }
    }

    if (toolName === 'run_terminal_command') {
      const sessionId = String(input.sessionId || '')
      const command = String(input.command || '')
      if (!sessionId || !command) return { content: 'sessionId and command are required', isError: true }
      try {
        const timeoutMs = typeof input.timeoutMs === 'number' ? input.timeoutMs : 15000
        const output = await executeCommandAndWait(sessionId, command, timeoutMs)
        return { content: (output || '(no output)').slice(-8000), isError: false }
      } catch (err: any) {
        return { content: `Terminal command failed: ${err.message}`, isError: true }
      }
    }

    if (toolName === 'list_db_connections') {
      try {
        const connections = await getDBConnections()
        if (!connections || connections.length === 0) {
          return { content: 'No database connections configured.', isError: false }
        }
        const lines = connections.map((c: any) => {
          const connected = isDBConnected(c.id) ? 'connected' : 'idle'
          return `- [${c.id}] ${c.type} ${c.name || c.host || c.path || ''} (${connected})`
        })
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

      const UNSAFE_KEYWORDS = /\b(DROP|DELETE|INSERT|UPDATE|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC)\b/i
      if (UNSAFE_KEYWORDS.test(query)) {
        return { content: 'Only read-only SELECT queries are allowed on query_database. Use execute_database for writes.', isError: true }
      }

      try {
        if (!isDBConnected(connectionId)) {
          return { content: 'Database is not connected. Connect it in AI Terminal first.', isError: true }
        }
        const result = await queryDB(connectionId, query)
        return {
          content: JSON.stringify(result, null, 2).slice(0, 8000),
          isError: false,
        }
      } catch (err: any) {
        return { content: `Query failed: ${err.message}`, isError: true }
      }
    }

    if (toolName === 'execute_database') {
      const connectionId = String(input.connectionId || '')
      const sql = String(input.sql || '')
      if (!connectionId || !sql) {
        return { content: 'Missing connectionId or sql', isError: true }
      }
      const DESTRUCTIVE = /\b(DROP|TRUNCATE|ALTER)\b/i
      if (DESTRUCTIVE.test(sql) && !input.confirmDestructive) {
        return {
          content: 'Destructive DDL blocked. Set confirmDestructive=true only after the user explicitly confirmed.',
          isError: true,
        }
      }
      try {
        if (!isDBConnected(connectionId)) {
          return { content: 'Database is not connected. Connect it in AI Terminal first.', isError: true }
        }
        const result = await executeDB(connectionId, sql)
        return {
          content: `OK affectedRows=${result.affectedRows} timeMs=${result.executionTimeMs}`,
          isError: false,
        }
      } catch (err: any) {
        return { content: `Execute failed: ${err.message}`, isError: true }
      }
    }

    return { content: `Unknown tool: ${toolName}`, isError: true }
  }
}

// ============ Agent memory / self-maintenance ============

class AgentMemoryToolProvider implements InternalToolProvider {
  name = 'agent-memory'

  async listTools(): Promise<ToolDefinition[]> {
    return [
      {
        name: 'read_agent_file',
        description:
          'Load a durable agent knowledge file on demand (not fully inlined in the system prompt). ' +
          'soul=full persona; user=profile/preferences; memory=projects/decisions/todos; ' +
          'agents=sub-agent buddy roster; tools=detailed module harness (apps/terminal/DB/coding). ' +
          'Call when the current turn needs more than the short previews.',
        inputSchema: {
          type: 'object',
          properties: {
            file: {
              type: 'string',
              description: 'soul | user | memory | agents | tools',
              enum: ['soul', 'user', 'memory', 'agents', 'tools'],
            },
          },
          required: ['file'],
        },
      },
      {
        name: 'update_user_profile',
        description:
          'Update user.md — how to address the user, role/titles, expertise, preferences (hands-on vs hands-off), habits, communication style. Prefer merge (append) for small insights; replace only with a full rewritten profile.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Markdown content to write' },
            mode: {
              type: 'string',
              description: 'replace (full file) or append (default append for small notes)',
              enum: ['replace', 'append'],
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'update_long_term_memory',
        description:
          'Update memory.md — projects, decisions, facts, open todos (not the user persona). Prefer append for new facts; replace when condensing the whole file.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Markdown content to write' },
            mode: {
              type: 'string',
              description: 'replace or append',
              enum: ['replace', 'append'],
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'update_sub_agents',
        description:
          'Update agents.md (sub-agents / buddies): specialist helpers for multi-step work. Include name, role, when to use, and notes. Use replace to publish the full roster.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Full or partial markdown for sub-agents' },
            mode: {
              type: 'string',
              description: 'replace (recommended for full roster) or append',
              enum: ['replace', 'append'],
            },
          },
          required: ['content'],
        },
      },
    ]
  }

  async executeTool(toolName: string, input: Record<string, any>): Promise<ToolResult> {
    if (toolName === 'read_agent_file') {
      const file = String(input.file || '').toLowerCase()
      const map: Record<string, string> = {
        soul: 'soul.md',
        user: 'user.md',
        memory: 'memory.md',
        agents: 'agents.md',
        tools: 'tools.md',
      }
      const filename = map[file]
      if (!filename) {
        return { content: 'file must be soul | user | memory | agents | tools', isError: true }
      }
      try {
        const content = await readMemory(filename)
        // tools harness + memory can be larger; allow more for on-demand loads
        const max = file === 'tools' || file === 'memory' ? 12_000 : 8_000
        return {
          content: content?.trim()
            ? content.slice(0, max)
            : `(empty ${filename})`,
          isError: false,
        }
      } catch (err: any) {
        return { content: `Read failed: ${err.message}`, isError: true }
      }
    }

    const fileMap: Record<string, 'user' | 'memory' | 'agents'> = {
      update_user_profile: 'user',
      update_long_term_memory: 'memory',
      update_sub_agents: 'agents',
    }
    const file = fileMap[toolName]
    if (!file) {
      return { content: `Unknown tool: ${toolName}`, isError: true }
    }

    const content = String(input.content || '')
    const mode = input.mode === 'replace' ? 'replace' : 'append'
    // Sub-agents default to replace when mode omitted for cleaner roster
    const effectiveMode =
      toolName === 'update_sub_agents' && input.mode === undefined ? 'replace' : mode

    const result = await applyAgentFileUpdate(file, content, effectiveMode)
    if (!result.ok) {
      return { content: result.error || 'Update failed', isError: true }
    }
    return {
      content: `Updated ${file}.md (${effectiveMode}, ${result.length} chars)`,
      isError: false,
    }
  }
}

// ============ Singleton Registry ============

export const internalToolRegistry = new InternalToolRegistry()

/**
 * Rebuild tools.md from static harness + live registered tool list.
 */
export async function refreshToolsHarness(): Promise<void> {
  try {
    const tools = await internalToolRegistry.listAllTools()
    await writeToolsHarness(
      tools.map((t) => ({ name: t.name, description: t.description || '' }))
    )
    logger.info(`[internal-tools] tools.md refreshed (${tools.length} tools)`)
  } catch (err) {
    logger.error('[internal-tools] Failed to refresh tools.md:', err)
  }
}

/**
 * Initialize all internal tool providers.
 * Called once at app startup.
 */
export function initInternalTools(): void {
  internalToolRegistry.register(new LocalEnvToolProvider())
  internalToolRegistry.register(new WorkbenchToolProvider())
  internalToolRegistry.register(new CodingToolProvider())
  internalToolRegistry.register(new TerminalToolProvider())
  internalToolRegistry.register(new AgentMemoryToolProvider())
  logger.info('[internal-tools] All providers registered')
  // Fire-and-forget: sync tools.md with live tool list
  refreshToolsHarness().catch(() => {})
}
