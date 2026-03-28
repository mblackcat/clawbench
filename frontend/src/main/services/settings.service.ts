import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import {
  getSettings as getSettingsFromStore,
  setSetting as setSettingInStore,
  getAiModelConfigs as getAiModelConfigsFromStore,
  setAiModelConfigs as setAiModelConfigsInStore,
  getImageGenConfigs as getImageGenConfigsFromStore,
  setImageGenConfigs as setImageGenConfigsInStore
} from '../store/settings.store'
import type { AIModelConfig, ImageGenConfig } from '../store/settings.store'
import * as logger from '../utils/logger'

export interface Settings {
  pythonPath: string
  language: string
  theme: string
  userAppDir: string
  autoUpdate: boolean
}

export interface PythonValidationResult {
  valid: boolean
  version: string
}

/**
 * Returns all current settings.
 */
export function getSettings(): Settings {
  return getSettingsFromStore()
}

/**
 * Updates a single setting by key.
 */
export function setSetting(key: string, value: unknown): void {
  setSettingInStore(key as keyof Settings, value as never)
  logger.info(`Setting updated: ${key} =`, value)
}

/**
 * Validates a Python path by running it with --version flag.
 * Returns whether the path is valid and the Python version string.
 */
export function validatePythonPath(pythonPath: string): Promise<PythonValidationResult> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(pythonPath, ['--version'], {
        timeout: 10000
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        // Python --version may output to stdout or stderr depending on version
        const output = (stdout || stderr).trim()
        if (code === 0 && output) {
          const versionMatch = output.match(/Python\s+([\d.]+)/)
          resolve({
            valid: true,
            version: versionMatch ? versionMatch[1] : output
          })
        } else {
          resolve({ valid: false, version: '' })
        }
      })

      proc.on('error', (err) => {
        logger.error('Python validation failed:', err.message)
        resolve({ valid: false, version: '' })
      })
    } catch (err) {
      logger.error('Python validation error:', err)
      resolve({ valid: false, version: '' })
    }
  })
}

/**
 * Returns AI model configs with masked API keys (for display).
 */
export function getAiModelConfigs(): AIModelConfig[] {
  const configs = getAiModelConfigsFromStore()
  return configs.map((c) => ({
    ...c,
    apiKey: c.apiKey ? '****' + c.apiKey.slice(-4) : ''
  }))
}

/**
 * Returns AI model configs with full API keys (for internal use).
 */
export function getAiModelConfigsRaw(): AIModelConfig[] {
  return getAiModelConfigsFromStore()
}

/**
 * Saves (creates or updates) an AI model config.
 */
export function saveAiModelConfig(
  config: Partial<AIModelConfig> & { apiKey?: string }
): AIModelConfig {
  const configs = getAiModelConfigsFromStore()
  const existingIndex = config.id ? configs.findIndex((c) => c.id === config.id) : -1

  if (existingIndex >= 0) {
    const existing = configs[existingIndex]
    const updatedConfig: AIModelConfig = {
      ...existing,
      ...config,
      apiKey:
        config.apiKey?.startsWith('****') ? existing.apiKey : (config.apiKey || existing.apiKey)
    } as AIModelConfig
    configs[existingIndex] = updatedConfig
    setAiModelConfigsInStore(configs)
    logger.info(`[settings] AI model config updated: ${updatedConfig.id}`)
    return updatedConfig
  } else {
    const newConfig: AIModelConfig = {
      id: randomUUID(),
      name: config.name || '',
      provider: config.provider || 'openai',
      endpoint: config.endpoint || '',
      apiKey: config.apiKey || '',
      models: config.models || [],
      enabled: config.enabled ?? true,
      apiVersion: config.apiVersion,
      capabilities: config.capabilities || []
    }
    configs.push(newConfig)
    setAiModelConfigsInStore(configs)
    logger.info(`[settings] AI model config created: ${newConfig.id} provider=${newConfig.provider}`)
    return newConfig
  }
}

/**
 * Deletes an AI model config by id.
 */
export function deleteAiModelConfig(id: string): boolean {
  const configs = getAiModelConfigsFromStore()
  const filtered = configs.filter((c) => c.id !== id)
  if (filtered.length === configs.length) return false
  setAiModelConfigsInStore(filtered)
  logger.info(`[settings] AI model config deleted: ${id}`)
  return true
}

/**
 * Tests an AI model config by hitting the /models endpoint.
 * If apiKey is masked and configId is provided, uses the real key from store.
 */
