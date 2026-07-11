/**
 * Rolling digests of local / cloud AI Chat conversations for memory self-update.
 * Renderer pushes snippets via IPC; memory-updater merges them with IM digests.
 */

import { join } from 'path'
import { promises as fs } from 'fs'
import { getMemoryDir } from './agent-memory.service'
import * as logger from '../utils/logger'

export interface ChatDigestEntry {
  conversationId: string
  title: string
  /** local-chat | backend-chat */
  source: string
  updatedAt: number
  /** Short role:content lines for summarization */
  snippets: string[]
}

const DIGEST_FILE = 'chat-digests.json'
const MAX_ENTRIES = 40

async function digestPath(): Promise<string> {
  const dir = getMemoryDir()
  await fs.mkdir(dir, { recursive: true })
  return join(dir, DIGEST_FILE)
}

export async function listChatDigests(): Promise<ChatDigestEntry[]> {
  try {
    const raw = await fs.readFile(await digestPath(), 'utf-8')
    const data = JSON.parse(raw) as ChatDigestEntry[]
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * Upsert one conversation digest (by conversationId).
 */
export async function pushChatDigest(entry: ChatDigestEntry): Promise<void> {
  if (!entry?.conversationId) return
  const list = await listChatDigests()
  const filtered = list.filter((e) => e.conversationId !== entry.conversationId)
  filtered.push({
    conversationId: entry.conversationId,
    title: entry.title || 'Chat',
    source: entry.source || 'local-chat',
    updatedAt: entry.updatedAt || Date.now(),
    snippets: (entry.snippets || []).slice(-12).map((s) => String(s).slice(0, 500)),
  })
  // Keep most recently updated
  filtered.sort((a, b) => b.updatedAt - a.updatedAt)
  const trimmed = filtered.slice(0, MAX_ENTRIES)
  await fs.writeFile(await digestPath(), JSON.stringify(trimmed, null, 2), 'utf-8')
  logger.debug(`[chat-digest] Upserted ${entry.conversationId} (${entry.snippets?.length || 0} snippets)`)
}

/**
 * Replace many digests at once (bulk sync from renderer).
 */
export async function replaceChatDigests(entries: ChatDigestEntry[]): Promise<void> {
  const cleaned = (entries || [])
    .filter((e) => e?.conversationId)
    .map((e) => ({
      conversationId: e.conversationId,
      title: e.title || 'Chat',
      source: e.source || 'local-chat',
      updatedAt: e.updatedAt || Date.now(),
      snippets: (e.snippets || []).slice(-12).map((s) => String(s).slice(0, 500)),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_ENTRIES)
  await fs.writeFile(await digestPath(), JSON.stringify(cleaned, null, 2), 'utf-8')
  logger.info(`[chat-digest] Replaced digests: ${cleaned.length}`)
}
