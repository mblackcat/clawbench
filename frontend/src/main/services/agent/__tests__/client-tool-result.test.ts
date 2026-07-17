import { describe, it, expect } from 'vitest'
import {
  resolveClientToolResult,
} from '../agent-query.service'

/**
 * Client tool results may arrive before the loop registers a waiter
 * (tool_use event races with execute). resolveClientToolResult must buffer them.
 * We only unit-test the exported resolve path: buffer then cannot double-resolve
 * via re-export wait — wait is private; instead assert resolve returns true
 * when buffering early results.
 */
describe('resolveClientToolResult (shipped race buffer)', () => {
  it('accepts early results without a pre-registered waiter', () => {
    const taskId = 'task-test-early'
    const toolCallId = 'tc-1'
    const ok = resolveClientToolResult(taskId, toolCallId, 'hello from client', false)
    expect(ok).toBe(true)
    // Second resolve for same key still succeeds (overwrites buffer)
    expect(resolveClientToolResult(taskId, toolCallId, 'updated', true)).toBe(true)
  })
})
