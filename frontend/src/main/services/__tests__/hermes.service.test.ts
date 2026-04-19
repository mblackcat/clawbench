import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeHermesConfigForSave, readHermesConfigFromSources } from '../hermes.service'

describe('hermes.service config mapping', () => {
  beforeEach(() => {
    process.env.HOME = '/tmp/hermes-test-home'
  })

  it('reads the full 16-channel schema and env values from persisted sources', () => {
    const config = readHermesConfigFromSources(
      {
        model: { provider: 'anthropic', default: 'claude-opus-4-6' },
        memory: { memory_enabled: true, user_profile_enabled: true },
        agent: { max_turns: 50, reasoning_effort: 'medium' },
        _ui: {
          channels: {
            telegram: true,
            discord: true,
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
          },
        },
      },
      {
        ANTHROPIC_API_KEY: 'secret',
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        DISCORD_BOT_TOKEN: 'discord-token',
        SLACK_BOT_TOKEN: 'slack-bot-token',
        SLACK_APP_TOKEN: 'slack-app-token',
        SIGNAL_HTTP_URL: 'http://signal.local',
        SIGNAL_ACCOUNT: '+1234567890',
        WHATSAPP_ENABLED: 'true',
        MATRIX_HOMESERVER: 'https://matrix.local',
        MATRIX_ACCESS_TOKEN: 'matrix-access-token',
        MATTERMOST_URL: 'https://mattermost.local',
        MATTERMOST_TOKEN: 'mattermost-token',
        HASS_URL: 'https://ha.local',
        HASS_TOKEN: 'hass-token',
        DINGTALK_CLIENT_ID: 'dingtalk-client-id',
        DINGTALK_CLIENT_SECRET: 'dingtalk-client-secret',
        FEISHU_APP_ID: 'feishu-app-id',
        FEISHU_APP_SECRET: 'feishu-app-secret',
        WECOM_BOT_ID: 'wecom-bot-id',
        WECOM_SECRET: 'wecom-secret',
        WEIXIN_TOKEN: 'weixin-token',
        WEIXIN_ACCOUNT_ID: 'weixin-account-id',
        TWILIO_ACCOUNT_SID: 'twilio-account-sid',
        TWILIO_AUTH_TOKEN: 'twilio-auth-token',
        TWILIO_PHONE_NUMBER: '+15555550123',
        SMS_WEBHOOK_URL: 'https://sms.local/webhook',
        EMAIL_ADDRESS: 'agent@example.com',
        EMAIL_PASSWORD: 'email-password',
        EMAIL_IMAP_HOST: 'imap.example.com',
        EMAIL_SMTP_HOST: 'smtp.example.com',
        BLUEBUBBLES_SERVER_URL: 'https://bluebubbles.local',
        BLUEBUBBLES_PASSWORD: 'bluebubbles-password',
        QQ_APP_ID: 'qq-app-id',
        QQ_CLIENT_SECRET: 'qq-client-secret',
      }
    )

    expect(config.model.provider).toBe('anthropic')
    expect(config.model.authType).toBe('api_key')
    expect(config.model.apiKey).toBe('secret')

    expect(config.channels.telegram).toEqual({ enabled: true, token: 'telegram-token' })
    expect(config.channels.discord).toEqual({ enabled: true, token: 'discord-token' })
    expect(config.channels.slack).toEqual({ enabled: true, bot_token: 'slack-bot-token', app_token: 'slack-app-token' })
    expect(config.channels.signal).toEqual({ enabled: true, http_url: 'http://signal.local', account: '+1234567890' })
    expect(config.channels.whatsapp).toEqual({ enabled: true })
    expect(config.channels.matrix).toEqual({ enabled: true, homeserver: 'https://matrix.local', access_token: 'matrix-access-token' })
    expect(config.channels.mattermost).toEqual({ enabled: true, url: 'https://mattermost.local', token: 'mattermost-token' })
    expect(config.channels.homeassistant).toEqual({ enabled: true, url: 'https://ha.local', token: 'hass-token' })
    expect(config.channels.dingtalk).toEqual({ enabled: true, client_id: 'dingtalk-client-id', client_secret: 'dingtalk-client-secret' })
    expect(config.channels.feishu).toEqual({ enabled: true, app_id: 'feishu-app-id', app_secret: 'feishu-app-secret' })
    expect(config.channels.wecom).toEqual({ enabled: true, bot_id: 'wecom-bot-id', secret: 'wecom-secret' })
    expect(config.channels.weixin).toEqual({ enabled: true, token: 'weixin-token', account_id: 'weixin-account-id' })
    expect(config.channels.sms).toEqual({
      enabled: true,
      account_sid: 'twilio-account-sid',
      auth_token: 'twilio-auth-token',
      phone_number: '+15555550123',
      webhook_url: 'https://sms.local/webhook',
    })
    expect(config.channels.email).toEqual({
      enabled: true,
      address: 'agent@example.com',
      password: 'email-password',
      imap_host: 'imap.example.com',
      smtp_host: 'smtp.example.com',
    })
    expect(config.channels.bluebubbles).toEqual({ enabled: true, server_url: 'https://bluebubbles.local', password: 'bluebubbles-password' })
    expect(config.channels.qqbot).toEqual({ enabled: true, app_id: 'qq-app-id', client_secret: 'qq-client-secret' })
  })

  it('normalizes all 16 channels into yaml flags and env secrets', () => {
    const normalized = normalizeHermesConfigForSave({
      model: {
        provider: 'bedrock',
        model: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
        base_url: '',
        authType: 'aws',
        apiKey: '',
        aws: {
          region: 'us-west-2',
          profile: 'team',
          accessKeyId: 'AKIA123',
          secretAccessKey: 'secret',
          sessionToken: 'token',
        },
      },
      channels: {
        telegram: { enabled: true, token: 'telegram-token' },
        discord: { enabled: true, token: 'discord-token' },
        slack: { enabled: true, bot_token: 'slack-bot-token', app_token: 'slack-app-token' },
        signal: { enabled: true, http_url: 'http://signal.local', account: '+1234567890' },
        whatsapp: { enabled: true },
        matrix: { enabled: true, homeserver: 'https://matrix.local', access_token: 'matrix-access-token' },
        mattermost: { enabled: true, url: 'https://mattermost.local', token: 'mattermost-token' },
        homeassistant: { enabled: true, url: 'https://ha.local', token: 'hass-token' },
        dingtalk: { enabled: true, client_id: 'dingtalk-client-id', client_secret: 'dingtalk-client-secret' },
        feishu: { enabled: true, app_id: 'feishu-app-id', app_secret: 'feishu-app-secret' },
        wecom: { enabled: true, bot_id: 'wecom-bot-id', secret: 'wecom-secret' },
        weixin: { enabled: true, token: 'weixin-token', account_id: 'weixin-account-id' },
        sms: {
          enabled: true,
          account_sid: 'twilio-account-sid',
          auth_token: 'twilio-auth-token',
          phone_number: '+15555550123',
          webhook_url: 'https://sms.local/webhook',
        },
        email: {
          enabled: true,
          address: 'agent@example.com',
          password: 'email-password',
          imap_host: 'imap.example.com',
          smtp_host: 'smtp.example.com',
        },
        bluebubbles: { enabled: true, server_url: 'https://bluebubbles.local', password: 'bluebubbles-password' },
        qqbot: { enabled: true, app_id: 'qq-app-id', client_secret: 'qq-client-secret' },
      },
      agent: { memory_enabled: true, user_profile_enabled: true, max_turns: 50, reasoning_effort: 'medium' },
    })

    expect(normalized.yaml.model.provider).toBe('bedrock')
    expect(normalized.yaml.model.default).toBe('anthropic.claude-3-7-sonnet-20250219-v1:0')
    expect(normalized.yaml.aws.region).toBe('us-west-2')
    expect(normalized.yaml._ui.channels).toEqual({
      telegram: true,
      discord: true,
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
      DISCORD_BOT_TOKEN: 'discord-token',
      SLACK_BOT_TOKEN: 'slack-bot-token',
      SLACK_APP_TOKEN: 'slack-app-token',
      SIGNAL_HTTP_URL: 'http://signal.local',
      SIGNAL_ACCOUNT: '+1234567890',
      WHATSAPP_ENABLED: 'true',
      MATRIX_HOMESERVER: 'https://matrix.local',
      MATRIX_ACCESS_TOKEN: 'matrix-access-token',
      MATTERMOST_URL: 'https://mattermost.local',
      MATTERMOST_TOKEN: 'mattermost-token',
      HASS_URL: 'https://ha.local',
      HASS_TOKEN: 'hass-token',
      DINGTALK_CLIENT_ID: 'dingtalk-client-id',
      DINGTALK_CLIENT_SECRET: 'dingtalk-client-secret',
      FEISHU_APP_ID: 'feishu-app-id',
      FEISHU_APP_SECRET: 'feishu-app-secret',
      WECOM_BOT_ID: 'wecom-bot-id',
      WECOM_SECRET: 'wecom-secret',
      WEIXIN_TOKEN: 'weixin-token',
      WEIXIN_ACCOUNT_ID: 'weixin-account-id',
      TWILIO_ACCOUNT_SID: 'twilio-account-sid',
      TWILIO_AUTH_TOKEN: 'twilio-auth-token',
      TWILIO_PHONE_NUMBER: '+15555550123',
      SMS_WEBHOOK_URL: 'https://sms.local/webhook',
      EMAIL_ADDRESS: 'agent@example.com',
      EMAIL_PASSWORD: 'email-password',
      EMAIL_IMAP_HOST: 'imap.example.com',
      EMAIL_SMTP_HOST: 'smtp.example.com',
      BLUEBUBBLES_SERVER_URL: 'https://bluebubbles.local',
      BLUEBUBBLES_PASSWORD: 'bluebubbles-password',
      QQ_APP_ID: 'qq-app-id',
      QQ_CLIENT_SECRET: 'qq-client-secret',
      AWS_PROFILE: 'team',
      AWS_ACCESS_KEY_ID: 'AKIA123',
      AWS_SECRET_ACCESS_KEY: 'secret',
      AWS_SESSION_TOKEN: 'token',
    })
  })
})

