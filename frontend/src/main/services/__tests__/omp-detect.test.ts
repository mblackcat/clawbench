import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'path'
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
    const tools = ['claude', 'codex', 'antigravity', 'agy', 'grok', 'opencode']
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
    const otherTools = ['claude', 'codex', 'grok', 'opencode', 'omp']
    for (const tool of otherTools) {
      const candidates = getToolCandidatePaths(tool)
      const hasAgyCrossPollination = candidates.some(
        (p) => p.endsWith('agy.exe') || p.endsWith('/agy') || p.includes('AppData\\Local\\agy\\bin\\agy.exe')
      )
      expect(hasAgyCrossPollination).toBe(false)
    }
  })

  describe('windows npm-global / package-manager shims', () => {
    const originalPlatform = process.platform
    const saved = {
      NVM_SYMLINK: process.env.NVM_SYMLINK,
      ProgramFiles: process.env.ProgramFiles,
      'ProgramFiles(x86)': process.env['ProgramFiles(x86)']
    }

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    })

    it('includes nvm-windows, Node.js install dir, scoop and winget link candidates', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      process.env.NVM_SYMLINK = 'C:/nvm4w/nodejs'
      process.env.ProgramFiles = 'C:/Program Files'
      delete process.env['ProgramFiles(x86)']
      const candidates = getToolCandidatePaths('opencode')
      expect(candidates).toContain(join('C:/nvm4w/nodejs', 'opencode.cmd'))
      expect(candidates).toContain(join('C:/Program Files', 'nodejs', 'opencode.cmd'))
      expect(candidates.some((p) => p.includes(join('scoop', 'shims', 'opencode.exe')))).toBe(true)
      expect(candidates.some((p) => p.includes(join('WinGet', 'Links', 'opencode.exe')))).toBe(true)
      expect(candidates.some((p) => p.includes(join('.opencode', 'bin', 'opencode.exe')))).toBe(true)
    })

    it('omits the nvm-windows candidates when NVM_SYMLINK is unset', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      delete process.env.NVM_SYMLINK
      expect(getToolCandidatePaths('claude').some((p) => p.includes('nvm4w'))).toBe(false)
    })
  })
})
