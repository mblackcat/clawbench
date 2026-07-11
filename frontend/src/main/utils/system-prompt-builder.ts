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
 */
export const PROMPT_INJECT_CAPS = {
  /** Persona is always needed but may be user-edited long */
  soul: 3_500,
  /** Collaboration style — keep a compact always-on slice */
  user: 1_200,
  /** Project facts — compact always-on; full file via tool */
  memory: 2_000,
  /** Never inject full tools.md / agents.md */
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

function onDemandCatalog(availableTools: string[]): string {
  const hasRead = availableTools.includes('read_agent_file')
  const readHint = hasRead
    ? 'Use `read_agent_file` to load details only when the turn needs them.'
    : 'Detailed files exist on disk; prefer tools when available to load them.'

  return `## On-demand knowledge (do not assume empty)
Durable docs are NOT fully inlined every turn. ${readHint}
| file | when to load |
|------|----------------|
| \`soul\` | full persona when the identity preview was truncated |
| \`user\` | full profile / preferences beyond the short User Profile above |
| \`memory\` | past projects, decisions, todos beyond the memory preview |
| \`agents\` | sub-agent / buddy roster (multi-step specialist work) |
| \`tools\` | detailed module harness (apps / terminal / DB / coding how-to) |

Rules:
- Simple Q&A: answer without loading extra files
- Before complex module ops or multi-specialist plans: load \`tools\` and/or \`agents\` first
- Never invent file contents — read when unsure`
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

  // 1. Soul — always (capped)
  if (mem?.soul?.trim()) {
    const soul = injectBoundedSection('Identity', mem.soul, PROMPT_INJECT_CAPS.soul, 'soul')
    // Soul is free-form; keep raw body without forcing "## Identity" if it already has a title
    // Prefer inject as-is when under cap for nicer templates
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

  // 5. Progressive catalog — always (replaces full tools.md + agents.md)
  sections.push(onDemandCatalog(ctx.availableTools))

  // 6. Compact workflow
  sections.push(`## Workflow
1. Understand intent; answer simple questions directly
2. Complex tasks: brief plan → tools → synthesize
3. Prefer parallel tool calls when independent
4. Load on-demand docs (\`read_agent_file\`) only when this turn needs them
5. Persist durable learnings: \`update_user_profile\`, \`update_long_term_memory\`, \`update_sub_agents\``)

  // 7. Tool names only (schemas already sent by the API when tools are attached)
  if (ctx.availableTools.length > 0) {
    sections.push(`## Tool Usage
- Tool schemas are provided by the API; names: ${ctx.availableTools.join(', ')}
- Use tools proactively when they improve quality; never expose secrets in tool args
- Prefer safe, read-only commands; confirm destructive shell/SQL
- For module how-to beyond tool schemas, load file=\`tools\` via \`read_agent_file\``)
  }

  // 8. Search strategy (only when enabled)
  if (ctx.webSearchEnabled) {
    sections.push(`## Search Strategy
Use web search judiciously — NOT on every message.

**Skip search:** greetings, math/logic, coding from known APIs, basic facts, follow-ups already in thread.
**Do search:** current events, latest versions/changelogs, uncertain facts, user-linked URLs, explicit "latest/today".

**Rules:** decide first; if needed use plan_search then web_search; vary queries; stop after 2–4 useful rounds; cite URLs.`)
  }

  // 9. Safety
  sections.push(`## Safety
- Never reveal API keys, tokens, passwords, or other credentials
- Never execute destructive commands (rm -rf, DROP TABLE, etc.) without explicit user confirmation
- If a request seems harmful or unethical, explain why and suggest alternatives`)

  // 10. Context
  sections.push(`## Context
- Current time: ${ctx.currentTime}
- Timezone: ${ctx.timezone}
- Platform: ${ctx.platform}
- User language: ${ctx.language}`)

  // NOTE: tools.md and agents.md are intentionally NOT fully injected.
  // Model discovers them via On-demand knowledge + read_agent_file.

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
