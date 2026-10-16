import { describe, expect, it } from 'vitest'
import { getOmpCandidatePaths, getToolCandidatePaths } from '../../utils/windows-env'

describe('tool-candidates-detect', () => {
  it('returns candidate paths for omp including standard installer directories', () => {
    const candidates = getOmpCandidatePaths()
    expect(Array.isArray(candidates)).toBe(true)
    expect(candidates.length).toBeGreaterThan(0)
    if (process.platform === 'win32') {
      expect(candidates.some((p) => p.includes('omp.exe'))).toBe(true)
      expect(candidates.some((p) => p.includes('AppData') || p.includes('.local'))).toBe(true)
    } else {
      expect(candidates.some((p) => p.includes('.local') || p.includes('usr/local'))).toBe(true)
    }
  })

  it('returns candidate paths for other coding tools across platforms', () => {
    const tools = ['claude', 'codex', 'antigravity', 'agy', 'grok']
    for (const tool of tools) {
      const candidates = getToolCandidatePaths(tool)
      expect(candidates.length).toBeGreaterThan(0)
      if (process.platform === 'win32') {
        expect(candidates.some((p) => p.includes(`${tool}.exe`) || p.includes(`${tool}.cmd`))).toBe(true)
      } else {
        expect(candidates.some((p) => p.includes(tool))).toBe(true)
      }
    }
  })

  it('does not cross-pollinate agy candidate paths into other tools', () => {
    const otherTools = ['claude', 'codex', 'grok', 'omp']
    for (const tool of otherTools) {
      const candidates = getToolCandidatePaths(tool)
      const hasAgyCrossPollination = candidates.some(
        (p) => p.endsWith('agy.exe') || p.endsWith('/agy') || p.includes('AppData\\Local\\agy\\bin\\agy.exe')
      )
      expect(hasAgyCrossPollination).toBe(false)
    }
  })
})
