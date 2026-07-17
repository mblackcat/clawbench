/**
 * Unified agent tool catalog (Claude Code–inspired).
 *
 * Each tool carries:
 * - API schema (name / description / inputSchema)
 * - Optional long-form prompt() guidance (internalized capability)
 * - isReadOnly / isConcurrencySafe for parallel execution
 * - isSafe for default auto-approval
 * - execute() implementation
 */
import { executeTool as executeBuiltinTool, COMMAND_EXECUTOR_TOOL } from '../tool-executor.service'
import { IMAGE_GENERATION_TOOL, IMAGE_EDIT_TOOL } from '../image-gen.service'
import { internalToolRegistry } from '../internal-tools.service'
import { mcpClientManager } from '../mcp/mcp-client.service'
import { getFeishuToolsService, isFeishuToolsAvailable } from '../feishu-tools.service'
import { applyToolResultBudget, applyToolResultBatchBudget } from './tool-result-budget'
import * as logger from '../../utils/logger'

export interface AgentToolCall {
  id: string
  name: string
  input: Record<string, any>
}

export interface AgentToolResult {
  id: string
  name: string
  content: string
  isError: boolean
}

export interface AgentToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
  /** Extra usage guidance — not always inlined; merged into description when listing for the API */
  prompt?: () => string
  isReadOnly?: (input: Record<string, any>) => boolean
  isConcurrencySafe?: (input: Record<string, any>) => boolean
  /** Safe for auto-approve-safe mode (default false) */
  isSafe?: boolean
  source: 'builtin' | 'internal' | 'mcp' | 'search' | 'feishu' | 'pseudo'
  mcpServerId?: string
  execute: (input: Record<string, any>, ctx?: AgentToolExecContext) => Promise<{ content: string; isError: boolean }>
}

export interface AgentToolExecContext {
  attachmentPaths?: string[]
}

export interface ResolveToolsOptions {
  toolsEnabled?: boolean
  webSearchEnabled?: boolean
  feishuKitsEnabled?: boolean
  /** Include MCP tools (default true when toolsEnabled) */
  includeMcp?: boolean
  includeInternal?: boolean
}

const SAFE_TOOL_NAMES = new Set([
  'web_search',
  'web_browse',
  'plan_search',
  'generate_image',
  'edit_image',
  'get_dev_environment',
  'list_workbench_apps',
  'search_market_apps',
  'list_coding_workspaces',
  'list_coding_sessions',
  'list_terminal_connections',
  'list_db_connections',
  'query_database',
  'read_agent_file',
  'feishu_read_doc',
  'feishu_search_docs',
  'feishu_search_messages',
  'feishu_list_wiki_spaces',
  'feishu_sheet_read',
])

function wrapBuiltin(
  def: { name: string; description: string; inputSchema: Record<string, any> },
  opts: Partial<AgentToolDefinition> = {}
): AgentToolDefinition {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    source: 'builtin',
    isSafe: SAFE_TOOL_NAMES.has(def.name),
    isReadOnly: () => SAFE_TOOL_NAMES.has(def.name) && def.name !== 'execute_command',
    isConcurrencySafe: (input) => {
      if (def.name === 'execute_command') return false
      if (def.name === 'web_browse') return true
      if (def.name === 'web_search') return true
      return opts.isConcurrencySafe?.(input) ?? true
    },
    execute: async (input) => {
      const r = await executeBuiltinTool(def.name, input)
      return { content: r.output || r.error || '', isError: r.isError }
    },
    ...opts,
  }
}

const PLAN_SEARCH: AgentToolDefinition = {
  name: 'plan_search',
  description:
    'Optional planning step for multi-query research. Declare queries and why before calling web_search. Skip for a single obvious query. After planning, execute searches yourself (this tool does not fetch pages).',
  inputSchema: {
    type: 'object',
    properties: {
      queries: { type: 'array', items: { type: 'string' }, description: 'List of search queries to execute' },
      reasoning: { type: 'string', description: 'Brief explanation of your search strategy' },
    },
    required: ['queries', 'reasoning'],
  },
  source: 'pseudo',
  isSafe: true,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  prompt: () =>
    'Use plan_search only for multi-angle research. Then call web_search with varied queries; cite URLs in the final answer.',
  execute: async (input) => {
    const queries = input.queries || []
    const reasoning = input.reasoning || ''
    return {
      content: `Search plan confirmed. ${queries.length} queries planned. Reasoning: ${reasoning}\nProceed with your searches.`,
      isError: false,
    }
  },
}

