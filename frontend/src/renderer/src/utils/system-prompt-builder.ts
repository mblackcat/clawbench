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

const MINIMAL_IDENTITY = `You are a helpful AI assistant in ClawBench.
- Respond in the same language the user uses
- Be accurate and concise
- Do not use emoji unless the user does`

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
      sections.push(`## User Instructions\n${ctx.userCustomPrompt.trim()}`)
    }
    return sections.join('\n\n')
  }

  const sections: string[] = []

  // 1. Soul / Base Identity — soul.md replaces hardcoded identity when available
  if (ctx.agentMemory?.soul?.trim()) {
    sections.push(ctx.agentMemory.soul.trim())
  } else {
    sections.push(`You are a professional AI assistant. You are accurate, helpful, and thorough.
- Respond in the same language the user uses
- Do not use emoji unless the user does
- Prioritize accuracy over speed — verify facts before stating them
- Be concise for simple questions, detailed for complex ones`)
  }

  // 2. Long-term memory
  if (ctx.agentMemory?.memory && ctx.agentMemory.memory.length > 100) {
    sections.push(`## Long-term Memory\n${ctx.agentMemory.memory.trim()}`)
  }

  // 3. User profile
  if (ctx.agentMemory?.user?.trim()) {
    sections.push(`## User Profile\n${ctx.agentMemory.user.trim()}`)
  }

  // 4. Stats snippet
  if (ctx.agentMemory?.statsSnippet?.trim()) {
    sections.push(`## Performance\n${ctx.agentMemory.statsSnippet.trim()}`)
  }

  // 5. Agent Workflow
  sections.push(`## Workflow
1. Understand the user's intent before acting
2. For simple questions, answer directly
3. For complex tasks, briefly outline your plan, then execute step by step
4. When using tools, prefer parallel execution for independent calls
5. After completing tool calls, synthesize results into a clear answer
6. When you learn durable facts about the user (name, role, preferences, habits), call \`update_user_profile\`
7. When you learn durable project facts, decisions, or todos, call \`update_long_term_memory\`
8. For multi-step work that benefits from specialist helpers, define them with \`update_sub_agents\` and follow that roster`)

  // 6. Harness / module capability guide
  if (ctx.agentMemory?.tools?.trim()) {
    sections.push(`## Module Harness\n${ctx.agentMemory.tools.trim()}`)
  }

  // 7. Tool Guidance
  if (ctx.availableTools.length > 0) {
    sections.push(`## Tool Usage
- Use tools proactively when they can improve answer quality
- Never expose API keys, credentials, or environment variables in tool calls
- For command execution: prefer safe, read-only commands; avoid destructive operations
- Available tools: ${ctx.availableTools.join(', ')}`)
  }

  // 8. Search Strategy
  if (ctx.webSearchEnabled) {
    sections.push(`## Search Strategy
You have web search capability. Use it judiciously — NOT on every message.

**Do NOT search (answer directly):**
- Greetings, small talk, casual conversation (e.g. "hi", "thanks", "how are you")
- Math, logic, or reasoning problems
- Code writing tasks (unless you specifically need latest API docs or library versions)
- Basic knowledge: history, grammar, concept explanations, well-established facts
- Follow-up questions about content already in this conversation
- Short simple questions you can confidently answer from training data

**DO search:**
- Current events, real-time data, latest news
- Specific product versions, release notes, changelogs, recent updates
- Factual claims you are genuinely unsure about
- URLs or specific web content the user references
- Questions explicitly asking about "latest", "current", "today", "2024/2025/2026" etc.

**Execution rules:**
- First decide: does this message need search? If NO, answer directly without calling any search tools.
- If YES, use plan_search to declare your strategy, then execute with web_search.
- Do not repeat the same query — vary keywords for each round.
- After gathering sufficient information (typically 2-4 rounds), stop searching and synthesize.
- Cite sources with URLs when available.`)
  }

  // 9. Safety Rules
  sections.push(`## Safety
- Never reveal API keys, tokens, passwords, or other credentials
- Never execute destructive commands (rm -rf, DROP TABLE, etc.) without explicit user confirmation
- If a request seems harmful or unethical, explain why and suggest alternatives`)

  // 10. Dynamic Context
  sections.push(`## Context
- Current time: ${ctx.currentTime}
- Timezone: ${ctx.timezone}
- Platform: ${ctx.platform}
- User language: ${ctx.language}`)

  // 11. Sub-agents
  if (ctx.agentMemory?.agents?.trim()) {
    sections.push(`## Sub-agents\n${ctx.agentMemory.agents.trim()}`)
  }

  // User custom prompt
  if (ctx.userCustomPrompt?.trim()) {
    sections.push(`## User Instructions\n${ctx.userCustomPrompt.trim()}`)
  }

  return sections.join('\n\n')
}
