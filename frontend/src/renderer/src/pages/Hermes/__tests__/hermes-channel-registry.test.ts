import { describe, expect, it } from 'vitest'
import { getT } from '../../../i18n'
import { useSettingsStore } from '../../../stores/useSettingsStore'

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

const EXTRA_NOTE_KEYS = [
  'hermes.channel.signal.note',
  'hermes.channel.homeassistant.note',
  'hermes.channel.weixin.note',
  'hermes.channel.sms.note',
  'hermes.channel.bluebubbles.note',
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

  it('provides localized strings for all registry translation keys in both languages', async () => {
    const registry = await loadRegistry()
    const previousLanguage = useSettingsStore.getState().language

    try {
      ;(['zh-CN', 'en'] as const).forEach((language) => {
        useSettingsStore.setState({ language })
        const t = getT()

        registry.forEach((channel: any) => {
          expect(t(channel.titleKey)).not.toBe(channel.titleKey)
          expect(t(channel.descriptionKey)).not.toBe(channel.descriptionKey)

          if (channel.noteKey) {
            expect(t(channel.noteKey)).not.toBe(channel.noteKey)
          }

          channel.fields.forEach((field: any) => {
            expect(t(field.labelKey)).not.toBe(field.labelKey)
          })
        })

        EXTRA_NOTE_KEYS.forEach((noteKey) => {
          expect(t(noteKey)).not.toBe(noteKey)
        })
      })
    } finally {
      useSettingsStore.setState({ language: previousLanguage })
    }
  })
})
