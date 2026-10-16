import { describe, it, expect, vi, beforeEach } from 'vitest'

const { enrich, FakeDisabledError } = vi.hoisted(() => {
  class FakeDisabledError extends Error {
    i18nKey = 'subapp.appDisabledNamed'
    i18nArgs = ['X']
  }
  return { enrich: vi.fn(), FakeDisabledError }
})

vi.mock('../project.service', () => ({
  BUILTIN_APP_ID_PREFIX: 'com.clawbench.builtin.',
  AppDisabledError: FakeDisabledError,
  enrichBuiltinAppParams: (...args: unknown[]) => enrich(...args)
}))
vi.mock('../../store/auth.store', () => ({
  getUser: () => ({ id: 'u1', name: 'Ann', email: 'a@x', feishuId: 'f1' })
}))
const { resolvePython, installReqs } = vi.hoisted(() => ({ resolvePython: vi.fn(), installReqs: vi.fn() }))
vi.mock('../python-runner.service', () => ({
  resolvePythonCommand: (...args: unknown[]) => resolvePython(...args),
  getI18nPayload: () => ({ i18nKey: 'subapp.pythonNotFound', i18nArgs: [] })
}))
vi.mock('../python-venv.service', () => ({
  installAppRequirements: (...args: unknown[]) => installReqs(...args)
}))
vi.mock('../../utils/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../../utils/i18n', () => ({ mainT: (k: string) => k }))

import { stripReservedParams, gateSubAppRun, prepareSubAppRun } from '../subapp-run.service'

const plain = { appId: 'cb.tool', appName: 'Tool', appPath: '/apps/cb.tool' }
const builtin = { appId: 'com.clawbench.builtin.x', appName: 'X', appPath: '/apps/x' }

beforeEach(() => {
  enrich.mockReset()
  resolvePython.mockReset()
  installReqs.mockReset()
})

describe('stripReservedParams', () => {
  it('drops __ keys and non-object input', () => {
    expect(stripReservedParams({ a: 1, __user: {}, __project: 1, _x: 2 })).toEqual({ a: 1, _x: 2 })
    expect(stripReservedParams(null)).toEqual({})
    expect(stripReservedParams('x')).toEqual({})
    expect(stripReservedParams([1])).toEqual({})
  })
})

describe('gateSubAppRun', () => {
  it('passes non-builtins through without injection', async () => {
    const res = await gateSubAppRun(plain, { a: 1, __user: 'spoof' })
    expect(res).toEqual({ ok: true, params: { a: 1 } })
    expect(enrich).not.toHaveBeenCalled()
  })

  it('enriches builtins and injects __user', async () => {
    enrich.mockImplementation(async (_id, _n, p) => ({ ...p, __app_config: { k: 1 } }))
    const res = await gateSubAppRun(builtin, { a: 1, __app_config: 'spoof' })
    expect(enrich.mock.calls[0][2]).toEqual({ a: 1 })
    expect(res).toMatchObject({
      ok: true,
      params: { a: 1, __app_config: { k: 1 }, __user: { userId: 'u1', feishuId: 'f1' } }
    })
  })

  it('maps the kill-switch to a disabled failure', async () => {
    enrich.mockRejectedValue(new FakeDisabledError('disabled'))
    const res = await gateSubAppRun(builtin, {})
    expect(res).toMatchObject({ ok: false, status: 'disabled', stage: 'gate' })
  })
})

describe('prepareSubAppRun', () => {
  it('resolves Python with the app path and installs deps into it', async () => {
    resolvePython.mockResolvedValue({ path: '/venv/bin/python', version: '3.12', source: 'venv' })
    installReqs.mockResolvedValue({ success: true, installed: true })
    const res = await prepareSubAppRun(plain, { a: 1 })
    expect(resolvePython.mock.calls[0][0]).toBe('/apps/cb.tool')
    expect(installReqs.mock.calls[0][0]).toBe('/apps/cb.tool')
    expect(installReqs.mock.calls[0][1]).toMatchObject({ pythonPath: '/venv/bin/python' })
    expect(res).toMatchObject({ ok: true, params: { a: 1 } })
  })

  it('reports Python failures and treats requirement failures as non-fatal', async () => {
    resolvePython.mockRejectedValueOnce(new Error('no python'))
    expect(await prepareSubAppRun(plain, {})).toMatchObject({ ok: false, stage: 'python', status: 'failed' })

    resolvePython.mockResolvedValue({ path: '/venv/bin/python', version: '3.12', source: 'venv' })
    installReqs.mockResolvedValue({ success: false, installed: false, error: 'boom\nlast line' })
    const out: string[] = []
    const res = await prepareSubAppRun(plain, {}, (m) => out.push(m))
    expect(res.ok).toBe(true)
    expect(out).toContain('pythonVenv.requirementsFailed')
  })
})
