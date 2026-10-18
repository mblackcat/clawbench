import * as fs from 'fs'
import * as path from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const { HOME } = vi.hoisted(() => {
  const nodeOs = require('os') as typeof import('os')
  const nodeFs = require('fs') as typeof import('fs')
  const nodePath = require('path') as typeof import('path')
  return { HOME: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'cb-native-home-')) }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => HOME }
})

import { invalidateNativeSessionCache, listNativeSessions } from '../native-sessions.service'

const WORKDIR = path.join(HOME, 'project')
const claudeLine = (text: string): string =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text } })

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true })
})

describe('native sessions: title cache survives live-session writes', () => {
  it('claude: does not re-read a titled transcript when only its mtime changes', async () => {
    const hash = path.resolve(WORKDIR).replace(/\\/g, '/').replace(/:/g, '-').replace(/\//g, '-')
    const dir = path.join(HOME, '.claude', 'projects', hash)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'aaaaaaaa-1111.jsonl')
    // No slug anywhere — matches current Claude Code transcripts.
    fs.writeFileSync(file, `${claudeLine('fix the login bug')}\n${claudeLine('second prompt')}\n`)

    const first = await listNativeSessions(WORKDIR, 'claude')
    expect(first.map((s) => s.title)).toEqual(['fix the login bug'])

    // The live session appends output; a re-parse would now see a different
    // first prompt. The cached title must be served instead.
    fs.writeFileSync(file, `${claudeLine('rewritten head')}\n`)
    const later = new Date(Date.now() + 5_000)
    fs.utimesSync(file, later, later)

    invalidateNativeSessionCache() // skip the 3s list TTL; exercise the per-file cache
    const second = await listNativeSessions(WORKDIR, 'claude')
    expect(second.map((s) => s.title)).toEqual(['fix the login bug'])
    expect(Math.abs(second[0].modifiedAt - later.getTime())).toBeLessThan(1000)
  })

  it('codex: walks nested session dirs asynchronously and filters by cwd', async () => {
    const dayDir = path.join(HOME, '.codex', 'sessions', '2026', '10', '18')
    fs.mkdirSync(dayDir, { recursive: true })
    const meta = (id: string, cwd: string): string =>
      JSON.stringify({ type: 'session_meta', payload: { id, cwd } })
    const prompt = (text: string): string =>
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })
    fs.writeFileSync(path.join(dayDir, 'rollout-a.jsonl'), `${meta('codex-a', WORKDIR)}\n${prompt('add tests')}\n`)
    fs.writeFileSync(path.join(dayDir, 'rollout-b.jsonl'), `${meta('codex-b', '/elsewhere')}\n${prompt('other')}\n`)

    const sessions = await listNativeSessions(WORKDIR, 'codex')
    expect(sessions.map((s) => [s.sessionId, s.title])).toEqual([['codex-a', 'add tests']])
  })
})
