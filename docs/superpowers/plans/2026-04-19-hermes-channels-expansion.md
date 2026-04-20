# Hermes Channels Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Hermes Channels tab from 4 hardcoded platforms to the full 16-platform gateway surface, store all minimum credentials in `.env`, and verify that the new mapping saves and starts Hermes correctly.

**Architecture:** Replace the existing 4-platform channel model with a registry-driven 16-platform schema shared by the renderer and main-process persistence layer. Keep channel enablement in `config.yaml` under `_ui.channels`, keep all minimum credentials in `.env`, and render channel cards from metadata instead of hand-written JSX.

**Tech Stack:** Electron, React 18, TypeScript, Ant Design, Zustand, electron-vite, Vitest, js-yaml

---

## File Structure

### Existing files to modify

- `frontend/src/renderer/src/types/hermes.ts`
  - Expand `HermesConfig.channels` from 4 platforms to the full 16-platform schema.
- `frontend/src/renderer/src/pages/Hermes/hermes-provider-helpers.ts`
  - Replace the old 4-channel defaults with the new complete channel defaults.
- `frontend/src/main/services/hermes.service.ts`
  - Update config read/save normalization so `_ui.channels` covers all 16 platforms and `.env` maps all minimum fields.
- `frontend/src/renderer/src/pages/Hermes/HermesPage.tsx`
  - Replace the hardcoded 4-card channels tab with registry-driven rendering.
- `frontend/src/renderer/src/i18n/index.ts`
  - Add labels, field names, descriptions, and external-setup notes for all new platforms.
- `frontend/src/main/services/__tests__/hermes.service.test.ts`
  - Expand persistence tests to cover the new channel schema and env mappings.
- `frontend/src/renderer/src/pages/Hermes/__tests__/hermes-provider-helpers.test.ts`
  - Expand defaults tests to cover the new channel schema.

### New files to create

- `frontend/src/renderer/src/pages/Hermes/hermes-channel-registry.ts`
  - Define channel metadata used by the Channels tab: IDs, icons, i18n keys, helper notes, fields, and placeholders.
- `frontend/src/renderer/src/pages/Hermes/__tests__/hermes-channel-registry.test.ts`
  - Verify registry coverage for all 16 channels and catch accidental omissions in future edits.

---

### Task 1: Replace the Hermes channel type and defaults

**Files:**
- Modify: `frontend/src/renderer/src/types/hermes.ts:67-72`
- Modify: `frontend/src/renderer/src/pages/Hermes/hermes-provider-helpers.ts:4-9`
- Test: `frontend/src/renderer/src/pages/Hermes/__tests__/hermes-provider-helpers.test.ts`

- [ ] **Step 1: Write the failing defaults test**

```ts
import { describe, expect, it } from 'vitest'
import { createDefaultHermesConfig } from '../hermes-provider-helpers'

describe('createDefaultHermesConfig', () => {
  it('creates the full 16-channel default shape', () => {
    const config = createDefaultHermesConfig('anthropic')

    expect(Object.keys(config.channels)).toEqual([
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
    ])

    expect(config.channels.signal).toEqual({ enabled: false, http_url: '', account: '' })
    expect(config.channels.whatsapp).toEqual({ enabled: false })
    expect(config.channels.matrix).toEqual({ enabled: false, homeserver: '', access_token: '' })
    expect(config.channels.sms).toEqual({
      enabled: false,
      account_sid: '',
      auth_token: '',
      phone_number: '',
      webhook_url: '',
    })
    expect(config.channels.email).toEqual({
      enabled: false,
      address: '',
      password: '',
      imap_host: '',
      smtp_host: '',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- frontend/src/renderer/src/pages/Hermes/__tests__/hermes-provider-helpers.test.ts`
Expected: FAIL because `HermesConfig.channels` and `DEFAULT_CHANNELS` only define 4 channels and `signal.phone` instead of the new fields.

- [ ] **Step 3: Replace `HermesConfig.channels` with the full schema**

```ts
channels: {
  telegram: { enabled: boolean; token: string }
  discord: { enabled: boolean; token: string }
  slack: { enabled: boolean; bot_token: string; app_token: string }
  signal: { enabled: boolean; http_url: string; account: string }
  whatsapp: { enabled: boolean }
  matrix: { enabled: boolean; homeserver: string; access_token: string }
  mattermost: { enabled: boolean; url: string; token: string }
  homeassistant: { enabled: boolean; url: string; token: string }
  dingtalk: { enabled: boolean; client_id: string; client_secret: string }
  feishu: { enabled: boolean; app_id: string; app_secret: string }
  wecom: { enabled: boolean; bot_id: string; secret: string }
  weixin: { enabled: boolean; token: string; account_id: string }
  sms: { enabled: boolean; account_sid: string; auth_token: string; phone_number: string; webhook_url: string }
  email: { enabled: boolean; address: string; password: string; imap_host: string; smtp_host: string }
  bluebubbles: { enabled: boolean; server_url: string; password: string }
  qqbot: { enabled: boolean; app_id: string; client_secret: string }
}
```

- [ ] **Step 4: Replace `DEFAULT_CHANNELS` with the new complete defaults**

