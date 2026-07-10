/**
 * Memory self-update: while the client is online and assistant is enabled,
 * periodically condense recent conversation digests into memory.md.
 *
 * Phase 3 foundation — digests currently come from IM agent conversations;
 * local AI Chat digests can be merged later via IPC.
 */

import { getAgentSettings } from '../store/settings.store'
import { readMemory, writeMemory } from './agent-memory.service'
import { listImConversations, getImConversation } from './im/im-agent.service'
import { completeChat } from './ai.service'
import { getAiModelConfigs, getLastChatModel } from '../store/settings.store'
import * as logger from '../utils/logger'

const INTERVAL_MS = 45 * 60 * 1000 // 45 minutes
const MAX_MEMORY_CHARS = 12_000

let timer: ReturnType<typeof setInterval> | null = null
let lastRunAt = 0
let running = false

export function startMemoryUpdater(): void {
  if (timer) return
  // First run after a short delay so app can finish booting
  setTimeout(() => {
    runMemoryUpdate().catch(() => {})
  }, 5 * 60 * 1000)
  timer = setInterval(() => {
    runMemoryUpdate().catch(() => {})
  }, INTERVAL_MS)
  logger.info('[memory-updater] Started')
}

export function stopMemoryUpdater(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  logger.info('[memory-updater] Stopped')
}

export async function runMemoryUpdate(force = false): Promise<void> {
  if (running) return
  const agent = getAgentSettings()
  if (!agent.assistantEnabled) {
    logger.debug('[memory-updater] Skipped: assistant disabled')
    return
  }

  if (!force && Date.now() - lastRunAt < INTERVAL_MS - 60_000) {
    return
  }

  running = true
  try {
    const digests = await collectDigests()
    if (!digests.trim()) {
      logger.debug('[memory-updater] No digests to merge')
      return
    }

    const configs = getAiModelConfigs().filter((c) => c.enabled !== false)
    if (!configs.length) return

    const last = getLastChatModel()
    const config = (last.configId && configs.find((c) => c.id === last.configId)) || configs[0]
    const modelId = last.modelId || config.models?.[0] || config.name

    const existing = await readMemory('memory.md')
    const prompt = `You maintain a long-term memory file for a desktop AI assistant.
Merge the conversation digests into an updated memory.md.
Keep facts, preferences, project names, decisions, and open todos.
Remove redundancy. Max ~${MAX_MEMORY_CHARS} characters. Write plain markdown only.

## Current memory.md
${existing.slice(0, 8000) || '(empty)'}

## New digests
${digests.slice(0, 8000)}
`

    const updated = await completeChat(
      config.id,
      [
        { role: 'system', content: 'You output only the updated memory.md markdown body.' },
        { role: 'user', content: prompt },
      ],
      modelId,
      4096
    )

    if (updated && updated.trim().length > 20) {
      await writeMemory('memory.md', updated.trim().slice(0, MAX_MEMORY_CHARS))
      lastRunAt = Date.now()
      logger.info('[memory-updater] memory.md updated')
    }
  } catch (err) {
    logger.error('[memory-updater] Failed:', err)
  } finally {
    running = false
  }
}

async function collectDigests(): Promise<string> {
  const list = await listImConversations()
  const recent = list.slice(0, 8)
  const parts: string[] = []
  for (const item of recent) {
    const full = await getImConversation(item.id)
    if (!full) continue
    const msgs = full.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
      .join('\n')
    if (msgs) {
      parts.push(`### IM ${full.title} (${new Date(full.updatedAt).toISOString()})\n${msgs}`)
    }
  }
  return parts.join('\n\n')
}
