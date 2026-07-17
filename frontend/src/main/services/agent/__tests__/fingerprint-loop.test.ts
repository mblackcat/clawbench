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
    const call = { id: '1', name: 'plan_search', input: { queries: ['x'], reasoning: 'y' } }

    // plan_search is a real tool that executes without side effects
    for (let i = 0; i < MAX_TOOL_DUPLICATES; i++) {
      const batch = await executeAgentToolBatch([{ ...call, id: `c${i}` }], {
        toolsEnabled: true,
        webSearchEnabled: true,
        fingerprints,
      })
      fingerprints = batch.fingerprints
      expect(batch.results[0].isError).toBe(false)
    }
    const last = await executeAgentToolBatch([{ ...call, id: 'blocked' }], {
      toolsEnabled: true,
      webSearchEnabled: true,
      fingerprints,
    })
    expect(last.results[0].isError).toBe(true)
    expect(last.results[0].content).toMatch(/Duplicate|anti-loop/i)
  })
})
