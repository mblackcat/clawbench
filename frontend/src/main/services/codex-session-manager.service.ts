import { BrowserWindow } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as readline from 'readline'
import * as path from 'path'
import * as fs from 'fs'
import * as logger from '../utils/logger'
import { scanAndMergeInstructions } from './coding-adapters/instructions'

type CodingMode = 'plan' | 'ask-first' | 'auto-edit' | 'full-access'
type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
type CodexApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'
type CodexApprovalsReviewer = 'user' | 'auto_review'

interface JsonRpcMessage {
  jsonrpc?: '2.0'
  id?: number
  method?: string
  params?: any
  result?: any
  error?: { message?: string }
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface CodexSessionState {
  process: ChildProcessWithoutNullStreams
  rl: readline.Interface
  nextId: number
  pending: Map<number, PendingRequest>
  cwd: string
  threadId: string | null
  resumeThreadId: string | null
  isProcessing: boolean
  mode: CodingMode
  env?: Record<string, string | undefined>
  onEvent?: (sessionId: string, data: Record<string, unknown>) => void
  onClose?: (sessionId: string) => void
  onError?: (sessionId: string, err: Error) => void
  turnResolve?: () => void
  outputBuffer: string
  textLengths: Record<string, number>
  /** Block ids whose block_start has already been emitted (dedup, per turn). */
  seenBlocks: Set<string>
  thinkingLengths: Record<string, number>
}

const codexSessions = new Map<string, CodexSessionState>()
const RING_BUFFER_MAX = 4000

const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64'
}

function getTargetTriple(): string | null {
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return 'x86_64-unknown-linux-musl'
    if (process.arch === 'arm64') return 'aarch64-unknown-linux-musl'
  }
  if (process.platform === 'darwin') {
    if (process.arch === 'x64') return 'x86_64-apple-darwin'
    if (process.arch === 'arm64') return 'aarch64-apple-darwin'
  }
  if (process.platform === 'win32') {
    if (process.arch === 'x64') return 'x86_64-pc-windows-msvc'
    if (process.arch === 'arm64') return 'aarch64-pc-windows-msvc'
  }
  return null
}

function requireResolve(id: string): string | null {
  try {
    return require.resolve(id)
  } catch {
    return null
  }
}

export function resolveBundledCodexPath(): string | null {
  const targetTriple = getTargetTriple()
  if (!targetTriple) return null

  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[targetTriple]
  const packageJsonPath = requireResolve(`${platformPackage}/package.json`)
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex'

  const packageDirs = new Set<string>()
  if (packageJsonPath) packageDirs.add(path.dirname(packageJsonPath))
  if (process.resourcesPath) {
    packageDirs.add(path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      ...platformPackage.split('/')
    ))
  }

  const candidateRoots = new Set<string>()
  for (const packageDir of packageDirs) {
    const vendorRoot = path.join(packageDir, 'vendor', targetTriple)
    const unpackedVendorRoot = vendorRoot.replace(
      `${path.sep}app.asar${path.sep}`,
      `${path.sep}app.asar.unpacked${path.sep}`
    )
    candidateRoots.add(unpackedVendorRoot)
    candidateRoots.add(vendorRoot)
  }

  const candidates = [...candidateRoots].flatMap((vendorRoot) => [
    path.join(vendorRoot, 'bin', binaryName),
    path.join(vendorRoot, 'codex', binaryName)
  ])
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function forwardToRenderer(sessionId: string, event: Record<string, unknown>): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('ai-coding:pipe-event', { sessionId, event })
  })
}

function emitEvent(
  sessionId: string,
  state: CodexSessionState,
  event: Record<string, unknown>
): void {
  if (state.onEvent) state.onEvent(sessionId, event)
  forwardToRenderer(sessionId, event)
}

function appendOutput(state: CodexSessionState, text: string): void {
  if (!text) return
  const combined = state.outputBuffer + text
  state.outputBuffer = combined.length > RING_BUFFER_MAX
    ? combined.slice(combined.length - RING_BUFFER_MAX)
    : combined
}

