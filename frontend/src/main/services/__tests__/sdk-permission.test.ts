import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: undefined, app: undefined }))
vi.mock('../ai-terminal.service', () => ({
  executeCommandAndWait: vi.fn(),
  getTerminalOutput: vi.fn(),
  isDBConnected: vi.fn(),
  queryDBReadOnly: vi.fn(),
  executeDB: vi.fn()
}))
vi.mock('../../utils/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))

import { requiresExplicitApproval } from '../sdk-session-manager.service'

describe('requiresExplicitApproval', () => {
  it('flags the terminal exec side-effect tools only', () => {
    expect(requiresExplicitApproval('mcp__clawbench-terminal__run_terminal_command')).toBe(true)
    expect(requiresExplicitApproval('mcp__clawbench-terminal__run_sql_write')).toBe(true)
    expect(requiresExplicitApproval('mcp__clawbench-terminal__run_sql_query')).toBe(false)
    expect(requiresExplicitApproval('mcp__clawbench-terminal__read_terminal_output')).toBe(false)
    expect(requiresExplicitApproval('Edit')).toBe(false)
    expect(requiresExplicitApproval('mcp__other__run_terminal_command')).toBe(false)
  })
})