const WEB_SEARCH = wrapBuiltin(
  {
    name: 'web_search',
    description:
      'Search the web for current information (events, latest versions, changelogs, uncertain facts). ' +
      'Skip for greetings, pure math/logic, coding from well-known APIs, and follow-ups already answered in-thread. ' +
      'Vary queries when results are thin; prefer 2–4 useful searches over exhaustive crawling. Cite source URLs in the final answer.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        maxResults: { type: 'number', description: 'Maximum number of results to return (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    source: 'search',
    isSafe: true,
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    prompt: () =>
      'Web search is for fresh/uncertain facts only. Do not search every message. Prefer quality over volume.',
  }
)

const WEB_BROWSE = wrapBuiltin(
  {
    name: 'web_browse',
    description:
      'Fetch and read a specific URL (full page text). Use after web_search for promising links, or when the user provides a URL. ' +
      'Do not re-browse the same page path in one turn. Prefer extracting only what answers the user.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to browse' },
      },
      required: ['url'],
    },
  },
  {
    source: 'search',
    isSafe: true,
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  }
)

/**
 * Resolve the full tool set for an agent turn.
 */
export async function resolveAgentTools(opts: ResolveToolsOptions = {}): Promise<AgentToolDefinition[]> {
  const tools: AgentToolDefinition[] = []
  const toolsEnabled = opts.toolsEnabled !== false
  const webSearch = !!opts.webSearchEnabled

  if (toolsEnabled) {
    tools.push(
      wrapBuiltin(COMMAND_EXECUTOR_TOOL, {
        isSafe: false,
        isReadOnly: () => false,
        isConcurrencySafe: () => false,
        prompt: () =>
          'Prefer dedicated module tools over shell when available. Never run catastrophic commands without explicit user confirmation.',
      })
    )
    tools.push(
      wrapBuiltin(IMAGE_GENERATION_TOOL as any, {
        isSafe: true,
        isReadOnly: () => true,
        isConcurrencySafe: () => true,
      })
    )
    tools.push(
      wrapBuiltin(IMAGE_EDIT_TOOL as any, {
        isSafe: true,
        isReadOnly: () => true,
        isConcurrencySafe: () => true,
      })
    )

    if (opts.includeInternal !== false) {
      try {
        const internal = await internalToolRegistry.listAllTools()
        for (const t of internal) {
          tools.push({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            source: 'internal',
            isSafe: SAFE_TOOL_NAMES.has(t.name),
            isReadOnly: () =>
              SAFE_TOOL_NAMES.has(t.name) ||
              t.name.startsWith('list_') ||
              t.name.startsWith('get_') ||
              t.name === 'read_agent_file' ||
              t.name === 'query_database',
            isConcurrencySafe: (input) => {
              if (t.name === 'run_shell_command' || t.name === 'run_terminal_command') return false
              if (t.name === 'execute_database' || t.name === 'run_workbench_app') return false
              if (t.name === 'create_coding_session') return false
              return true
            },
            execute: async (input) => {
              const r = await internalToolRegistry.executeTool(t.name, input)
              return { content: r.content, isError: r.isError }
            },
          })
        }
      } catch (err) {
        logger.error('[agent-tools] Failed to list internal tools:', err)
      }
    }

    if (opts.includeMcp !== false) {
      try {
        const mcpTools = mcpClientManager.getAvailableTools()
        for (const t of mcpTools) {
          tools.push({
            name: t.name,
            description: t.description || `MCP tool from ${t.serverName || t.serverId}`,
            inputSchema: t.inputSchema || { type: 'object', properties: {} },
            source: 'mcp',
            mcpServerId: t.serverId,
            isSafe: false,
            isReadOnly: () => false,
            isConcurrencySafe: () => false,
            execute: async (input, ctx) => {
              try {
                if (ctx?.attachmentPaths?.length && t.isVisionTool) {
                  const r = await mcpClientManager.callToolWithImageInjection(
                    t.serverId,
                    t.name,
                    input,
                    ctx.attachmentPaths
                  )
                  return { content: r.content, isError: r.isError }
                }
                const r = await mcpClientManager.callTool(t.serverId, t.name, input)
                return { content: r.content, isError: r.isError }
              } catch (err: any) {
                return { content: err.message || 'MCP tool failed', isError: true }
              }
            },
          })
        }
      } catch (err) {
        logger.error('[agent-tools] Failed to list MCP tools:', err)
      }
    }
  }

  if (webSearch) {
    tools.push(PLAN_SEARCH, WEB_SEARCH, WEB_BROWSE)
  }

  if (opts.feishuKitsEnabled) {
    try {
      const availability = isFeishuToolsAvailable()
      if (availability.available) {
        const feishuSvc = getFeishuToolsService()
        const feishuTools = feishuSvc.listTools()
        for (const t of feishuTools) {
          tools.push({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            source: 'feishu',
            isSafe: SAFE_TOOL_NAMES.has(t.name),
            isReadOnly: () => SAFE_TOOL_NAMES.has(t.name),
            isConcurrencySafe: () =>
              t.name.includes('read') || t.name.includes('search') || t.name.includes('list'),
            execute: async (input) => {
              const r = await feishuSvc.executeTool(t.name, input)
              return { content: r.content, isError: r.isError }
            },
          })
        }
      }
    } catch (err) {
      logger.error('[agent-tools] Failed to list Feishu tools:', err)
    }
  }

  // Dedupe by name (first wins)
  const seen = new Set<string>()
  const deduped: AgentToolDefinition[] = []
  for (const t of tools) {
    if (seen.has(t.name)) continue
    seen.add(t.name)
    deduped.push(t)
  }
  return deduped
}

