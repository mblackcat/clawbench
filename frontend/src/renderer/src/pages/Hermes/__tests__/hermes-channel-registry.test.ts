import { describe, expect, it } from 'vitest'
import { getT } from '../../../i18n'
import { useSettingsStore } from '../../../stores/useSettingsStore'
import { HERMES_CHANNEL_REGISTRY } from '../hermes-channel-registry'
import type { HermesChannelMeta, HermesChannelFieldMeta } from '../hermes-channel-registry'

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

const CHANNELS_WITH_EXTERNAL_SETUP_NOTES = {
  signal: 'hermes.channel.signal.note',
  whatsapp: 'hermes.channel.whatsapp.note',
  homeassistant: 'hermes.channel.homeassistant.note',
  weixin: 'hermes.channel.weixin.note',
  sms: 'hermes.channel.sms.note',
  bluebubbles: 'hermes.channel.bluebubbles.note',
} as const

const EXTRA_NOTE_KEYS = Object.values(CHANNELS_WITH_EXTERNAL_SETUP_NOTES)

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

  it('exposes external setup note keys for every channel that requires them', async () => {
    const registry = await loadRegistry()

    const registryNoteKeys = Object.fromEntries(
      registry
        .filter((channel: HermesChannelMeta) => channel.noteKey)
        .map((channel: HermesChannelMeta) => [channel.id, channel.noteKey]),
    )

    expect(registryNoteKeys).toEqual(CHANNELS_WITH_EXTERNAL_SETUP_NOTES)
  })

  it('provides localized strings for all registry translation keys in both languages', async () => {
    const registry = await loadRegistry()
    const previousLanguage = useSettingsStore.getState().language

    try {
      ;(['zh-CN', 'en'] as const).forEach((language) => {
        useSettingsStore.setState({ language })
        const t = getT()

        registry.forEach((channel: HermesChannelMeta) => {
          expect(t(channel.titleKey)).not.toBe(channel.titleKey)
          expect(t(channel.descriptionKey)).not.toBe(channel.descriptionKey)

          if (channel.noteKey) {
            expect(t(channel.noteKey)).not.toBe(channel.noteKey)
          }

          channel.fields.forEach((field: HermesChannelFieldMeta) => {
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

  it('all titleKeys start with hermes.channel', () => {
    HERMES_CHANNEL_REGISTRY.forEach((channel) => {
      expect(channel.titleKey).toMatch(/^hermes\.channel/)
    })
  })
})