```ts
const DEFAULT_CHANNELS: HermesConfig['channels'] = {
  telegram: { enabled: false, token: '' },
  discord: { enabled: false, token: '' },
  slack: { enabled: false, bot_token: '', app_token: '' },
  signal: { enabled: false, http_url: '', account: '' },
  whatsapp: { enabled: false },
  matrix: { enabled: false, homeserver: '', access_token: '' },
  mattermost: { enabled: false, url: '', token: '' },
  homeassistant: { enabled: false, url: '', token: '' },
  dingtalk: { enabled: false, client_id: '', client_secret: '' },
  feishu: { enabled: false, app_id: '', app_secret: '' },
  wecom: { enabled: false, bot_id: '', secret: '' },
  weixin: { enabled: false, token: '', account_id: '' },
  sms: { enabled: false, account_sid: '', auth_token: '', phone_number: '', webhook_url: '' },
  email: { enabled: false, address: '', password: '', imap_host: '', smtp_host: '' },
  bluebubbles: { enabled: false, server_url: '', password: '' },
  qqbot: { enabled: false, app_id: '', client_secret: '' },
}
```

- [ ] **Step 5: Run the defaults test to verify it passes**

Run: `npm test -- frontend/src/renderer/src/pages/Hermes/__tests__/hermes-provider-helpers.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/renderer/src/types/hermes.ts frontend/src/renderer/src/pages/Hermes/hermes-provider-helpers.ts frontend/src/renderer/src/pages/Hermes/__tests__/hermes-provider-helpers.test.ts
git commit -m "refactor: replace Hermes channel schema"
```

### Task 2: Add a registry for all Hermes channels

**Files:**
- Create: `frontend/src/renderer/src/pages/Hermes/hermes-channel-registry.ts`
- Test: `frontend/src/renderer/src/pages/Hermes/__tests__/hermes-channel-registry.test.ts`

- [ ] **Step 1: Write the failing registry test**

```ts
import { describe, expect, it } from 'vitest'
import { HERMES_CHANNEL_REGISTRY } from '../hermes-channel-registry'

describe('HERMES_CHANNEL_REGISTRY', () => {
  it('covers all 16 Hermes channels with stable IDs', () => {
    expect(HERMES_CHANNEL_REGISTRY.map((channel) => channel.id)).toEqual([
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
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- frontend/src/renderer/src/pages/Hermes/__tests__/hermes-channel-registry.test.ts`
Expected: FAIL because the registry file does not exist.

- [ ] **Step 3: Create the channel registry type and metadata**

