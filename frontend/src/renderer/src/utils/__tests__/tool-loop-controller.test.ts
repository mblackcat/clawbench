import { describe, it, expect } from 'vitest'
import { ToolLoopController } from '../tool-loop-controller'

describe('ToolLoopController (Claude Code–style)', () => {
  it('allows unlimited steps when maxSteps is 0 or omitted', () => {
    const c = new ToolLoopController({ maxSteps: 0, maxDuplicates: 3 })
    for (let i = 0; i < 50; i++) {
      const check = c.canExecute('web_search', { query: `q${i}` })
      expect(check.allowed).toBe(true)
      c.recordExecution('web_search', { query: `q${i}` })
    }
    expect(c.getStepCount()).toBe(50)
    expect(c.getMaxSteps()).toBe(0)
  })

  it('enforces soft maxSteps only when positive', () => {
    const c = new ToolLoopController({ maxSteps: 2, maxDuplicates: 5 })
    expect(c.canExecute('t', { a: 1 }).allowed).toBe(true)
    c.recordExecution('t', { a: 1 })
    expect(c.canExecute('t', { a: 2 }).allowed).toBe(true)
    c.recordExecution('t', { a: 2 })
    expect(c.canExecute('t', { a: 3 }).allowed).toBe(false)
    expect(c.getMaxSteps()).toBe(2)
  })

  it('blocks exact duplicate tool+input after maxDuplicates', () => {
    const c = new ToolLoopController({ maxDuplicates: 2 })
    const input = { query: 'same' }
    expect(c.canExecute('web_search', input).allowed).toBe(true)
    c.recordExecution('web_search', input)
    expect(c.canExecute('web_search', input).allowed).toBe(true)
    c.recordExecution('web_search', input)
    expect(c.canExecute('web_search', input).allowed).toBe(false)
  })

  it('dedupes web_browse by domain+path', () => {
    const c = new ToolLoopController()
    expect(c.canExecute('web_browse', { url: 'https://ex.com/a?x=1' }).allowed).toBe(true)
    c.recordExecution('web_browse', { url: 'https://ex.com/a?x=1' })
    expect(c.canExecute('web_browse', { url: 'https://ex.com/a?x=2' }).allowed).toBe(false)
    expect(c.canExecute('web_browse', { url: 'https://ex.com/b' }).allowed).toBe(true)
  })
})