function modeToCodexOptions(mode: CodingMode): {
  sandbox: CodexSandboxMode
  approvalPolicy: CodexApprovalPolicy
  approvalsReviewer?: CodexApprovalsReviewer
  prefix?: string
} {
  if (mode === 'plan') {
    return {
      sandbox: 'read-only',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      prefix: 'You are in Plan mode. Do not edit files or run mutating commands. First produce a clear implementation plan and ask before making changes.'
    }
  }
  if (mode === 'auto-edit') {
    return { sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' }
  }
  if (mode === 'full-access') {
    return { sandbox: 'danger-full-access', approvalPolicy: 'never' }
  }
  return { sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' }
}

function sandboxToTurnPolicy(sandbox: CodexSandboxMode): Record<string, unknown> {
  if (sandbox === 'danger-full-access') return { type: 'dangerFullAccess' }
  if (sandbox === 'read-only') return { type: 'readOnly' }
  return { type: 'workspaceWrite' }
}

function buildThreadParams(state: CodexSessionState): Record<string, unknown> {
  const opts = modeToCodexOptions(state.mode)
  const params: Record<string, unknown> = {
    cwd: state.cwd,
    sandbox: opts.sandbox,
    approvalPolicy: opts.approvalPolicy,
    skipGitRepoCheck: true
  }
  if (opts.approvalsReviewer) params.approvalsReviewer = opts.approvalsReviewer
  const model = state.env?.CODEX_MODEL || process.env.CODEX_MODEL
  if (model) params.model = model
  return params
}

function buildTurnParams(state: CodexSessionState, input: Array<Record<string, unknown>>): Record<string, unknown> {
  const opts = modeToCodexOptions(state.mode)
  const params: Record<string, unknown> = {
    threadId: state.threadId,
    input,
    cwd: state.cwd,
    approvalPolicy: opts.approvalPolicy,
    sandboxPolicy: sandboxToTurnPolicy(opts.sandbox)
  }
  if (opts.approvalsReviewer) params.approvalsReviewer = opts.approvalsReviewer
  const model = state.env?.CODEX_MODEL || process.env.CODEX_MODEL
  if (model) params.model = model
  return params
}

// ── Client streaming protocol emission (delta / tool_* / thinking_*) ──
// `seenBlocks` dedups thinking_start / tool_start per itemId within a turn;
// textLengths / thinkingLengths track cumulative streamed length so re-sent full
// text from item/updated|completed doesn't duplicate.

function emitTextDelta(sessionId: string, state: CodexSessionState, _itemId: string, delta: string): void {
  if (!delta) return
  appendOutput(state, delta)
  emitEvent(sessionId, state, { type: 'delta', text: delta })
}

function emitThinkingDelta(sessionId: string, state: CodexSessionState, itemId: string, delta: string): void {
  if (!state.seenBlocks.has(itemId)) {
    state.seenBlocks.add(itemId)
    emitEvent(sessionId, state, { type: 'thinking_start' })
  }
  if (delta) emitEvent(sessionId, state, { type: 'thinking_delta', text: delta })
}

function emitToolStart(
  sessionId: string,
  state: CodexSessionState,
  itemId: string,
  name: string,
  input: Record<string, unknown>
): void {
  if (state.seenBlocks.has(itemId)) return
  state.seenBlocks.add(itemId)
  emitEvent(sessionId, state, { type: 'tool_start', id: itemId, name })
  emitEvent(sessionId, state, { type: 'tool_executing', id: itemId, name, input })
  appendOutput(state, `\n[${name}] ${JSON.stringify(input)}\n`)
}

function emitToolResult(
  sessionId: string,
  state: CodexSessionState,
  itemId: string,
  content: string,
  isError?: boolean
): void {
  if (content) appendOutput(state, `\n${content}\n`)
  emitEvent(sessionId, state, { type: 'tool_result', id: itemId, content, isError: !!isError })
}

function extractToolResult(item: any): string {
  if (typeof item?.aggregated_output === 'string') return item.aggregated_output
  if (typeof item?.output === 'string') return item.output
  if (typeof item?.error?.message === 'string') return item.error.message
  if (Array.isArray(item?.result?.content)) {
    return item.result.content.map((c: any) => c?.text || '').filter(Boolean).join('\n')
  }
  if (typeof item?.result === 'string') return item.result
  return ''
}

function serializeUsage(usage: any, tokenUsage?: any): Record<string, unknown> | null {
  const total = tokenUsage?.total
  const inputTokens =
    total?.inputTokens ??
    usage?.input_tokens ??
    usage?.inputTokens ??
    0
  const cachedInputTokens =
    usage?.cached_input_tokens ??
    usage?.cache_read_input_tokens ??
    total?.cachedInputTokens ??
    0
  const outputTokens = usage?.output_tokens ?? usage?.outputTokens ?? 0
  const contextWindow = total?.contextWindow ?? usage?.context_window ?? usage?.contextWindow
  const usedTokens = Number(inputTokens || 0) + Number(cachedInputTokens || 0)
  if (!usedTokens && !outputTokens && !contextWindow) return null
  return { inputTokens, cachedInputTokens, outputTokens, contextWindow, usedTokens }
}

function respond(state: CodexSessionState, id: number | undefined, result: unknown): void {
  if (id === undefined || !state.process.stdin.writable) return
  state.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function send(
  state: CodexSessionState,
  method: string,
  params?: unknown,
  timeoutMs = 30000
): Promise<any> {
  const id = state.nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(id)
      reject(new Error(`Codex request timeout: ${method}`))
    }, timeoutMs)
    state.pending.set(id, { resolve, reject, timer })
    const msg: JsonRpcMessage = { jsonrpc: '2.0', id, method }
    if (params !== undefined) msg.params = params
    state.process.stdin.write(JSON.stringify(msg) + '\n')
  })
}

