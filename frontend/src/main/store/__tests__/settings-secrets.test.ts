import { describe, it, expect, vi, beforeEach } from 'vitest'

const mem = vi.hoisted(() => new Map<string, unknown>())

vi.mock('electron-store', () => ({
  default: class {
    get(key: string): unknown {
      return mem.get(key)
    }
    set(key: string, value: unknown): void {
      mem.set(key, value)
    }
  }
}))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (v: string) => Buffer.from(`x${v}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').slice(1)
  }
}))
vi.mock('../../utils/paths', () => ({ getUserAppsPath: () => '/tmp/user-apps' }))
vi.mock('../../utils/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))

import {
  getAiModelConfigs,
  setAiModelConfigs,
  getImageGenConfigs,
  setSetting,
  getSettings,
  encryptStoredModelKeys,
  type AIModelConfig
} from '../settings.store'

const model = (apiKey: string): AIModelConfig => ({
  id: 'cfg-1',
  name: 'Mine',
  provider: 'openai',
  endpoint: 'https://api.example.com/v1',
  apiKey,
  models: ['gpt-x'],
  enabled: true
})

describe('settings.store secret handling', () => {
  beforeEach(() => mem.clear())

  it('stores model API keys encrypted and returns them decrypted', () => {
    setAiModelConfigs([model('sk-secret-1234')])
    const raw = mem.get('aiModelConfigs') as AIModelConfig[]
    expect(raw[0].apiKey.startsWith('enc:v1:')).toBe(true)
    expect(raw[0].apiKey).not.toContain('sk-secret-1234')
    expect(getAiModelConfigs()[0].apiKey).toBe('sk-secret-1234')
  })

  it('encrypts writes made through the generic setSetting', () => {
    setSetting('aiModelConfigs', [model('sk-generic')])
    expect((mem.get('aiModelConfigs') as AIModelConfig[])[0].apiKey.startsWith('enc:v1:')).toBe(true)
    setSetting('imageGenConfigs', [
      { id: 'i', name: 'img', provider: 'dall-e', endpoint: '', apiKey: 'sk-img', enabled: true }
    ])
    expect((mem.get('imageGenConfigs') as Array<{ apiKey: string }>)[0].apiKey.startsWith('enc:v1:')).toBe(true)
    expect(getImageGenConfigs()[0].apiKey).toBe('sk-img')
  })

  it('migrates legacy plaintext keys once and masks keys in public settings', () => {
    mem.set('aiModelConfigs', [model('sk-legacy-9876')])
    encryptStoredModelKeys()
    const stored = (mem.get('aiModelConfigs') as AIModelConfig[])[0].apiKey
    expect(stored.startsWith('enc:v1:')).toBe(true)
    encryptStoredModelKeys()
    expect((mem.get('aiModelConfigs') as AIModelConfig[])[0].apiKey).toBe(stored)

    mem.set('userAppDir', '/tmp/user-apps')
    const pub = getSettings()
    expect(pub.aiModelConfigs[0].apiKey).toBe('****9876')
  })
})
