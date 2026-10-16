import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const h = vi.hoisted(() => ({ root: '', settings: new Map<string, unknown>() }))

vi.mock('../../utils/paths', () => ({
  getBuiltinAppsPath: () => path.join(h.root, 'bundle'),
  getUserAppsPath: () => path.join(h.root, 'user-apps')
}))
vi.mock('../../store/settings.store', () => ({
  settingsStore: {
    get: (k: string) => h.settings.get(k),
    set: (k: string, v: unknown) => h.settings.set(k, v)
  }
}))
vi.mock('../usage-tracking.service', () => ({ reportBuiltinAppInstall: vi.fn() }))
vi.mock('../python-venv.service', () => ({ installAppRequirements: vi.fn(() => Promise.resolve()) }))
vi.mock('../project.service', () => ({ BUILTIN_APP_ID_PREFIX: 'com.clawbench.builtin.' }))
vi.mock('../../utils/logger', () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }))
// Minimal installApp mirroring subapp.service semantics (merge when preserveLocal)
vi.mock('../subapp.service', () => ({
  installApp: (src: string, opts: { preserveLocal?: boolean } = {}) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf-8'))
    const target = path.join(h.root, 'user-apps', manifest.id)
    if (fs.existsSync(target) && !opts.preserveLocal) fs.rmSync(target, { recursive: true })
    fs.cpSync(src, target, { recursive: true })
    return { success: true, manifest, targetDir: target }
  }
}))

import {
  seedBuiltinApps,
  markBuiltinAppRemoved,
  computeFilesToPrune,
  resetBuiltinApp
} from '../builtin-apps.service'

const ID = 'com.clawbench.builtin.demo'
const write = (p: string, c = 'x'): void => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, c)
}
const bundle = (version: string, files: string[]): void => {
  const dir = path.join(h.root, 'bundle', 'demo')
  fs.rmSync(dir, { recursive: true, force: true })
  write(path.join(dir, 'manifest.json'), JSON.stringify({ id: ID, version, name: 'Demo' }))
  for (const f of files) write(path.join(dir, f))
}
const installed = (rel: string): string => path.join(h.root, 'user-apps', ID, rel)

describe('builtin-apps.service', () => {
  beforeEach(() => {
    h.root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-builtin-'))
    h.settings.clear()
  })
  afterEach(() => fs.rmSync(h.root, { recursive: true, force: true }))

  it('does not re-seed a builtin the user removed; reset clears the flag', () => {
    bundle('1.0.0', ['main.py'])
    markBuiltinAppRemoved(ID)
    seedBuiltinApps()
    expect(fs.existsSync(installed('manifest.json'))).toBe(false)

    expect(resetBuiltinApp(ID).success).toBe(true)
    expect(h.settings.get('removedBuiltinApps')).toEqual([])
    expect(fs.existsSync(installed('main.py'))).toBe(true)
  })

  it('upgrade prunes files dropped upstream but keeps user data and user files', () => {
    bundle('1.0.0', ['main.py', 'old_helper.py', 'data/seed.json'])
    seedBuiltinApps()
    write(installed('data/user.db'))
    write(installed('notes.txt'))

    bundle('1.1.0', ['main.py'])
    seedBuiltinApps()
    expect(fs.existsSync(installed('main.py'))).toBe(true)
    expect(fs.existsSync(installed('old_helper.py'))).toBe(false) // removed upstream
    expect(fs.existsSync(installed('data/seed.json'))).toBe(true) // data/ is preserved
    expect(fs.existsSync(installed('data/user.db'))).toBe(true)
    expect(fs.existsSync(installed('notes.txt'))).toBe(true) // never shipped → user file
  })

  it('computeFilesToPrune is a no-op without a record and skips unsafe paths', () => {
    expect(computeFilesToPrune(null, ['a'])).toEqual([])
    expect(computeFilesToPrune(['a', 'b', '../x', 'logs/run.log'], ['a'])).toEqual(['b'])
  })
})