function notify(state: CodexSessionState, method: string, params?: unknown): void {
  if (!state.process.stdin.writable) return
  const msg: JsonRpcMessage = { jsonrpc: '2.0', method }
  if (params !== undefined) msg.params = params
  state.process.stdin.write(JSON.stringify(msg) + '\n')
}

function handleItemEvent(sessionId: string, state: CodexSessionState, method: string, item: any): void {
  const phase = method.split('/')[1]
  const itemId = item?.id || `${item?.type || 'item'}-${Date.now()}`
  const itemType = item?.type

  if (itemType === 'agentMessage' || itemType === 'agent_message') {
    const fullText = String(item.text || '')
    const previous = state.textLengths[itemId] ?? 0
    if (fullText.length > previous) {
      state.textLengths[itemId] = fullText.length
      emitTextDelta(sessionId, state, itemId, fullText.slice(previous))
    }
    return
  }

  if (itemType === 'reasoning') {
    const text = String(item.text || item.summary || '')
    const previous = state.thinkingLengths[itemId] ?? 0
    if (text.length > previous) {
      state.thinkingLengths[itemId] = text.length
      emitThinkingDelta(sessionId, state, itemId, text.slice(previous))
    } else if (phase === 'started') {
      emitThinkingDelta(sessionId, state, itemId, '')
    }
    return
  }

  if (itemType === 'commandExecution' || itemType === 'command_execution') {
    const command = String(item.command || '')
    emitToolStart(sessionId, state, itemId, 'Bash', { command })
    if (phase === 'completed') {
      emitToolResult(sessionId, state, itemId, extractToolResult(item), item.status === 'failed')
    }
    return
  }

  if (itemType === 'fileChange' || itemType === 'file_change') {
    const changes = Array.isArray(item.changes) ? item.changes : []
    const changeText = changes.map((c: any) => `${c.kind || 'change'} ${c.path || ''}`).join(', ')
    const primaryPath = changes.length === 1 ? String(changes[0]?.path || '') : ''
    emitToolStart(sessionId, state, itemId, 'Edit', { changes: changeText, file_path: primaryPath })
    if (phase === 'completed') {
      const diff = changes.map((c: any) => c.diff || '').filter(Boolean).join('\n\n')
      emitToolResult(sessionId, state, itemId, diff || 'Changes applied', item.status === 'failed')
    }
    return
  }

  if (itemType === 'mcpToolCall' || itemType === 'mcp_tool_call') {
    const name = String(item.tool || item.name || 'mcp_tool')
    emitToolStart(sessionId, state, itemId, name, item.arguments || item.input || {})
    if (phase === 'completed') {
      emitToolResult(sessionId, state, itemId, extractToolResult(item), !!item.error)
    }
    return
  }

  if (itemType === 'webSearch' || itemType === 'web_search') {
    emitToolStart(sessionId, state, itemId, 'WebSearch', { query: item.query || item.searchQuery || '' })
    return
  }

  if (itemType === 'plan' && typeof item.text === 'string') {
    emitTextDelta(sessionId, state, `plan-${itemId}`, item.text)
    return
  }

  if (itemType === 'error') {
    emitEvent(sessionId, state, { type: 'error', error: { message: item.message || 'Codex error' } })
  }
}