export function toApiToolDefs(
  tools: AgentToolDefinition[]
): Array<{ name: string; description: string; inputSchema: Record<string, any> }> {
  return tools.map((t) => {
    const extra = t.prompt?.()?.trim()
    const description = extra ? `${t.description}\n\n${extra}` : t.description
    return {
      name: t.name,
      description: description.slice(0, 4000),
      inputSchema: t.inputSchema,
    }
  })
}

export function isToolSafe(tool: AgentToolDefinition | undefined, name: string): boolean {
  if (tool?.isSafe) return true
  return SAFE_TOOL_NAMES.has(name)
}

/**
 * Partition tool calls into concurrent-safe batches (Claude Code style).
 * Consecutive read-only/concurrency-safe tools run in parallel; others serial.
 */
export function partitionToolBatches(
  calls: AgentToolCall[],
  catalog: Map<string, AgentToolDefinition>
): Array<{ concurrent: boolean; calls: AgentToolCall[] }> {
  const batches: Array<{ concurrent: boolean; calls: AgentToolCall[] }> = []
  for (const call of calls) {
    const tool = catalog.get(call.name)
    let safe = false
    try {
      safe = Boolean(tool?.isConcurrencySafe?.(call.input) ?? tool?.isReadOnly?.(call.input))
    } catch {
      safe = false
    }
    const last = batches[batches.length - 1]
    if (safe && last?.concurrent) {
      last.calls.push(call)
    } else {
      batches.push({ concurrent: safe, calls: [call] })
    }
  }
  return batches
}

export async function executeAgentTool(
  call: AgentToolCall,
  catalog: Map<string, AgentToolDefinition>,
  ctx?: AgentToolExecContext
): Promise<AgentToolResult> {
  const tool = catalog.get(call.name)
  if (!tool) {
    return { id: call.id, name: call.name, content: `Unknown tool: ${call.name}`, isError: true }
  }
  try {
    const r = await tool.execute(call.input || {}, ctx)
    const budgeted = applyToolResultBudget(r.content || '')
    return {
      id: call.id,
      name: call.name,
      content: budgeted.content,
      isError: r.isError,
    }
  } catch (err: any) {
    return {
      id: call.id,
      name: call.name,
      content: err?.message || 'Tool execution failed',
      isError: true,
    }
  }
}

/** Stable fingerprint for tool name + args (loop-scoped anti-spin). */
export function toolCallFingerprint(name: string, input: Record<string, any>): string {
  return `${name}:${JSON.stringify(input || {}, Object.keys(input || {}).sort())}`
}