export async function testAiModelConfig(config: {
  provider: string
  endpoint: string
  apiKey: string
  configId?: string
}): Promise<{ success: boolean; message: string }> {
  let apiKey = config.apiKey
  if (apiKey.startsWith('****') && config.configId) {
    const configs = getAiModelConfigsFromStore()
    const existing = configs.find((c) => c.id === config.configId)
    if (existing) {
      apiKey = existing.apiKey
    }
  }
  if (!apiKey || apiKey.startsWith('****')) {
    return { success: false, message: '请输入完整的 API Key 进行测试' }
  }
  try {
    if (config.provider === 'azure-openai') {
      // Azure OpenAI: try a lightweight chat completion to verify connectivity
      const existingConfig = config.configId
        ? getAiModelConfigsFromStore().find((c) => c.id === config.configId)
        : undefined
      const apiVersion = existingConfig?.apiVersion || '2025-04-01-preview'
      const model = existingConfig?.models?.[0] || 'gpt-4o'
      const baseUrl = config.endpoint.replace(/\/$/, '')
      // Standard Azure path: /openai/deployments/{model}/chat/completions
      const url = `${baseUrl}/openai/deployments/${model}/chat/completions?api-version=${apiVersion}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(15000)
      })
      if (response.ok) {
        logger.info(`[settings] AI model test passed: provider=${config.provider}`)
        return { success: true, message: '连接成功' }
      }
      // Some Azure proxies use a flat path; try fallback
      const fallback = await fetch(`${baseUrl}/chat/completions?api-version=${apiVersion}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(15000)
      })
      if (fallback.ok) {
        logger.info(`[settings] AI model test passed: provider=${config.provider}`)
        return { success: true, message: '连接成功' }
      }
      logger.warn(`[settings] AI model test failed: provider=${config.provider} — HTTP ${fallback.status}: ${fallback.statusText}`)
      return { success: false, message: `HTTP ${fallback.status}: ${fallback.statusText}` }
    }

    if (config.provider === 'claude' || config.provider === 'anthropic-compatible') {
      // Anthropic API: POST /messages with x-api-key header
      const url = config.endpoint.replace(/\/$/, '') + '/messages'
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }]
        }),
        signal: AbortSignal.timeout(15000)
      })
      if (response.ok || response.status === 400) {
        // 400 may occur if model name is wrong but auth succeeded
        logger.info(`[settings] AI model test passed: provider=${config.provider}`)
        return { success: true, message: '连接成功' }
      }
      logger.warn(`[settings] AI model test failed: provider=${config.provider} — HTTP ${response.status}: ${response.statusText}`)
      return { success: false, message: `HTTP ${response.status}: ${response.statusText}` }
    }

    if (config.provider === 'google') {
      // Google Gemini: uses ?key= query param, not Bearer token
      const url = config.endpoint.replace(/\/$/, '') + '/models?key=' + apiKey
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (response.ok) {
        logger.info(`[settings] AI model test passed: provider=${config.provider}`)
        return { success: true, message: '连接成功' }
      }
      logger.warn(`[settings] AI model test failed: provider=${config.provider} — HTTP ${response.status}: ${response.statusText}`)
      return { success: false, message: `HTTP ${response.status}: ${response.statusText}` }
    }

    // Default: OpenAI-compatible with Bearer token
    const url = config.endpoint.replace(/\/$/, '') + '/models'
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000)
    })
    if (response.ok) {
      logger.info(`[settings] AI model test passed: provider=${config.provider}`)
      return { success: true, message: '连接成功' }
    }
    logger.warn(`[settings] AI model test failed: provider=${config.provider} — HTTP ${response.status}: ${response.statusText}`)
    return { success: false, message: `HTTP ${response.status}: ${response.statusText}` }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '连接失败'
    logger.warn(`[settings] AI model test failed: provider=${config.provider} — ${message}`)
    return { success: false, message }
  }
}

// ==================== Image Generation Config ====================

/**
 * Returns image gen configs with masked API keys.
 */
export function getImageGenConfigs(): ImageGenConfig[] {
  const configs = getImageGenConfigsFromStore()
  return configs.map((c) => ({
    ...c,
    apiKey: c.apiKey ? '****' + c.apiKey.slice(-4) : ''
  }))
}

/**
 * Saves (creates or updates) an image gen config.
 */
export function saveImageGenConfig(
  config: Partial<ImageGenConfig> & { apiKey?: string }
): ImageGenConfig {
  const configs = getImageGenConfigsFromStore()
  const existingIndex = config.id ? configs.findIndex((c) => c.id === config.id) : -1

  if (existingIndex >= 0) {
    const existing = configs[existingIndex]
    const updatedConfig: ImageGenConfig = {
      ...existing,
      ...config,
      apiKey:
        config.apiKey?.startsWith('****') ? existing.apiKey : (config.apiKey || existing.apiKey)
    } as ImageGenConfig
    configs[existingIndex] = updatedConfig
    setImageGenConfigsInStore(configs)
    logger.info(`[settings] Image gen config saved: ${updatedConfig.id}`)
    return updatedConfig
  } else {
    const newConfig: ImageGenConfig = {
      id: randomUUID(),
      name: config.name || '',
      provider: config.provider || 'dall-e',
      endpoint: config.endpoint || '',
      apiKey: config.apiKey || '',
      defaultModel: config.defaultModel,
      defaultSize: config.defaultSize || '1024x1024',
      enabled: config.enabled ?? true
    }
    configs.push(newConfig)
    setImageGenConfigsInStore(configs)
    logger.info(`[settings] Image gen config saved: ${newConfig.id}`)
    return newConfig
  }
}

/**
 * Deletes an image gen config by id.
 */
export function deleteImageGenConfig(id: string): boolean {
  const configs = getImageGenConfigsFromStore()
  const filtered = configs.filter((c) => c.id !== id)
  if (filtered.length === configs.length) return false
  setImageGenConfigsInStore(filtered)
  logger.info(`[settings] Image gen config deleted: ${id}`)
  return true
}