```ts
import type { HermesConfig } from '../../types/hermes'
import type { HermesModuleField } from './HermesModuleCard'

export interface HermesChannelFieldSchema {
  key: string
  labelKey: string
  type: HermesModuleField['type']
  placeholder?: string
}

export interface HermesChannelMeta {
  id: keyof HermesConfig['channels']
  icon: string
  titleKey: string
  descriptionKey: string
  noteKey?: string
  fields: HermesChannelFieldSchema[]
}

export const HERMES_CHANNEL_REGISTRY: HermesChannelMeta[] = [
  { id: 'telegram', icon: '✈️', titleKey: 'hermes.channelTelegram', descriptionKey: 'hermes.telegramDesc', fields: [{ key: 'token', labelKey: 'hermes.botToken', type: 'password', placeholder: '123456:ABC-DEF...' }] },
  { id: 'discord', icon: '🎮', titleKey: 'hermes.channelDiscord', descriptionKey: 'hermes.discordDesc', fields: [{ key: 'token', labelKey: 'hermes.botToken', type: 'password', placeholder: 'Bot token...' }] },
  { id: 'slack', icon: '💬', titleKey: 'hermes.channelSlack', descriptionKey: 'hermes.slackDesc', fields: [
    { key: 'bot_token', labelKey: 'hermes.slackBotToken', type: 'password', placeholder: 'xoxb-...' },
    { key: 'app_token', labelKey: 'hermes.slackAppToken', type: 'password', placeholder: 'xapp-...' },
  ] },
  { id: 'signal', icon: '🔒', titleKey: 'hermes.channelSignal', descriptionKey: 'hermes.signalDesc', noteKey: 'hermes.signalNote', fields: [
    { key: 'http_url', labelKey: 'hermes.signalHttpUrl', type: 'text', placeholder: 'http://127.0.0.1:8080' },
    { key: 'account', labelKey: 'hermes.signalAccount', type: 'text', placeholder: '+1234567890' },
  ] },
  { id: 'whatsapp', icon: '🟢', titleKey: 'hermes.channelWhatsApp', descriptionKey: 'hermes.whatsappDesc', noteKey: 'hermes.whatsappNote', fields: [] },
  { id: 'matrix', icon: '🧊', titleKey: 'hermes.channelMatrix', descriptionKey: 'hermes.matrixDesc', fields: [
    { key: 'homeserver', labelKey: 'hermes.matrixHomeserver', type: 'text', placeholder: 'https://matrix.example.com' },
    { key: 'access_token', labelKey: 'hermes.matrixAccessToken', type: 'password', placeholder: 'syt_...' },
  ] },
  { id: 'mattermost', icon: '🧭', titleKey: 'hermes.channelMattermost', descriptionKey: 'hermes.mattermostDesc', fields: [
    { key: 'url', labelKey: 'hermes.serverUrl', type: 'text', placeholder: 'https://chat.example.com' },
    { key: 'token', labelKey: 'hermes.botToken', type: 'password', placeholder: 'Access token...' },
  ] },
  { id: 'homeassistant', icon: '🏠', titleKey: 'hermes.channelHomeAssistant', descriptionKey: 'hermes.homeAssistantDesc', noteKey: 'hermes.homeAssistantNote', fields: [
    { key: 'url', labelKey: 'hermes.serverUrl', type: 'text', placeholder: 'http://homeassistant.local:8123' },
    { key: 'token', labelKey: 'hermes.accessToken', type: 'password', placeholder: 'Long-lived access token...' },
  ] },
  { id: 'dingtalk', icon: '📨', titleKey: 'hermes.channelDingTalk', descriptionKey: 'hermes.dingTalkDesc', fields: [
    { key: 'client_id', labelKey: 'hermes.clientId', type: 'text', placeholder: 'dingxxxxxxxx' },
    { key: 'client_secret', labelKey: 'hermes.clientSecret', type: 'password', placeholder: 'Client secret...' },
  ] },
  { id: 'feishu', icon: '🕊️', titleKey: 'hermes.channelFeishu', descriptionKey: 'hermes.feishuDesc', fields: [
    { key: 'app_id', labelKey: 'hermes.appId', type: 'text', placeholder: 'cli_xxxxxxxx' },
    { key: 'app_secret', labelKey: 'hermes.appSecret', type: 'password', placeholder: 'App secret...' },
  ] },
  { id: 'wecom', icon: '🏢', titleKey: 'hermes.channelWeCom', descriptionKey: 'hermes.wecomDesc', fields: [
    { key: 'bot_id', labelKey: 'hermes.botId', type: 'text', placeholder: 'Bot ID...' },
    { key: 'secret', labelKey: 'hermes.secret', type: 'password', placeholder: 'Bot secret...' },
  ] },
  { id: 'weixin', icon: '💚', titleKey: 'hermes.channelWeixin', descriptionKey: 'hermes.weixinDesc', noteKey: 'hermes.weixinNote', fields: [
    { key: 'token', labelKey: 'hermes.token', type: 'password', placeholder: 'Token...' },
    { key: 'account_id', labelKey: 'hermes.accountId', type: 'text', placeholder: 'Account ID...' },
  ] },
  { id: 'sms', icon: '📱', titleKey: 'hermes.channelSms', descriptionKey: 'hermes.smsDesc', noteKey: 'hermes.smsNote', fields: [
    { key: 'account_sid', labelKey: 'hermes.twilioAccountSid', type: 'text', placeholder: 'ACxxxxxxxx' },
    { key: 'auth_token', labelKey: 'hermes.twilioAuthToken', type: 'password', placeholder: 'Auth token...' },
    { key: 'phone_number', labelKey: 'hermes.phoneNumber', type: 'text', placeholder: '+1234567890' },
    { key: 'webhook_url', labelKey: 'hermes.webhookUrl', type: 'text', placeholder: 'https://example.com/twilio/webhook' },
  ] },
  { id: 'email', icon: '✉️', titleKey: 'hermes.channelEmail', descriptionKey: 'hermes.emailDesc', fields: [
    { key: 'address', labelKey: 'hermes.emailAddress', type: 'text', placeholder: 'agent@example.com' },
    { key: 'password', labelKey: 'hermes.emailPassword', type: 'password', placeholder: 'Password...' },
    { key: 'imap_host', labelKey: 'hermes.imapHost', type: 'text', placeholder: 'imap.example.com' },
    { key: 'smtp_host', labelKey: 'hermes.smtpHost', type: 'text', placeholder: 'smtp.example.com' },
  ] },
  { id: 'bluebubbles', icon: '💙', titleKey: 'hermes.channelBlueBubbles', descriptionKey: 'hermes.bluebubblesDesc', noteKey: 'hermes.bluebubblesNote', fields: [
    { key: 'server_url', labelKey: 'hermes.serverUrl', type: 'text', placeholder: 'http://localhost:1234' },
    { key: 'password', labelKey: 'hermes.password', type: 'password', placeholder: 'Server password...' },
  ] },
  { id: 'qqbot', icon: '🐧', titleKey: 'hermes.channelQqBot', descriptionKey: 'hermes.qqbotDesc', fields: [
    { key: 'app_id', labelKey: 'hermes.appId', type: 'text', placeholder: 'App ID...' },
    { key: 'client_secret', labelKey: 'hermes.clientSecret', type: 'password', placeholder: 'Client secret...' },
  ] },
]
```

- [ ] **Step 4: Run the registry test to verify it passes**

Run: `npm test -- frontend/src/renderer/src/pages/Hermes/__tests__/hermes-channel-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderer/src/pages/Hermes/hermes-channel-registry.ts frontend/src/renderer/src/pages/Hermes/__tests__/hermes-channel-registry.test.ts
git commit -m "feat: add Hermes channel registry"
```

### Task 3: Expand Hermes persistence tests for the new env mapping