function handleNotification(sessionId: string, state: CodexSessionState, msg: JsonRpcMessage): void {
  const method = msg.method || ''
  const params = msg.params || {}

  if (params.threadId && state.threadId && params.threadId !== state.threadId) return

  if (method === 'item/commandExecution/requestApproval') {
    const accepted = state.mode !== 'plan'
    // Per product decision: auto-accept by mode, with a non-blocking transparency note.
    if (accepted) {
      emitEvent(sessionId, state, { type: 'system', subtype: 'local', message: '⚙ 已按当前模式自动允许执行命令' })
    }
    respond(state, msg.id, { decision: accepted ? 'accept' : 'decline' })
    return
  }

  if (method === 'item/fileChange/requestApproval') {
    const accepted = state.mode !== 'plan'
    if (accepted) {
      emitEvent(sessionId, state, { type: 'system', subtype: 'local', message: '⚙ 已按当前模式自动允许修改文件' })
    }
    respond(state, msg.id, { decision: accepted ? 'accept' : 'decline' })
    return
  }

  if (method === 'item/tool/requestUserInput' || method === 'mcpServer/elicitation/request') {
    emitEvent(sessionId, state, {
      type: 'system',
      subtype: 'local',
      message: params.message || params.prompt || 'Codex requested additional input from a tool.'
    })
    respond(state, msg.id, { action: 'reject' })
    return
  }

  if (method === 'thread/started') {
    const threadId = params.thread?.id || params.threadId
    if (threadId) state.threadId = threadId
    emitEvent(sessionId, state, { type: 'system', subtype: 'init', session_id: state.threadId || '' })
    return
  }

  if (method === 'thread/tokenUsage/updated') {
    const usage = serializeUsage(null, params.tokenUsage)
    if (usage) emitEvent(sessionId, state, { type: 'context_usage', usage })
    return
  }

  if (method === 'turn/started') {
    state.textLengths = {}
    state.seenBlocks = new Set()
    state.thinkingLengths = {}
    emitEvent(sessionId, state, { type: 'turn_started' })
    return
  }

  if (method === 'item/agentMessage/delta') {
    const itemId = params.itemId || params.id || 'agent-message'
    const delta = String(params.delta || '')
    if (delta) {
      state.textLengths[itemId] = (state.textLengths[itemId] || 0) + delta.length
      emitTextDelta(sessionId, state, itemId, delta)
    }
    return
  }

  if (method === 'item/started' || method === 'item/updated' || method === 'item/completed') {
    if (params.item) handleItemEvent(sessionId, state, method, params.item)
    return
  }

  if (method === 'turn/completed') {
    const usage = serializeUsage(params.usage)
    if (usage) emitEvent(sessionId, state, { type: 'context_usage', usage })
    emitEvent(sessionId, state, {
      type: 'result',
      session_id: state.threadId || '',
      usage,
      subtype: params.status || 'success',
      result: ''
    })
    if (state.turnResolve) {
      const resolve = state.turnResolve
      state.turnResolve = undefined
      resolve()
    }
    return
  }

  if (method === 'turn/failed') {
    emitEvent(sessionId, state, { type: 'error', error: { message: params.error?.message || 'Codex turn failed' } })
    if (state.turnResolve) {
      const resolve = state.turnResolve
      state.turnResolve = undefined
      resolve()
    }
  }
}

function handleMessage(sessionId: string, state: CodexSessionState, msg: JsonRpcMessage): void {
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
    const pending = state.pending.get(msg.id)
    if (!pending) return
    state.pending.delete(msg.id)
    clearTimeout(pending.timer)
    if (msg.error) pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
    else pending.resolve(msg.result)
    return
  }

  if (msg.method) handleNotification(sessionId, state, msg)
}

