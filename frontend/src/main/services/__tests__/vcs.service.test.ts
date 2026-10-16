import fs from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectVcsType, detectVcsTypes } from '../vcs.service'

/**
 * Detection is marker-based via fs.existsSync, so we stub existsSync against an
 * in-memory set of "present" paths. Marker dirs are derived from the workspace
 * through the same path.resolve/dirname the walker uses, so the set keys line up
 * identically on both POSIX and Windows (drive-prefixed) resolves.
 */
describe('vcs detection (upward marker search)', () => {
  const existing = new Set<string>()
  let existsSpy: ReturnType<typeof vi.spyOn>
  let savedP4Config: string | undefined

  const WS = join(sep, 'repo', 'proj', 'sub') // the "opened workspace"

  /** Nth ancestor of the workspace (0 = the workspace itself). */
  const ancestor = (levels: number): string => {
    let dir = resolve(WS)
    for (let i = 0; i < levels; i++) dir = dirname(dir)
    return dir
  }
  const mark = (levels: number, name: string): void => {
    existing.add(join(ancestor(levels), name))
  }

  beforeEach(() => {
    existing.clear()
    existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => existing.has(resolve(String(p))))
    savedP4Config = process.env.P4CONFIG
    delete process.env.P4CONFIG
  })

  afterEach(() => {
    existsSpy.mockRestore()
    if (savedP4Config === undefined) delete process.env.P4CONFIG
    else process.env.P4CONFIG = savedP4Config
  })

  it('detects svn when .svn is in a parent of the workspace', () => {
    mark(2, '.svn') // grandparent holds the checkout root
    expect(detectVcsType(WS)).toBe('svn')
    expect(detectVcsTypes(WS)).toContain('svn')
  })

  it('detects svn when .svn is several levels up', () => {
    mark(3, '.svn')
    expect(detectVcsType(WS)).toBe('svn')
  })

  it('does NOT walk up for git (the workspace is treated as the unit)', () => {
    mark(2, '.git') // git marker only in a parent, not in the workspace itself
    expect(detectVcsType(WS)).toBe('none')
  })

  it('detects svn when .svn is in the workspace itself', () => {
    mark(0, '.svn')
    expect(detectVcsType(WS)).toBe('svn')
  })

  it('prioritizes git over svn when both markers are in the workspace', () => {
    mark(0, '.git')
    mark(0, '.svn')
    expect(detectVcsType(WS)).toBe('git')
    expect(detectVcsTypes(WS)).toEqual(['git', 'svn'])
  })

  it('detects perforce via a default .p4config file in a parent', () => {
    mark(2, '.p4config')
    expect(detectVcsType(WS)).toBe('perforce')
  })

  it('detects perforce via the P4CONFIG-named file walking up', () => {
    process.env.P4CONFIG = 'client.cfg'
    mark(2, 'client.cfg')
    expect(detectVcsType(WS)).toBe('perforce')
  })

  it('does not treat an unrelated filename as a perforce marker', () => {
    process.env.P4CONFIG = 'client.cfg'
    mark(2, 'random.cfg') // not in the candidate set
    expect(detectVcsType(WS)).toBe('none')
  })

  it('returns none when no marker is present anywhere up the chain', () => {
    expect(detectVcsType(WS)).toBe('none')
    expect(detectVcsTypes(WS)).toEqual([])
  })

  it('terminates without throwing at the filesystem root', () => {
    expect(detectVcsType(join(sep))).toBe('none')
  })
})
