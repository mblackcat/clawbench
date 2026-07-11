/**
 * IM Agent Service — multi-turn Feishu agent chat with local AI Chat parity.
 *
 * - Persona / harness / memory when assistantEnabled
 * - Internal tools (apps, terminal, DB, coding)
 * - Conversation history persisted under userData
 * - Session rules: idle timeout, max turns, /new
 */

import { join } from 'path'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import OpenAI, { AzureOpenAI } from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getAppDataPath } from '../../utils/paths'
import { getUser } from '../../store/auth.store'
import { getAgentSettings, getAiModelConfigs, getLastChatModel, settingsStore } from '../../store/settings.store'
import { getIMConfig } from '../ai-coding.service'
import { readMemory, getStatsSnippet } from '../agent-memory.service'
import { internalToolRegistry } from '../internal-tools.service'
import { buildSystemPrompt } from '../../utils/system-prompt-builder'
import { normalizeOpenAIBaseURL, normalizeAnthropicBaseURL } from '../../utils/endpoint'
import * as logger from '../../utils/logger'
import type { AIModelConfig } from '../../store/settings.store'

export interface ImAgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  createdAt: number
}

export interface ImAgentConversation {
  id: string
  source: 'im'
  title: string
  chatId: string
  modelConfigId?: string
  modelId?: string
  createdAt: number
  updatedAt: number
  closedAt?: number
  closeReason?: 'idle' | 'new' | 'turn_limit' | 'user' | 'error'
  messages: ImAgentMessage[]
}

interface ChatRuntime {
  conversationId: string | null
  lastActivityAt: number
  turnCount: number
}

const chatRuntime = new Map<string, ChatRuntime>()

function getConvDir(): string {
  const user = getUser()
  const sub = user?.id || 'local'
  return join(getAppDataPath(), 'clawbench-agent', sub, 'im-conversations')
}