export async function launchCodexSession(
  sessionId: string,
  executablePath: string,
  cwd: string,
  resumeThreadId?: string,
  onEvent?: (sessionId: string, data: Record<string, unknown>) => void,
  onClose?: (sessionId: string) => void,
  onError?: (sessionId: string, err: Error) => void,
  env?: Record<string, string | undefined>
): Promise<{ success: boolean; error?: string }> {
  closeCodexSession(sessionId)

  try {
    const child = spawn(executablePath, ['app-server'], {
      cwd,
      env: { ...process.env, ...(env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(executablePath)
    })

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
    const state: CodexSessionState = {
      process: child,
      rl,
      nextId: 1,
      pending: new Map(),
      cwd,
      threadId: null,
      resumeThreadId: resumeThreadId || null,
      isProcessing: false,
      mode: 'ask-first',
      env,
      onEvent,
      onClose,
      onError,
      outputBuffer: '',
      textLengths: {},
      seenBlocks: new Set(),
      thinkingLengths: {}
    }

    codexSessions.set(sessionId, state)

    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        handleMessage(sessionId, state, JSON.parse(line))
      } catch (err: any) {
        logger.warn(`[codex] Failed to parse app-server line: ${err?.message || err}`)
      }
    })

    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) logger.info(`[codex stderr] ${text}`)
    })

    child.on('error', (err) => {
      logger.error(`[codex] Process error for ${sessionId}:`, err)
      if (state.onError) state.onError(sessionId, err)
      emitEvent(sessionId, state, { type: 'error', error: { message: err.message } })
    })

    child.on('exit', (code, signal) => {
      logger.info(`[codex] app-server exited ${sessionId}: code=${code} signal=${signal}`)
      state.pending.forEach((pending) => {
        clearTimeout(pending.timer)
        pending.reject(new Error(`Codex app-server exited: ${code ?? signal}`))
      })
      state.pending.clear()
      if (codexSessions.get(sessionId) === state) codexSessions.delete(sessionId)
      forwardToRenderer(sessionId, { type: 'pipe_exit' })
      if (state.onClose) state.onClose(sessionId)
    })

    await send(state, 'initialize', {
      clientInfo: { name: 'clawbench', title: 'ClawBench' },
      capabilities: { experimentalApi: true }
    }, 15000)
    notify(state, 'initialized', {})
    logger.info(`[codex] Session launched: ${sessionId}`)
    return { success: true }
  } catch (err: any) {
    closeCodexSession(sessionId)
    return { success: false, error: err?.message || String(err) }
  }
}

export async function writeToCodexSession(
  sessionId: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  const state = codexSessions.get(sessionId)
  if (!state) return { success: false, error: 'Codex session not running' }
  if (state.isProcessing) return { success: false, error: 'Codex is still processing the previous turn' }

  state.isProcessing = true
  try {
    const opts = modeToCodexOptions(state.mode)
    const creatingThread = !state.threadId
    let prompt = text
    if (opts.prefix) prompt = `${opts.prefix}\n\n${text}`

    if (!state.threadId) {
      const result = state.resumeThreadId
        ? await send(state, 'thread/resume', { ...buildThreadParams(state), threadId: state.resumeThreadId }, 60000)
        : await send(state, 'thread/start', buildThreadParams(state), 60000)
      const threadId = result?.thread?.id || result?.threadId
      if (threadId) {
        state.threadId = threadId
        emitEvent(sessionId, state, { type: 'system', subtype: 'init', session_id: threadId })
      }
    }

    // On the first turn of a new thread, inject non-native project instructions
    // (CLAUDE.md, .cursorrules, ...). Codex reads AGENTS.md natively.
    if (creatingThread) {
      const merged = scanAndMergeInstructions(state.cwd, 'codex')
      if (merged) prompt = `${merged}\n\n${prompt}`
    }

    const turnPromise = new Promise<void>((resolve) => { state.turnResolve = resolve })
    await send(state, 'turn/start', buildTurnParams(state, [{ type: 'text', text: prompt }]), 60000)
    await turnPromise
    return { success: true }
  } catch (err: any) {
    emitEvent(sessionId, state, { type: 'error', error: { message: err?.message || String(err) } })
    return { success: false, error: err?.message || String(err) }
  } finally {
    state.isProcessing = false
  }
}

export function interruptCodexSession(sessionId: string): void {
  const state = codexSessions.get(sessionId)
  if (!state?.threadId) return
  send(state, 'turn/interrupt', { threadId: state.threadId }, 5000).catch(() => {})
}

export function closeCodexSession(sessionId: string): void {
  const state = codexSessions.get(sessionId)
  if (!state) return
  codexSessions.delete(sessionId)
  try { state.rl.close() } catch { /* ignore */ }
  try { state.process.stdin.end() } catch { /* ignore */ }
  try { state.process.kill('SIGTERM') } catch { /* ignore */ }
}

export function hasCodexSession(sessionId: string): boolean {
  return codexSessions.has(sessionId)
}

export function getCodexSessionOutput(sessionId: string): string {
  return codexSessions.get(sessionId)?.outputBuffer ?? ''
}

export function setCodexSessionMode(sessionId: string, mode: string): boolean {
  const state = codexSessions.get(sessionId)
  if (!state) return false
  if (mode === 'plan') state.mode = 'plan'
  else if (mode === 'full-access' || mode === 'danger-full-access' || mode === 'bypassPermissions') state.mode = 'full-access'
  else if (mode === 'auto-edit' || mode === 'auto-review') state.mode = 'auto-edit'
  else state.mode = 'ask-first'
  return true
}
