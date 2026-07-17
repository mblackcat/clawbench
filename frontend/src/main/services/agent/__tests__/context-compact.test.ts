import { describe, it, expect } from 'vitest'
import {
  estimateMessagesChars,
  needsCompact,
  DEFAULT_CONTEXT_CHAR_BUDGET,
} from '../context-compact'
import type { ChatMessage } from '../../ai.service'

describe('context-compact', () => {
  it('estimates message characters', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world', toolCalls: [{ id: '1', name: 'web_search', input: { q: 'x' } }] },
    ]
    expect(estimateMessagesChars(msgs)).toBeGreaterThan(10)
  })

  it('needsCompact when over trigger ratio', () => {
    const huge = 'x'.repeat(Math.floor(DEFAULT_CONTEXT_CHAR_BUDGET * 0.9))
    const msgs: ChatMessage[] = [{ role: 'user', content: huge }]
    expect(needsCompact(msgs)).toBe(true)
    expect(needsCompact([{ role: 'user', content: 'short' }])).toBe(false)
  })
})
