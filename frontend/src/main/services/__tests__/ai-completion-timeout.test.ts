import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, app: { getPath: () => '/tmp' } }))
vi.mock('../../store/settings.store', () => ({ settingsStore: { get: vi.fn(), set: vi.fn() } }))

import { runWithTimeout } from '../ai.service'

describe('runWithTimeout', () => {
  it('aborts the signal and rejects when the call hangs', async () => {
    vi.useFakeTimers()
    let seen: AbortSignal | undefined
    const p = runWithTimeout(1000, 'AI completion', (signal) => {
      seen = signal
      return new Promise<string>(() => {})
    })
    const assertion = expect(p).rejects.toThrow('AI completion timed out after 1s')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(seen?.aborted).toBe(true)
    vi.useRealTimers()
  })

  it('resolves normally and clears the timer', async () => {
    vi.useFakeTimers()
    await expect(runWithTimeout(1000, 'x', async () => 'ok')).resolves.toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})
