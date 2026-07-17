/**
 * Main-process agent query loop (Claude Code QueryEngine–inspired).
 *
 * Owns: multi-turn streaming, tool execution (parallel when safe), approval gates,
 * anti-spin, and context compaction. Renderer only renders events + approves tools.
 */
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import {
  type ChatMessage,
  type AttachmentInfo,
  StreamEmitter,
  streamOneTurn,
  registerActiveTask,
  unregisterActiveTask,
  getModelConfig,
} from '../ai.service'
import { settingsStore, getAgentSettings, type AIModelConfig } from '../../store/settings.store'
import { buildSystemPrompt } from '../../utils/system-prompt-builder'
import { readMemory } from '../agent-memory.service'
import { getStatsSnippet } from '../agent-memory.service'
import {
  resolveAgentTools,
  toApiToolDefs,
  partitionToolBatches,
  executeAgentTool,
  isToolSafe,
  type AgentToolDefinition,
  type AgentToolCall,
} from './agent-tools'
import { compactMessages, needsCompact } from './context-compact'
import * as logger from '../../utils/logger'

export type ToolApprovalMode = 'auto-approve-safe' | 'auto-approve-session' | 'ask-every-time'

/** Tools executed in the renderer (Editor / AI Terminal); main waits for submitToolResult. */
export interface ClientToolDef {
  name: string
  description: string
  inputSchema: Record<string, any>
  /** Default true — concurrent-safe read-only tools */
  isReadOnly?: boolean
}

export interface AgentQueryParams {
  modelConfigId: string
  modelId?: string
  /** Conversation messages WITHOUT system prompt (user/assistant/tool history). */
  messages: ChatMessage[]
  attachments?: AttachmentInfo[]
  enableThinking?: boolean
  webSearchEnabled?: boolean
  toolsEnabled?: boolean
  feishuKitsEnabled?: boolean
  toolApprovalMode?: ToolApprovalMode
  language?: string
  customSystemPrompt?: string
  assistantEnabled?: boolean
  /** Absolute paths for vision MCP injection */
  attachmentPaths?: string[]
  /**
   * Full system prompt override (Editor/Terminal). When set, skips persona/memory builder.
   */
  systemPromptOverride?: string
  /**
   * Tools whose execute lives in the renderer. Model schemas are merged into the API
   * tool list; main emits tool_use and waits for `submitToolResult` with the payload.
   */
  clientTools?: ClientToolDef[]
}

/** Pending human approval for a tool call */
interface PendingApproval {
  resolve: (approved: boolean) => void
}

const pendingApprovals = new Map<string, PendingApproval>() // key: `${taskId}:${toolCallId}`

/** Pending client (renderer) tool results */
interface PendingClientResult {
  resolve: (r: { content: string; isError: boolean }) => void
}
const pendingClientResults = new Map<string, PendingClientResult>()
/** Results that arrived before the loop registered a waiter (race with streaming tool_use). */
const earlyClientResults = new Map<string, { content: string; isError: boolean }>()

export function resolveToolApproval(
  taskId: string,
  toolCallId: string,
  approved: boolean
): boolean {
  const key = `${taskId}:${toolCallId}`
  const pending = pendingApprovals.get(key)
  if (!pending) return false
  pendingApprovals.delete(key)
  pending.resolve(approved)
  return true
}

/**
 * Resolve a client tool execution from the renderer.
 * Buffers if the loop has not yet started waiting (tool_use event races ahead).
 */
export function resolveClientToolResult(
  taskId: string,
  toolCallId: string,
  content: string,
  isError: boolean
): boolean {
  const key = `${taskId}:${toolCallId}`
  const pending = pendingClientResults.get(key)
  if (pending) {
    pendingClientResults.delete(key)
    pending.resolve({ content: content || '', isError: !!isError })
    return true
  }
  earlyClientResults.set(key, { content: content || '', isError: !!isError })
  return true
}

function waitForApproval(
  taskId: string,
  toolCallId: string,
  timeoutMs = 300_000
): Promise<boolean> {
  return new Promise((resolve) => {
    const key = `${taskId}:${toolCallId}`
    const timer = setTimeout(() => {
      pendingApprovals.delete(key)
      resolve(false)
    }, timeoutMs)
    pendingApprovals.set(key, {
      resolve: (approved) => {
        clearTimeout(timer)
        resolve(approved)
      },
    })
  })
}

function waitForClientToolResult(
  taskId: string,
  toolCallId: string,
  timeoutMs = 300_000
): Promise<{ content: string; isError: boolean }> {
  return new Promise((resolve) => {
    const key = `${taskId}:${toolCallId}`
    const early = earlyClientResults.get(key)
    if (early) {
      earlyClientResults.delete(key)
      resolve(early)
      return
    }
    const timer = setTimeout(() => {
      pendingClientResults.delete(key)
      resolve({ content: 'Client tool timed out', isError: true })
    }, timeoutMs)
    pendingClientResults.set(key, {
      resolve: (r) => {
        clearTimeout(timer)
        resolve(r)
      },
    })
  })
}

