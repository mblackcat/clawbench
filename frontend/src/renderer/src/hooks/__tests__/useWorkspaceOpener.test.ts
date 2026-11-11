import { describe, it, expect } from 'vitest'
import { isVsCodePath, isVsCodeItem, resolveVsCode } from '../useWorkspaceOpener'

describe('useWorkspaceOpener utils', () => {
  describe('isVsCodePath', () => {
    it('detects windows Code.exe', () => {
      expect(isVsCodePath('C:\\Users\\user\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe')).toBe(true)
      expect(isVsCodePath('C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd')).toBe(true)
    })

    it('detects mac / linux code paths', () => {
      expect(isVsCodePath('/Applications/Visual Studio Code.app')).toBe(true)
      expect(isVsCodePath('/usr/bin/code')).toBe(true)
      expect(isVsCodePath('/snap/bin/code')).toBe(true)
    })

    it('returns false for other editors and empty inputs', () => {
      expect(isVsCodePath('')).toBe(false)
      expect(isVsCodePath(null)).toBe(false)
      expect(isVsCodePath(undefined)).toBe(false)
      expect(isVsCodePath('C:\\Program Files\\JetBrains\\PyCharm\\bin\\pycharm64.exe')).toBe(false)
      expect(isVsCodePath('/usr/bin/vim')).toBe(false)
    })
  })

  describe('isVsCodeItem', () => {
    it('matches by id', () => {
      expect(isVsCodeItem({ id: 'vscode', name: 'Visual Studio Code', path: '/opt/code' })).toBe(true)
    })

    it('matches by name', () => {
      expect(isVsCodeItem({ id: 'custom', name: 'VS Code (Community)', path: '/custom/path' })).toBe(true)
      expect(isVsCodeItem({ id: 'custom', name: 'Visual Studio Code Insiders', path: '/custom/path' })).toBe(true)
    })

    it('matches by path', () => {
      expect(isVsCodeItem({ id: 'custom', name: 'My Editor', path: '/usr/local/bin/code' })).toBe(true)
    })

    it('returns false for non-vscode items', () => {
      expect(isVsCodeItem({ id: 'pycharm', name: 'PyCharm', path: '/bin/pycharm' })).toBe(false)
      expect(isVsCodeItem({ id: 'cursor', name: 'Cursor', path: '/bin/cursor' })).toBe(false)
    })
  })

  describe('resolveVsCode', () => {
    it('resolves configured localIdePath if it is VS Code', () => {
      const res = resolveVsCode([], 'C:\\vscode\\Code.exe')
      expect(res.installed).toBe(true)
      expect(res.path).toBe('C:\\vscode\\Code.exe')
    })

    it('resolves from availableIdes when localIdePath is not set or not VS Code', () => {
      const available = [
        { id: 'cursor', name: 'Cursor', path: '/opt/cursor' },
        { id: 'vscode', name: 'Visual Studio Code', path: 'C:\\Programs\\VSCode\\Code.exe' }
      ]
      const res = resolveVsCode(available, '')
      expect(res.installed).toBe(true)
      expect(res.path).toBe('C:\\Programs\\VSCode\\Code.exe')

      const resWithPycharm = resolveVsCode(available, 'C:\\PyCharm\\pycharm64.exe')
      expect(resWithPycharm.installed).toBe(true)
      expect(resWithPycharm.path).toBe('C:\\Programs\\VSCode\\Code.exe')
    })

    it('returns installed false when no VS Code is detected', () => {
      const available = [
        { id: 'cursor', name: 'Cursor', path: '/opt/cursor' },
        { id: 'pycharm', name: 'PyCharm', path: '/opt/pycharm' }
      ]
      const res = resolveVsCode(available, '')
      expect(res.installed).toBe(false)
      expect(res.path).toBeUndefined()
    })
  })
})
