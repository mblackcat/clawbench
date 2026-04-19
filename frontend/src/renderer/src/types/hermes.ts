export type HermesServiceStatus = 'running' | 'stopped' | 'unknown'

export type HermesProviderGroupId = 'hosted' | 'oauth' | 'self-hosted-compatible'
export type HermesAuthType = 'api_key' | 'oauth' | 'aws' | 'local' | 'compatible'

export interface HermesModelOption {
  value: string
  label: string
  hint?: string
}

export interface HermesProviderFieldOption {
  value: string
  label: string
}

export interface HermesProviderFieldSchema {
  key: string
  labelKey: string
  type: 'text' | 'password' | 'select'
  placeholder?: string
  options?: HermesProviderFieldOption[]
}

export interface HermesProviderMeta {
  id: string
  group: HermesProviderGroupId
  authType: HermesAuthType
  titleKey: string
  descriptionKey: string
  docsUrl?: string
  badgeKey: string
  modelSummaryKey: string
  defaultModel: string
  recommendedModels: HermesModelOption[]
  fields: HermesProviderFieldSchema[]
}

export interface HermesConfig {
  model: {
    provider: string
    model: string
    base_url: string
    authType: HermesAuthType
    apiKey: string
    oauth?: {
      configured?: boolean
      accountLabel?: string
      authMode?: string
    }
    aws?: {
      region?: string
      profile?: string
      accessKeyId?: string
      secretAccessKey?: string
      sessionToken?: string
      bedrockBaseUrl?: string
    }
    headers?: Record<string, string>
    extra?: Record<string, string>
    local?: {
      toolCallParser?: string
      contextWindow?: string
      endpointHint?: string
    }
  }
  channels: {
    telegram: { enabled: boolean; token: string }
    discord: { enabled: boolean; token: string }
    slack: { enabled: boolean; bot_token: string; app_token: string }
    signal: { enabled: boolean; phone: string }
  }
  agent: {
    memory_enabled: boolean
    user_profile_enabled: boolean
    max_turns: number
    reasoning_effort: string
  }
}