async function buildAgentSystemPrompt(
  toolNames: string[],
  webSearchEnabled: boolean,
  language: string,
  customPrompt?: string,
  assistantEnabled = true
): Promise<string> {
  let soul = ''
  let memory = ''
  let user = ''
  let statsSnippet = ''
  if (assistantEnabled) {
    try {
      ;[soul, memory, user, statsSnippet] = await Promise.all([
        readMemory('soul.md'),
        readMemory('memory.md'),
        readMemory('user.md'),
        getStatsSnippet(),
      ])
    } catch {
      /* empty memory ok */
    }
  }

  return buildSystemPrompt({
    currentTime: new Date().toLocaleString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: process.platform,
    language: language || 'zh-CN',
    availableTools: toolNames,
    webSearchEnabled,
    userCustomPrompt: customPrompt,
    agentMemory: { soul, memory, user, statsSnippet },
    assistantEnabled,
  })
}

/**
 * Start an agentic multi-turn query. Returns taskId immediately; events stream via IPC.
 */
export async function streamAgentQuery(
  window: BrowserWindow,
  params: AgentQueryParams
): Promise<string> {
  const taskId = randomUUID()
  const abortController = new AbortController()
  registerActiveTask(taskId, abortController)

  const config = getModelConfig(params.modelConfigId)
  if (!config) {
    new StreamEmitter(window, taskId).error('Model config not found')
    unregisterActiveTask(taskId)
    return taskId
  }

  const modelId = params.modelId || config.models[0] || config.name
  const agentSettings = getAgentSettings()
  const approvalMode: ToolApprovalMode =
    params.toolApprovalMode ||
    (agentSettings.defaultToolApprovalMode as ToolApprovalMode) ||
    'auto-approve-safe'
  const assistantEnabled =
    params.assistantEnabled !== undefined
      ? params.assistantEnabled
      : agentSettings.assistantEnabled !== false
  const customPrompt =
    params.customSystemPrompt !== undefined
      ? params.customSystemPrompt
      : agentSettings.customSystemPrompt || ''
  const language =
    params.language || settingsStore.get('language') || 'zh-CN'

  // Fire-and-forget the loop
  runAgentLoop(window, taskId, config, modelId, params, {
    approvalMode,
    assistantEnabled,
    customPrompt,
    language,
    signal: abortController.signal,
  })
    .catch((err) => {
      logger.error('[agent-query] loop error:', err)
      new StreamEmitter(window, taskId, { agentLoopMode: true }).error(
        err?.message || 'Agent query failed'
      )
    })
    .finally(() => {
      unregisterActiveTask(taskId)
      // Clear any leftover approvals / client tool waiters for this task
      for (const key of pendingApprovals.keys()) {
        if (key.startsWith(`${taskId}:`)) {
          const p = pendingApprovals.get(key)
          pendingApprovals.delete(key)
          p?.resolve(false)
        }
      }
      for (const key of pendingClientResults.keys()) {
        if (key.startsWith(`${taskId}:`)) {
          const p = pendingClientResults.get(key)
          pendingClientResults.delete(key)
          p?.resolve({ content: 'Task cancelled', isError: true })
        }
      }
      for (const key of [...earlyClientResults.keys()]) {
        if (key.startsWith(`${taskId}:`)) earlyClientResults.delete(key)
      }
    })

  return taskId
}

/**
 * Headless agent query for IM / background: same loop + tools + compact,
 * auto-approves tools, returns final assistant text.
 */
export async function runAgentQueryHeadless(
  config: AIModelConfig,
  modelId: string,
  history: ChatMessage[],
  options?: {
    toolsEnabled?: boolean
    webSearchEnabled?: boolean
    feishuKitsEnabled?: boolean
    language?: string
    customSystemPrompt?: string
    assistantEnabled?: boolean
    signal?: AbortSignal
  }
): Promise<string> {
  const taskId = randomUUID()
  const abortController = new AbortController()
  if (options?.signal) {
    options.signal.addEventListener('abort', () => abortController.abort(), { once: true })
  }
  const agentSettings = getAgentSettings()
  const params: AgentQueryParams = {
    modelConfigId: config.id,
    modelId,
    messages: history.filter((m) => m.role !== 'system'),
    toolsEnabled: options?.toolsEnabled !== false,
    webSearchEnabled: !!options?.webSearchEnabled,
    feishuKitsEnabled: !!options?.feishuKitsEnabled,
    toolApprovalMode: 'auto-approve-session', // headless: no UI to ask
    language: options?.language || settingsStore.get('language') || 'zh-CN',
    customSystemPrompt:
      options?.customSystemPrompt !== undefined
        ? options.customSystemPrompt
        : agentSettings.customSystemPrompt || '',
    assistantEnabled:
      options?.assistantEnabled !== undefined
        ? options.assistantEnabled
        : agentSettings.assistantEnabled !== false,
  }

  const emit = new StreamEmitter(null, taskId, { agentLoopMode: true })
  try {
    await runAgentLoop(null, taskId, config, modelId, params, {
      approvalMode: 'auto-approve-session',
      assistantEnabled: params.assistantEnabled !== false,
      customPrompt: params.customSystemPrompt || '',
      language: params.language || 'zh-CN',
      signal: abortController.signal,
      emit,
    })
    // Final text is the last non-tool assistant content from the loop emitter turns.
    // runAgentLoop streams deltas into emit; last turn text is emit.textContent after finalize.
    return emit.textContent?.trim() || collectFinalTextFromLoop(emit) || ''
  } catch (err: any) {
    logger.error('[agent-query] headless failed:', err)
    throw err
  }
}

