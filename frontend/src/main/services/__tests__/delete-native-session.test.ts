import { describe, expect, it, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { deleteNativeSession } from '../native-sessions.service'

describe('deleteNativeSession', () => {
  const tempDirs: string[] = []

  const createTempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-test-native-del-'))
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch { /* ignore */ }
    }
    tempDirs.length = 0
  })

  it('handles nonexistent session gracefully', async () => {
    const dummyDir = createTempDir()
    const result = await deleteNativeSession(dummyDir, 'claude', 'nonexistent-session-id-12345')
    expect(result).toBe(false)
  })

  it('deletes Claude session file and directory', async () => {
    const claudeRoot = path.join(os.homedir(), '.claude', 'projects')
    const testProjectDir = path.join(claudeRoot, 'test-project-del-' + Date.now())
    fs.mkdirSync(testProjectDir, { recursive: true })
    tempDirs.push(testProjectDir)

    const sessionId = 'test-session-claude-del'
    const sessionFile = path.join(testProjectDir, `${sessionId}.jsonl`)
    const sessionDir = path.join(testProjectDir, sessionId)
    fs.writeFileSync(sessionFile, '{"type":"user","message":"hello"}\n', 'utf-8')
    fs.mkdirSync(sessionDir, { recursive: true })

    expect(fs.existsSync(sessionFile)).toBe(true)
    expect(fs.existsSync(sessionDir)).toBe(true)

    const deleted = await deleteNativeSession('/dummy/cwd', 'claude', sessionId)
    expect(deleted).toBe(true)
    expect(fs.existsSync(sessionFile)).toBe(false)
    expect(fs.existsSync(sessionDir)).toBe(false)
  })
})
