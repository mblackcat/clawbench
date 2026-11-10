import { describe, it, expect, vi, beforeEach } from 'vitest'

const safe = vi.hoisted(() => ({ available: true, fail: false }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => safe.available,
    encryptString: (v: string) => Buffer.from(`x${v}`, 'utf8'),
    decryptString: (b: Buffer) => {
      if (safe.fail) throw new Error('keystore changed')
      return b.toString('utf8').slice(1)
    }
  }
}))
vi.mock('../logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))

import { encryptSecretValue, decryptSecretValue, SECRET_ENC_PREFIX } from '../secret-storage'

describe('secret-storage', () => {
  beforeEach(() => {
    safe.available = true
    safe.fail = false
  })

  it('encrypts with the OS keystore and round-trips', () => {
    const enc = encryptSecretValue('sk-123')
    expect(enc.startsWith(SECRET_ENC_PREFIX)).toBe(true)
    expect(enc).not.toContain('sk-123')
    expect(decryptSecretValue(enc)).toBe('sk-123')
  })

  it('is idempotent and keeps empty values empty', () => {
    const enc = encryptSecretValue('sk-123')
    expect(encryptSecretValue(enc)).toBe(enc)
    expect(encryptSecretValue('')).toBe('')
    expect(decryptSecretValue('')).toBe('')
  })

  it('reads legacy plaintext as-is', () => {
    expect(decryptSecretValue('sk-legacy')).toBe('sk-legacy')
  })

  it('falls back to plaintext when the keystore is unavailable', () => {
    safe.available = false
    expect(encryptSecretValue('sk-123')).toBe('sk-123')
  })

  it("returns '' when decryption fails", () => {
    const enc = encryptSecretValue('sk-123')
    safe.fail = true
    expect(decryptSecretValue(enc)).toBe('')
  })
})