function collectFinalTextFromLoop(emit: StreamEmitter): string {
  return emit.getResult().text?.trim() || ''
}

async function runAgentLoop(
  window: BrowserWindow | null,
  taskId: string,
  config: AIModelConfig,
  modelId: string,
  params: AgentQueryParams,
  opts: {
    approvalMode: ToolApprovalMode
    assistantEnabled: boolean
    customPrompt: string
    language: string
    signal: AbortSignal
    emit?: StreamEmitter
  }
): Promise<void> {
  const emit = opts.emit || new StreamEmitter(window, taskId, { agentLoopMode: true })

  const agentTools = await resolveAgentTools({
    toolsEnabled: params.toolsEnabled !== false,
    webSearchEnabled: !!params.webSearchEnabled,
    feishuKitsEnabled: !!params.feishuKitsEnabled,
  })
  const catalog = new Map(agentTools.map((t) => [t.name, t]))
  const clientToolNames = new Set((params.clientTools || []).map((t) => t.name))

  // Merge client tools (renderer-executed) into catalog + API schema list
  for (const ct of params.clientTools || []) {
    catalog.set(ct.name, {
      name: ct.name,
      description: ct.description,
      inputSchema: ct.inputSchema,
      source: 'builtin',
      isSafe: true,
      isReadOnly: () => ct.isReadOnly !== false,
      isConcurrencySafe: () => ct.isReadOnly !== false,
      execute: async () => ({
        content: 'Client tool must be executed in the renderer',
        isError: true,
      }),
    })
  }

  const apiTools = [
    ...toApiToolDefs(agentTools),
    ...(params.clientTools || []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  ]

  const allToolNames = [...catalog.keys()]
  const systemPrompt = params.systemPromptOverride?.trim()
    ? params.systemPromptOverride.trim()
    : await buildAgentSystemPrompt(
        allToolNames,
        !!params.webSearchEnabled,
        opts.language,
        opts.customPrompt,
        opts.assistantEnabled
      )

  // Build messages with system + history
  let messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...params.messages.filter((m) => m.role !== 'system'),
  ]

  // Multimodal attachments on last user message
  if (params.attachments?.length) {
    messages = attachImages(
      messages,
      params.attachments,
      !!config.capabilities?.includes('vision')
    )
  }

  const fingerprints = new Map<string, number>()
  const MAX_DUPLICATES = 3
  const HARD_CEILING = 200
  let step = 0
  let lastUsage: { promptTokens?: number; completionTokens?: number } | undefined

  while (!opts.signal.aborted) {
    // Context compact before the model call when oversized
    if (needsCompact(messages)) {
      try {
        const compact = await compactMessages(messages, config as any, modelId)
        if (compact.compacted) {
          messages = compact.messages
          emit.contextCompacted(compact.summary || '')
        }
      } catch (err) {
        logger.warn('[agent-query] compact failed:', err)
      }
    }

    emit.beginTurn()
    const turn = await streamOneTurn(
      window,
      taskId,
      config as any,
      modelId,
      messages,
      opts.signal,
      apiTools.length > 0 ? apiTools : undefined,
      params.enableThinking,
      params.webSearchEnabled,
      true // agentLoopMode
    )

    if (opts.signal.aborted) break

    lastUsage = turn.usage

    // No tool calls → final answer (capture text for headless consumers)
    if (!turn.toolCalls.length) {
      emit.textContent = turn.text || emit.textContent
      emit.thinkingContent = turn.thinking || emit.thinkingContent
      emit.finalizeDone(turn.usage)
      return
    }

    // Append assistant turn with tool calls
    messages.push({
      role: 'assistant',
      content: turn.text || '',
      reasoningContent: turn.thinking || undefined,
      toolCalls: turn.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        input: tc.input,
      })),
    })

    // Execute tools in concurrent-safe batches
    const batches = partitionToolBatches(turn.toolCalls, catalog)
    for (const batch of batches) {
      if (opts.signal.aborted) break

      if (batch.concurrent && batch.calls.length > 1) {
        const results = await Promise.all(
          batch.calls.map((call) =>
            runOneTool(
              taskId,
              call,
              catalog,
              emit,
              opts.approvalMode,
              fingerprints,
              params.attachmentPaths,
              clientToolNames
            )
          )
        )
        for (const r of results) {
          messages.push({
            role: 'tool',
            content: r.content,
            toolCallId: r.id,
          })
        }
      } else {
        for (const call of batch.calls) {
          if (opts.signal.aborted) break
          const r = await runOneTool(
            taskId,
            call,
            catalog,
            emit,
            opts.approvalMode,
            fingerprints,
            params.attachmentPaths,
            clientToolNames
          )
          messages.push({
            role: 'tool',
            content: r.content,
            toolCallId: r.id,
          })
        }
      }
    }

    step++
    if (step >= HARD_CEILING) {
      emit.error('Agent tool loop hit safety ceiling')
      emit.finalizeDone(lastUsage)
      return
    }

    // Continue loop — next model turn with tool results
  }

  if (!opts.signal.aborted) {
    emit.finalizeDone(lastUsage)
  }
}