**Files:**
- Modify: `frontend/src/main/services/__tests__/hermes.service.test.ts`
- Modify: `frontend/src/main/services/hermes.service.ts:273-391`

- [ ] **Step 1: Write the failing persistence test for env normalization**

```ts
it('normalizes all Hermes channels into _ui.channels and .env', () => {
  const config = createDefaultHermesConfig('anthropic')

  config.channels.telegram = { enabled: true, token: 'telegram-token' }
  config.channels.slack = { enabled: true, bot_token: 'xoxb-1', app_token: 'xapp-1' }
  config.channels.signal = { enabled: true, http_url: 'http://127.0.0.1:8080', account: '+15550001' }
  config.channels.whatsapp = { enabled: true }
  config.channels.matrix = { enabled: true, homeserver: 'https://matrix.example.com', access_token: 'matrix-token' }
  config.channels.mattermost = { enabled: true, url: 'https://chat.example.com', token: 'mattermost-token' }
  config.channels.homeassistant = { enabled: true, url: 'http://ha.local:8123', token: 'hass-token' }
  config.channels.dingtalk = { enabled: true, client_id: 'ding-id', client_secret: 'ding-secret' }
  config.channels.feishu = { enabled: true, app_id: 'cli_app', app_secret: 'cli_secret' }
  config.channels.wecom = { enabled: true, bot_id: 'bot-id', secret: 'bot-secret' }
  config.channels.weixin = { enabled: true, token: 'wx-token', account_id: 'wx-account' }
  config.channels.sms = { enabled: true, account_sid: 'AC123', auth_token: 'sms-secret', phone_number: '+15550002', webhook_url: 'https://example.com/sms' }
  config.channels.email = { enabled: true, address: 'agent@example.com', password: 'email-secret', imap_host: 'imap.example.com', smtp_host: 'smtp.example.com' }
  config.channels.bluebubbles = { enabled: true, server_url: 'http://localhost:1234', password: 'blue-secret' }
  config.channels.qqbot = { enabled: true, app_id: 'qq-app', client_secret: 'qq-secret' }

  const normalized = normalizeHermesConfigForSave(config)

  expect(normalized.yaml._ui.channels).toEqual({
    telegram: true,
    discord: false,
    slack: true,
    signal: true,
    whatsapp: true,
    matrix: true,
    mattermost: true,
    homeassistant: true,
    dingtalk: true,
    feishu: true,
    wecom: true,
    weixin: true,
    sms: true,
    email: true,
    bluebubbles: true,
    qqbot: true,
  })

  expect(normalized.env).toMatchObject({
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    SLACK_BOT_TOKEN: 'xoxb-1',
    SLACK_APP_TOKEN: 'xapp-1',
    SIGNAL_HTTP_URL: 'http://127.0.0.1:8080',
    SIGNAL_ACCOUNT: '+15550001',
    WHATSAPP_ENABLED: 'true',
    MATRIX_HOMESERVER: 'https://matrix.example.com',
    MATRIX_ACCESS_TOKEN: 'matrix-token',
    MATTERMOST_URL: 'https://chat.example.com',
    MATTERMOST_TOKEN: 'mattermost-token',
    HASS_URL: 'http://ha.local:8123',
    HASS_TOKEN: 'hass-token',
    DINGTALK_CLIENT_ID: 'ding-id',
    DINGTALK_CLIENT_SECRET: 'ding-secret',
    FEISHU_APP_ID: 'cli_app',
    FEISHU_APP_SECRET: 'cli_secret',
    WECOM_BOT_ID: 'bot-id',
    WECOM_SECRET: 'bot-secret',
    WEIXIN_TOKEN: 'wx-token',
    WEIXIN_ACCOUNT_ID: 'wx-account',
    TWILIO_ACCOUNT_SID: 'AC123',
    TWILIO_AUTH_TOKEN: 'sms-secret',
    TWILIO_PHONE_NUMBER: '+15550002',
    SMS_WEBHOOK_URL: 'https://example.com/sms',
    EMAIL_ADDRESS: 'agent@example.com',
    EMAIL_PASSWORD: 'email-secret',
    EMAIL_IMAP_HOST: 'imap.example.com',
    EMAIL_SMTP_HOST: 'smtp.example.com',
    BLUEBUBBLES_SERVER_URL: 'http://localhost:1234',
    BLUEBUBBLES_PASSWORD: 'blue-secret',
    QQ_APP_ID: 'qq-app',
    QQ_CLIENT_SECRET: 'qq-secret',
  })
})
```

- [ ] **Step 2: Write the failing read test for env parsing**

