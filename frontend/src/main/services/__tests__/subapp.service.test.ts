import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const roots = { user: '', def: '' }

vi.mock('../../utils/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../../utils/paths', () => ({
  getUserAppsPath: () => roots.user,
  getDefaultUserAppsPath: () => roots.def
}))

import {
  validateManifestId,
  checkExpectedManifestId,
  isStrictlyInside,
  installApp,
  uninstallApp
} from '../subapp.service'

let tmp: string

function makeSource(manifest: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(tmp, 'src-'))
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(1)')
  return dir
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'subapp-test-'))
  roots.user = path.join(tmp, 'user-apps')
  roots.def = roots.user
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('validateManifestId', () => {
  it('accepts normal ids', () => {
    for (const id of ['com.clawbench.builtin.x', 'cb.user.app-1', 'A_b', '0abc']) {
      expect(validateManifestId(id)).toBeNull()
    }
  })

  it('rejects traversal, separators and empty ids', () => {
    for (const id of ['', '..', '../x', 'a/../b', 'a/b', 'a\\b', '.hidden', 'a..b', '-x', 'a b', 'C:', 42, undefined]) {
      expect(validateManifestId(id)).not.toBeNull()
    }
  })
})

describe('checkExpectedManifestId', () => {
  it('requires the requested id to match', () => {
    expect(checkExpectedManifestId('cb.a', 'cb.a')).toBeNull()
    expect(checkExpectedManifestId('cb.other', 'cb.a')).not.toBeNull()
  })

  it('tolerates legacy UUID market ids except for builtin claims', () => {
    const uuid = '3f2a6c1e-1b2c-4d5e-8f90-0123456789ab'
    expect(checkExpectedManifestId('cb.a', uuid)).toBeNull()
    expect(checkExpectedManifestId('com.clawbench.builtin.x', uuid)).not.toBeNull()
  })
})

describe('isStrictlyInside', () => {
  it('only accepts strict descendants', () => {
    expect(isStrictlyInside('/a/b', '/a/b/c')).toBe(true)
    expect(isStrictlyInside('/a/b', '/a/b')).toBe(false)
    expect(isStrictlyInside('/a/b', '/a/bc')).toBe(false)
    expect(isStrictlyInside('/a/b', '/a/b/../c')).toBe(false)
  })
})

describe('installApp / uninstallApp', () => {
  it('installs a valid app under its manifest id', () => {
    const src = makeSource({ id: 'cb.ok', name: 'Ok', version: '1.0.0', entry: 'main.py' })
    const res = installApp(src, { expectedId: 'cb.ok' })
    expect(res.success).toBe(true)
    expect(fs.existsSync(path.join(roots.user, 'cb.ok', 'main.py'))).toBe(true)
  })

  it('rejects a traversal manifest id without touching anything outside', () => {
    const victim = path.join(tmp, 'victim')
    fs.mkdirSync(victim)
    const src = makeSource({ id: '../victim', name: 'Evil', version: '1', entry: 'main.py' })
    const res = installApp(src)
    expect(res.success).toBe(false)
    expect(fs.existsSync(victim)).toBe(true)
  })

  it('rejects a package whose manifest id differs from the requested id', () => {
    const src = makeSource({ id: 'cb.other', name: 'X', version: '1', entry: 'main.py' })
    expect(installApp(src, { expectedId: 'cb.wanted' }).success).toBe(false)
  })

  it('uninstalls apps inside the managed root', () => {
    const src = makeSource({ id: 'cb.rm', name: 'Rm', version: '1', entry: 'main.py' })
    installApp(src)
    expect(uninstallApp('cb.rm').success).toBe(true)
    expect(fs.existsSync(path.join(roots.user, 'cb.rm'))).toBe(false)
  })
})
