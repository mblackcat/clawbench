import { describe, expect, it } from 'vitest'

const EXPECTED_CHANNELS = [
  'telegram',
  'discord',
  'slack',
  'signal',
  'whatsapp',
  'matrix',
  'mattermost',
  'homeassistant',
  'dingtalk',
  'feishu',
  'wecom',
  'weixin',
  'sms',
  'email',
  'bluebubbles',
  'qqbot',
] as const

async function loadRegistry() {
  try {
    const modulePath = '../hermes-channel-registry'
    const module = await import(/* @vite-ignore */ modulePath)
    return module.HERMES_CHANNEL_REGISTRY ?? []
  } catch {
    return []
  }
}

describe('hermes channel registry', () => {
  it('covers all 16 supported Hermes channels', async () => {
    const registry = await loadRegistry()

    expect(registry.map((channel: { id: string }) => channel.id)).toEqual(EXPECTED_CHANNELS)
  })

  it('defines renderer metadata for every channel entry', async () => {
    const registry = await loadRegistry()

    expect(registry).toHaveLength(EXPECTED_CHANNELS.length)
    registry.forEach((channel: any) => {
      expect(channel.icon).toBeTruthy()
      expect(channel.titleKey).toBe(`hermes.channel.${channel.id}.title`)
      expect(channel.descriptionKey).toBe(`hermes.channel.${channel.id}.description`)
      expect(Array.isArray(channel.fields)).toBe(true)

      channel.fields.forEach((field: any) => {
        expect(field.key).toBeTruthy()
        expect(field.labelKey).toBe(`hermes.channel.${channel.id}.field.${field.key}.label`)
        expect(['text', 'password']).toContain(field.type)
        expect(typeof field.placeholder).toBe('string')
      })
    })
  })

  it('keeps note keys optional while covering the configured channel fields', async () => {
    const registry = await loadRegistry()

    expect(registry.find((channel: { id: string }) => channel.id === 'whatsapp')).toMatchObject({
      fields: [],
      noteKey: 'hermes.channel.whatsapp.note',
    })
    expect(registry.find((channel: { id: string }) => channel.id === 'slack')).toMatchObject({
      fields: [
        { key: 'bot_token', type: 'password' },
        { key: 'app_token', type: 'password' },
      ],
    })
    expect(registry.find((channel: { id: string }) => channel.id === 'signal')).toMatchObject({
      fields: [
        { key: 'http_url', type: 'text' },
        { key: 'account', type: 'text' },
      ],
    })
    expect(registry.find((channel: { id: string }) => channel.id === 'email')).toMatchObject({
      fields: [
        { key: 'address', type: 'text' },
        { key: 'password', type: 'password' },
        { key: 'imap_host', type: 'text' },
        { key: 'smtp_host', type: 'text' },
      ],
    })
  })
})
