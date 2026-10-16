import { describe, expect, it } from 'vitest'
import { createPtyReplayGate, trimChunkAfterSnapshot } from '../pty-replay'

describe('trimChunkAfterSnapshot', () => {
  it('drops chunks fully contained in the snapshot', () => {
    expect(trimChunkAfterSnapshot({ data: 'abc', offset: 10 }, 10)).toBe('')
    expect(trimChunkAfterSnapshot({ data: 'abc', offset: 5 }, 10)).toBe('')
  })
  it('keeps chunks entirely after the snapshot', () => {
    expect(trimChunkAfterSnapshot({ data: 'abc', offset: 13 }, 10)).toBe('abc')
  })
  it('trims the overlapping prefix of a straddling chunk', () => {
    // chunk covers [8, 13) → snapshot ends at 10 → keep last 3 chars
    expect(trimChunkAfterSnapshot({ data: 'xyabc', offset: 13 }, 10)).toBe('abc')
  })
  it('passes through when offsets are unknown (older main / no replay)', () => {
    expect(trimChunkAfterSnapshot({ data: 'abc' }, 10)).toBe('abc')
    expect(trimChunkAfterSnapshot({ data: 'abc', offset: 3 }, null)).toBe('abc')
  })
})

describe('createPtyReplayGate', () => {
  it('queues until release and drops already-replayed chunks', () => {
    const out: string[] = []
    const gate = createPtyReplayGate((d) => out.push(d))
    gate.push({ data: 'hello', offset: 5 })
    gate.push({ data: ' wor', offset: 9 })
    expect(out).toEqual([])
    // snapshot "hello wo" ends at 8
    gate.release(8)
    expect(out).toEqual(['r'])
    gate.push({ data: 'ld', offset: 11 })
    expect(out).toEqual(['r', 'ld'])
  })
  it('filters a straddling chunk that arrives after release, then stops filtering', () => {
    const out: string[] = []
    const gate = createPtyReplayGate((d) => out.push(d))
    gate.release(8)
    gate.push({ data: 'wxyz', offset: 10 }) // covers [6,10) → keep 'yz'
    gate.push({ data: 'ab', offset: 2 }) // restarted PTY: offsets reset
    expect(out).toEqual(['yz', 'ab'])
  })
  it('flushes everything when released without a snapshot', () => {
    const out: string[] = []
    const gate = createPtyReplayGate((d) => out.push(d))
    gate.push({ data: 'a', offset: 1 })
    gate.release()
    gate.push({ data: 'b', offset: 2 })
    expect(out).toEqual(['a', 'b'])
  })
})
