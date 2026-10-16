import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawnMock, spawnSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
  spawnSyncMock: vi.fn()
}))
vi.mock('child_process', () => {
  const mod = { spawn: spawnMock, spawnSync: spawnSyncMock }
  return { ...mod, default: mod }
})
vi.mock('../logger', () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }))

const realPlatform = process.platform
function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

describe('killProcessTrees', () => {
  afterEach(() => {
    setPlatform(realPlatform)
    spawnMock.mockClear()
    spawnSyncMock.mockClear()
  })

  it('Windows: one detached async taskkill for all pids, no sync waits', async () => {
    setPlatform('win32')
    const { killProcessTrees } = await import('../process-tree')
    killProcessTrees([11, undefined, 0, 22])
    expect(spawnSyncMock).not.toHaveBeenCalled()
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '11', '/PID', '22', '/T', '/F'],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
  })

  it('does nothing for an empty pid list', async () => {
    setPlatform('win32')
    const { killProcessTrees } = await import('../process-tree')
    killProcessTrees([])
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