export const MAX_TOOL_DUPLICATES = 3

/**
 * Record a tool fingerprint; returns blocked when identical call exceeds max.
 * Pure helper — used by executeAgentToolBatch and unit-tested on the real path.
 */
export function checkAndRecordFingerprint(
  fingerprints: Map<string, number> | Record<string, number>,
  name: string,
  input: Record<string, any>,
  maxDup: number = MAX_TOOL_DUPLICATES
): { blocked: boolean; fingerprint: string; count: number } {
  const fp = toolCallFingerprint(name, input)
  const get = (k: string) =>
    fingerprints instanceof Map ? fingerprints.get(k) || 0 : fingerprints[k] || 0
  const set = (k: string, v: number) => {
    if (fingerprints instanceof Map) fingerprints.set(k, v)
    else fingerprints[k] = v
  }
  const count = get(fp)
  if (count >= maxDup) {
    return { blocked: true, fingerprint: fp, count }
  }
  set(fp, count + 1)
  return { blocked: false, fingerprint: fp, count: count + 1 }
}

export interface ExecuteAgentToolBatchResult {
  results: Array<{ id: string; name: string; content: string; isError: boolean }>
  /** Updated fingerprint counts for the whole agent turn/loop (persist across IPC calls). */
  fingerprints: Record<string, number>
}

/**
 * Execute a batch of tool calls with concurrency partitioning + result budget.
 * Used by main agent loop and by hybrid builtin chat via IPC.
 * Pass `fingerprints` from previous steps so anti-spin spans the full agent loop.
 */
export async function executeAgentToolBatch(
  calls: AgentToolCall[],
  options?: {
    toolsEnabled?: boolean
    webSearchEnabled?: boolean
    feishuKitsEnabled?: boolean
    attachmentPaths?: string[]
    /** Loop-scoped anti-spin state (serialized). Mutated and returned. */
    fingerprints?: Record<string, number>
  }
): Promise<ExecuteAgentToolBatchResult> {
  const agentTools = await resolveAgentTools({
    toolsEnabled: options?.toolsEnabled !== false,
    webSearchEnabled: !!options?.webSearchEnabled,
    feishuKitsEnabled: !!options?.feishuKitsEnabled,
  })
  const catalog = new Map(agentTools.map((t) => [t.name, t]))
  const fingerprints: Record<string, number> = { ...(options?.fingerprints || {}) }
  const ctx = { attachmentPaths: options?.attachmentPaths }

  const results: Array<{ id: string; name: string; content: string; isError: boolean }> = []
  const batches = partitionToolBatches(calls, catalog)

  for (const batch of batches) {
    const runOne = async (call: AgentToolCall) => {
      const check = checkAndRecordFingerprint(fingerprints, call.name, call.input || {})
      if (check.blocked) {
        return {
          id: call.id,
          name: call.name,
          content: 'Duplicate tool call blocked (anti-loop). Use existing results.',
          isError: true,
        }
      }
      return executeAgentTool(call, catalog, ctx)
    }

    if (batch.concurrent && batch.calls.length > 1) {
      // Serial fingerprint checks first (parallel execute would race Map updates)
      const allowed: AgentToolCall[] = []
      const blocked: Array<{ id: string; name: string; content: string; isError: boolean }> = []
      for (const call of batch.calls) {
        const check = checkAndRecordFingerprint(fingerprints, call.name, call.input || {})
        if (check.blocked) {
          blocked.push({
            id: call.id,
            name: call.name,
            content: 'Duplicate tool call blocked (anti-loop). Use existing results.',
            isError: true,
          })
        } else {
          allowed.push(call)
        }
      }
      results.push(...blocked)
      if (allowed.length > 0) {
        const batchResults = await Promise.all(
          allowed.map((call) => executeAgentTool(call, catalog, ctx))
        )
        results.push(...batchResults)
      }
    } else {
      for (const call of batch.calls) {
        results.push(await runOne(call))
      }
    }
  }

  return {
    results: applyToolResultBatchBudget(results).map((r) => ({
      id: r.id,
      name: r.name || '',
      content: r.content,
      isError: !!r.isError,
    })),
    fingerprints,
  }
}
