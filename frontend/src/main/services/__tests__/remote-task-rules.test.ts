import { describe, it, expect } from 'vitest'
import {
  compareVersions,
  needsConfirm,
  normalizeRemoteTask,
  planInstall,
  type RemoteTask
} from '../remote-task-rules'

const SHA = 'a'.repeat(64)

function task(overrides: Partial<RemoteTask> = {}): RemoteTask {
  return {
    taskId: 'disp-1',
    appId: 'com.test.cleaner',
    appName: 'Cleaner',
    appVersion: '1.0.0',
    packageSha256: SHA,
    presetParams: { fixIssues: true },
    forceConfirm: false,
    autoInstall: false,
    executionStatus: 'RECEIVED',
    expiresAt: Date.now() + 60_000,
    ...overrides
  }
}

const manifest = {
  version: '1.0.0',
  params: [
    { name: 'fixIssues', type: 'boolean', required: true },
    { name: 'customPath', type: 'path' }
  ]
}

describe('normalizeRemoteTask', () => {
  it('accepts a well-formed task', () => {
    expect(normalizeRemoteTask({ ...task(), extra: 1 })).toMatchObject({ appId: 'com.test.cleaner' })
  })

  it.each([
    ['path traversal app id', { appId: '../evil' }],
    ['slash in app id', { appId: 'a/b' }],
    ['empty app id', { appId: '' }],
    ['bad sha', { packageSha256: 'xyz' }],
    ['non-object params', { presetParams: ['a'] }],
    ['bad version', { appVersion: '1.0.0; rm -rf /' }],
    ['missing task id', { taskId: undefined }]
  ])('rejects %s', (_label, patch) => {
    expect(normalizeRemoteTask({ ...task(), ...patch })).toBeNull()
  })

  it('coerces flags to strict booleans', () => {
    const t = normalizeRemoteTask({ ...task(), forceConfirm: 'yes', autoInstall: 1 })
    expect(t?.forceConfirm).toBe(false)
    expect(t?.autoInstall).toBe(false)
  })
})

describe('compareVersions', () => {
  it('compares numerically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0)
  })
})

describe('planInstall', () => {
  it('runs a matching installed version', () => {
    expect(planInstall(task(), manifest)).toEqual({ action: 'run' })
  })
  it('never downgrades', () => {
    expect(planInstall(task(), { version: '2.0.0' })).toMatchObject({
      action: 'skip',
      reasonCode: 'VERSION_MISMATCH'
    })
  })
  it('upgrades only with autoInstall', () => {
    expect(planInstall(task({ appVersion: '1.1.0' }), manifest)).toMatchObject({ action: 'skip' })
    expect(planInstall(task({ appVersion: '1.1.0', autoInstall: true }), manifest)).toEqual({
      action: 'upgrade'
    })
  })
  it('installs only with autoInstall', () => {
    expect(planInstall(task(), undefined)).toMatchObject({ reasonCode: 'APP_NOT_INSTALLED' })
    expect(planInstall(task({ autoInstall: true }), undefined)).toEqual({ action: 'install' })
  })
})

describe('needsConfirm', () => {
  it('always confirms in the default always-confirm mode', () => {
    expect(needsConfirm(task(), manifest, 'always-confirm')).toBe(true)
  })
  it('runs silently in silent mode when nothing requires confirmation', () => {
    expect(needsConfirm(task(), manifest, 'silent')).toBe(false)
  })
  it('confirms installs/upgrades even in silent mode', () => {
    expect(needsConfirm(task({ installAction: 'install' }), undefined, 'silent')).toBe(true)
    expect(needsConfirm(task({ installAction: 'upgrade' }), manifest, 'silent')).toBe(true)
  })
  it('confirms forceConfirm / confirm_before_run / missing required / sensitive params', () => {
    expect(needsConfirm(task({ forceConfirm: true }), manifest, 'silent')).toBe(true)
    expect(needsConfirm(task(), { ...manifest, confirm_before_run: true }, 'silent')).toBe(true)
    expect(needsConfirm(task({ presetParams: {} }), manifest, 'silent')).toBe(true)
    expect(
      needsConfirm(task({ presetParams: { fixIssues: true, customPath: '/tmp' } }), manifest, 'silent')
    ).toBe(true)
  })
})
