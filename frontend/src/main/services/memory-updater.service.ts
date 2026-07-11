/**
 * Memory self-update: while the client is online and assistant is enabled,
 * periodically condense recent conversation digests into memory.md + user.md
 * (and lightly refresh agents.md when digests mention specialist helpers).
 *
 * Sources:
 * - IM agent conversations (main-process store)
 * - Local / backend AI Chat digests pushed from renderer via chat-digest.service
 */

import { getAgentSettings } from '../store/settings.store'
import {
  readMemory,
  writeMemory,
  resolveBackgroundModel,
  MAX_MEMORY_CHARS,
  MAX_USER_CHARS,
  MAX_AGENTS_CHARS,
} from './agent-memory.service'
import { parseMemoryUpdateLlmResult } from './agent-memory-utils'
import { listImConversations, getImConversation } from './im/im-agent.service'
import { listChatDigests } from './chat-digest.service'
import { completeChat } from './ai.service'
import * as logger from '../utils/logger'

const INTERVAL_MS = 45 * 60 * 1000 // 45 minutes

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

    const model = resolveBackgroundModel()
    if (!model) return

    const [existingMemory, existingUser, existingAgents] = await Promise.all([
      readMemory('memory.md'),
      readMemory('user.md'),
      readMemory('agents.md'),
    ])

    const systemMessage = `You maintain durable knowledge files for a desktop AI assistant.
Return ONLY valid JSON (no markdown fences) with keys:
- "memory_md": full updated long-term memory (facts, projects, decisions, open todos). Max ~${MAX_MEMORY_CHARS} chars.
- "user_md": full updated user profile (how to address them, role/titles, expertise, preferences including control style, habits, communication). Max ~${MAX_USER_CHARS} chars.
- "agents_md": optional full sub-agents file if digests imply specialist helpers; otherwise omit or keep existing. Max ~${MAX_AGENTS_CHARS} chars.

Rules:
- Merge new digests into existing content; remove redundancy; plain markdown only inside each value
- Separate "who the user is" (user_md) from "what happened / projects" (memory_md)
- Do not invent credentials or private data not present in digests`

    const userMessage = `## Current memory.md
${(existingMemory || '(empty)').slice(0, 6000)}

## Current user.md
${(existingUser || '(empty)').slice(0, 3000)}

## Current agents.md
${(existingAgents || '(empty)').slice(0, 2000)}

## New digests
${digests.slice(0, 8000)}
`

    const updated = await completeChat(
      model.configId,
      [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage },
      ],
      model.modelId,
      4096
    )

    const parsed = parseMemoryUpdateLlmResult(updated)
    if (!parsed) {
      logger.warn('[memory-updater] LLM response was not valid JSON; skip write')
      return
    }

    let wrote = false
    if (parsed.memory_md) {
      await writeMemory('memory.md', parsed.memory_md)
      wrote = true
    }
    if (parsed.user_md) {
      await writeMemory('user.md', parsed.user_md)
      wrote = true
    }
    if (parsed.agents_md) {
      await writeMemory('agents.md', parsed.agents_md)
      wrote = true
    }

    if (wrote) {
      lastRunAt = Date.now()
      logger.info(
        `[memory-updater] updated` +
          ` memory=${!!parsed.memory_md} user=${!!parsed.user_md} agents=${!!parsed.agents_md}`
      )
    }
  } catch (err) {
    logger.error('[memory-updater] Failed:', err)
  } finally {
    running = false
  }
}

async function collectDigests(): Promise<string> {
  const parts: string[] = []

  // 1) AI Chat digests (local + any backend chats the renderer pushed)
  const chatDigests = await listChatDigests()
  for (const d of chatDigests.slice(0, 12)) {
    if (!d.snippets?.length) continue
    const body = d.snippets.join('\n')
    parts.push(
      `### AI Chat [${d.source}] ${d.title} (${new Date(d.updatedAt).toISOString()})\n${body}`
    )
  }

  // 2) IM agent conversations
  const list = await listImConversations()
  for (const item of list.slice(0, 8)) {
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
