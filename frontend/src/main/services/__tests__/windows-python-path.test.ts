import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'child_process'
import {
  ensureWindowsPythonPathPriority,
  isWindowsAppsPath,
  isPythonPathEntry,
  reorderWindowsPathEntries,
  reorderWindowsPathString
} from '../../utils/windows-env'

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, execFile: vi.fn() }
})

describe('windows-python-path', () => {
  describe('isWindowsAppsPath', () => {
    it('detects standard WindowsApps paths with varying casing and slashes', () => {
      expect(isWindowsAppsPath('C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps')).toBe(true)
      expect(isWindowsAppsPath('C:/Users/alice/AppData/Local/Microsoft/WindowsApps/')).toBe(true)
      expect(isWindowsAppsPath('%LOCALAPPDATA%\\Microsoft\\WindowsApps')).toBe(true)
      expect(isWindowsAppsPath('%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps')).toBe(true)
    })

    it('returns false for non-WindowsApps paths', () => {
      expect(isWindowsAppsPath('C:\\Python313')).toBe(false)
      expect(isWindowsAppsPath('C:\\Program Files\\Git\\bin')).toBe(false)
      expect(isWindowsAppsPath('')).toBe(false)
    })
  })

  describe('isPythonPathEntry', () => {
    it('detects standard Python and Scripts folders', () => {
      expect(
        isPythonPathEntry('C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python313\\Scripts')
      ).toBe(true)
      expect(
        isPythonPathEntry('C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python313')
      ).toBe(true)
      expect(isPythonPathEntry('C:\\Python312')).toBe(true)
      expect(isPythonPathEntry('C:\\Python312\\Scripts')).toBe(true)
      expect(isPythonPathEntry('C:\\Users\\alice\\miniconda3\\Scripts')).toBe(true)
      expect(isPythonPathEntry('C:\\Users\\alice\\.pyenv\\pyenv-win\\shims')).toBe(true)
    })

    it('never treats WindowsApps as a real Python directory', () => {
      expect(isPythonPathEntry('C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps')).toBe(false)
    })
  })

  describe('reorderWindowsPathEntries', () => {
    it('moves Python and Scripts entries ahead of WindowsApps when installed after', () => {
      const initial = [
        'C:\\Windows\\system32',
        'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps',
        'D:\\Tools\\bin',
        'C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python313\\Scripts',
        'C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python313'
      ]

      const { reordered, changed } = reorderWindowsPathEntries(initial)
      expect(changed).toBe(true)

      const winAppsIdx = reordered.findIndex((p) => isWindowsAppsPath(p))
      const scriptsIdx = reordered.findIndex((p) => p.includes('Scripts'))
      const pythonIdx = reordered.findIndex((p) => p.endsWith('Python313'))

      expect(winAppsIdx).toBeGreaterThan(-1)
      expect(scriptsIdx).toBeLessThan(winAppsIdx)
      expect(pythonIdx).toBeLessThan(winAppsIdx)

      // Other tools before WindowsApps remain before, other tools after remain after
      expect(reordered[0]).toBe('C:\\Windows\\system32')
      expect(reordered).toContain('D:\\Tools\\bin')
    })

    it('keeps order intact if Python already precedes WindowsApps', () => {
      const initial = [
        'C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python313\\Scripts',
        'C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python313',
        'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps',
        'D:\\Tools\\bin'
      ]

      const { reordered, changed } = reorderWindowsPathEntries(initial)
      expect(changed).toBe(false)
      expect(reordered).toEqual(initial)
    })

    it('inserts extra discovered Python directories before WindowsApps if missing from PATH', () => {
      const initial = [
        'C:\\Windows\\system32',
        'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps'
      ]
      const extras = [
        'C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python313\\Scripts',
        'C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python313'
      ]

      const { reordered, changed } = reorderWindowsPathEntries(initial, extras)
      expect(changed).toBe(true)

      const winAppsIdx = reordered.findIndex((p) => isWindowsAppsPath(p))
      expect(reordered.indexOf(extras[0])).toBeLessThan(winAppsIdx)
      expect(reordered.indexOf(extras[1])).toBeLessThan(winAppsIdx)
      expect(reordered[0]).toBe('C:\\Windows\\system32')
    })
  })

  describe('reorderWindowsPathString', () => {
    it('corrects semicolon separated path strings', () => {
      const pathStr =
        'C:\\Windows;%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Python313'
      const { newPath, changed } = reorderWindowsPathString(pathStr)
      expect(changed).toBe(true)
      expect(newPath).toBe(
        'C:\\Windows;C:\\Python313;%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps'
      )
    })
  })

  describe('ensureWindowsPythonPathPriority (default = process PATH only)', () => {
    const originalPlatform = process.platform
    const originalPath = process.env.PATH

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
      process.env.PATH = originalPath
      vi.mocked(execFile).mockClear()
    })

    it('is a no-op off Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const before = process.env.PATH
      const res = await ensureWindowsPythonPathPriority(['C:\\Python313'])
      expect(res).toEqual({ changed: false, persisted: false })
      expect(process.env.PATH).toBe(before)
    })

    it('reorders only the process PATH and never spawns PowerShell / touches the registry', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      process.env.PATH =
        'C:\\Windows;C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Python313'
      const res = await ensureWindowsPythonPathPriority(['C:\\Python313'])
      expect(res).toEqual({ changed: true, persisted: false })
      expect(process.env.PATH).toBe(
        'C:\\Windows;C:\\Python313;C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps'
      )
      expect(execFile).not.toHaveBeenCalled()
    })
  })
})
