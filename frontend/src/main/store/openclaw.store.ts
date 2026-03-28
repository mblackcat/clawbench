import Store from 'electron-store'

export interface OpenClawConfigField {
  key: string
  label: string
  type: 'text' | 'password' | 'number' | 'select' | 'model-tags'
  placeholder?: string
  required?: boolean
  defaultValue?: string
  options?: { label: string; value: string }[]
}

export interface OpenClawItem {
  id: string
  name: string
  icon?: string
  description: string
  enabled: boolean
  category: 'ai_provider' | 'comm_tool' | 'skill' | 'builtin_feature'
  configFields: OpenClawConfigField[]
  configValues: Record<string, string>
  /** Link to the official API key / credential signup page */
  docsUrl?: string
  /** Link to the OpenClaw configuration guide for this item */
  openclawDocsUrl?: string
}

interface OpenClawSchema {
  installPath: string
  items: OpenClawItem[]
  installedSkills: string[]
  modelPriority: string[]
}

export const openclawStore = new Store<OpenClawSchema>({
  name: 'openclaw',
  schema: {
    installPath: {
      type: 'string',
      default: ''
    },
    items: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          icon: { type: 'string' },
          description: { type: 'string' },
          enabled: { type: 'boolean' },
          category: { type: 'string' },
          configFields: { type: 'array' },
          configValues: { type: 'object' }
        }
      }
    },
    installedSkills: {
      type: 'array',
      default: [],
      items: { type: 'string' }
    },
    modelPriority: {
      type: 'array',
      default: [],
      items: { type: 'string' }
    }
  }
})

