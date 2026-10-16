import { describe, expect, it } from 'vitest'
import {
  hasParentSegment,
  validateCommand,
  validateDirPath,
  validateEffort,
  validateFilePath,
  validateId,
  validateImageData,
  validatePermissionMode,
  validatePtyDimensions,
  validateToolType
} from '../ipc-validation'

describe('ipc-validation', () => {
  it('accepts every AI coding tool id and rejects unknown ones', () => {
    for (const id of [
      'claude', 'codex', 'gemini', 'grok', 'opencode', 'trae', 'qoder',
      'kimi', 'zcode', 'mimo', 'terminal', 'qwen'
    ]) {
      expect(validateToolType(id)).toBe(true)
    }
    expect(validateToolType('nope')).toBe(false)
    expect(validateToolType(1)).toBe(false)
  })

  it('accepts the permission modes the renderer actually sends', () => {
    // Claude SDK runtime modes + Codex modes (toRuntimePermissionMode)
    for (const m of [
      'default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk',
      'ask', 'approve-for-me', 'full-access'
    ]) {
      expect(validatePermissionMode(m)).toBe(true)
    }
    expect(validatePermissionMode('always-allow')).toBe(false)
    expect(validatePermissionMode(undefined)).toBe(false)
  })

  it('validates effort levels incl. ultracode', () => {
    expect(validateEffort('ultracode')).toBe(true)
    expect(validateEffort('xhigh')).toBe(true)
    expect(validateEffort('extreme')).toBe(false)
  })

  it('validates ids', () => {
    expect(validateId('3f2a-uuid_1')).toBe(true)
    expect(validateId('ses_01.abc:2')).toBe(true)
    expect(validateId('')).toBe(false)
    expect(validateId('..')).toBe(false)
    expect(validateId('a/b')).toBe(false)
    expect(validateId('a'.repeat(201))).toBe(false)
  })

  describe('paths', () => {
    it('accepts names that merely contain ".."', () => {
      expect(validateDirPath('/Users/me/my..project')).toBe('/Users/me/my..project')
      expect(validateFilePath('/tmp/v1..2/notes..md')).toBe('/tmp/v1..2/notes..md')
      expect(validateDirPath('..hidden')).toBe('..hidden')
    })

    it('accepts Windows drive, UNC and CJK paths', () => {
      expect(validateDirPath('C:\\Users\\me\\项目 A')).toBe('C:\\Users\\me\\项目 A')
      expect(validateFilePath('D:/work/a.txt')).toBe('D:/work/a.txt')
      expect(validateDirPath('\\\\server\\share\\dir')).toBe('\\\\server\\share\\dir')
    })

    it('rejects ".." segments unless explicitly allowed', () => {
      expect(validateDirPath('/a/../b')).toBeNull()
      expect(validateDirPath('C:\\a\\..\\b')).toBeNull()
      expect(validateDirPath('..')).toBeNull()
      expect(validateDirPath('/a/../b', { allowParentSegments: true })).toBe('/a/../b')
      expect(hasParentSegment('a/..b/c')).toBe(false)
    })

    it('rejects empty, non-string and control characters', () => {
      expect(validateDirPath('')).toBeNull()
      expect(validateDirPath('   ')).toBeNull()
      expect(validateDirPath(42)).toBeNull()
      expect(validateFilePath('/tmp/a\0b')).toBeNull()
      expect(validateFilePath('/tmp/a\nb')).toBeNull()
    })
  })

  it('keeps commands to sanity checks only', () => {
    expect(validateCommand('echo `date` | grep 1 && ls $(pwd)')).toBe('echo `date` | grep 1 && ls $(pwd)')
    expect(validateCommand('claude --resume\n')).toBe('claude --resume\n')
    expect(validateCommand('a\0b')).toBeNull()
    expect(validateCommand('x'.repeat(10_001))).toBeNull()
    expect(validateCommand(null)).toBeNull()
  })

  it('validates PTY dimensions', () => {
    expect(validatePtyDimensions(80, 24)).toEqual({ cols: 80, rows: 24 })
    expect(validatePtyDimensions('120', '5')).toEqual({ cols: 120, rows: 5 })
    expect(validatePtyDimensions(0, 24)).toBeNull()
    expect(validatePtyDimensions(80.5, 24)).toBeNull()
  })

  it('validates image attachments', () => {
    expect(validateImageData({ data: 'aGk=', mediaType: 'image/PNG' })).toBe(true)
    expect(validateImageData({ data: 'aGk=', mediaType: 'text/html' })).toBe(false)
    expect(validateImageData({ data: '', mediaType: 'image/png' })).toBe(false)
    expect(validateImageData(null)).toBe(false)
  })
})
