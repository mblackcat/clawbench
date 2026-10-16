import * as os from 'os'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { listNativeSessions, NATIVE_SESSION_TOOL_TYPES } from '../native-sessions.service'

describe('antigravity native sessions', () => {
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
})
