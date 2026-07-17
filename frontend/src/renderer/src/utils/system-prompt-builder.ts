export interface AgentMemoryContext {
  soul?: string
  memory?: string
  user?: string
  agents?: string
  tools?: string
  statsSnippet?: string
}

export interface SystemPromptContext {
  currentTime: string
  timezone: string
  platform: string
  language: string
  availableTools: string[]
  webSearchEnabled: boolean
  userCustomPrompt?: string
  agentMemory?: AgentMemoryContext
  /** When false, use minimal identity prompt without persona/memory/harness. Default true. */
  assistantEnabled?: boolean
}

/**
 * Progressive injection budgets (characters).
 * Always-on core stays small; large / situational docs are on-demand via read_agent_file.
 * Mirrors Claude Code: identity + compact context in prompt; capabilities live in tools.
 */
export const PROMPT_INJECT_CAPS = {
  /** Persona is always needed but may be user-edited long */
  soul: 3_500,
  /** Collaboration style — keep a compact always-on slice */
  user: 1_200,
  /** Project facts — compact always-on; full file via tool */
  memory: 2_000,
  /** Never inject full tools.md / agents.md — load via tools */
  tools: 0,
  agents: 0,
  customPrompt: 2_000,
} as const

const MINIMAL_IDENTITY = `You are a helpful AI assistant in ClawBench.
- Respond in the same language the user uses
- Be accurate and concise
- Do not use emoji unless the user does`

const DEFAULT_SOUL_FALLBACK = `You are a professional AI assistant. You are accurate, helpful, and thorough.
- Respond in the same language the user uses
- Do not use emoji unless the user does
- Prioritize accuracy over speed — verify facts before stating them
- Be concise for simple questions, detailed for complex ones`

/**
 * Inject content with a soft cap. Over-budget content is truncated and points to read_agent_file.
 */
export function injectBoundedSection(
  title: string,
  content: string | undefined,
  maxChars: number,
  fileKey?: 'user' | 'memory' | 'agents' | 'tools' | 'soul'
): string | null {
  const t = (content || '').trim()
  if (!t) return null
  if (maxChars <= 0) return null
  if (t.length <= maxChars) {
    return `## ${title}\n${t}`
  }
  const hint = fileKey
    ? `\n\n…(truncated for context budget; call \`read_agent_file\` with file=\`${fileKey}\` for the full document)`
    : `\n\n…(truncated for context budget)`
  return `## ${title}\n${t.slice(0, maxChars).trimEnd()}${hint}`
}

/**
 * Claude Code–style: progressive knowledge is a capability (tools), not a long prompt dump.
 * tools.md / agents.md are never fully inlined — they are internal agent files.
 */
function onDemandCatalog(availableTools: string[]): string {
  const hasRead = availableTools.includes('read_agent_file')
  const readHint = hasRead
    ? 'Use `read_agent_file` to load a file only when this turn needs more than the short previews above.'
    : 'Detailed agent files may exist on disk; prefer tools when available to load them.'

  const persistLines: string[] = []
  if (availableTools.includes('update_user_profile')) {
    persistLines.push('`update_user_profile` — durable user prefs / identity notes')
  }
  if (availableTools.includes('update_long_term_memory')) {
    persistLines.push('`update_long_term_memory` — projects, decisions, todos')
  }
  if (availableTools.includes('update_sub_agents')) {
    persistLines.push('`update_sub_agents` — specialist buddy roster')
  }

  const persistBlock =
    persistLines.length > 0
      ? `\n\nPersist durable learnings with: ${persistLines.join('; ')}.`
      : ''

  return `## Agent knowledge files
Durable docs are not fully inlined every turn. ${readHint}

| file | when to load |
|------|----------------|
| \`soul\` | full persona when the identity preview was truncated |
| \`user\` | full profile / preferences beyond the short User Profile above |
| \`memory\` | past projects, decisions, todos beyond the memory preview |
| \`agents\` | sub-agent / buddy roster (multi-step specialist work) |
| \`tools\` | detailed module harness (apps / terminal / DB / coding how-to) |

Simple Q&A: answer without loading extra files. Complex module ops: load \`tools\` and/or \`agents\` first. Never invent file contents.${persistBlock}`
}

/**
 * Claude Code system section (trimmed): tool results tags, permission denial, parallel tools.
 * Safety and search policy live in tool descriptions / executors, not here.
 */
