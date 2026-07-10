import { join } from 'path'
import { promises as fs } from 'fs'
import { getAppDataPath } from '../utils/paths'
import { getUser } from '../store/auth.store'
import { getAgentSettings } from '../store/settings.store'
import * as logger from '../utils/logger'

export interface FeedbackStats {
  totalFeedback: { up: number; down: number }
  byTopic: Record<string, { up: number; down: number }>
  recentTrend: { date: string; up: number; down: number }[]
  soulSuggestions: { suggestion: string; reason: string; feedbackCount: number }[]
}

export type SoulRole = 'general' | 'design' | 'tech' | 'art'

const SOUL_TEMPLATES: Record<SoulRole, string> = {
  general: `# ClawBench AI Assistant — General

## Identity
You are the built-in AI assistant for ClawBench desktop. You help users coordinate apps, answer questions, and orchestrate workflows across modules.

## Style
- Respond in the user's language
- Concise for simple questions, detailed for complex analysis
- No emoji unless the user uses them first

## Capabilities
- Multi-model conversation and reasoning
- Long-term memory of user preferences and project context (when assistant mode is on)
- Run installed local workbench apps; search and install published apps
- Help with terminal sessions, shell commands, and database queries (when tools are available)
- Create AI coding sessions in a workspace with an initial prompt
- Web search / browse when enabled

## Boundaries
- Do not invent file paths, app IDs, or connection credentials
- Confirm before destructive operations (delete data, force push, DROP TABLE, etc.)
- Never expose API keys, tokens, or secrets in replies
- Stay within ClawBench modules you can actually control via tools; say so when a request needs manual UI steps
`,

  design: `# ClawBench AI Assistant — Design

## Identity
You are a design-oriented assistant inside ClawBench. You help with creative assets, structured content (e.g. Copiper tables), prompts, and product copy — not deep infrastructure work unless asked.

## Style
- Respond in the user's language
- Prefer clear structure, naming suggestions, and visual/UX-minded feedback
- Concise drafts first; expand when the user asks

## Capabilities
- Conversation for ideation, copywriting, and design critique
- Workbench apps: run installed tools; search/install marketplace apps that help design workflows
- Copiper / tabular content guidance when relevant
- Light coding session kickoff only when the user needs implementation handoff

## Boundaries
- Do not claim to edit Figma/Photoshop natively unless a tool supports it
- Avoid unsolicited large refactors or system administration
- Confirm before destructive data ops
- Never leak secrets or credentials
`,

  tech: `# ClawBench AI Assistant — Tech / Engineering

## Identity
You are a senior engineering assistant embedded in ClawBench. You help with coding agents, terminals, databases, local env, and workbench automation.

## Style
- Respond in the user's language
- Prefer precise, actionable steps and correct technical detail
- Show commands and tool results clearly; avoid fluff

## Capabilities
- Full harness: apps (run/search/install), terminal sessions & commands, DB query/update (gated), AI coding session creation with initial prompts
- Local environment awareness (tool versions)
- Debug, review, and plan implementation work across workspaces
- Memory of project conventions and past decisions (when assistant mode is on)

## Boundaries
- Prefer safe, reversible commands; confirm destructive shell/SQL
- Do not invent stack versions — use tools or admit uncertainty
- Never print secrets, .env contents, or tokens
- Coding sessions run in the user's workspace — pick the right workspace before creating sessions
`,

  art: `# ClawBench AI Assistant — Art / Creative

## Identity
You are a creative-work assistant in ClawBench, focused on artistic direction, narrative, prompts, and asset-oriented workflows.

## Style
- Respond in the user's language
- Evocative but practical; offer options rather than a single rigid answer
- Keep technical digressions short unless requested

## Capabilities
- Ideation, prompt craft, and creative feedback
- Run/install workbench apps useful for creative pipelines
- Light use of coding/terminal only when needed for asset pipelines or tooling

## Boundaries
- Do not over-engineer infrastructure
- Confirm before overwriting user creative files or bulk-deleting assets
- Never expose credentials
`
}

