import { describe, expect, it } from 'vitest'
import { EMPTY_KEEP_ALIVE, nextKeepAlive, type KeepAliveState } from '../terminal-keep-alive'

const all = (): boolean => true

/** Visit tabs in order, returning the final state. */
function visit(ids: string[], max = 3, eligible: (id: string) => boolean = all): KeepAliveState {
  return ids.reduce((state, id) => nextKeepAlive(state, id, eligible, max), EMPTY_KEEP_ALIVE)
}

describe('nextKeepAlive', () => {
  it('keeps visited tabs mounted in first-seen order', () => {
    expect(visit(['a', 'b', 'c']).ids).toEqual(['a', 'b', 'c'])
    // revisiting does not reorder the mounted layers
    expect(visit(['a', 'b', 'c', 'a']).ids).toEqual(['a', 'b', 'c'])
  })

  it('evicts the least recently used tab past the cap, never the active one', () => {
    // a was revisited, so b is the LRU when d arrives
    expect(visit(['a', 'b', 'c', 'a', 'd']).ids).toEqual(['a', 'c', 'd'])
    expect(visit(['a', 'b', 'c', 'd'], 1).ids).toEqual(['d'])
  })

  it('returns the same state object when the active tab is unchanged', () => {
    const s = visit(['a', 'b'])
    expect(nextKeepAlive(s, 'b', all, 3)).toBe(s)
  })

  it('drops ineligible tabs (closed / chat view / ended), including a just-left active tab', () => {
    const s = visit(['a', 'b', 'c'])
    const next = nextKeepAlive(s, 'c', (id) => id !== 'a', 3)
    expect(next.ids).toEqual(['b', 'c'])
    expect(next.lastUsed.a).toBeUndefined()
  })

  it('does not mount an ineligible active tab (chat view)', () => {
    const s = visit(['a'])
    expect(nextKeepAlive(s, 'chat-tab', (id) => id !== 'chat-tab', 3).ids).toEqual(['a'])
    expect(nextKeepAlive(EMPTY_KEEP_ALIVE, null, all, 3)).toBe(EMPTY_KEEP_ALIVE)
  })
})