async function ensureConvDir(): Promise<string> {
  const dir = getConvDir()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function loadConversation(id: string): Promise<ImAgentConversation | null> {
  try {
    const raw = await fs.readFile(join(getConvDir(), `${id}.json`), 'utf-8')
    return JSON.parse(raw) as ImAgentConversation
  } catch {
    return null
  }
}

async function saveConversation(conv: ImAgentConversation): Promise<void> {
  const dir = await ensureConvDir()
  await fs.writeFile(join(dir, `${conv.id}.json`), JSON.stringify(conv, null, 2), 'utf-8')
}

export async function listImConversations(): Promise<ImAgentConversation[]> {
  try {
    const dir = await ensureConvDir()
    const files = await fs.readdir(dir)
    const list: ImAgentConversation[] = []
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(join(dir, f), 'utf-8')
        const conv = JSON.parse(raw) as ImAgentConversation
        // Strip heavy messages for list views? Keep short form
        list.push({
          ...conv,
          messages: conv.messages?.slice(-2) || [],
        })
      } catch { /* skip */ }
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export async function getImConversation(id: string): Promise<ImAgentConversation | null> {
  return loadConversation(id)
}

export async function deleteImConversation(id: string): Promise<boolean> {
  try {
    await fs.unlink(join(getConvDir(), `${id}.json`))
    // Clear runtime if pointing at this conversation
    for (const [chatId, rt] of chatRuntime) {
      if (rt.conversationId === id) {
        rt.conversationId = null
        rt.turnCount = 0
        rt.lastActivityAt = 0
      }
    }
    return true
  } catch {
    return false
  }
}

export async function renameImConversation(id: string, title: string): Promise<boolean> {
  const conv = await loadConversation(id)
  if (!conv) return false
  conv.title = title.trim() || conv.title
  conv.updatedAt = Date.now()
  await saveConversation(conv)
  return true
}

function getRuntime(chatId: string): ChatRuntime {
  let r = chatRuntime.get(chatId)
  if (!r) {
    r = { conversationId: null, lastActivityAt: 0, turnCount: 0 }
    chatRuntime.set(chatId, r)
  }
  return r
}

export function closeAgentSession(chatId: string, reason: ImAgentConversation['closeReason'] = 'new'): void {
  const r = getRuntime(chatId)
  const id = r.conversationId
  r.conversationId = null
  r.turnCount = 0
  r.lastActivityAt = 0
  if (id) {
    loadConversation(id).then((conv) => {
      if (!conv || conv.closedAt) return
      conv.closedAt = Date.now()
      conv.closeReason = reason
      conv.updatedAt = Date.now()
      return saveConversation(conv)
    }).catch(() => {})
  }
}

async function resolveModel(): Promise<{ config: AIModelConfig; modelId: string }> {
  const im = getIMConfig()
  const configs = getAiModelConfigs().filter((c) => c.enabled !== false)
  if (!configs.length) throw new Error('尚未配置 AI 模型，请在桌面端设置中添加。')

  let config = im.modelConfigId ? configs.find((c) => c.id === im.modelConfigId) : undefined
  let modelId = im.modelId || ''

  if (!config) {
    const last = getLastChatModel()
    config = (last.configId && configs.find((c) => c.id === last.configId)) || configs[0]
    if (!modelId) {
      modelId = (last.modelId && config.models?.includes(last.modelId) ? last.modelId : null)
        ?? config.models?.[0]
        ?? config.name
    }
  } else if (!modelId) {
    modelId = config.models?.[0] ?? config.name
  }

  return { config, modelId }
}

async function buildAgentSystemPrompt(availableTools: string[]): Promise<string> {
  const agentSettings = getAgentSettings()
  const assistantEnabled = agentSettings.assistantEnabled !== false
  const lang = settingsStore.get('language') || 'zh-CN'

  let agentMemory: {
    soul?: string
    memory?: string
    user?: string
    agents?: string
    tools?: string
    statsSnippet?: string
  } = {}

  if (assistantEnabled) {
    const [soul, memory, user, agents, tools, statsSnippet] = await Promise.all([
      readMemory('soul.md'),
      readMemory('memory.md'),
      readMemory('user.md'),
      readMemory('agents.md'),
      readMemory('tools.md'),
      getStatsSnippet(),
    ])
    agentMemory = { soul, memory, user, agents, tools, statsSnippet }
  }

  return buildSystemPrompt({
    currentTime: new Date().toLocaleString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: process.platform,
    language: lang,
    availableTools,
    webSearchEnabled: false,
    userCustomPrompt: agentSettings.customSystemPrompt || '',
    agentMemory,
    assistantEnabled,
  })
}

/**
 * Handle one user turn for IM agent chat.
 * Returns reply text (and optional notice about new session).
 */
export async function handleImAgentMessage(
  chatId: string,
  text: string
): Promise<{ reply: string; conversationId: string; notice?: string }> {
  const im = getIMConfig()
  if (!im.remoteEnabled) {
    return {
      reply: '远程 IM 控制未开启。请在 ClawBench 设置或顶部飞书入口中启用。',
      conversationId: '',
    }
  }

  const idleTimeout = im.idleTimeoutMs ?? 3_600_000
  const maxTurns = im.maxTurnsPerSession ?? 40
  const runtime = getRuntime(chatId)
  const now = Date.now()
  let notice: string | undefined

  // Idle cut
  if (runtime.conversationId && runtime.lastActivityAt && now - runtime.lastActivityAt > idleTimeout) {
    closeAgentSession(chatId, 'idle')
    notice = '距离上次对话已超过 1 小时，已自动开启新会话。'
  }

  // Turn limit
  if (runtime.conversationId && runtime.turnCount >= maxTurns) {
    closeAgentSession(chatId, 'turn_limit')
    notice = `本会话已达 ${maxTurns} 轮上限，已自动开启新会话。发送 /new 可随时新开对话。`
  }

  let conv: ImAgentConversation | null = runtime.conversationId
    ? await loadConversation(runtime.conversationId)
    : null

  if (!conv || conv.closedAt) {
    const { config, modelId } = await resolveModel()
    conv = {
      id: randomUUID(),
      source: 'im',
      title: text.slice(0, 40) || 'IM Chat',
      chatId,
      modelConfigId: config.id,
      modelId,
      createdAt: now,
      updatedAt: now,
      messages: [],
    }
    runtime.conversationId = conv.id
    runtime.turnCount = 0
  }

  const userMsg: ImAgentMessage = {
    id: randomUUID(),
    role: 'user',
    content: text,
    createdAt: now,
  }
  conv.messages.push(userMsg)

  const tools = await internalToolRegistry.listAllTools()
  const toolDefs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))
  const systemPrompt = await buildAgentSystemPrompt(toolDefs.map((t) => t.name))

  const { config, modelId } = conv.modelConfigId
    ? { config: getAiModelConfigs().find((c) => c.id === conv!.modelConfigId)!, modelId: conv.modelId || '' }
    : await resolveModel()

  if (!config) {
    const { config: c, modelId: m } = await resolveModel()
    conv.modelConfigId = c.id
    conv.modelId = m
  }

  const actualConfig = config || (await resolveModel()).config
  const actualModel = modelId || conv.modelId || actualConfig.models?.[0] || actualConfig.name

  let reply = ''
  try {
    reply = await runAgentLoop(actualConfig, actualModel, systemPrompt, conv.messages, toolDefs)
  } catch (err: any) {
    reply = `❌ AI 调用失败：${err.message || err}`
    logger.error('[im-agent] loop failed:', err)
  }

  conv.messages.push({
    id: randomUUID(),
    role: 'assistant',
    content: reply,
    createdAt: Date.now(),
  })
  conv.updatedAt = Date.now()
  if (conv.title === 'IM Chat' || conv.messages.filter((m) => m.role === 'user').length === 1) {
    conv.title = text.slice(0, 40) || 'IM Chat'
  }
  await saveConversation(conv)

  runtime.conversationId = conv.id
  runtime.lastActivityAt = Date.now()
  runtime.turnCount += 1

  return { reply, conversationId: conv.id, notice }
}