const DEFAULT_SOUL = SOUL_TEMPLATES.general

/** Default harness / capability guide injected via tools.md */
export const DEFAULT_TOOLS_HARNESS = `# ClawBench Module Harness

You can control local ClawBench modules via tools. Prefer tools over guessing.

## Workbench Apps
- \`list_workbench_apps\` — list installed apps and parameters
- \`run_workbench_app\` — run an installed app by id with params
- \`search_market_apps\` — search published marketplace apps
- \`install_market_app\` — install a published app by applicationId

## AI Terminal & Database
- \`list_terminal_sessions\` / \`run_terminal_command\` — list sessions and run a command (prefer non-destructive)
- \`list_db_connections\` — list saved DB connections
- \`query_database\` — read-only SQL (SELECT)
- \`execute_database\` — DML when the user explicitly wants writes; never DROP/TRUNCATE without explicit confirmation

## AI Coding
- \`list_coding_workspaces\` / \`list_coding_sessions\` — inventory
- \`create_coding_session\` — create a session in a workspace with toolType (claude|codex|gemini|…) and optional initialPrompt

## Remote Feishu IM (when user messages via bot)
- Same tools and persona as local chat
- Slash commands still work for power users: /help, /w, /ss, /new <tool>, /app, …
- Bare \`/new\` starts a fresh agent conversation; \`/new <tool>\` creates a coding session
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

export function getSoulTemplate(role?: string): string {
  const key = (role || 'general') as SoulRole
  return SOUL_TEMPLATES[key] || SOUL_TEMPLATES.general
}

export function listSoulRoles(): SoulRole[] {
  return ['general', 'design', 'tech', 'art']
}

/**
 * Read a memory file. Returns empty string if not found.
 * For soul.md / tools.md, returns default content if file doesn't exist.
 */
export async function readMemory(filename: string): Promise<string> {
  if (!VALID_FILES.includes(filename)) {
    throw new Error(`Invalid memory file: ${filename}`)
  }

  const filePath = join(getMemoryDir(), filename)
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    if (filename === 'soul.md') {
      const role = getAgentSettings().setupRole
      return getSoulTemplate(role)
    }
    if (filename === 'tools.md') return DEFAULT_TOOLS_HARNESS
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
  const filePath = join(getMemoryDir(), filename)
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
 * When assistant master switch is OFF, only stats are updated (no memory.md writes).
 */
export async function processFeedback(data: {
  messageId: string
  type: 'up' | 'down'
  reason?: string
  snippet: string
}): Promise<void> {
  try {
    // Only update stats — memory.md is reserved for LLM-driven insights
    await updateStats(data.type)
    logger.info(`[agent-memory] Processed ${data.type} feedback for message ${data.messageId}`)
  } catch (err) {
    logger.error('[agent-memory] Failed to process feedback:', err)
  }
}

/**
 * Restore soul.md to the template for the current setup role (or general).
 */
export async function restoreSoulDefault(): Promise<void> {
  const role = getAgentSettings().setupRole
  await writeMemory('soul.md', getSoulTemplate(role))
}

/**
 * Apply a persona template by role and optionally persist setupRole.
 */
export async function applySoulTemplate(role: SoulRole): Promise<void> {
  await writeMemory('soul.md', getSoulTemplate(role))
}

/**
 * Initialize soul from role if the user has not customized it yet.
 * Called after setup wizard finishes.
 */
export async function initSoulFromRole(role: SoulRole): Promise<void> {
  const filePath = join(getMemoryDir(), 'soul.md')
  try {
    await fs.access(filePath)
    // File exists — leave user's content alone
  } catch {
    await writeMemory('soul.md', getSoulTemplate(role))
  }
  // Always ensure tools.md harness exists for new users
  const toolsPath = join(getMemoryDir(), 'tools.md')
  try {
    await fs.access(toolsPath)
  } catch {
    await writeMemory('tools.md', DEFAULT_TOOLS_HARNESS)
  }
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
