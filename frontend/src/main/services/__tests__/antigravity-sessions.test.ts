import { describe, expect, it, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  listNativeSessions,
  deleteNativeSession,
  invalidateNativeSessionCache,
  NATIVE_SESSION_TOOL_TYPES
} from '../native-sessions.service'

describe('antigravity native sessions', () => {
  const homeKeys = ['HOME', 'USERPROFILE'] as const
  const savedHome = homeKeys.map((k) => process.env[k])
  const tempDirs: string[] = []

  const setupFakeHome = (): string => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-agy-home-'))
    tempDirs.push(home)
    for (const k of homeKeys) process.env[k] = home
    invalidateNativeSessionCache()
    return home
  }

  afterEach(() => {
    homeKeys.forEach((k, i) => {
      if (savedHome[i] === undefined) delete process.env[k]
      else process.env[k] = savedHome[i]
    })
    invalidateNativeSessionCache()
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch { /* ignore */ }
    }
    tempDirs.length = 0
  })

  it('registers antigravity in NATIVE_SESSION_TOOL_TYPES', () => {
    expect(NATIVE_SESSION_TOOL_TYPES).toContain('antigravity')
  })

  it('queries antigravity sessions for a working directory without throwing', async () => {
    const sessions = await listNativeSessions(path.join(os.tmpdir(), 'cb-antigravity-test-project'), 'antigravity')
    expect(Array.isArray(sessions)).toBe(true)
    for (const session of sessions) {
      expect(session.sessionId).toBeDefined()
      expect(typeof session.sessionId).toBe('string')
      expect(typeof session.title).toBe('string')
      expect(typeof session.modifiedAt).toBe('number')
      expect(session.modifiedAt).toBeGreaterThan(0)
    }
  })

  it('handles nonexistent directories gracefully', async () => {
    const sessions = await listNativeSessions('/nonexistent/random/directory', 'antigravity')
    expect(Array.isArray(sessions)).toBe(true)
    expect(sessions).toHaveLength(0)
  })

  it('isolates sessions per workspace and ignores parent-dir or empty-workspace entries', async () => {
    const home = setupFakeHome()
    const agyDir = path.join(home, '.gemini', 'antigravity-cli')
    fs.mkdirSync(agyDir, { recursive: true })

    const wsParent = path.join(home, 'repos')
    const ws1 = path.join(wsParent, 'proj-a')
    const ws2 = path.join(wsParent, 'proj-b')
    const ws3 = path.join(wsParent, 'proj-c')

    const historyLines = [
      JSON.stringify({ conversationId: 'conv-empty-ws', workspace: '', display: 'Ghost No Workspace', timestamp: 1700000001000 }),
      JSON.stringify({ conversationId: 'conv-parent-ws', workspace: wsParent, display: 'Parent Dir Session', timestamp: 1700000002000 }),
      JSON.stringify({ conversationId: 'conv-proj-a', workspace: ws1, display: 'Proj A Only', timestamp: 1700000003000 })
    ]
    fs.writeFileSync(path.join(agyDir, 'history.jsonl'), historyLines.join('\n') + '\n', 'utf-8')

    const s1 = await listNativeSessions(ws1, 'antigravity')
    const s2 = await listNativeSessions(ws2, 'antigravity')
    const s3 = await listNativeSessions(ws3, 'antigravity')

    expect(s1.map((s) => s.sessionId)).toEqual(['conv-proj-a'])
    expect(s2).toEqual([])
    expect(s3).toEqual([])
  })

  it('does not leak Gemini sessions into antigravity or across same-basename workspaces', async () => {
    const home = setupFakeHome()
    const wsTrunk = path.join(home, 'vg1', 'trunk', 'client')
    const wsBranch = path.join(home, 'vg1', 'branch_a', 'client')

    const geminiClientDir = path.join(home, '.gemini', 'tmp', 'client')
    const chatsDir = path.join(geminiClientDir, 'chats')
    fs.mkdirSync(chatsDir, { recursive: true })
    fs.writeFileSync(path.join(geminiClientDir, '.project_root'), wsTrunk, 'utf-8')
    fs.writeFileSync(
      path.join(chatsDir, 'session-1.json'),
      JSON.stringify({
        sessionId: 'gem-1',
        lastUpdated: '2026-05-01T10:00:00Z',
        messages: [{ role: 'user', parts: [{ text: 'Trunk Gemini Chat' }] }]
      }),
      'utf-8'
    )

    // Antigravity must not duplicate Gemini chats
    expect(await listNativeSessions(wsTrunk, 'antigravity')).toEqual([])
    expect(await listNativeSessions(wsBranch, 'antigravity')).toEqual([])

    // Gemini only returns the chat for trunk/client, NOT branch_a/client
    const trunkGemini = await listNativeSessions(wsTrunk, 'gemini')
    const branchGemini = await listNativeSessions(wsBranch, 'gemini')
    expect(trunkGemini.map((s) => s.sessionId)).toEqual(['gem-1'])
    expect(branchGemini).toEqual([])
  })

  it('deletes only the target conversation from antigravity history.jsonl', async () => {
    const home = setupFakeHome()
    const agyDir = path.join(home, '.gemini', 'antigravity-cli')
    fs.mkdirSync(agyDir, { recursive: true })
    const ws = path.join(home, 'repos', 'proj-del')
    const historyFile = path.join(agyDir, 'history.jsonl')
    fs.writeFileSync(
      historyFile,
      [
        JSON.stringify({ conversationId: 'conv-keep', workspace: ws, display: 'Keep me', timestamp: 1700000001000 }),
        JSON.stringify({ conversationId: 'conv-drop', workspace: ws, display: 'Drop me', timestamp: 1700000002000 })
      ].join('\n') + '\n',
      'utf-8'
    )

    const deleted = await deleteNativeSession(ws, 'antigravity', 'conv-drop')
    expect(deleted).toBe(true)

    const remaining = await listNativeSessions(ws, 'antigravity')
    expect(remaining.map((s) => s.sessionId)).toEqual(['conv-keep'])
  })
})
