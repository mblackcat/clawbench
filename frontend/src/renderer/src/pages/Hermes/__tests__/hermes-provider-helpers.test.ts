import { describe, expect, it } from 'vitest'
import {
  buildProviderBadgeKey,
  createDefaultHermesConfig,
  getDefaultModelConfig,
  getProviderGroups,
  getProviderMeta,
  getProviderSummaryModel,
  getVisibleProviderIds,
} from '../hermes-provider-helpers'

describe('hermes provider helpers', () => {
  it('groups mainstream providers and keeps Qwen API distinct from Qwen OAuth', () => {
    const groups = getProviderGroups()
    const hosted = groups.find((group) => group.id === 'hosted')
    const oauth = groups.find((group) => group.id === 'oauth')

    expect(hosted?.providers.map((provider) => provider.id)).toContain('qwen')
    expect(oauth?.providers.map((provider) => provider.id)).toContain('qwen-portal')
    expect(getVisibleProviderIds()).toContain('deepseek')
    expect(getVisibleProviderIds()).toContain('minimax')
    expect(getVisibleProviderIds()).toContain('kimi')
    expect(getVisibleProviderIds()).toContain('glm')
    expect(getVisibleProviderIds()).toContain('ark')
  })

  it('creates the correct default channel shape for every Hermes platform', () => {
    expect(createDefaultHermesConfig().channels).toEqual({
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
    })
  })

  it('creates the correct default model config for Bedrock and compatible endpoints', () => {
    expect(getDefaultModelConfig('bedrock')).toMatchObject({
      provider: 'bedrock',
      authType: 'aws',
      aws: { region: 'us-east-1' },
    })

    expect(getDefaultModelConfig('custom-openai-compatible')).toMatchObject({
      provider: 'custom-openai-compatible',
      authType: 'compatible',
      base_url: '',
      headers: {},
    })
  })

  it('returns curated model suggestions for mainstream providers', () => {
    const anthropic = getProviderMeta('anthropic')
    const deepseek = getProviderMeta('deepseek')

    expect(anthropic.recommendedModels.length).toBeGreaterThanOrEqual(3)
    expect(deepseek.recommendedModels.map((model) => model.value)).toContain('deepseek-chat')
  })

  it('builds provider summary metadata for the UI', () => {
    expect(getProviderSummaryModel('anthropic')).toBe('claude-sonnet-4-20250514')
    expect(getProviderSummaryModel('ark')).toBe('doubao-pro-32k')
    expect(buildProviderBadgeKey('aws')).toBe('hermes.auth.aws')
    expect(buildProviderBadgeKey('oauth')).toBe('hermes.auth.oauth')
  })
})
