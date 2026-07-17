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
import { getAppDataPath } from '../../utils/paths'
import { getUser } from '../../store/auth.store'
import { getAgentSettings, getAiModelConfigs, getLastChatModel, settingsStore } from '../../store/settings.store'
import { getIMConfig } from '../ai-coding.service'
import { runAgentQueryHeadless } from '../agent/agent-query.service'
import type { ChatMessage } from '../ai.service'
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

/**
 * Handle one user turn for IM agent chat.
 * Uses the same main-process agent loop as local AI Chat (tools, compact, anti-spin).
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

  // Turn limit (session-level product limit — not the tool-step cap)
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

  let actualConfig = conv.modelConfigId
    ? getAiModelConfigs().find((c) => c.id === conv!.modelConfigId)
    : undefined
  let actualModel = conv.modelId || ''
  if (!actualConfig) {
    const resolved = await resolveModel()
    actualConfig = resolved.config
    actualModel = resolved.modelId
    conv.modelConfigId = actualConfig.id
    conv.modelId = actualModel
  }
  if (!actualModel) {
    actualModel = actualConfig.models?.[0] || actualConfig.name
  }

  const history: ChatMessage[] = conv.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

  let reply = ''
  try {
    const agentSettings = getAgentSettings()
    reply = await runAgentQueryHeadless(actualConfig, actualModel, history, {
      toolsEnabled: true,
      webSearchEnabled: false,
      feishuKitsEnabled: false,
      language: settingsStore.get('language') || 'zh-CN',
      customSystemPrompt: agentSettings.customSystemPrompt || '',
      assistantEnabled: agentSettings.assistantEnabled !== false,
    })
  } catch (err: any) {
    reply = `❌ AI 调用失败：${err.message || err}`
    logger.error('[im-agent] headless agent loop failed:', err)
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


