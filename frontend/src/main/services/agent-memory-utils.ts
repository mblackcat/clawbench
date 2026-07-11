/**
 * Pure helpers for agent memory (testable without electron-store / fs).
 */

export const MAX_MEMORY_CHARS = 12_000
export const MAX_USER_CHARS = 6_000
export const MAX_AGENTS_CHARS = 6_000

export interface LiveToolInfo {
  name: string
  description: string
}

/** Static module harness body (capability guide). Live tool list is appended separately. */
export const DEFAULT_TOOLS_HARNESS_BODY = `# ClawBench Module Harness

You can control local ClawBench modules via tools. Prefer tools over guessing.

## Workbench Apps
- \`list_workbench_apps\` — list installed apps and parameters
- \`run_workbench_app\` — run an installed app by id with params
- \`search_market_apps\` — search published marketplace apps
- \`install_market_app\` — install a published app by applicationId

## AI Terminal & Database
- \`get_dev_environment\` — local dev tool versions
- \`list_terminal_connections\` — saved SSH/local terminal profiles
- \`run_shell_command\` — one-shot local shell (prefer non-destructive)
- \`run_terminal_command\` — write to an open AI Terminal PTY session
- \`list_db_connections\` — list saved DB connections
- \`query_database\` — read-only SQL (SELECT)
- \`execute_database\` — DML when the user explicitly wants writes; never DROP/TRUNCATE without confirmation

## AI Coding
- \`list_coding_workspaces\` / \`list_coding_sessions\` — inventory
- \`create_coding_session\` — create a session in a workspace with toolType (claude|codex|gemini|…) and optional initialPrompt

## Self-maintenance (durable knowledge)
Full tools/agents/memory files are not always in the system prompt — load with \`read_agent_file\` when needed:
- \`read_agent_file\` — soul | user | memory | agents | tools (on-demand detail)
- \`update_user_profile\` — who the user is: name/titles, role, preferences, habits
- \`update_long_term_memory\` — projects, decisions, facts, open todos
- \`update_sub_agents\` — specialist buddies for multi-step work

## Remote Feishu IM (when user messages via bot)
- Same tools and persona as local chat
- Slash commands still work for power users: /help, /w, /ss, /new <tool>, /app, …
- Bare \`/new\` starts a fresh agent conversation; \`/new <tool>\` creates a coding session
`

/** @deprecated alias — full default equals body without live tools section */
export const DEFAULT_TOOLS_HARNESS = DEFAULT_TOOLS_HARNESS_BODY

export function buildToolsHarnessContent(liveTools: LiveToolInfo[] = []): string {
  const lines =
    liveTools.length > 0
      ? liveTools.map((t) => {
          const desc = (t.description || '').replace(/\s+/g, ' ').trim().slice(0, 140)
          return `- \`${t.name}\`${desc ? ` — ${desc}` : ''}`
        })
      : ['- (none registered yet)']

  return `${DEFAULT_TOOLS_HARNESS_BODY}

## Currently available tools (auto-updated)
${lines.join('\n')}
`

}

/** Extract first JSON object from model output (raw or fenced). */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text?.trim()) return null
  const trimmed = text.trim()
  try {
    const direct = JSON.parse(trimmed)
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>
    }
  } catch {
    /* try extract */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() || trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

export function clampMarkdown(content: string, maxChars: number): string {
  const t = content.trim()
  if (t.length <= maxChars) return t
  return t.slice(0, maxChars)
}

export interface FeedbackLlmResult {
  memory_md?: string
  user_md?: string
  topic?: string
  soul_suggestion?: { suggestion: string; reason: string } | null
}

export function parseFeedbackLlmResult(text: string): FeedbackLlmResult | null {
  const obj = extractJsonObject(text)
  if (!obj) return null
  const result: FeedbackLlmResult = {}
  if (typeof obj.memory_md === 'string' && obj.memory_md.trim()) {
    result.memory_md = clampMarkdown(obj.memory_md, MAX_MEMORY_CHARS)
  }
  if (typeof obj.user_md === 'string' && obj.user_md.trim()) {
    result.user_md = clampMarkdown(obj.user_md, MAX_USER_CHARS)
  }
  if (typeof obj.topic === 'string' && obj.topic.trim()) {
    result.topic = obj.topic.trim().slice(0, 64)
  }
  const ss = obj.soul_suggestion
  if (ss && typeof ss === 'object' && !Array.isArray(ss)) {
    const s = ss as Record<string, unknown>
    if (typeof s.suggestion === 'string' && s.suggestion.trim()) {
      result.soul_suggestion = {
        suggestion: s.suggestion.trim().slice(0, 500),
        reason: typeof s.reason === 'string' ? s.reason.trim().slice(0, 300) : '',
      }
    }
  } else if (ss === null) {
    result.soul_suggestion = null
  }
  return result
}

export interface MemoryUpdateLlmResult {
  memory_md?: string
  user_md?: string
  agents_md?: string
}

export function parseMemoryUpdateLlmResult(text: string): MemoryUpdateLlmResult | null {
  const obj = extractJsonObject(text)
  if (!obj) return null
  const result: MemoryUpdateLlmResult = {}
  if (typeof obj.memory_md === 'string' && obj.memory_md.trim().length > 20) {
    result.memory_md = clampMarkdown(obj.memory_md, MAX_MEMORY_CHARS)
  }
  if (typeof obj.user_md === 'string' && obj.user_md.trim().length > 10) {
    result.user_md = clampMarkdown(obj.user_md, MAX_USER_CHARS)
  }
  if (typeof obj.agents_md === 'string' && obj.agents_md.trim().length > 10) {
    result.agents_md = clampMarkdown(obj.agents_md, MAX_AGENTS_CHARS)
  }
  return result
}

export function mergeSoulSuggestionList(
  existing: { suggestion: string; reason: string; feedbackCount: number }[],
  incoming: { suggestion: string; reason: string }
): { suggestion: string; reason: string; feedbackCount: number }[] {
  const next = [...existing]
  const key = incoming.suggestion.trim().toLowerCase()
  const idx = next.findIndex((s) => s.suggestion.trim().toLowerCase() === key)
  if (idx >= 0) {
    next[idx] = {
      ...next[idx],
      feedbackCount: next[idx].feedbackCount + 1,
      reason: incoming.reason || next[idx].reason,
    }
  } else {
    next.push({
      suggestion: incoming.suggestion.trim(),
      reason: incoming.reason || '',
      feedbackCount: 1,
    })
  }
  // Cap pending list
  return next.slice(0, 20)
}