export function getDefaultItems(): OpenClawItem[] {
  return [
    // ── AI 服务商 (AI Service Providers) ──
    // Built-in providers: only need apiKey (OpenClaw has built-in catalog)
    {
      id: 'openai',
      name: 'OpenAI',
      description: 'OpenAI GPT 系列模型（内置服务商，仅需 API Key）',
      enabled: false,
      category: 'ai_provider',
      configFields: [
        { key: 'apiKey', label: 'API Key', type: 'password', required: true },
        {
          key: 'models',
          label: '模型列表',
          type: 'model-tags',
          placeholder: '选择或输入模型 ID',
          options: [
            { label: 'gpt-5.3-codex', value: 'openai/gpt-5.3-codex' },
            { label: 'gpt-5.2-codex', value: 'openai/gpt-5.2-codex' },
            { label: 'gpt-5.1-codex-max', value: 'openai/gpt-5.1-codex-max' },
            { label: 'gpt-5.2', value: 'openai/gpt-5.2' },
            { label: 'gpt-5.1-codex-mini', value: 'openai/gpt-5.1-codex-mini' },
            { label: 'gpt-4o', value: 'openai/gpt-4o' },
            { label: 'gpt-4o-mini', value: 'openai/gpt-4o-mini' }
          ]
        }
      ],
      configValues: {
        apiKey: '',
        models: 'openai/gpt-5.3-codex,openai/gpt-5.2-codex,openai/gpt-5.1-codex-max,openai/gpt-5.2,openai/gpt-5.1-codex-mini'
      },
      docsUrl: 'https://platform.openai.com/api-keys',
      openclawDocsUrl: 'https://docs.openclaw.ai/providers/openai'
    },
    {
      id: 'anthropic',
      name: 'Anthropic (Claude)',
      description: 'Anthropic Claude 系列模型（内置服务商，仅需 API Key）',
      enabled: false,
      category: 'ai_provider',
      configFields: [
        { key: 'apiKey', label: 'API Key', type: 'password', required: true },
        {
          key: 'models',
          label: '模型列表',
          type: 'model-tags',
          placeholder: '选择或输入模型 ID',
          options: [
            { label: 'claude-opus-4-6', value: 'anthropic/claude-opus-4-6' },
            { label: 'claude-sonnet-4-6', value: 'anthropic/claude-sonnet-4-6' },
            { label: 'claude-sonnet-4-5-20250929', value: 'anthropic/claude-sonnet-4-5-20250929' },
            { label: 'claude-opus-4-5-20251101', value: 'anthropic/claude-opus-4-5-20251101' },
            { label: 'claude-haiku-4-5-20251001', value: 'anthropic/claude-haiku-4-5-20251001' }
          ]
        }
      ],
      configValues: {
        apiKey: '',
        models: 'anthropic/claude-opus-4-6,anthropic/claude-sonnet-4-6,anthropic/claude-sonnet-4-5-20250929,anthropic/claude-opus-4-5-20251101,anthropic/claude-haiku-4-5-20251001'
      },
      docsUrl: 'https://console.anthropic.com/settings/keys',
      openclawDocsUrl: 'https://docs.openclaw.ai/providers/anthropic'
    },
    {
      id: 'google',
      name: 'Google Gemini',
      description: 'Google Gemini 系列模型（内置服务商，仅需 API Key）',
      enabled: false,
      category: 'ai_provider',
      configFields: [
        { key: 'apiKey', label: 'API Key', type: 'password', required: true },
        {
          key: 'models',
          label: '模型列表',
          type: 'model-tags',
          placeholder: '选择或输入模型 ID',
          options: [
            { label: 'gemini-3.1-pro-preview', value: 'google/gemini-3.1-pro-preview' },
            { label: 'gemini-3-pro-preview', value: 'google/gemini-3-pro-preview' },
            { label: 'gemini-3-flash', value: 'google/gemini-3-flash' },
            { label: 'gemini-2.5-flash', value: 'google/gemini-2.5-flash' },
            { label: 'gemini-2.0-flash', value: 'google/gemini-2.0-flash' },
            { label: 'gemini-1.5-pro', value: 'google/gemini-1.5-pro' }
          ]
        }
      ],
      configValues: {
        apiKey: '',
        models: 'google/gemini-3.1-pro-preview,google/gemini-3-pro-preview,google/gemini-3-flash,google/gemini-2.5-flash'
      },
      docsUrl: 'https://aistudio.google.com/app/apikey',
      openclawDocsUrl: 'https://docs.openclaw.ai/concepts/model-providers#google-gemini-api-key'
    },
    {
      id: 'google-gemini-cli',
      name: 'Google Gemini CLI (OAuth)',
      description: 'Google Gemini CLI 插件，支持 OAuth 授权免 API Key，或直接使用 API Key',
      enabled: false,
      category: 'ai_provider',
      configFields: [
        {
          key: 'authMode',
          label: '授权方式',
          type: 'select',
          options: [
            { label: 'OAuth（推荐，免 API Key）', value: 'oauth' },
            { label: 'API Key', value: 'api_key' }
          ]
        },
        { key: 'apiKey', label: 'API Key（仅 API Key 模式需要）', type: 'password' },
        { key: 'oauthEmail', label: '已授权账号', type: 'text', placeholder: '点击下方按钮完成 Google 授权后自动填入' },
        {
          key: 'models',
          label: '模型列表',
          type: 'model-tags',
          placeholder: '选择或输入模型 ID',
          options: [
            { label: 'gemini-3.1-pro-preview', value: 'gemini-3.1-pro-preview' },
            { label: 'gemini-3-pro-preview', value: 'gemini-3-pro-preview' },
            { label: 'gemini-3-flash', value: 'gemini-3-flash' },
            { label: 'gemini-2.5-flash', value: 'gemini-2.5-flash' },
            { label: 'gemini-2.0-flash', value: 'gemini-2.0-flash' },
            { label: 'gemini-1.5-pro', value: 'gemini-1.5-pro' }
          ]
        }
      ],
      configValues: {
        authMode: 'oauth',
        apiKey: '',
        oauthEmail: '',
        models: 'gemini-3.1-pro-preview,gemini-3-pro-preview,gemini-3-flash'
      },
      openclawDocsUrl: 'https://docs.openclaw.ai/concepts/model-providers#google-gemini-cli'
    },
    // Custom providers: need baseUrl + apiKey + api protocol + models
    {
      id: 'deepseek',
      name: 'DeepSeek',
      description: 'DeepSeek 深度求索（自定义服务商，需要配置端点和模型列表）',
      enabled: false,
      category: 'ai_provider',
      configFields: [
        { key: 'baseUrl', label: 'API 地址', type: 'text', required: true, defaultValue: 'https://api.deepseek.com/v1' },
        { key: 'apiKey', label: 'API Key', type: 'password', required: true },
        {
          key: 'api', label: 'API 协议', type: 'select', required: true,
          options: [
            { label: 'OpenAI Completions', value: 'openai-completions' },
            { label: 'OpenAI Responses', value: 'openai-responses' },
            { label: 'Anthropic Messages', value: 'anthropic-messages' },
            { label: 'Google Generative AI', value: 'google-generative-ai' }
          ]
        },
        {
          key: 'models', label: '模型列表', type: 'model-tags', required: true,
          placeholder: '选择或输入模型 ID',
          options: [
            { label: 'deepseek-chat', value: 'deepseek-chat' },
            { label: 'deepseek-reasoner', value: 'deepseek-reasoner' },
            { label: 'deepseek-ocr-2', value: 'deepseek-ocr-2' }
          ]
        }
      ],
      configValues: { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', api: 'openai-completions', models: 'deepseek-chat,deepseek-reasoner,deepseek-ocr-2' },
      docsUrl: 'https://platform.deepseek.com/api_keys'
    },
    {
      id: 'minimax',
      name: 'MiniMax',
      description: 'MiniMax 海螺 AI 系列模型（OpenAI 兼容）',
      enabled: false,
      category: 'ai_provider',
      configFields: [
        { key: 'baseUrl', label: 'API 地址', type: 'text', required: true, defaultValue: 'https://api.minimax.chat/v1' },
        { key: 'apiKey', label: 'API Key', type: 'password', required: true },
        {
          key: 'api', label: 'API 协议', type: 'select', required: true,
          options: [
            { label: 'OpenAI Completions', value: 'openai-completions' },
            { label: 'OpenAI Responses', value: 'openai-responses' }
          ]
        },
        {
          key: 'models', label: '模型列表', type: 'model-tags', required: true,
          placeholder: '选择或输入模型 ID',
          options: [
            { label: 'minimax-m2.5', value: 'minimax-m2.5' },
            { label: 'minimax-m2.1', value: 'minimax-m2.1' },
            { label: 'hailuo-2.3', value: 'hailuo-2.3' }
          ]
        }
      ],
      configValues: { baseUrl: 'https://api.minimax.chat/v1', apiKey: '', api: 'openai-completions', models: 'minimax-m2.5,minimax-m2.1,hailuo-2.3' },
      docsUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key'
    },
    {
      id: 'moonshot',
      name: 'Moonshot AI (Kimi)',
      description: 'Moonshot Kimi 系列长上下文模型（OpenAI 兼容）',
      enabled: false,
      category: 'ai_provider',
      configFields: [
        { key: 'baseUrl', label: 'API 地址', type: 'text', required: true, defaultValue: 'https://api.moonshot.cn/v1' },
        { key: 'apiKey', label: 'API Key', type: 'password', required: true },
        {
          key: 'api', label: 'API 协议', type: 'select', required: true,
          options: [
            { label: 'OpenAI Completions', value: 'openai-completions' },
            { label: 'OpenAI Responses', value: 'openai-responses' }
          ]
        },
        {
          key: 'models', label: '模型列表', type: 'model-tags', required: true,
          placeholder: '选择或输入模型 ID',
          options: [
            { label: 'kimi-k2.5', value: 'kimi-k2.5' },
            { label: 'kimi-k2-thinking', value: 'kimi-k2-thinking' },
            { label: 'kimi-k2-turbo-preview', value: 'kimi-k2-turbo-preview' },
            { label: 'moonshot-v1-128k', value: 'moonshot-v1-128k' },
            { label: 'moonshot-v1-32k', value: 'moonshot-v1-32k' },
            { label: 'moonshot-v1-8k', value: 'moonshot-v1-8k' }
          ]
        }
      ],
      configValues: { baseUrl: 'https://api.moonshot.cn/v1', apiKey: '', api: 'openai-completions', models: 'kimi-k2.5,kimi-k2-thinking,kimi-k2-turbo-preview,moonshot-v1-128k,moonshot-v1-32k,moonshot-v1-8k' },
      docsUrl: 'https://platform.moonshot.cn/console/api-keys'
    },
    {
      id: 'qwen',
      name: '通义千问 (Qwen)',
      description: '阿里云通义千问系列模型（OpenAI 兼容接口）',
      enabled: false,
      category: 'ai_provider',
      configFields: [
        { key: 'baseUrl', label: 'API 地址', type: 'text', required: true, defaultValue: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
        { key: 'apiKey', label: 'API Key (DashScope)', type: 'password', required: true },
        {
          key: 'api', label: 'API 协议', type: 'select', required: true,
          options: [
            { label: 'OpenAI Completions', value: 'openai-completions' },
            { label: 'OpenAI Responses', value: 'openai-responses' }
          ]
        },
        {
          key: 'models', label: '模型列表', type: 'model-tags', required: true,
          placeholder: '选择或输入模型 ID',
          options: [
            { label: 'qwen-3.5-max', value: 'qwen-3.5-max' },
            { label: 'qwen-3.5-turbo', value: 'qwen-3.5-turbo' },
            { label: 'qwen-3-max', value: 'qwen-3-max' },
            { label: 'qwen-plus', value: 'qwen-plus' },
            { label: 'qwen-turbo', value: 'qwen-turbo' },
            { label: 'qwen-max-longcontext', value: 'qwen-max-longcontext' }
          ]
        }
      ],
      configValues: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', api: 'openai-completions', models: 'qwen-3.5-max,qwen-3.5-turbo,qwen-3-max,qwen-plus,qwen-turbo,qwen-max-longcontext' },
      docsUrl: 'https://bailian.console.aliyun.com/?apiKey=1'
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      description: '统一路由访问数百个 AI 模型（OpenAI 兼容）',
      enabled: false,
      category: 'ai_provider',
      configFields: [
        { key: 'baseUrl', label: 'API 地址', type: 'text', required: true, defaultValue: 'https://openrouter.ai/api/v1' },
        { key: 'apiKey', label: 'API Key', type: 'password', required: true },
        {
          key: 'api', label: 'API 协议', type: 'select', required: true,
          options: [
            { label: 'OpenAI Completions', value: 'openai-completions' },
            { label: 'OpenAI Responses', value: 'openai-responses' }
          ]
        },
        {
          key: 'models', label: '模型列表', type: 'model-tags', required: true,
          placeholder: '选择或输入模型 ID',
          options: [
            { label: 'openai/gpt-4o', value: 'openai/gpt-4o' },
            { label: 'anthropic/claude-opus-4-6', value: 'anthropic/claude-opus-4-6' },
            { label: 'google/gemini-2.0-flash', value: 'google/gemini-2.0-flash' }
          ]
        }
      ],
      configValues: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', api: 'openai-completions', models: 'openai/gpt-4o,anthropic/claude-opus-4-6,google/gemini-2.0-flash' },
      docsUrl: 'https://openrouter.ai/keys'
    },
    {
      id: 'zhipu',
      name: '智谱 AI (GLM)',
      description: '智谱 AI GLM 系列模型（OpenAI 兼容）',
      enabled: false,
      category: 'ai_provider',
      configFields: [
        { key: 'baseUrl', label: 'API 地址', type: 'text', required: true, defaultValue: 'https://open.bigmodel.cn/api/paas/v4' },
        { key: 'apiKey', label: 'API Key', type: 'password', required: true },
        {
          key: 'api', label: 'API 协议', type: 'select', required: true,
          options: [
            { label: 'OpenAI Completions', value: 'openai-completions' },
            { label: 'OpenAI Responses', value: 'openai-responses' }
          ]
        },
        {
          key: 'models', label: '模型列表', type: 'model-tags', required: true,
          placeholder: '选择或输入模型 ID',
          options: [
            { label: 'glm-5', value: 'glm-5' },
            { label: 'glm-4.7', value: 'glm-4.7' }
          ]
        }
      ],
      configValues: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '', api: 'openai-completions', models: 'glm-5,glm-4.7' },
      docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys'
    },
    {
      id: 'ark',
      name: '方舟 (Ark)',
      description: '火山引擎方舟大模型平台（OpenAI 兼容）',
      enabled: false,
      category: 'ai_provider',
      configFields: [
        { key: 'baseUrl', label: 'API 地址', type: 'text', required: true, defaultValue: 'https://ark.cn-beijing.volces.com/api/coding/v3' },
        { key: 'apiKey', label: 'API Key', type: 'password', required: true },
        {
          key: 'api', label: 'API 协议', type: 'select', required: true,
          options: [
            { label: 'OpenAI Completions', value: 'openai-completions' },
            { label: 'OpenAI Responses', value: 'openai-responses' }
          ]
        },
        {
          key: 'models', label: '模型列表', type: 'model-tags', required: true,
          placeholder: '选择或输入模型 ID',
          options: [
            { label: 'doubao-seed-2-0-pro-260215', value: 'doubao-seed-2-0-pro-260215' },
            { label: 'doubao-seed-2-0-lite-260215', value: 'doubao-seed-2-0-lite-260215' },
            { label: 'doubao-seed-2-0-mini-260215', value: 'doubao-seed-2-0-mini-260215' },
            { label: 'doubao-seed-2-0-code-preview-260215', value: 'doubao-seed-2-0-code-preview-260215' },
            { label: 'deepseek-v3-2-251201', value: 'deepseek-v3-2-251201' },
            { label: 'glm-4-7-251222', value: 'glm-4-7-251222' }
          ]
        }
      ],
      configValues: {
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        apiKey: '',
        api: 'openai-completions',
        models: 'doubao-seed-2-0-pro-260215,doubao-seed-2-0-lite-260215,doubao-seed-2-0-mini-260215,doubao-seed-2-0-code-preview-260215,deepseek-v3-2-251201,glm-4-7-251222'
      },
      docsUrl: 'https://console.volcengine.com/ark'
    },
    {
      id: 'custom',
      name: '自定义 (LM Studio / Ollama)',
      description: '连接本地或自定义 OpenAI 兼容端点',
      enabled: false,
      category: 'ai_provider',
      configFields: [
        { key: 'baseUrl', label: 'API 地址', type: 'text', required: true, placeholder: 'http://localhost:1234/v1' },
        { key: 'apiKey', label: 'API Key', type: 'password' },
        {
          key: 'api', label: 'API 协议', type: 'select', required: true,
          options: [
            { label: 'OpenAI Completions', value: 'openai-completions' },
            { label: 'OpenAI Responses', value: 'openai-responses' },
            { label: 'Anthropic Messages', value: 'anthropic-messages' },
            { label: 'Google Generative AI', value: 'google-generative-ai' }
          ]
        },
        { key: 'models', label: '模型列表', type: 'model-tags', required: true, placeholder: '输入模型 ID 后回车' }
      ],
      configValues: { baseUrl: '', apiKey: '', api: 'openai-completions', models: '' }
    },

    // ── 通信工具 (Communication Tools) — 飞书排第一 ──
    {
      id: 'feishu',
      name: '飞书 (Feishu)',
      description: '通过飞书机器人进行对话',
      enabled: false,
      category: 'comm_tool',
      configFields: [
        { key: 'appId', label: 'App ID', type: 'text', required: true },
        { key: 'appSecret', label: 'App Secret', type: 'password', required: true }
      ],
      configValues: { appId: '', appSecret: '' },
      docsUrl: 'https://open.larkoffice.com/',
      openclawDocsUrl: 'https://docs.openclaw.ai/channels/feishu'
    },
    {
      id: 'telegram',
      name: 'Telegram',
      description: '通过 Telegram Bot 进行对话',
      enabled: false,
      category: 'comm_tool',
      configFields: [
        { key: 'botToken', label: 'Bot Token', type: 'password', required: true }
      ],
      configValues: { botToken: '' },
      docsUrl: 'https://t.me/BotFather',
      openclawDocsUrl: 'https://docs.openclaw.ai/channels/telegram'
    },
    {
      id: 'discord',
      name: 'Discord',
      description: '通过 Discord Bot 进行对话',
      enabled: false,
      category: 'comm_tool',
      configFields: [
        { key: 'token', label: 'Bot Token', type: 'password', required: true }
      ],
      configValues: { token: '' },
      docsUrl: 'https://discord.com/developers/applications',
      openclawDocsUrl: 'https://docs.openclaw.ai/channels/discord'
    },
    {
      id: 'slack',
      name: 'Slack',
      description: '通过 Slack Bot 进行对话',
      enabled: false,
      category: 'comm_tool',
      configFields: [
        { key: 'botToken', label: 'Bot Token (xoxb-)', type: 'password', required: true },
        { key: 'appToken', label: 'App Token (xapp-)', type: 'password', required: true }
      ],
      configValues: { botToken: '', appToken: '' },
      docsUrl: 'https://api.slack.com/apps',
      openclawDocsUrl: 'https://docs.openclaw.ai/channels/slack'
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp',
      description: '通过 WhatsApp 进行对话',
      enabled: false,
      category: 'comm_tool',
      configFields: [
        { key: 'phoneNumber', label: '手机号', type: 'text' }
      ],
      configValues: { phoneNumber: '' }
    },

    // ── 技能 (Skills) ──
    {
      id: 'coding',
      name: '代码编辑',
      description: '读写文件、执行命令、Git 操作（tools.profile: coding）',
      enabled: false,
      category: 'skill',
      configFields: [],
      configValues: {}
    },
    {
      id: 'elevated',
      name: '提权执行',
      description: '允许执行 sudo 等高权限命令',
      enabled: false,
      category: 'skill',
      configFields: [],
      configValues: {}
    },

    // ── 内置功能 (Built-in Features) ──
    // These map to various top-level and nested config keys in openclaw.json
    {
      id: 'web_search',
      name: '网页搜索',
      description: 'Brave Search API 驱动的网页搜索（tools.web.search）',
      enabled: false,
      category: 'builtin_feature',
      configFields: [
        { key: 'apiKey', label: 'Brave Search API Key', type: 'password', required: true }
      ],
      configValues: { apiKey: '' },
      docsUrl: 'https://brave.com/search/api/',
      openclawDocsUrl: 'https://docs.openclaw.ai/tools'
    },
    {
      id: 'web_fetch',
      name: '网页内容抓取',
      description: '抓取网页并提取可读内容（tools.web.fetch）',
      enabled: false,
      category: 'builtin_feature',
      configFields: [],
      configValues: {},
      openclawDocsUrl: 'https://docs.openclaw.ai/tools'
    },
    {
      id: 'tts',
      name: '文字转语音',
      description: 'ElevenLabs / OpenAI 语音合成（messages.tts）',
      enabled: false,
      category: 'builtin_feature',
      configFields: [
        {
          key: 'provider', label: 'TTS 服务商', type: 'select', required: true,
          options: [
            { label: 'ElevenLabs', value: 'elevenlabs' },
            { label: 'OpenAI', value: 'openai' },
            { label: 'Edge (免费)', value: 'edge' }
          ]
        },
        { key: 'apiKey', label: 'API Key（edge 无需填写）', type: 'password' }
      ],
      configValues: { provider: 'edge', apiKey: '' },
      openclawDocsUrl: 'https://docs.openclaw.ai/tools'
    },
    {
      id: 'browser',
      name: '浏览器自动化',
      description: '控制 Chromium 浏览器执行任务（顶层 browser 配置）',
      enabled: false,
      category: 'builtin_feature',
      configFields: [],
      configValues: {},
      openclawDocsUrl: 'https://docs.openclaw.ai/tools'
    },
    {
      id: 'cron',
      name: '定时任务',
      description: '设置定时任务和心跳检查（顶层 cron 配置）',
      enabled: false,
      category: 'builtin_feature',
      configFields: [],
      configValues: {},
      openclawDocsUrl: 'https://docs.openclaw.ai/tools'
    }
  ]
}

export function getOpenClawConfig(): { installPath: string; items: OpenClawItem[] } {
  let items = openclawStore.get('items')
  // Reset defaults if items are from an older schema version
  // (detect by checking if feishu item is missing openclawDocsUrl or openai item is missing openclawDocsUrl)
  if (items && items.length > 0) {
    const openaiItem = items.find((i) => i.id === 'openai')
    if (openaiItem && (openaiItem.configFields.some((f) => f.key === 'baseUrl') || !openaiItem.openclawDocsUrl)) {
      items = getDefaultItems()
      openclawStore.set('items', items)
    }
  }
  if (!items || items.length === 0) {
    items = getDefaultItems()
    openclawStore.set('items', items)
  }

  // Migration: add models field to built-in providers if not present,
  // upgrade custom provider models fields from 'text' to 'model-tags',
  // and add new providers (ark, google-gemini-cli) if missing.
  const builtinIds = ['openai', 'anthropic', 'google']
  const customProviderIds = ['deepseek', 'minimax', 'moonshot', 'qwen', 'openrouter', 'zhipu', 'custom', 'ark']
  let needsMigration = false
  const defaults = getDefaultItems()

  for (const item of items) {
    // Built-ins: add models field if missing
    if (builtinIds.includes(item.id) && !item.configFields.some((f) => f.key === 'models')) {
      const defaultItem = defaults.find((d) => d.id === item.id)!
      item.configFields.push(defaultItem.configFields.find((f) => f.key === 'models')!)
      item.configValues.models = defaultItem.configValues.models
      needsMigration = true
    }
    // Custom providers: upgrade models field type from 'text' to 'model-tags'
    if (customProviderIds.includes(item.id)) {
      const modelsField = item.configFields.find((f) => f.key === 'models')
      if (modelsField && modelsField.type === 'text') {
        const defaultItem = defaults.find((d) => d.id === item.id)
        const defaultModelsField = defaultItem?.configFields.find((f) => f.key === 'models')
        modelsField.type = 'model-tags'
        modelsField.label = defaultModelsField?.label ?? '模型列表'
        modelsField.options = defaultModelsField?.options
        modelsField.placeholder = defaultModelsField?.placeholder ?? '选择或输入模型 ID'
        needsMigration = true
      }
    }
  }

  // Add 'zhipu' provider if missing
  if (!items.some((i) => i.id === 'zhipu')) {
    const zhipuDefault = defaults.find((d) => d.id === 'zhipu')!
    const arkIdx = items.findIndex((i) => i.id === 'ark')
    if (arkIdx >= 0) {
      items.splice(arkIdx, 0, zhipuDefault)
    } else {
      const customIdx = items.findIndex((i) => i.id === 'custom')
      customIdx >= 0 ? items.splice(customIdx, 0, zhipuDefault) : items.push(zhipuDefault)
    }
    needsMigration = true
  }

  // Add 'ark' provider if missing
  if (!items.some((i) => i.id === 'ark')) {
    const arkDefault = defaults.find((d) => d.id === 'ark')!
    // Insert before 'custom' to preserve order
    const customIdx = items.findIndex((i) => i.id === 'custom')
    if (customIdx >= 0) {
      items.splice(customIdx, 0, arkDefault)
    } else {
      items.push(arkDefault)
    }
    needsMigration = true
  }

  // Add 'google-gemini-cli' provider if missing (insert after 'google')
  if (!items.some((i) => i.id === 'google-gemini-cli')) {
    const ggcDefault = defaults.find((d) => d.id === 'google-gemini-cli')!
    const googleIdx = items.findIndex((i) => i.id === 'google')
    if (googleIdx >= 0) {
      items.splice(googleIdx + 1, 0, ggcDefault)
    } else {
      const deepseekIdx = items.findIndex((i) => i.id === 'deepseek')
      deepseekIdx >= 0 ? items.splice(deepseekIdx, 0, ggcDefault) : items.push(ggcDefault)
    }
    needsMigration = true
  }

  if (needsMigration) {
    openclawStore.set('items', items)
  }

  return {
    installPath: openclawStore.get('installPath'),
    items
  }
}

export function setOpenClawConfig(config: { installPath?: string; items?: OpenClawItem[] }): void {
  if (config.installPath !== undefined) {
    openclawStore.set('installPath', config.installPath)
  }
  if (config.items !== undefined) {
    openclawStore.set('items', config.items)
  }
}

export function resetOpenClawConfig(): void {
  openclawStore.clear()
}

export function getInstalledSkills(): string[] {
  return openclawStore.get('installedSkills') || []
}

export function setInstalledSkills(ids: string[]): void {
  openclawStore.set('installedSkills', ids)
}

export function getModelPriority(): string[] {
  return openclawStore.get('modelPriority') || []
}

export function setModelPriority(priority: string[]): void {
  openclawStore.set('modelPriority', priority)
}

const BUILTIN_PROVIDER_IDS = new Set(['openai', 'anthropic', 'google'])
// Providers where models are stored WITHOUT provider prefix in configValues
// (getItemModelIds will prepend `${item.id}/` for these)
// google-gemini-cli stores bare model IDs like 'gemini-3.1-pro-preview'

/**
 * Get the global model IDs from a provider item.
 * Built-ins already store full IDs like 'anthropic/claude-opus-4-6'.
 * Custom providers store bare IDs like 'deepseek-chat' → prefixed to 'deepseek/deepseek-chat'.
 */
export function getItemModelIds(item: OpenClawItem): string[] {
  if (!item.configValues.models) return []
  return item.configValues.models
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => (BUILTIN_PROVIDER_IDS.has(item.id) ? m : `${item.id}/${m}`))
}

/**
 * Sync the model priority list against the currently configured models:
 * - Remove models no longer in any enabled provider
 * - Do NOT auto-append newly added models (they go to the pool in the UI)
 */
export function syncModelPriorityWithItems(currentPriority: string[], items: OpenClawItem[]): string[] {
  const allModels = new Set<string>()
  for (const item of items) {
    if (item.category === 'ai_provider' && item.enabled) {
      for (const id of getItemModelIds(item)) {
        allModels.add(id)
      }
    }
  }
  // Only remove models that are no longer available; preserve existing order
  return currentPriority.filter((m) => allModels.has(m))
}
