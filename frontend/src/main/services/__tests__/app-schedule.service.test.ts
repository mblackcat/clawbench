import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AppSchedule } from '../../store/app-schedule.store'

// Mocks
const mockSchedules: AppSchedule[] = []

vi.mock('../../store/app-schedule.store', () => ({
  listAppSchedules: vi.fn(() => mockSchedules),
  updateAppSchedule: vi.fn((id: string, updates: Partial<AppSchedule>) => {
    const idx = mockSchedules.findIndex((s) => s.id === id)
    if (idx !== -1) {
      mockSchedules[idx] = { ...mockSchedules[idx], ...updates, updatedAt: Date.now() }
      return mockSchedules[idx]
    }
    return undefined
  }),
  deleteAppSchedule: vi.fn((id: string) => {
    const idx = mockSchedules.findIndex((s) => s.id === id)
    if (idx !== -1) {
      mockSchedules.splice(idx, 1)
      return true
    }
    return false
  }),
  getAppScheduleByApp: vi.fn((appId: string) => mockSchedules.find((s) => s.appId === appId))
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}))

vi.mock('../subapp.service', () => ({
  getManifest: vi.fn(() => ({ name: 'Test App', version: '1.0.0', entry: 'main.py' })),
  getSubAppPath: vi.fn(() => '/mock/app/path')
}))

vi.mock('../workspace.service', () => ({
  getActiveWorkspace: vi.fn(() => ({ path: '/mock/workspace', name: 'test' }))
}))

interface MockCallbacks {
  onOutput?: (message: string, level: string) => void
  onProgress?: (percent: number, message: string) => void
  onComplete?: (success: boolean, summary: string, cancelled?: boolean) => void
}

const mockExecuteCallbacks = vi.fn()
vi.mock('../subapp-run.service', () => ({
  prepareSubAppRun: vi.fn(async (_target: unknown, params: Record<string, unknown>) => ({
    ok: true,
    params,
    python: { path: 'python', version: 'Python 3.12.0', source: 'system' }
  }))
}))

vi.mock('../python-runner.service', () => ({
  executeSubAppWithCallbacks: vi.fn((...args: unknown[]) => {
    mockExecuteCallbacks(...args)
  })
}))

vi.mock('../../utils/paths', () => ({
  getPythonSdkPath: vi.fn(() => '/mock/sdk/path')
}))

vi.mock('../../utils/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

import {
  initAppScheduler,
  stopAppScheduler,
  executeAppSchedule
} from '../app-schedule.service'

describe('app-schedule.service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSchedules.length = 0
    mockExecuteCallbacks.mockClear()
    stopAppScheduler()
  })

  afterEach(() => {
    stopAppScheduler()
    vi.useRealTimers()
  })

  it('does NOT trigger execution twice when task takes longer than 60 seconds', async () => {
    const baseTime = new Date('2026-09-30T09:59:00.000Z').getTime()
    vi.setSystemTime(baseTime)

    const runTime = new Date('2026-09-30T10:00:00.000Z').getTime()
    mockSchedules.push({
      id: 'sched-1',
      appId: 'com.test.my-app',
      appName: 'Test App',
      enabled: true,
      repeatRule: 'daily',
      time: '10:00',
      params: {},
      nextRunAt: runTime,
      lastRunAt: new Date('2026-09-29T10:00:00.000Z').getTime(),
      createdAt: baseTime,
      updatedAt: baseTime
    })

    let capturedCallbacks: MockCallbacks | undefined
    mockExecuteCallbacks.mockImplementation((...args: unknown[]) => {
      capturedCallbacks = args[10] as MockCallbacks
    })

    initAppScheduler()

    expect(mockExecuteCallbacks).toHaveBeenCalledTimes(0)

    // Advance time to 10:00:00
    vi.advanceTimersByTime(60_000)
    await Promise.resolve()

    expect(mockExecuteCallbacks).toHaveBeenCalledTimes(1)

    // Verify nextRunAt was advanced immediately upon trigger
    expect(mockSchedules[0].nextRunAt).toBeGreaterThan(runTime)

    // Advance by another 60 seconds while task is still running
    vi.advanceTimersByTime(60_000)
    await Promise.resolve()

    // Must NOT be executed twice
    expect(mockExecuteCallbacks).toHaveBeenCalledTimes(1)

    // Task completes
    const cb1 = capturedCallbacks as MockCallbacks | undefined
    cb1?.onComplete?.(true, 'Done', false)
    // Advance time
    vi.advanceTimersByTime(60_000)
    await Promise.resolve()

    expect(mockExecuteCallbacks).toHaveBeenCalledTimes(1)
  })

  it('deduplicates multiple schedule entries for the same appId', async () => {
    const baseTime = new Date('2026-09-30T09:59:00.000Z').getTime()
    vi.setSystemTime(baseTime)

    const runTime = new Date('2026-09-30T10:00:00.000Z').getTime()
    // Two schedule records with identical appId (store dirty data scenario)
    mockSchedules.push(
      {
        id: 'sched-dup-1',
        appId: 'com.test.dup-app',
        appName: 'Dup App 1',
        enabled: true,
        repeatRule: 'daily',
        time: '10:00',
        params: {},
        nextRunAt: runTime,
        createdAt: baseTime,
        updatedAt: baseTime
      },
      {
        id: 'sched-dup-2',
        appId: 'com.test.dup-app',
        appName: 'Dup App 2',
        enabled: true,
        repeatRule: 'daily',
        time: '10:00',
        params: {},
        nextRunAt: runTime,
        createdAt: baseTime,
        updatedAt: baseTime
      }
    )

    initAppScheduler()

    // Advance time to 10:00:00
    vi.advanceTimersByTime(60_000)
    await Promise.resolve()

    // Should only trigger ONCE, not twice for the duplicate entry
    expect(mockExecuteCallbacks).toHaveBeenCalledTimes(1)
  })

  it('rejects concurrent manual execution while schedule is running', async () => {
    const baseTime = new Date('2026-09-30T10:00:00.000Z').getTime()
    vi.setSystemTime(baseTime)

    const schedule: AppSchedule = {
      id: 'sched-concurrent',
      appId: 'com.test.concurrent-app',
      appName: 'Concurrent App',
      enabled: true,
      repeatRule: 'daily',
      time: '10:00',
      params: {},
      nextRunAt: baseTime,
      createdAt: baseTime,
      updatedAt: baseTime
    }
    mockSchedules.push(schedule)

    let capturedCallbacks: MockCallbacks | undefined
    mockExecuteCallbacks.mockImplementation((...args: unknown[]) => {
      capturedCallbacks = args[10] as MockCallbacks
    })

    // First manual execution starts
    await executeAppSchedule(schedule)
    expect(mockExecuteCallbacks).toHaveBeenCalledTimes(1)

    // Second manual execution while still running should reject
    await expect(executeAppSchedule(schedule)).rejects.toThrow(/already running/)

    // Complete first execution
    const cb2 = capturedCallbacks as MockCallbacks | undefined
    cb2?.onComplete?.(true, 'Done', false)
    // Third execution should succeed now that first is done
    await executeAppSchedule(schedule)
    expect(mockExecuteCallbacks).toHaveBeenCalledTimes(2)
  })
})
