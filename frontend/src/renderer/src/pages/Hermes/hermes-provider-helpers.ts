import type { HermesAuthType, HermesConfig, HermesProviderMeta } from '../../types/hermes'
import { HERMES_PROVIDER_REGISTRY } from './hermes-provider-registry'

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

const DEFAULT_AGENT: HermesConfig['agent'] = {
  memory_enabled: true,
  user_profile_enabled: true,
  max_turns: 50,
  reasoning_effort: 'medium',
}

export function getProviderMeta(providerId: string): HermesProviderMeta {
  const provider = HERMES_PROVIDER_REGISTRY.find((item) => item.id === providerId)
  if (!provider) {
    throw new Error(`Unknown Hermes provider: ${providerId}`)
  }
  return provider
}

export function getProviderGroups() {
  return [
    { id: 'hosted' as const, providers: HERMES_PROVIDER_REGISTRY.filter((provider) => provider.group === 'hosted') },
    { id: 'oauth' as const, providers: HERMES_PROVIDER_REGISTRY.filter((provider) => provider.group === 'oauth') },
    {
      id: 'self-hosted-compatible' as const,
      providers: HERMES_PROVIDER_REGISTRY.filter((provider) => provider.group === 'self-hosted-compatible'),
    },
  ]
}

export function getVisibleProviderIds(): string[] {
  return HERMES_PROVIDER_REGISTRY.map((provider) => provider.id)
}

export function getDefaultModelConfig(providerId: string): HermesConfig['model'] {
  const provider = getProviderMeta(providerId)
  return {
    provider: provider.id,
    model: provider.defaultModel,
    base_url: '',
    authType: provider.authType,
    apiKey: '',
    oauth: provider.authType === 'oauth' ? { configured: false, accountLabel: '', authMode: 'oauth' } : undefined,
    aws: provider.authType === 'aws' ? { region: 'us-east-1', profile: '' } : undefined,
    headers: provider.authType === 'compatible' ? {} : undefined,
    extra: provider.authType === 'compatible' ? {} : undefined,
    local: provider.authType === 'local' ? { toolCallParser: '', contextWindow: '', endpointHint: '' } : undefined,
  }
}

export function createDefaultHermesConfig(providerId = 'anthropic'): HermesConfig {
  return {
    model: getDefaultModelConfig(providerId),
    channels: structuredClone(DEFAULT_CHANNELS),
    agent: { ...DEFAULT_AGENT },
  }
}

export function getProviderSummaryModel(providerId: string): string {
  return getProviderMeta(providerId).defaultModel
}

export function buildProviderBadgeKey(authType: HermesAuthType): string {
  if (authType === 'aws') return 'hermes.auth.aws'
  if (authType === 'oauth') return 'hermes.auth.oauth'
  if (authType === 'local') return 'hermes.auth.local'
  if (authType === 'compatible') return 'hermes.auth.compatible'
  return 'hermes.auth.apiKey'
}
