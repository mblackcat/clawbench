import { describe, it, expect } from 'vitest'
import { formatSearchResults, getCurrentMonthYear } from '../web-search.service'

describe('formatSearchResults (Claude Code–style)', () => {
  it('formats results as markdown links for Sources sections', () => {
    const out = formatSearchResults('react docs', [
      { title: 'React', url: 'https://react.dev', snippet: 'The library for web UIs' },
      { title: 'Hooks', url: 'https://react.dev/hooks', snippet: 'useState etc.' },
    ])
    expect(out).toContain('Search results for "react docs"')
    expect(out).toContain('[React](https://react.dev)')
    expect(out).toContain('[Hooks](https://react.dev/hooks)')
    expect(out).toContain('Sources')
    expect(out).toContain('The library for web UIs')
  })

  it('exposes current month/year for query guidance', () => {
    const my = getCurrentMonthYear()
    expect(my).toMatch(/\d{4}/)
    expect(my.length).toBeGreaterThan(4)
  })
})