```ts
it('reads all Hermes channels from _ui.channels and .env', () => {
  const config = readHermesConfigFromSources(
    {
      model: { provider: 'anthropic', default: 'claude-sonnet-4-6' },
      _ui: {
        channels: {
          telegram: true,
          signal: true,
          whatsapp: true,
          matrix: true,
          sms: true,
        },
      },
    },
    {
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      SIGNAL_HTTP_URL: 'http://127.0.0.1:8080',
      SIGNAL_ACCOUNT: '+15550001',
      WHATSAPP_ENABLED: 'true',
      MATRIX_HOMESERVER: 'https://matrix.example.com',
      MATRIX_ACCESS_TOKEN: 'matrix-token',
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'sms-secret',
      TWILIO_PHONE_NUMBER: '+15550002',
      SMS_WEBHOOK_URL: 'https://example.com/sms',
    },
  )

  expect(config.channels.telegram).toEqual({ enabled: true, token: 'telegram-token' })
  expect(config.channels.signal).toEqual({ enabled: true, http_url: 'http://127.0.0.1:8080', account: '+15550001' })
  expect(config.channels.whatsapp).toEqual({ enabled: true })
  expect(config.channels.matrix).toEqual({ enabled: true, homeserver: 'https://matrix.example.com', access_token: 'matrix-token' })
  expect(config.channels.sms).toEqual({
    enabled: true,
    account_sid: 'AC123',
    auth_token: 'sms-secret',
    phone_number: '+15550002',
    webhook_url: 'https://example.com/sms',
  })
})
```

- [ ] **Step 3: Run the Hermes service test file to verify it fails**

Run: `npm test -- frontend/src/main/services/__tests__/hermes.service.test.ts`
Expected: FAIL because the service still uses the old 4-channel mapping and `SIGNAL_PHONE`.

- [ ] **Step 4: Replace channel read normalization with the full mapping**

```ts
const channels = rawYaml?._ui?.channels || {}
config.channels.telegram.enabled = !!channels.telegram
config.channels.discord.enabled = !!channels.discord
config.channels.slack.enabled = !!channels.slack
config.channels.signal.enabled = !!channels.signal
config.channels.whatsapp.enabled = !!channels.whatsapp
config.channels.matrix.enabled = !!channels.matrix
config.channels.mattermost.enabled = !!channels.mattermost
config.channels.homeassistant.enabled = !!channels.homeassistant
config.channels.dingtalk.enabled = !!channels.dingtalk
config.channels.feishu.enabled = !!channels.feishu
config.channels.wecom.enabled = !!channels.wecom
config.channels.weixin.enabled = !!channels.weixin
config.channels.sms.enabled = !!channels.sms
config.channels.email.enabled = !!channels.email
config.channels.bluebubbles.enabled = !!channels.bluebubbles
config.channels.qqbot.enabled = !!channels.qqbot

config.channels.telegram.token = env.TELEGRAM_BOT_TOKEN || ''
config.channels.discord.token = env.DISCORD_BOT_TOKEN || ''
config.channels.slack.bot_token = env.SLACK_BOT_TOKEN || ''
config.channels.slack.app_token = env.SLACK_APP_TOKEN || ''
config.channels.signal.http_url = env.SIGNAL_HTTP_URL || ''
config.channels.signal.account = env.SIGNAL_ACCOUNT || ''
config.channels.matrix.homeserver = env.MATRIX_HOMESERVER || ''
config.channels.matrix.access_token = env.MATRIX_ACCESS_TOKEN || ''
config.channels.mattermost.url = env.MATTERMOST_URL || ''
config.channels.mattermost.token = env.MATTERMOST_TOKEN || ''
config.channels.homeassistant.url = env.HASS_URL || ''
config.channels.homeassistant.token = env.HASS_TOKEN || ''
config.channels.dingtalk.client_id = env.DINGTALK_CLIENT_ID || ''
config.channels.dingtalk.client_secret = env.DINGTALK_CLIENT_SECRET || ''
config.channels.feishu.app_id = env.FEISHU_APP_ID || ''
config.channels.feishu.app_secret = env.FEISHU_APP_SECRET || ''
config.channels.wecom.bot_id = env.WECOM_BOT_ID || ''
config.channels.wecom.secret = env.WECOM_SECRET || ''
config.channels.weixin.token = env.WEIXIN_TOKEN || ''
config.channels.weixin.account_id = env.WEIXIN_ACCOUNT_ID || ''
config.channels.sms.account_sid = env.TWILIO_ACCOUNT_SID || ''
config.channels.sms.auth_token = env.TWILIO_AUTH_TOKEN || ''
config.channels.sms.phone_number = env.TWILIO_PHONE_NUMBER || ''
config.channels.sms.webhook_url = env.SMS_WEBHOOK_URL || ''
config.channels.email.address = env.EMAIL_ADDRESS || ''
config.channels.email.password = env.EMAIL_PASSWORD || ''
config.channels.email.imap_host = env.EMAIL_IMAP_HOST || ''
config.channels.email.smtp_host = env.EMAIL_SMTP_HOST || ''
config.channels.bluebubbles.server_url = env.BLUEBUBBLES_SERVER_URL || ''
config.channels.bluebubbles.password = env.BLUEBUBBLES_PASSWORD || ''
config.channels.qqbot.app_id = env.QQ_APP_ID || ''
config.channels.qqbot.client_secret = env.QQ_CLIENT_SECRET || ''
```

- [ ] **Step 5: Replace save normalization with the full `_ui.channels` and `.env` mapping**