function systemMechanicsSection(availableTools: string[]): string {
  const items = [
    'All text you output outside of tool use is displayed to the user. Use GitHub-flavored markdown.',
    'Tools run under the user-selected permission mode. If a tool is denied, do not re-attempt the exact same call — adjust your approach.',
    'Tool results and user messages may include system tags; they are automatically added and not part of the user\'s words.',
    'You can call multiple tools in one response when independent; use sequential calls when a later call depends on an earlier result.',
  ]

  if (availableTools.includes('run_shell_command') || availableTools.includes('execute_command')) {
    items.push(
      'Prefer dedicated tools over ad-hoc shell when a matching tool exists (apps, DB, coding sessions).'
    )
  }

  return `## System\n${items.map((i) => `- ${i}`).join('\n')}`
}

function usingToolsSection(availableTools: string[], webSearchEnabled: boolean): string | null {
  if (availableTools.length === 0 && !webSearchEnabled) return null

  const names =
    availableTools.length > 0
      ? availableTools.join(', ')
      : '(none registered)'

  const lines = [
    `Tool schemas are provided by the API. Available names: ${names}.`,
    'Use tools proactively when they improve correctness; never put secrets in tool arguments.',
  ]

  if (webSearchEnabled || availableTools.includes('web_search')) {
    lines.push(
      'Web search/browse tools encode their own usage policy. After using search results, end with a Sources: section of markdown links [Title](URL). Prefer the current year in queries for recent docs/events.'
    )
  }

  if (availableTools.includes('read_agent_file')) {
    lines.push(
      'For module how-to beyond tool schemas, load file=`tools` via `read_agent_file`.'
    )
  }

  return `## Using tools\n${lines.map((l) => `- ${l}`).join('\n')}`
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const assistantOn = ctx.assistantEnabled !== false

  // Master switch OFF → original / minimal system prompt only
  if (!assistantOn) {
    const sections: string[] = [MINIMAL_IDENTITY]
    if (ctx.availableTools.length > 0) {
      sections.push(`## Tool Usage
- Available tools: ${ctx.availableTools.join(', ')}
- Prefer safe, read-only operations; confirm destructive actions`)
    }
    sections.push(`## Context
- Current time: ${ctx.currentTime}
- Timezone: ${ctx.timezone}
- Platform: ${ctx.platform}
- User language: ${ctx.language}`)
    if (ctx.userCustomPrompt?.trim()) {
      const custom = injectBoundedSection(
        'User Instructions',
        ctx.userCustomPrompt,
        PROMPT_INJECT_CAPS.customPrompt
      )
      if (custom) sections.push(custom)
    }
    return sections.join('\n\n')
  }

  const sections: string[] = []
  const mem = ctx.agentMemory

  // 1. Soul — always (capped). Identity is the primary always-on prompt surface.
  if (mem?.soul?.trim()) {
    const soul = injectBoundedSection('Identity', mem.soul, PROMPT_INJECT_CAPS.soul, 'soul')
    if (mem.soul.trim().length <= PROMPT_INJECT_CAPS.soul) {
      sections.push(mem.soul.trim())
    } else if (soul) {
      sections.push(soul)
    }
  } else {
    sections.push(DEFAULT_SOUL_FALLBACK)
  }

  // 2. User profile — compact always-on slice
  const userSec = injectBoundedSection(
    'User Profile',
    mem?.user,
    PROMPT_INJECT_CAPS.user,
    'user'
  )
  if (userSec) sections.push(userSec)

  // 3. Memory preview — only if substantial; always capped
  if (mem?.memory && mem.memory.trim().length > 100) {
    const memSec = injectBoundedSection(
      'Long-term Memory (preview)',
      mem.memory,
      PROMPT_INJECT_CAPS.memory,
      'memory'
    )
    if (memSec) sections.push(memSec)
  }

  // 4. Stats one-liner
  if (mem?.statsSnippet?.trim()) {
    sections.push(`## Performance\n${mem.statsSnippet.trim()}`)
  }

  // 5. System mechanics (Claude Code–style)
  sections.push(systemMechanicsSection(ctx.availableTools))

  // 6. Using tools (brief; detailed policy lives in tool descriptions)
  const toolsSec = usingToolsSection(ctx.availableTools, ctx.webSearchEnabled)
  if (toolsSec) sections.push(toolsSec)

  // 7. Progressive agent knowledge catalog (internal MD files)
  sections.push(onDemandCatalog(ctx.availableTools))

  // 8. Context
  sections.push(`## Context
- Current time: ${ctx.currentTime}
- Timezone: ${ctx.timezone}
- Platform: ${ctx.platform}
- User language: ${ctx.language}`)

  // NOTE: tools.md and agents.md are intentionally NOT fully injected.
  // Model discovers them via Agent knowledge files + read_agent_file.

  // Custom prompt (capped)
  if (ctx.userCustomPrompt?.trim()) {
    const custom = injectBoundedSection(
      'User Instructions',
      ctx.userCustomPrompt,
      PROMPT_INJECT_CAPS.customPrompt
    )
    if (custom) sections.push(custom)
  }

  return sections.join('\n\n')
}
