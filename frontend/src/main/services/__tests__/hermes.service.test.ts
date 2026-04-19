import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeHermesConfigForSave, readHermesConfigFromSources } from '../hermes.service'

describe('hermes.service config mapping', () => {
  beforeEach(() => {
    process.env.HOME = '/tmp/hermes-test-home'
  })

  it('keeps legacy configs readable while expanding Bedrock and compatible config buckets', () => {
    const config = readHermesConfigFromSources(
      {
        model: { provider: 'anthropic', default: 'claude-opus-4-6' },
        memory: { memory_enabled: true, user_profile_enabled: true },
        agent: { max_turns: 50, reasoning_effort: 'medium' },
      },
      { ANTHROPIC_API_KEY: 'secret' }
    )

    expect(config.model.provider).toBe('anthropic')
    expect(config.model.authType).toBe('api_key')
    expect(config.model.apiKey).toBe('secret')
  })

  it('normalizes Bedrock config into YAML fields and env secrets', () => {
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
        telegram: { enabled: false, token: '' },
        discord: { enabled: false, token: '' },
        slack: { enabled: false, bot_token: '', app_token: '' },
        signal: { enabled: false, phone: '' },
      },
      agent: { memory_enabled: true, user_profile_enabled: true, max_turns: 50, reasoning_effort: 'medium' },
    })

    expect(normalized.yaml.model.provider).toBe('bedrock')
    expect(normalized.yaml.model.default).toBe('anthropic.claude-3-7-sonnet-20250219-v1:0')
    expect(normalized.yaml.aws.region).toBe('us-west-2')
    expect(normalized.env.AWS_PROFILE).toBe('team')
    expect(normalized.env.AWS_ACCESS_KEY_ID).toBe('AKIA123')
  })
})