async function runAgentLoop(
  config: AIModelConfig,
  modelId: string,
  systemPrompt: string,
  history: ImAgentMessage[],
  tools: Array<{ name: string; description: string; inputSchema: Record<string, any> }>,
  maxSteps = 8
): Promise<string> {
  const provider = config.provider.toLowerCase()
  // Build chat messages (exclude tool-only intermediate from display history for non-OpenAI)
  const baseMessages = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  if (provider === 'openai' || provider === 'openai-compatible' || provider === 'azure-openai'
    || provider === 'qwen' || provider === 'doubao' || provider === 'deepseek' || provider === 'kimi') {
    return runOpenAIToolLoop(config, modelId, systemPrompt, baseMessages, tools, maxSteps)
  }

  // Claude / Google: complete without tools for now (still have persona/memory/history)
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...baseMessages,
  ]
  return completeWithoutTools(config, modelId, messages)
}

async function completeWithoutTools(
  config: AIModelConfig,
  modelId: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const provider = config.provider.toLowerCase()
  if (provider === 'anthropic' || provider === 'anthropic-compatible') {
    const client = new Anthropic({ apiKey: config.apiKey, baseURL: normalizeAnthropicBaseURL(config.endpoint) })
    const systemMsg = messages.find((m) => m.role === 'system')
    const resp = await client.messages.create({
      model: modelId,
      max_tokens: 4096,
      system: systemMsg?.content || undefined,
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    })
    const textBlock = resp.content.find((b) => b.type === 'text')
    return (textBlock as any)?.text?.trim() || ''
  }
  if (provider === 'google') {
    const genAI = new GoogleGenerativeAI(config.apiKey)
    const model = genAI.getGenerativeModel({ model: modelId })
    const last = messages.filter((m) => m.role === 'user').pop()
    const result = await model.generateContent(last?.content || '')
    return result.response.text().trim() || ''
  }
  // OpenAI-compatible fallback
  return runOpenAIToolLoop(config, modelId, messages.find((m) => m.role === 'system')?.content || '',
    messages.filter((m) => m.role !== 'system') as any, [], 1)
}

async function runOpenAIToolLoop(
  config: AIModelConfig,
  modelId: string,
  systemPrompt: string,
  baseMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  tools: Array<{ name: string; description: string; inputSchema: Record<string, any> }>,
  maxSteps: number
): Promise<string> {
  const ClientClass = config.provider === 'azure-openai' ? AzureOpenAI : OpenAI
  const clientOpts: any = { apiKey: config.apiKey }
  if (config.provider === 'azure-openai') {
    clientOpts.apiVersion = config.apiVersion || '2025-04-01-preview'
    clientOpts.endpoint = config.endpoint
  } else {
    clientOpts.baseURL = normalizeOpenAIBaseURL(config.endpoint)
  }
  const client = new ClientClass(clientOpts)

  const openaiTools = tools.length > 0
    ? tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema || { type: 'object', properties: {} },
        },
      }))
    : undefined

  type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam
  const messages: Msg[] = [
    { role: 'system', content: systemPrompt },
    ...baseMessages.map((m) => ({ role: m.role, content: m.content }) as Msg),
  ]

  for (let step = 0; step < maxSteps; step++) {
    const resp = await client.chat.completions.create({
      model: modelId,
      messages,
      max_tokens: 4096,
      tools: openaiTools,
      tool_choice: openaiTools ? 'auto' : undefined,
    })
    const choice = resp.choices[0]?.message
    if (!choice) return ''

    const toolCalls = choice.tool_calls
    if (toolCalls && toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: choice.content || null,
        tool_calls: toolCalls,
      } as Msg)

      for (const tc of toolCalls) {
        const fn = (tc as any).function as { name?: string; arguments?: string } | undefined
        const name = fn?.name || ''
        let args: Record<string, any> = {}
        try {
          args = JSON.parse(fn?.arguments || '{}')
        } catch {
          args = {}
        }
        logger.info(`[im-agent] tool call: ${name}`, args)
        const result = await internalToolRegistry.executeTool(name, args)
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result.content.slice(0, 12000),
        } as Msg)
      }
      continue
    }

    return (choice.content || '').trim()
  }

  return '（达到工具调用步数上限，请简化请求后重试）'
}