```ts
_ui: {
  channels: {
    telegram: config.channels.telegram.enabled,
    discord: config.channels.discord.enabled,
    slack: config.channels.slack.enabled,
    signal: config.channels.signal.enabled,
    whatsapp: config.channels.whatsapp.enabled,
    matrix: config.channels.matrix.enabled,
    mattermost: config.channels.mattermost.enabled,
    homeassistant: config.channels.homeassistant.enabled,
    dingtalk: config.channels.dingtalk.enabled,
    feishu: config.channels.feishu.enabled,
    wecom: config.channels.wecom.enabled,
    weixin: config.channels.weixin.enabled,
    sms: config.channels.sms.enabled,
    email: config.channels.email.enabled,
    bluebubbles: config.channels.bluebubbles.enabled,
    qqbot: config.channels.qqbot.enabled,
  },
},
```

```ts
const env: Record<string, string> = {
  [resolveProviderEnvKey(config.model.provider)]: config.model.apiKey,
  TELEGRAM_BOT_TOKEN: config.channels.telegram.token,
  DISCORD_BOT_TOKEN: config.channels.discord.token,
  SLACK_BOT_TOKEN: config.channels.slack.bot_token,
  SLACK_APP_TOKEN: config.channels.slack.app_token,
  SIGNAL_HTTP_URL: config.channels.signal.http_url,
  SIGNAL_ACCOUNT: config.channels.signal.account,
  WHATSAPP_ENABLED: String(config.channels.whatsapp.enabled),
  MATRIX_HOMESERVER: config.channels.matrix.homeserver,
  MATRIX_ACCESS_TOKEN: config.channels.matrix.access_token,
  MATTERMOST_URL: config.channels.mattermost.url,
  MATTERMOST_TOKEN: config.channels.mattermost.token,
  HASS_URL: config.channels.homeassistant.url,
  HASS_TOKEN: config.channels.homeassistant.token,
  DINGTALK_CLIENT_ID: config.channels.dingtalk.client_id,
  DINGTALK_CLIENT_SECRET: config.channels.dingtalk.client_secret,
  FEISHU_APP_ID: config.channels.feishu.app_id,
  FEISHU_APP_SECRET: config.channels.feishu.app_secret,
  WECOM_BOT_ID: config.channels.wecom.bot_id,
  WECOM_SECRET: config.channels.wecom.secret,
  WEIXIN_TOKEN: config.channels.weixin.token,
  WEIXIN_ACCOUNT_ID: config.channels.weixin.account_id,
  TWILIO_ACCOUNT_SID: config.channels.sms.account_sid,
  TWILIO_AUTH_TOKEN: config.channels.sms.auth_token,
  TWILIO_PHONE_NUMBER: config.channels.sms.phone_number,
  SMS_WEBHOOK_URL: config.channels.sms.webhook_url,
  EMAIL_ADDRESS: config.channels.email.address,
  EMAIL_PASSWORD: config.channels.email.password,
  EMAIL_IMAP_HOST: config.channels.email.imap_host,
  EMAIL_SMTP_HOST: config.channels.email.smtp_host,
  BLUEBUBBLES_SERVER_URL: config.channels.bluebubbles.server_url,
  BLUEBUBBLES_PASSWORD: config.channels.bluebubbles.password,
  QQ_APP_ID: config.channels.qqbot.app_id,
  QQ_CLIENT_SECRET: config.channels.qqbot.client_secret,
  AWS_PROFILE: config.model.aws?.profile || '',
  AWS_ACCESS_KEY_ID: config.model.aws?.accessKeyId || '',
  AWS_SECRET_ACCESS_KEY: config.model.aws?.secretAccessKey || '',
  AWS_SESSION_TOKEN: config.model.aws?.sessionToken || '',
  BEDROCK_BASE_URL: config.model.aws?.bedrockBaseUrl || '',
}
```

- [ ] **Step 6: Run the Hermes service tests to verify they pass**

Run: `npm test -- frontend/src/main/services/__tests__/hermes.service.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/main/services/hermes.service.ts frontend/src/main/services/__tests__/hermes.service.test.ts
git commit -m "feat: expand Hermes channel persistence"
```

### Task 4: Add i18n coverage for new channel labels and notes

**Files:**
- Modify: `frontend/src/renderer/src/i18n/index.ts`

- [ ] **Step 1: Write the failing translation smoke test**

Add to an existing Hermes-oriented test file or create a focused assertions block:

```ts
import { describe, expect, it } from 'vitest'
import { translations } from '../../../i18n/index'

describe('Hermes channel translations', () => {
  it('contains the new channel keys in zh-CN and en', () => {
    const requiredKeys = [
      'hermes.channelWhatsApp',
      'hermes.channelMatrix',
      'hermes.channelMattermost',
      'hermes.channelHomeAssistant',
      'hermes.channelDingTalk',
      'hermes.channelFeishu',
      'hermes.channelWeCom',
      'hermes.channelWeixin',
      'hermes.channelSms',
      'hermes.channelEmail',
      'hermes.channelBlueBubbles',
      'hermes.channelQqBot',
      'hermes.signalHttpUrl',
      'hermes.signalAccount',
      'hermes.smsNote',
      'hermes.whatsappNote',
    ]

    for (const key of requiredKeys) {
      expect(translations['zh-CN'][key]).toBeTruthy()
      expect(translations.en[key]).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run the translation test to verify it fails**

Run: `npm test -- frontend/src/renderer/src/pages/Hermes/__tests__/hermes-channel-registry.test.ts`
Expected: FAIL because the new i18n keys are missing.

- [ ] **Step 3: Add the new i18n keys in both locales**

Add keys for:

```ts
'hermes.channelWhatsApp'
'hermes.channelMatrix'
'hermes.channelMattermost'
'hermes.channelHomeAssistant'
'hermes.channelDingTalk'
'hermes.channelFeishu'
'hermes.channelWeCom'
'hermes.channelWeixin'
'hermes.channelSms'
'hermes.channelEmail'
'hermes.channelBlueBubbles'
'hermes.channelQqBot'
'hermes.signalHttpUrl'
'hermes.signalAccount'
'hermes.matrixHomeserver'
'hermes.matrixAccessToken'
'hermes.serverUrl'
'hermes.accessToken'
'hermes.clientId'
'hermes.clientSecret'
'hermes.appId'
'hermes.appSecret'
'hermes.botId'
'hermes.secret'
'hermes.token'
'hermes.accountId'
'hermes.twilioAccountSid'
'hermes.phoneNumber'
'hermes.webhookUrl'
'hermes.emailAddress'
'hermes.emailPassword'
'hermes.imapHost'
'hermes.smtpHost'
'hermes.password'
'hermes.whatsappDesc'
'hermes.whatsappNote'
'hermes.matrixDesc'
'hermes.mattermostDesc'
'hermes.homeAssistantDesc'
'hermes.homeAssistantNote'
'hermes.dingTalkDesc'
'hermes.feishuDesc'
'hermes.wecomDesc'
'hermes.weixinDesc'
'hermes.weixinNote'
'hermes.smsDesc'
'hermes.smsNote'
'hermes.emailDesc'
'hermes.bluebubblesDesc'
'hermes.bluebubblesNote'
'hermes.qqbotDesc'
```

Use short, direct copy. For example:

```ts
'hermes.whatsappNote': 'Requires bridge pairing outside this page',
'hermes.signalNote': 'Requires a running signal-cli HTTP service',
'hermes.homeAssistantNote': 'Requires a reachable Home Assistant instance',
'hermes.smsNote': 'Requires a public Twilio webhook endpoint',
'hermes.bluebubblesNote': 'Requires a running BlueBubbles server',
'hermes.weixinNote': 'Requires platform-side setup outside this page',
```

- [ ] **Step 4: Run the translation test to verify it passes**

Run: `npm test -- frontend/src/renderer/src/pages/Hermes/__tests__/hermes-channel-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderer/src/i18n/index.ts frontend/src/renderer/src/pages/Hermes/__tests__/hermes-channel-registry.test.ts
git commit -m "feat: add Hermes channel translations"
```

### Task 5: Replace the hardcoded Channels tab with registry-driven rendering

**Files:**
- Modify: `frontend/src/renderer/src/pages/Hermes/HermesPage.tsx:380-445`
- Modify: `frontend/src/renderer/src/pages/Hermes/hermes-channel-registry.ts`
- Test: `frontend/src/renderer/src/components/__tests__/AgentConfigCard.test.tsx` or a new Hermes page test if needed

- [ ] **Step 1: Write the failing renderer test**

Create or extend a test that asserts the channel registry drives the visible card count:

```ts
import { describe, expect, it } from 'vitest'
import { HERMES_CHANNEL_REGISTRY } from '../hermes-channel-registry'

