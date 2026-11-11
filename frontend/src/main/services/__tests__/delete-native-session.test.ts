import { describe, expect, it, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { deleteNativeSession } from '../native-sessions.service'

describe('deleteNativeSession', () => {
  const homeKeys = ['HOME', 'USERPROFILE'] as const
  const savedHome = homeKeys.map((k) => process.env[k])
  const tempDirs: string[] = []

  afterEach(() => {
    homeKeys.forEach((k, i) => {
      if (savedHome[i] === undefined) delete process.env[k]
      else process.env[k] = savedHome[i]
    })
    for (const dir of tempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
    tempDirs.length = 0
  })

  /** Point os.homedir() at a throwaway dir so nothing real is touched. */
  const fakeHome = (): string => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-native-del-'))
    tempDirs.push(home)
    for (const k of homeKeys) process.env[k] = home
    return home
  }

  it('handles nonexistent session gracefully', async () => {
    const home = fakeHome()
    const result = await deleteNativeSession(home, 'claude', 'nonexistent-session-id-12345')
    expect(result).toBe(false)
  })

  it('deletes Claude session file and directory', async () => {
    const home = fakeHome()
    const projectDir = path.join(home, '.claude', 'projects', 'some-project')
    fs.mkdirSync(projectDir, { recursive: true })

    const sessionId = 'test-session-claude-del'
    const sessionFile = path.join(projectDir, `${sessionId}.jsonl`)
    const sessionDir = path.join(projectDir, sessionId)
    const otherFile = path.join(projectDir, `${sessionId}-other.jsonl`)
    fs.writeFileSync(sessionFile, '{"type":"user","message":"hello"}\n', 'utf-8')
    fs.writeFileSync(otherFile, '{"type":"user","message":"keep"}\n', 'utf-8')
    fs.mkdirSync(sessionDir, { recursive: true })

    const deleted = await deleteNativeSession('/dummy/cwd', 'claude', sessionId)
    expect(deleted).toBe(true)
    expect(fs.existsSync(sessionFile)).toBe(false)
    expect(fs.existsSync(sessionDir)).toBe(false)
    expect(fs.existsSync(otherFile)).toBe(true)
  })

  it('refuses short or path-like ids', async () => {
    const home = fakeHome()
    const projectDir = path.join(home, '.claude', 'projects', 'p')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'abc.jsonl'), '{}\n', 'utf-8')

    expect(await deleteNativeSession(home, 'claude', 'abc')).toBe(false)
    expect(await deleteNativeSession(home, 'claude', '../../etc/passwd')).toBe(false)
    expect(fs.existsSync(path.join(projectDir, 'abc.jsonl'))).toBe(true)
  })

  it('only deletes the exact Codex rollout for the id', async () => {
    const home = fakeHome()
    const dayDir = path.join(home, '.codex', 'sessions', '2026', '11', '09')
    fs.mkdirSync(dayDir, { recursive: true })
    const id = '019a0000-1111-2222-3333-444455556666'
    const target = path.join(dayDir, `rollout-2026-11-09T10-00-00-${id}.jsonl`)
    const other = path.join(dayDir, 'rollout-2026-11-09T11-00-00-019a0000-1111-2222-3333-999999999999.jsonl')
    fs.writeFileSync(target, '{}\n', 'utf-8')
    fs.writeFileSync(other, '{}\n', 'utf-8')

    expect(await deleteNativeSession(home, 'codex', id)).toBe(true)
    expect(fs.existsSync(target)).toBe(false)
    expect(fs.existsSync(other)).toBe(true)
  })
})
