import type { HermesConfig } from '../../types/hermes'
import type { HermesModuleField } from './HermesModuleCard'

export type HermesChannelId = keyof HermesConfig['channels']
export type HermesChannelFieldType = Extract<HermesModuleField['type'], 'text' | 'password'>

export interface HermesChannelFieldMeta {
  key: string
  labelKey: string
  type: HermesChannelFieldType
  placeholder: string
}

export interface HermesChannelMeta {
  id: HermesChannelId
  icon: string
  titleKey: string
  descriptionKey: string
  noteKey?: string
  fields: HermesChannelFieldMeta[]
}

const createField = (
  channelId: HermesChannelId,
  key: string,
  type: HermesChannelFieldType,
  placeholder: string,
): HermesChannelFieldMeta => ({
  key,
  labelKey: `hermes.channel.${channelId}.field.${key}.label`,
  type,
  placeholder,
})

const HERMES_CHANNEL_REGISTRY_MAP = {
  telegram: {
    id: 'telegram',
    icon: 'telegram',
    titleKey: 'hermes.channel.telegram.title',
    descriptionKey: 'hermes.channel.telegram.description',
    fields: [
      createField('telegram', 'token', 'password', '123456:ABC-DEF...'),
    ],
  },
  discord: {
    id: 'discord',
    icon: 'discord',
    titleKey: 'hermes.channel.discord.title',
    descriptionKey: 'hermes.channel.discord.description',
    fields: [
      createField('discord', 'token', 'password', 'Bot token...'),
    ],
  },
  slack: {
    id: 'slack',
    icon: 'slack',
    titleKey: 'hermes.channel.slack.title',
    descriptionKey: 'hermes.channel.slack.description',
    fields: [
      createField('slack', 'bot_token', 'password', 'xoxb-...'),
      createField('slack', 'app_token', 'password', 'xapp-...'),
    ],
  },
  signal: {
    id: 'signal',
    icon: 'signal',
    titleKey: 'hermes.channel.signal.title',
    descriptionKey: 'hermes.channel.signal.description',
    fields: [
      createField('signal', 'http_url', 'text', 'http://localhost:8080'),
      createField('signal', 'account', 'text', '+1234567890'),
    ],
  },
  whatsapp: {
    id: 'whatsapp',
    icon: 'whatsapp',
    titleKey: 'hermes.channel.whatsapp.title',
    descriptionKey: 'hermes.channel.whatsapp.description',
    noteKey: 'hermes.channel.whatsapp.note',
    fields: [],
  },
  matrix: {
    id: 'matrix',
    icon: 'matrix',
    titleKey: 'hermes.channel.matrix.title',
    descriptionKey: 'hermes.channel.matrix.description',
    fields: [
      createField('matrix', 'homeserver', 'text', 'https://matrix.example.com'),
      createField('matrix', 'access_token', 'password', 'syt_...'),
    ],
  },
  mattermost: {
    id: 'mattermost',
    icon: 'mattermost',
    titleKey: 'hermes.channel.mattermost.title',
    descriptionKey: 'hermes.channel.mattermost.description',
    fields: [
      createField('mattermost', 'url', 'text', 'https://chat.example.com'),
      createField('mattermost', 'token', 'password', 'Mattermost token...'),
    ],
  },
  homeassistant: {
    id: 'homeassistant',
    icon: 'homeassistant',
    titleKey: 'hermes.channel.homeassistant.title',
    descriptionKey: 'hermes.channel.homeassistant.description',
    fields: [
      createField('homeassistant', 'url', 'text', 'http://homeassistant.local:8123'),
      createField('homeassistant', 'token', 'password', 'Long-lived access token...'),
    ],
  },
  dingtalk: {
    id: 'dingtalk',
    icon: 'dingtalk',
    titleKey: 'hermes.channel.dingtalk.title',
    descriptionKey: 'hermes.channel.dingtalk.description',
    fields: [
      createField('dingtalk', 'client_id', 'text', 'DingTalk client ID...'),
      createField('dingtalk', 'client_secret', 'password', 'DingTalk client secret...'),
    ],
  },
  feishu: {
    id: 'feishu',
    icon: 'feishu',
    titleKey: 'hermes.channel.feishu.title',
    descriptionKey: 'hermes.channel.feishu.description',
    fields: [
      createField('feishu', 'app_id', 'text', 'cli_xxxxx'),
      createField('feishu', 'app_secret', 'password', 'Feishu app secret...'),
    ],
  },
  wecom: {
    id: 'wecom',
    icon: 'wecom',
    titleKey: 'hermes.channel.wecom.title',
    descriptionKey: 'hermes.channel.wecom.description',
    fields: [
      createField('wecom', 'bot_id', 'text', 'WeCom bot ID...'),
      createField('wecom', 'secret', 'password', 'WeCom secret...'),
    ],
  },
  weixin: {
    id: 'weixin',
    icon: 'weixin',
    titleKey: 'hermes.channel.weixin.title',
    descriptionKey: 'hermes.channel.weixin.description',
    fields: [
      createField('weixin', 'token', 'password', 'Weixin token...'),
      createField('weixin', 'account_id', 'text', 'gh_xxxxx'),
    ],
  },
  sms: {
    id: 'sms',
    icon: 'sms',
    titleKey: 'hermes.channel.sms.title',
    descriptionKey: 'hermes.channel.sms.description',
    fields: [
      createField('sms', 'account_sid', 'text', 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
      createField('sms', 'auth_token', 'password', 'Twilio auth token...'),
      createField('sms', 'phone_number', 'text', '+15551234567'),
      createField('sms', 'webhook_url', 'text', 'https://example.com/hermes/sms'),
    ],
  },
  email: {
    id: 'email',
    icon: 'email',
    titleKey: 'hermes.channel.email.title',
    descriptionKey: 'hermes.channel.email.description',
    fields: [
      createField('email', 'address', 'text', 'agent@example.com'),
      createField('email', 'password', 'password', 'App password...'),
      createField('email', 'imap_host', 'text', 'imap.example.com'),
      createField('email', 'smtp_host', 'text', 'smtp.example.com'),
    ],
  },
  bluebubbles: {
    id: 'bluebubbles',
    icon: 'bluebubbles',
    titleKey: 'hermes.channel.bluebubbles.title',
    descriptionKey: 'hermes.channel.bluebubbles.description',
    fields: [
      createField('bluebubbles', 'server_url', 'text', 'https://bluebubbles.example.com'),
      createField('bluebubbles', 'password', 'password', 'BlueBubbles password...'),
    ],
  },
  qqbot: {
    id: 'qqbot',
    icon: 'qqbot',
    titleKey: 'hermes.channel.qqbot.title',
    descriptionKey: 'hermes.channel.qqbot.description',
    fields: [
      createField('qqbot', 'app_id', 'text', 'QQ bot app ID...'),
      createField('qqbot', 'client_secret', 'password', 'QQ bot client secret...'),
    ],
  },
} satisfies Record<HermesChannelId, HermesChannelMeta>

const HERMES_CHANNEL_ORDER = [
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
] as const satisfies readonly HermesChannelId[]

export const HERMES_CHANNEL_REGISTRY: HermesChannelMeta[] = HERMES_CHANNEL_ORDER.map(
  (channelId) => HERMES_CHANNEL_REGISTRY_MAP[channelId],
)