async function runOneTool(
  taskId: string,
  call: AgentToolCall,
  catalog: Map<string, AgentToolDefinition>,
  emit: StreamEmitter,
  approvalMode: ToolApprovalMode,
  fingerprints: Map<string, number>,
  attachmentPaths?: string[],
  clientToolNames?: Set<string>
): Promise<{ id: string; content: string }> {
  const tool = catalog.get(call.name)
  const fp = `${call.name}:${JSON.stringify(call.input || {}, Object.keys(call.input || {}).sort())}`
  const dup = fingerprints.get(fp) || 0
  if (dup >= MAX_DUP) {
    const msg = 'Duplicate tool call blocked (anti-loop). Use existing results.'
    emit.toolResult(call.id, call.name, msg, true)
    return { id: call.id, content: msg }
  }

  // Approval gate (skip for client tools — renderer panel owns UX)
  const isClient = clientToolNames?.has(call.name)
  const needsAsk =
    !isClient &&
    (approvalMode === 'ask-every-time' ||
      (approvalMode === 'auto-approve-safe' && !isToolSafe(tool, call.name)))

  if (needsAsk) {
    emit.toolApprovalRequest(call.id, call.name, call.input || {})
    const approved = await waitForApproval(taskId, call.id)
    if (!approved) {
      const msg = 'Tool call rejected by user'
      emit.toolResult(call.id, call.name, msg, true)
      return { id: call.id, content: msg }
    }
  }

  fingerprints.set(fp, dup + 1)

  if (isClient) {
    // tool_use already emitted by stream; wait for renderer submitToolResult
    const clientResult = await waitForClientToolResult(taskId, call.id)
    emit.toolResult(call.id, call.name, clientResult.content, clientResult.isError)
    return { id: call.id, content: clientResult.content }
  }

  const result = await executeAgentTool(call, catalog, { attachmentPaths })
  emit.toolResult(call.id, call.name, result.content, result.isError)
  return { id: call.id, content: result.content }
}

const MAX_DUP = 3

function attachImages(
  messages: ChatMessage[],
  attachments: AttachmentInfo[],
  supportsVision: boolean
): ChatMessage[] {
  const fs = require('fs') as typeof import('fs')
  const result = [...messages]
  let lastUserIdx = -1
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].role === 'user') {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx < 0) return result
  const lastMsg = result[lastUserIdx]
  const imageAttachments = attachments.filter((a) => a.mimeType.startsWith('image/'))
  if (!imageAttachments.length) return result

  if (!supportsVision) {
    const names = imageAttachments.map((a) => a.fileName).join(', ')
    result[lastUserIdx] = {
      ...lastMsg,
      content: `${lastMsg.content}\n\n[用户上传了图片附件: ${names}。你本身无法直接查看图片，如需了解图片内容，请调用可用的识图工具。]`,
    }
    return result
  }

  const parts: Array<{
    type: 'text' | 'image_base64'
    text?: string
    mimeType?: string
    base64Data?: string
  }> = [{ type: 'text', text: lastMsg.content }]
  for (const att of imageAttachments) {
    try {
      if (fs.existsSync(att.filePath)) {
        parts.push({
          type: 'image_base64',
          mimeType: att.mimeType,
          base64Data: fs.readFileSync(att.filePath).toString('base64'),
        })
      }
    } catch {
      /* skip */
    }
  }
  result[lastUserIdx] = { ...lastMsg, contentParts: parts as any }
  return result
}
