import { describe, it, expect } from 'vitest'
import {
  checkAndRecordFingerprint,
  toolCallFingerprint,
  MAX_TOOL_DUPLICATES,
  executeAgentToolBatch,
} from '../agent-tools'

describe('checkAndRecordFingerprint (shipped anti-spin helper)', () => {
  it('allows first MAX_TOOL_DUPLICATES identical calls then blocks', () => {
    const fp: Record<string, number> = {}
    const input = { query: 'same' }
    for (let i = 0; i < MAX_TOOL_DUPLICATES; i++) {
      const r = checkAndRecordFingerprint(fp, 'web_search', input)
      expect(r.blocked).toBe(false)
    }
    const blocked = checkAndRecordFingerprint(fp, 'web_search', input)
    expect(blocked.blocked).toBe(true)
    expect(blocked.fingerprint).toBe(toolCallFingerprint('web_search', input))
  })

  it('does not treat different inputs as duplicates', () => {
    const fp: Record<string, number> = {}
    expect(checkAndRecordFingerprint(fp, 'web_search', { query: 'a' }).blocked).toBe(false)
    expect(checkAndRecordFingerprint(fp, 'web_search', { query: 'b' }).blocked).toBe(false)
  })

  it('persists across sequential batch calls (loop-scoped map)', async () => {
    // Simulate two IPC steps with the same fingerprints bag (builtin hybrid contract)
    let fingerprints: Record<string, number> = {}
    // Use a pure fingerprint bag without network: only checkAndRecord across "batches"
    const callName = 'web_search'
    const input = { query: 'same-query-for-anti-spin' }
    for (let i = 0; i < MAX_TOOL_DUPLICATES; i++) {
      const r = checkAndRecordFingerprint(fingerprints, callName, input)
      expect(r.blocked).toBe(false)
    }
    const blocked = checkAndRecordFingerprint(fingerprints, callName, input)
    expect(blocked.blocked).toBe(true)
    // Also verify executeAgentToolBatch respects pre-seeded fingerprints
    const last = await executeAgentToolBatch(
      [{ id: 'blocked', name: callName, input }],
      { toolsEnabled: true, webSearchEnabled: true, fingerprints }
    )
    expect(last.results[0].isError).toBe(true)
    expect(last.results[0].content).toMatch(/Duplicate|anti-loop/i)
  })
})
