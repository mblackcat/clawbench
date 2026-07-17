/**
 * Context compaction for long agent conversations (Claude Code–inspired).
 * When estimated size exceeds budget, summarize older turns and keep a tail of recent messages.
 */
import type { ChatMessage } from '../ai.service'
import { completeChat } from '../ai.service'
import type { AIModelConfig } from '../../store/settings.store'
import * as logger from '../../utils/logger'

/** Soft budget in characters for the whole messages array (approx tokens * 4). */
export const DEFAULT_CONTEXT_CHAR_BUDGET = 120_000
/** Always keep this many most recent non-system messages. */
export const DEFAULT_KEEP_RECENT = 12
/** Trigger compact when over this fraction of budget. */
export const COMPACT_TRIGGER_RATIO = 0.85

export function estimateMessagesChars(messages: ChatMessage[]): number {
  let n = 0
  for (const m of messages) {
    n += (m.content || '').length
    n += (m.reasoningContent || '').length
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        n += tc.name.length + JSON.stringify(tc.input || {}).length
      }
    }
  }
  return n
}

export function needsCompact(
  messages: ChatMessage[],
  budgetChars = DEFAULT_CONTEXT_CHAR_BUDGET
): boolean {
  return estimateMessagesChars(messages) > budgetChars * COMPACT_TRIGGER_RATIO
}

/**
 * Compact conversation history: keep system messages + summary + recent tail.
 */
export async function compactMessages(
  messages: ChatMessage[],
  config: AIModelConfig,
  modelId: string,
  options?: { budgetChars?: number; keepRecent?: number }
): Promise<{ messages: ChatMessage[]; compacted: boolean; summary?: string }> {
  const budget = options?.budgetChars ?? DEFAULT_CONTEXT_CHAR_BUDGET
  const keepRecent = options?.keepRecent ?? DEFAULT_KEEP_RECENT

  if (!needsCompact(messages, budget)) {
    return { messages, compacted: false }
  }

  const systemMsgs = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')

  if (rest.length <= keepRecent + 2) {
    return { messages, compacted: false }
  }

  const toSummarize = rest.slice(0, -keepRecent)
  const tail = rest.slice(-keepRecent)

  const transcript = toSummarize
    .map((m) => {
      const role = m.role === 'tool' ? 'tool' : m.role
      let body = (m.content || '').slice(0, 1500)
      if (m.toolCalls?.length) {
        body +=
          '\n[tools: ' +
          m.toolCalls.map((t) => t.name).join(', ') +
          ']'
      }
      return `${role}: ${body}`
    })
    .join('\n\n')
    .slice(0, 40_000)

  let summary =
    'Earlier conversation was compacted. Key points from prior turns are summarized below for continuity.'

  try {
    const raw = await completeChat(
      config.id,
      [
        {
          role: 'system',
          content:
            'You compress conversation history for an AI agent. Produce a concise bullet summary of decisions, facts, tool outcomes, and open tasks. No preamble. Max 800 words.',
        },
        {
          role: 'user',
          content: `Summarize this conversation history:\n\n${transcript}`,
        },
      ],
      modelId,
      1024
    )
    if (raw?.trim()) summary = raw.trim().slice(0, 6000)
  } catch (err) {
    logger.warn('[context-compact] LLM summary failed, using stub:', err)
    summary =
      `Earlier conversation compacted (${toSummarize.length} messages). Continue from recent context.\n` +
      toSummarize
        .slice(-4)
        .map((m) => `- ${m.role}: ${(m.content || '').slice(0, 200)}`)
        .join('\n')
  }

  const compacted: ChatMessage[] = [
    ...systemMsgs,
    {
      role: 'user',
      content: `[System: conversation context compacted]\n\n## Prior context summary\n${summary}`,
    },
    {
      role: 'assistant',
      content: 'Understood. I have the prior context summary and will continue from the recent messages.',
    },
    ...tail,
  ]

  logger.info(
    `[context-compact] compacted ${toSummarize.length} msgs → summary ${summary.length} chars; kept ${tail.length} recent`
  )

  return { messages: compacted, compacted: true, summary }
}
