import { describe, expect, it } from 'vitest'
import { findCounterpart } from '../app-match'

describe('findCounterpart', () => {
  const market = [
    { id: 'cb.a.tool', name: 'Tool', type: 'app' },
    { id: 'cb.b.tool-prompt', name: 'Tool', type: 'prompt' },
    { id: 'cb.c.other', name: 'Other' }
  ]

  it('prefers an exact id match', () => {
    expect(findCounterpart({ id: 'cb.c.other', name: 'Renamed' }, market)?.id).toBe('cb.c.other')
  })

  it('falls back to name only within the same type', () => {
    expect(findCounterpart({ id: 'legacy-uuid', name: 'Tool', type: 'prompt' }, market)?.id).toBe('cb.b.tool-prompt')
    expect(findCounterpart({ id: 'legacy-uuid', name: 'Tool' }, market)?.id).toBe('cb.a.tool')
    expect(findCounterpart({ id: 'legacy-uuid', name: 'Tool', type: 'ai-skill' }, market)).toBeUndefined()
  })

  it('never name-matches a counterpart that has its own id match', () => {
    expect(findCounterpart({ id: 'legacy-uuid', name: 'Tool' }, market, new Set(['cb.a.tool']))).toBeUndefined()
  })
})
