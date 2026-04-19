import { describe, expect, it } from 'vitest'

type ExpectedChannelField = {
  key: string
  type: 'text' | 'password'
}

type ExpectedChannelMeta = {
  fields: ExpectedChannelField[]
  noteKey?: string
}

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

const EXPECTED_CHANNEL_META = {
  telegram: {
    fields: [{ key: 'token', type: 'password' }],
  },
  discord: {
    fields: [{ key: 'token', type: 'password' }],
  },
  slack: {
    fields: [
      { key: 'bot_token', type: 'password' },
      { key: 'app_token', type: 'password' },
    ],
  },
  signal: {
    fields: [
      { key: 'http_url', type: 'text' },
      { key: 'account', type: 'text' },
    ],
  },
  whatsapp: {
    fields: [],
    noteKey: 'hermes.channel.whatsapp.note',
  },
  matrix: {
    fields: [
      { key: 'homeserver', type: 'text' },
      { key: 'access_token', type: 'password' },
    ],
  },
  mattermost: {
    fields: [
      { key: 'url', type: 'text' },
      { key: 'token', type: 'password' },
    ],
  },
  homeassistant: {
    fields: [
      { key: 'url', type: 'text' },
      { key: 'token', type: 'password' },
    ],
  },
  dingtalk: {
    fields: [
      { key: 'client_id', type: 'text' },
      { key: 'client_secret', type: 'password' },
    ],
  },
  feishu: {
    fields: [
      { key: 'app_id', type: 'text' },
      { key: 'app_secret', type: 'password' },
    ],
  },
  wecom: {
    fields: [
      { key: 'bot_id', type: 'text' },
      { key: 'secret', type: 'password' },
    ],
  },
  weixin: {
    fields: [
      { key: 'token', type: 'password' },
      { key: 'account_id', type: 'text' },
    ],
  },
  sms: {
    fields: [
      { key: 'account_sid', type: 'text' },
      { key: 'auth_token', type: 'password' },
      { key: 'phone_number', type: 'text' },
      { key: 'webhook_url', type: 'text' },
    ],
  },
  email: {
    fields: [
      { key: 'address', type: 'text' },
      { key: 'password', type: 'password' },
      { key: 'imap_host', type: 'text' },
      { key: 'smtp_host', type: 'text' },
    ],
  },
  bluebubbles: {
    fields: [
      { key: 'server_url', type: 'text' },
      { key: 'password', type: 'password' },
    ],
  },
  qqbot: {
    fields: [
      { key: 'app_id', type: 'text' },
      { key: 'client_secret', type: 'password' },
    ],
  },
} as const satisfies Record<(typeof EXPECTED_CHANNELS)[number], ExpectedChannelMeta>

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
  it('covers all 16 supported Hermes channels in the expected order', async () => {
    const registry = await loadRegistry()

    expect(registry.map((channel: { id: string }) => channel.id)).toEqual(EXPECTED_CHANNELS)
  })

  it('matches the exact field and note-key coverage for every channel', async () => {
    const registry = await loadRegistry()

    expect(registry).toHaveLength(EXPECTED_CHANNELS.length)

    registry.forEach((channel: any) => {
      const expected = EXPECTED_CHANNEL_META[channel.id as keyof typeof EXPECTED_CHANNEL_META]

      expect(expected).toBeDefined()
      expect(channel.icon).toBeTruthy()
      expect(channel.titleKey).toBe(`hermes.channel.${channel.id}.title`)
      expect(channel.descriptionKey).toBe(`hermes.channel.${channel.id}.description`)
      expect(channel.noteKey).toBe(expected.noteKey)
      expect(channel.fields).toHaveLength(expected.fields.length)
      expect(
        channel.fields.map((field: any) => ({
          key: field.key,
          type: field.type,
        })),
      ).toEqual(expected.fields)

      channel.fields.forEach((field: any) => {
        expect(field.labelKey).toBe(`hermes.channel.${channel.id}.field.${field.key}.label`)
        expect(typeof field.placeholder).toBe('string')
      })
    })
  })
})
