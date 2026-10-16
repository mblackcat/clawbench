import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  getAppVenvPython,
  isWorkbenchVenvReady,
  installAppRequirements,
  extractExternalRequirements,
  buildPipIndexArgs,
  resolvePipIndexUrl
} from '../python-venv.service'
import { settingsStore } from '../../store/settings.store'

// In-memory settings store: keeps tests off the real electron-store file.
vi.mock('../../store/settings.store', () => {
  const data = new Map<string, unknown>()
  return {
    settingsStore: {
      get: (key: string) => data.get(key),
      set: (key: string, value: unknown) => {
        data.set(key, value)
      }
    }
  }
})

describe('python-venv.service', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-venv-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
    vi.restoreAllMocks()
  })

  describe('getAppVenvPython', () => {
    it('returns null when appPath does not exist', () => {
      expect(getAppVenvPython(path.join(tmpDir, 'nonexistent'))).toBeNull()
    })

    it('returns null when no .venv or venv exists in appPath', () => {
      expect(getAppVenvPython(tmpDir)).toBeNull()
    })

    it('detects .venv python when present', () => {
      const venvBinDir = process.platform === 'win32'
        ? path.join(tmpDir, '.venv', 'Scripts')
        : path.join(tmpDir, '.venv', 'bin')
      const pyName = process.platform === 'win32' ? 'python.exe' : 'python'
      fs.mkdirSync(venvBinDir, { recursive: true })
      const pyFile = path.join(venvBinDir, pyName)
      fs.writeFileSync(pyFile, '#!/bin/sh\n')

      const detected = getAppVenvPython(tmpDir)
      expect(detected).toBe(pyFile)
    })

    it('detects venv python when present', () => {
      const venvBinDir = process.platform === 'win32'
        ? path.join(tmpDir, 'venv', 'Scripts')
        : path.join(tmpDir, 'venv', 'bin')
      const pyName = process.platform === 'win32' ? 'python.exe' : 'python'
      fs.mkdirSync(venvBinDir, { recursive: true })
      const pyFile = path.join(venvBinDir, pyName)
      fs.writeFileSync(pyFile, '#!/bin/sh\n')

      const detected = getAppVenvPython(tmpDir)
      expect(detected).toBe(pyFile)
    })
  })

  describe('installAppRequirements', () => {
    it('returns installed=false if requirements.txt does not exist', async () => {
      const result = await installAppRequirements(tmpDir)
      expect(result.success).toBe(true)
      expect(result.installed).toBe(false)
    })

    it('returns installed=false if requirements.txt is empty', async () => {
      fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), '   \n  \n')
      const result = await installAppRequirements(tmpDir)
      expect(result.success).toBe(true)
      expect(result.installed).toBe(false)
    })

    it('instantly marks success when requirements only contain clawbench-sdk', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'requirements.txt'),
        'clawbench-sdk>=1.1.0\n# local SDK only\n'
      )
      const result = await installAppRequirements(tmpDir)
      expect(result.success).toBe(true)
      expect(result.installed).toBe(true)
    })
  })

  describe('extractExternalRequirements', () => {
    it('filters out clawbench-sdk and comments', () => {
      const content = `
clawbench-sdk>=1.1.0
# Comments
pyyaml>=6.0
requests
clawbench_sdk==1.0.0
`
      const deps = extractExternalRequirements(content)
      expect(deps).toEqual(['pyyaml>=6.0', 'requests'])
    })
  })

  describe('extractExternalRequirements edge cases', () => {
    it('keeps packages that merely start with the sdk name', () => {
      expect(extractExternalRequirements('clawbench-sdk-extra==1.0\nclawbench-sdk\n')).toEqual([
        'clawbench-sdk-extra==1.0'
      ])
    })
  })

  describe('pip mirror configuration', () => {
    const originalEnv = process.env.CB_PIP_INDEX_URL

    afterEach(() => {
      settingsStore.set('pipIndexUrl', '')
      if (originalEnv === undefined) delete process.env.CB_PIP_INDEX_URL
      else process.env.CB_PIP_INDEX_URL = originalEnv
    })

    it('defaults to no mirror', () => {
      delete process.env.CB_PIP_INDEX_URL
      expect(resolvePipIndexUrl()).toBe('')
      expect(buildPipIndexArgs()).toEqual([])
    })

    it('uses the settings value, then the env var', () => {
      process.env.CB_PIP_INDEX_URL = 'https://env.example.com/simple/'
      expect(resolvePipIndexUrl()).toBe('https://env.example.com/simple/')
      settingsStore.set('pipIndexUrl', 'https://mirror.example.com/simple/')
      expect(resolvePipIndexUrl()).toBe('https://mirror.example.com/simple/')
    })

    it('ignores non-http(s) values and trusts plain-http hosts', () => {
      settingsStore.set('pipIndexUrl', 'file:///etc/passwd')
      delete process.env.CB_PIP_INDEX_URL
      expect(resolvePipIndexUrl()).toBe('')
      expect(buildPipIndexArgs('http://10.0.0.5:8080/simple/')).toEqual([
        '--index-url',
        'http://10.0.0.5:8080/simple/',
        '--trusted-host',
        '10.0.0.5'
      ])
      expect(buildPipIndexArgs('https://mirror.example.com/simple/')).toEqual([
        '--index-url',
        'https://mirror.example.com/simple/'
      ])
    })
  })
})
