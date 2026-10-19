import { describe, expect, it } from 'vitest'
import { brewArgs, brewOwnerMatchesBinaries, parseBrewOwner } from '../brew-owner'

describe('parseBrewOwner', () => {
  it('reads formula names from Cellar paths (incl. third-party taps)', () => {
    expect(parseBrewOwner('/opt/homebrew/Cellar/omp/18.1.2/bin/omp')).toEqual({ kind: 'formula', name: 'omp' })
    expect(parseBrewOwner('/usr/local/Cellar/gemini-cli/0.9.0/libexec/bin/gemini')).toEqual({ kind: 'formula', name: 'gemini-cli' })
    expect(parseBrewOwner('/home/linuxbrew/.linuxbrew/Cellar/opencode/1.2.3/bin/opencode')).toEqual({ kind: 'formula', name: 'opencode' })
    expect(parseBrewOwner('/opt/homebrew/Cellar/postgresql@16/16.4/bin/psql')).toEqual({ kind: 'formula', name: 'postgresql@16' })
  })

  it('reads cask names from Caskroom paths', () => {
    expect(parseBrewOwner('/opt/homebrew/Caskroom/codex/0.50.0/codex-aarch64-apple-darwin')).toEqual({ kind: 'cask', name: 'codex' })
    expect(parseBrewOwner('/opt/homebrew/Caskroom/antigravity-cli/1.0.0/agy')).toEqual({ kind: 'cask', name: 'antigravity-cli' })
  })

  it('ignores paths that only sit inside a brew prefix', () => {
    expect(parseBrewOwner('/opt/homebrew/lib/node_modules/@google/gemini-cli/dist/index.js')).toBeNull()
    expect(parseBrewOwner('/opt/homebrew/bin/omp')).toBeNull()
    expect(parseBrewOwner('/Users/me/.local/bin/omp')).toBeNull()
    expect(parseBrewOwner('/Users/me/.local/share/omp/18.12.2/omp')).toBeNull()
    expect(parseBrewOwner('')).toBeNull()
    // Needs a version segment below the package dir
    expect(parseBrewOwner('/opt/homebrew/Cellar/omp')).toBeNull()
  })

  it('handles Windows-style separators without matching', () => {
    expect(parseBrewOwner('C:\\Users\\me\\AppData\\Local\\omp\\omp.exe')).toBeNull()
  })
})

describe('brewOwnerMatchesBinaries', () => {
  const formula = (name: string) => ({ kind: 'formula' as const, name })

  it('accepts packages named after the binary', () => {
    expect(brewOwnerMatchesBinaries(formula('omp'), ['omp'])).toBe(true)
    expect(brewOwnerMatchesBinaries(formula('gemini-cli'), ['gemini'])).toBe(true)
    expect(brewOwnerMatchesBinaries({ kind: 'cask', name: 'antigravity-cli' }, ['agy', 'antigravity'])).toBe(true)
    expect(brewOwnerMatchesBinaries(formula('qoder'), ['qodercli', 'qoder'])).toBe(true)
    expect(brewOwnerMatchesBinaries(formula('qoder-cli'), ['qodercli'])).toBe(true)
    expect(brewOwnerMatchesBinaries(formula('OMP'), ['omp'])).toBe(true)
  })

  it('rejects unrelated packages that ship a same-named binary', () => {
    expect(brewOwnerMatchesBinaries(formula('node'), ['omp'])).toBe(false)
    expect(brewOwnerMatchesBinaries(formula('go'), ['gofoo'])).toBe(false)
    expect(brewOwnerMatchesBinaries(formula('python@3.12'), ['codex'])).toBe(false)
  })
})

describe('brewArgs', () => {
  it('adds --cask only for casks', () => {
    expect(brewArgs('upgrade', { kind: 'formula', name: 'omp' })).toEqual(['upgrade', 'omp'])
    expect(brewArgs('uninstall', { kind: 'cask', name: 'codex' })).toEqual(['uninstall', '--cask', 'codex'])
  })
})