describe('Hermes channel registry rendering contract', () => {
  it('keeps the number of rendered channels aligned with the registry', () => {
    expect(HERMES_CHANNEL_REGISTRY).toHaveLength(16)
    expect(HERMES_CHANNEL_REGISTRY.every((item) => item.titleKey.startsWith('hermes.channel'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify current behavior is incomplete**

Run: `npm test -- frontend/src/renderer/src/pages/Hermes/__tests__/hermes-channel-registry.test.ts`
Expected: PASS for registry existence after Task 2, but the UI is still incomplete until the code change below.

- [ ] **Step 3: Add a field builder helper in `HermesPage.tsx`**

```ts
const buildChannelFields = <K extends keyof HermesConfig['channels']>(channelId: K): HermesModuleField[] => {
  if (!config) return []

  const channelMeta = HERMES_CHANNEL_REGISTRY.find((item) => item.id === channelId)
  if (!channelMeta) return []

  const channelConfig = config.channels[channelId] as Record<string, string | boolean>
  if (!channelConfig.enabled) return []

  return channelMeta.fields.map((field) => ({
    key: field.key,
    label: t(field.labelKey),
    type: field.type,
    placeholder: field.placeholder,
    value: channelConfig[field.key] as string,
    onChange: (value) => patchChannels({
      [channelId]: {
        ...config.channels[channelId],
        [field.key]: value as string,
      },
    } as Partial<HermesConfig['channels']>),
  }))
}
```

- [ ] **Step 4: Replace the hardcoded channels tab with a registry map**

```ts
const channelsTab = config ? (
  <div>
    {renderGrid(
      HERMES_CHANNEL_REGISTRY.map((channel) => (
        <HermesModuleCard
          key={channel.id}
          icon={channel.icon}
          title={t(channel.titleKey)}
          description={t(channel.descriptionKey)}
          note={channel.noteKey ? t(channel.noteKey) : undefined}
          enabled={config.channels[channel.id].enabled}
          onToggle={(enabled) => patchChannels({
            [channel.id]: {
              ...config.channels[channel.id],
              enabled,
            },
          } as Partial<HermesConfig['channels']>)}
          fields={buildChannelFields(channel.id)}
        />
      )),
    )}
  </div>
) : null
```

- [ ] **Step 5: Run typecheck and targeted tests**

Run: `npm run typecheck && npm test -- frontend/src/renderer/src/pages/Hermes/__tests__/hermes-channel-registry.test.ts frontend/src/renderer/src/pages/Hermes/__tests__/hermes-provider-helpers.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/renderer/src/pages/Hermes/HermesPage.tsx frontend/src/renderer/src/pages/Hermes/hermes-channel-registry.ts frontend/src/renderer/src/pages/Hermes/__tests__/hermes-channel-registry.test.ts
git commit -m "feat: render Hermes channels from registry"
```

### Task 6: Verify end-to-end config persistence and gateway startup manually

**Files:**
- Verify: `~/.hermes/config.yaml`
- Verify: `~/.hermes/.env`
- Modify if needed: any files from Tasks 1-5

- [ ] **Step 1: Run the full frontend test/typecheck suite for touched Hermes files**

Run: `npm run typecheck && npm test -- frontend/src/main/services/__tests__/hermes.service.test.ts frontend/src/renderer/src/pages/Hermes/__tests__/hermes-provider-helpers.test.ts frontend/src/renderer/src/pages/Hermes/__tests__/hermes-channel-registry.test.ts`
Expected: PASS

- [ ] **Step 2: Start the frontend app**

Run: `npm run dev`
Expected: Electron dev app opens successfully.

- [ ] **Step 3: Save a representative multi-platform config through the UI**

Use these values in the Hermes Channels tab:

```text
Telegram token: telegram-token
Slack bot token: xoxb-1
Slack app token: xapp-1
Signal HTTP URL: http://127.0.0.1:8080
Signal account: +15550001
Matrix homeserver: https://matrix.example.com
Matrix access token: matrix-token
WhatsApp: enabled only
```

Expected UI result: save succeeds and the dirty state clears.

- [ ] **Step 4: Read back the saved config files**

Run:

```bash
python - <<'PY'
from pathlib import Path
print(Path.home().joinpath('.hermes/config.yaml').read_text())
print('---ENV---')
print(Path.home().joinpath('.hermes/.env').read_text())
PY
```

Expected: `_ui.channels` contains the enabled platforms and `.env` contains the entered values under the new keys.

- [ ] **Step 5: Re-open Hermes config through the app**

In the running app, reload or re-open the Hermes page.
Expected: the fields round-trip and render the same saved values.

- [ ] **Step 6: Restart Hermes gateway**

Use the app’s Hermes controls or run:

```bash
hermes gateway >/tmp/hermes-gateway.log 2>&1 & echo $!
```

Expected: Hermes starts without immediate config-shape failure. External-service-dependent channels may remain non-functional if their external systems are not running, but Hermes must not crash because of bad key names or malformed config.

- [ ] **Step 7: Inspect startup output if Hermes exits**

Run: `python - <<'PY'
from pathlib import Path
p = Path('/tmp/hermes-gateway.log')
print(p.read_text() if p.exists() else 'no log file')
PY`
Expected: no errors caused by the desktop app writing incorrect channel keys.

- [ ] **Step 8: Commit the verification fixes if any were needed**

```bash
git add frontend/src/main/services/hermes.service.ts frontend/src/renderer/src/pages/Hermes/HermesPage.tsx frontend/src/renderer/src/i18n/index.ts frontend/src/renderer/src/types/hermes.ts frontend/src/renderer/src/pages/Hermes/hermes-provider-helpers.ts frontend/src/renderer/src/pages/Hermes/hermes-channel-registry.ts frontend/src/main/services/__tests__/hermes.service.test.ts frontend/src/renderer/src/pages/Hermes/__tests__/hermes-provider-helpers.test.ts frontend/src/renderer/src/pages/Hermes/__tests__/hermes-channel-registry.test.ts
git commit -m "fix: verify Hermes channel expansion"
```

---

## Self-Review

### Spec coverage

- 16-channel scope: covered by Tasks 1, 2, 3, and 5.
- Minimum field exposure only: covered by Task 2 registry and Task 5 renderer.
- Credentials in `.env` and enablement in `_ui.channels`: covered by Task 3.
- No compatibility layer: covered by Task 1 type/default replacement and Task 3 persistence replacement.
- External-setup notes: covered by Task 4 and rendered in Task 5.
- Persistence and gateway validation: covered by Task 6.

No spec gaps remain.

### Placeholder scan

- No `TODO`, `TBD`, or deferred steps remain.
- Each code-writing step includes concrete code.
- Each verification step includes a concrete command and expected result.

### Type consistency

- `signal` consistently uses `http_url` and `account`.
- `matrix` consistently uses `homeserver` and `access_token`.
- `sms` consistently uses `account_sid`, `auth_token`, `phone_number`, and `webhook_url`.
- `qqbot` consistently uses `app_id` and `client_secret`.

---
