import { join } from 'path'
import { promises as fs } from 'fs'
import { getAppDataPath } from '../utils/paths'
import { getUser } from '../store/auth.store'
import * as logger from '../utils/logger'

export interface FeedbackStats {
  totalFeedback: { up: number; down: number }
  byTopic: Record<string, { up: number; down: number }>
  recentTrend: { date: string; up: number; down: number }[]
  soulSuggestions: { suggestion: string; reason: string; feedbackCount: number }[]
}

const DEFAULT_SOUL = `# ClawBench AI Assistant

## Identity
Built-in AI assistant for ClawBench desktop IDE, focused on developer workflows.

## Style
- Respond in the user's language
- Concise for simple questions, detailed for complex analysis
- No emoji unless the user uses them first

## Core Capabilities
- Code analysis and debugging
- Tool and environment management
- AI workflow orchestration
- Cross-module task dispatch

## Behavioral Rules
- State uncertainty explicitly when unsure
- Confirm with user before dangerous operations
- Learn from user feedback to improve responses over time
`

const DEFAULT_STATS: FeedbackStats = {
  totalFeedback: { up: 0, down: 0 },
  byTopic: {},
  recentTrend: [],
  soulSuggestions: [],
}

const VALID_FILES = ['soul.md', 'memory.md', 'user.md', 'tools.md', 'agents.md', 'stats.json']

/**
 * Get the memory directory path for the current user.
 * Logged-in users: {userData}/clawbench-agent/{userId}/
 * Local users: {userData}/clawbench-agent/local/
 */
export function getMemoryDir(): string {
  const user = getUser()
  const subDir = user?.id || 'local'
  return join(getAppDataPath(), 'clawbench-agent', subDir)
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

/**
 * Read a memory file. Returns empty string if not found.
 * For soul.md, returns default content if file doesn't exist.
 */
export async function readMemory(filename: string): Promise<string> {
  if (!VALID_FILES.includes(filename)) {
    throw new Error(`Invalid memory file: ${filename}`)
  }

  const filePath = join(getMemoryDir(), filename)
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    if (filename === 'soul.md') return DEFAULT_SOUL
    if (filename === 'stats.json') return JSON.stringify(DEFAULT_STATS, null, 2)
    return ''
  }
}

/**
 * Write a memory file.
 */
export async function writeMemory(filename: string, content: string): Promise<void> {
  if (!VALID_FILES.includes(filename)) {
    throw new Error(`Invalid memory file: ${filename}`)
  }

  const dir = getMemoryDir()
  await ensureDir(dir)
  const filePath = join(dir, filename)
  await fs.writeFile(filePath, content, 'utf-8')
  logger.info(`[agent-memory] Wrote ${filename} (${content.length} bytes)`)
}

/**
 * Read all memory files including stats.json.
 */
export async function readAllMemories(): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const f of VALID_FILES) {
    result[f] = await readMemory(f)
  }
  return result
}

/**
 * Read feedback stats.
 */
export async function readStats(): Promise<FeedbackStats> {
  const raw = await readMemory('stats.json')
  try {
    return JSON.parse(raw)
  } catch {
    return { ...DEFAULT_STATS }
  }
}

/**
 * Update feedback stats with new feedback data.
 */
export async function updateStats(
  type: 'up' | 'down',
  topic?: string
): Promise<FeedbackStats> {
  const stats = await readStats()

  // Update total
  stats.totalFeedback[type]++

  // Update by topic
  if (topic) {
    if (!stats.byTopic[topic]) {
      stats.byTopic[topic] = { up: 0, down: 0 }
    }
    stats.byTopic[topic][type]++
  }

  // Update recent trend
  const today = new Date().toISOString().slice(0, 10)
  const last = stats.recentTrend[stats.recentTrend.length - 1]
  if (last?.date === today) {
    last[type]++
  } else {
    stats.recentTrend.push({ date: today, up: type === 'up' ? 1 : 0, down: type === 'down' ? 1 : 0 })
  }

  // Keep only last 30 days
  if (stats.recentTrend.length > 30) {
    stats.recentTrend = stats.recentTrend.slice(-30)
  }

  await writeMemory('stats.json', JSON.stringify(stats, null, 2))
  return stats
}

/**
 * Process feedback through LLM to update memory files.
 * This is a fire-and-forget background task.
 */
export async function processFeedback(data: {
  messageId: string
  type: 'up' | 'down'
  reason?: string
  snippet: string
}): Promise<void> {
  try {
    // Only update stats — memory.md is reserved for LLM-driven insights,
    // not raw feedback logs (which are already captured in stats.json)
    await updateStats(data.type)
    logger.info(`[agent-memory] Processed ${data.type} feedback for message ${data.messageId}`)
  } catch (err) {
    logger.error('[agent-memory] Failed to process feedback:', err)
  }
}

/**
 * Restore soul.md to default content.
 */
export async function restoreSoulDefault(): Promise<void> {
  await writeMemory('soul.md', DEFAULT_SOUL)
}

/**
 * Get condensed stats snippet for system prompt injection.
 */
export async function getStatsSnippet(): Promise<string> {
  const stats = await readStats()
  const { up, down } = stats.totalFeedback
  if (up + down === 0) return ''

  const total = up + down
  const positiveRate = Math.round((up / total) * 100)

  let snippet = `Feedback: ${up} helpful, ${down} unhelpful (${positiveRate}% positive).`

  // Top topics
  const topics = Object.entries(stats.byTopic)
    .sort(([, a], [, b]) => (b.up + b.down) - (a.up + a.down))
    .slice(0, 3)

  if (topics.length > 0) {
    const topicStrs = topics.map(([name, counts]) => {
      const rate = Math.round((counts.up / (counts.up + counts.down)) * 100)
      return `${name} (${rate}%)`
    })
    snippet += ` Strongest: ${topicStrs.join(', ')}.`
  }

  return snippet
}
