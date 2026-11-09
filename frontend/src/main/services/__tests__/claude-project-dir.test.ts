import { describe, expect, it, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { listNativeSessions } from '../native-sessions.service'

/** Claude Code's project dir naming: every non-alphanumeric char → "-". */
function claudeDirName(workingDir: string): string {
  return path.resolve(workingDir).replace(/\\/g, '/').replace(/\/+$/, '').replace(/[^a-zA-Z0-9]/g, '-')
}

describe('Claude project dir resolution', () => {
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

  /** Fake home with one Claude session stored under `dirName`. */
  const setupHome = (dirName: string): void => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-claude-home-'))
    tempDirs.push(home)
    for (const k of homeKeys) process.env[k] = home
    const projectDir = path.join(home, '.claude', 'projects', dirName)
    fs.mkdirSync(projectDir, { recursive: true })
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello from session' } })
    fs.writeFileSync(path.join(projectDir, 'abc-session.jsonl'), line + '\n', 'utf-8')
  }

  const workspace = (...segments: string[]): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-ws-'))
    tempDirs.push(root)
    return path.join(root, ...segments)
  }

  it('finds sessions for paths containing underscores', async () => {
    const wd = workspace('vg1_trunk', 'client')
    setupHome(claudeDirName(wd))
    const sessions = await listNativeSessions(wd, 'claude')
    expect(sessions.map((s) => s.title)).toEqual(['hello from session'])
  })

  it('finds sessions for paths containing CJK, dots and spaces', async () => {
    const wd = workspace('项目 v1.2', 'my_app')
    setupHome(claudeDirName(wd))
    const sessions = await listNativeSessions(wd, 'claude')
    expect(sessions).toHaveLength(1)
  })

  it('still finds dirs created with the legacy ":" and "/" rule', async () => {
    const wd = workspace('legacy_dir')
    const legacy = path.resolve(wd).replace(/\\/g, '/').replace(/:/g, '-').replace(/\//g, '-')
    setupHome(legacy)
    const sessions = await listNativeSessions(wd, 'claude')
    expect(sessions).toHaveLength(1)
  })

  it('matches truncated + hashed dir names for very long paths', async () => {
    const wd = workspace('a_'.repeat(60), 'b_'.repeat(60))
    const full = claudeDirName(wd)
    expect(full.length).toBeGreaterThan(200)
    setupHome(`${full.slice(0, 200)}-1x2y3z`)
    const sessions = await listNativeSessions(wd, 'claude')
    expect(sessions).toHaveLength(1)
  })
})
