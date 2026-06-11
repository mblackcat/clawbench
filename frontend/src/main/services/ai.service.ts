import OpenAI, { AzureOpenAI } from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { randomUUID } from 'crypto'
import fs from 'fs'
import { BrowserWindow } from 'electron'
import { settingsStore, AIModelConfig } from '../store/settings.store'
import * as logger from '../utils/logger'

export interface ContentPart {
  type: 'text' | 'image_base64'
  text?: string
  mimeType?: string
  base64Data?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  contentParts?: ContentPart[]
  toolCallId?: string
  toolCalls?: Array<{ id: string; name: string; input: Record<string, any> }>
}

export interface AttachmentInfo {
  filePath: string
  mimeType: string
  fileName: string
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
}

interface StreamTask {
  taskId: string
  abortController: AbortController
}

const activeTasks = new Map<string, StreamTask>()

/**
 * Get full model config by id (with real apiKey)
 */
function getModelConfigById(configId: string): AIModelConfig | undefined {
  const configs = settingsStore.get('aiModelConfigs') || []
  return configs.find((c: AIModelConfig) => c.id === configId)
}

/**
 * Build multimodal messages from attachments
 */
function buildMessagesWithAttachments(
  messages: ChatMessage[],
  attachments?: AttachmentInfo[]
): ChatMessage[] {
  if (!attachments || attachments.length === 0) return messages

  // Find the last user message and add contentParts
  const result = [...messages]
  const lastUserIdx = result.length - 1
  const lastMsg = result[lastUserIdx]
  if (!lastMsg || lastMsg.role !== 'user') return result

  const parts: ContentPart[] = [{ type: 'text', text: lastMsg.content }]
  for (const att of attachments) {
    try {
      if (fs.existsSync(att.filePath) && att.mimeType.startsWith('image/')) {
        const fileData = fs.readFileSync(att.filePath)
        parts.push({
          type: 'image_base64',
          mimeType: att.mimeType,
          base64Data: fileData.toString('base64')
        })
      }
    } catch (err) {
      logger.error(`Failed to read attachment ${att.filePath}:`, err)
    }
  }

  result[lastUserIdx] = { ...lastMsg, contentParts: parts }
  return result
}

// ============ Tool format converters ============

function toOpenAITools(tools: ToolDefinition[]): any[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema
    }
  }))
}

function toClaudeTools(tools: ToolDefinition[]): any[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema
  }))
}

function toGeminiTools(tools: ToolDefinition[]): any[] {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema
      }))
    }
  ]
}

// ============ Multimodal message builders per provider ============

function buildOpenAIMessages(messages: ChatMessage[], withTools = false): any[] {
  return messages.map((m) => {
    // Tool result message
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    }
    // Assistant with tool calls
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input) }
        }))
      }
    }
    // Multimodal
    if (m.contentParts && m.contentParts.length > 0) {
      const parts: any[] = []
      for (const p of m.contentParts) {
        if (p.type === 'text' && p.text) {
          parts.push({ type: 'text', text: p.text })
        } else if (p.type === 'image_base64' && p.base64Data) {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${p.mimeType || 'image/png'};base64,${p.base64Data}` }
          })
        }
      }
      return { role: m.role, content: parts.length > 0 ? parts : m.content }
    }
    return { role: m.role, content: m.content }
  })
}

function buildClaudeMessages(messages: ChatMessage[]): any[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      // Tool result → user message with tool_result
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [
            { type: 'tool_result', tool_use_id: m.toolCallId || '', content: m.content }
          ]
        }
      }
      // Assistant with tool calls
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        const blocks: any[] = []
        if (m.content) blocks.push({ type: 'text', text: m.content })
        for (const tc of m.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
        }
        return { role: 'assistant' as const, content: blocks }
      }
      // Multimodal
      if (m.contentParts && m.contentParts.length > 0) {
        const parts: any[] = []
        for (const p of m.contentParts) {
          if (p.type === 'text' && p.text) {
            parts.push({ type: 'text', text: p.text })
          } else if (p.type === 'image_base64' && p.base64Data) {
            parts.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: p.mimeType || 'image/png',
                data: p.base64Data
              }
            })
          }
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: parts.length > 0 ? parts : m.content
        }
      }
      return { role: m.role as 'user' | 'assistant', content: m.content }
    })
}

function buildGeminiParts(msg: ChatMessage): any[] {
  if (msg.contentParts && msg.contentParts.length > 0) {
    const parts: any[] = []
    for (const p of msg.contentParts) {
      if (p.type === 'text' && p.text) {
        parts.push({ text: p.text })
      } else if (p.type === 'image_base64' && p.base64Data) {
        parts.push({
          inlineData: { mimeType: p.mimeType || 'image/png', data: p.base64Data }
        })
      }
    }
    return parts.length > 0 ? parts : [{ text: msg.content }]
  }
  return [{ text: msg.content }]
}

// ============ Title generation (non-streaming, text only) ============

export async function generateTitle(
  modelConfigId: string,
  messages: ChatMessage[],
  modelId?: string
): Promise<string> {
  const config = getModelConfigById(modelConfigId)
  if (!config) throw new Error('Model config not found')

  const actualModelId = modelId || config.models[0] || config.name
  const provider = config.provider.toLowerCase()

  // Image generation models don't support chat completions, return default title
  if (isImageGenModel(actualModelId)) {
    return '图片生成'
  }

  const titlePrompt: ChatMessage[] = [
    {
      role: 'user',
      content: `请用10个字以内总结以下对话的主题，直接回复标题文字，不要加引号和其他内容：\n\n${messages.map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.substring(0, 200)}`).join('\n')}`
    }
  ]

  if (provider === 'claude' || provider === 'anthropic-compatible') {
    return completeClaude(config, actualModelId, titlePrompt)
  } else if (provider === 'google') {
    return completeGoogle(config, actualModelId, titlePrompt)
  } else if (provider === 'azure-openai') {
    return completeAzureOpenAI(config, actualModelId, titlePrompt)
  } else if (provider === 'openai-responses') {
    return completeOpenAIResponses(config, actualModelId, titlePrompt, 50)
  } else {
    return completeOpenAI(config, actualModelId, titlePrompt)
  }
}

async function completeOpenAI(
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[]
): Promise<string> {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.endpoint })
  const response = await client.chat.completions.create({
    model: modelId,
    messages: messages.map((m) => ({ role: m.role, content: m.content })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    max_tokens: 50
  })
  return response.choices[0]?.message?.content?.trim() || '新对话'
}

async function completeAzureOpenAI(
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[]
): Promise<string> {
  const client = new AzureOpenAI({
    apiKey: config.apiKey,
    apiVersion: config.apiVersion || '2025-04-01-preview',
    endpoint: config.endpoint
  })
  const response = await client.chat.completions.create({
    model: modelId,
    messages: messages.map((m) => ({ role: m.role, content: m.content })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    max_tokens: 50
  })
  return response.choices[0]?.message?.content?.trim() || '新对话'
}

async function completeClaude(
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[]
): Promise<string> {
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.endpoint || undefined })
  const response = await client.messages.create({
    model: modelId,
    max_tokens: 50,
    messages: messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))
  })
  const textBlock = response.content.find((b) => b.type === 'text')
  return (textBlock as any)?.text?.trim() || '新对话'
}

async function completeGoogle(
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[]
): Promise<string> {
  const genAI = new GoogleGenerativeAI(config.apiKey)
  const requestOptions = config.endpoint ? { baseUrl: config.endpoint } : undefined
  const model = genAI.getGenerativeModel({ model: modelId }, requestOptions)
  const result = await model.generateContent(messages[messages.length - 1].content)
  return result.response.text().trim() || '新对话'
}

// ============ Non-streaming completion (for scheduled tasks) ============

/**
 * Non-streaming chat completion. Returns the full response text.
 * Used by scheduled tasks and other background processes.
 */
export async function completeChat(
  configId: string,
  messages: ChatMessage[],
  modelId?: string,
  maxTokens = 4096
): Promise<string> {
  const config = getModelConfigById(configId)
  if (!config) throw new Error('Model config not found')

  const actualModelId = modelId || config.models[0] || config.name
  const provider = config.provider.toLowerCase()

  if (provider === 'claude' || provider === 'anthropic-compatible') {
    return completeChatClaude(config, actualModelId, messages, maxTokens)
  } else if (provider === 'google') {
    return completeChatGoogle(config, actualModelId, messages, maxTokens)
  } else if (provider === 'openai-responses') {
    return completeOpenAIResponses(config, actualModelId, messages, maxTokens)
  } else {
    return completeChatOpenAI(config, actualModelId, messages, maxTokens)
  }
}

async function completeChatOpenAI(
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<string> {
  const ClientClass = config.provider === 'azure-openai' ? AzureOpenAI : OpenAI
  const clientOpts: any = { apiKey: config.apiKey }
  if (config.provider === 'azure-openai') {
    clientOpts.apiVersion = config.apiVersion || '2025-04-01-preview'
    clientOpts.endpoint = config.endpoint
  } else {
    clientOpts.baseURL = config.endpoint
  }
  const client = new ClientClass(clientOpts)
  const response = await client.chat.completions.create({
    model: modelId,
    messages: messages.map((m) => ({ role: m.role, content: m.content })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    max_tokens: maxTokens
  })
  return response.choices[0]?.message?.content?.trim() || ''
}

async function completeChatClaude(
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<string> {
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.endpoint || undefined })
  const systemMsg = messages.find((m) => m.role === 'system')
  const response = await client.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    system: systemMsg?.content || undefined,
    messages: messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  })
  const textBlock = response.content.find((b) => b.type === 'text')
  return (textBlock as any)?.text?.trim() || ''
}

async function completeChatGoogle(
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[],
  _maxTokens: number
): Promise<string> {
  const genAI = new GoogleGenerativeAI(config.apiKey)
  const requestOptions = config.endpoint ? { baseUrl: config.endpoint } : undefined
  const model = genAI.getGenerativeModel({ model: modelId }, requestOptions)
  const lastMsg = messages[messages.length - 1]
  const result = await model.generateContent(lastMsg?.content || '')
  return result.response.text().trim() || ''
}

// ============ Streaming ============

/**
 * Stream chat with optional tool support.
 *
 * When tools are provided and the AI returns tool_use, the stream emits
 * `ai:chat-tool-use` events and ends (no `ai:chat-done`). The renderer
 * is responsible for executing the tool, then calling streamChat again
 * with updated messages (including the tool result).
 */
export async function streamChat(
  window: BrowserWindow,
  modelConfigId: string,
  messages: ChatMessage[],
  modelId?: string,
  attachments?: AttachmentInfo[],
  tools?: ToolDefinition[],
  enableThinking?: boolean,
  webSearchEnabled?: boolean
): Promise<string> {
  const taskId = randomUUID()
  const abortController = new AbortController()
  activeTasks.set(taskId, { taskId, abortController })

  const config = getModelConfigById(modelConfigId)
  if (!config) {
    new StreamEmitter(window, taskId).error('Model config not found')
    return taskId
  }

  const actualModelId = modelId || config.models[0] || config.name

  // Build multimodal messages if attachments provided
  const finalMessages = buildMessagesWithAttachments(messages, attachments)

  doStream(window, taskId, config, actualModelId, finalMessages, abortController.signal, tools, enableThinking, webSearchEnabled)
    .catch((err) => {
      logger.error('Stream error:', err)
      new StreamEmitter(window, taskId).error(err.message)
    })
    .finally(() => {
      activeTasks.delete(taskId)
    })

  return taskId
}

export function cancelChat(taskId: string): boolean {
  const task = activeTasks.get(taskId)
  if (task) {
    task.abortController.abort()
    activeTasks.delete(taskId)
    return true
  }
  return false
}

/**
 * Check if a model is an image generation model (uses Images API, not Chat Completions).
 */
function isImageGenModel(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  return lower.includes('gpt-image') || lower.startsWith('dall-e')
}

async function doStream(
  window: BrowserWindow,
  taskId: string,
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  tools?: ToolDefinition[],
  enableThinking?: boolean,
  webSearchEnabled?: boolean
): Promise<void> {
  const provider = config.provider.toLowerCase()

  // Image generation models use the Images API, not Chat Completions
  if (isImageGenModel(modelId) && (provider === 'openai' || provider === 'openai-compatible')) {
    await streamOpenAIImage(window, taskId, config, modelId, messages, signal)
    return
  }

  if (provider === 'claude' || provider === 'anthropic-compatible') {
    await streamClaude(window, taskId, config, modelId, messages, signal, tools, enableThinking)
  } else if (provider === 'google') {
    await streamGoogle(window, taskId, config, modelId, messages, signal, tools, webSearchEnabled)
  } else if (provider === 'azure-openai') {
    await streamAzureOpenAI(window, taskId, config, modelId, messages, signal, tools, enableThinking)
  } else if (provider === 'openai-responses') {
    await streamOpenAIResponses(window, taskId, config, modelId, messages, signal, tools, enableThinking)
  } else {
    await streamOpenAI(window, taskId, config, modelId, messages, signal, tools, enableThinking)
  }
}

/**
 * Handle image generation models via the OpenAI Images API.
 * Extracts the prompt from the last user message, calls /v1/images/generations,
 * and emits the result as a markdown image in the chat stream.
 */
async function streamOpenAIImage(
  window: BrowserWindow,
  taskId: string,
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[],
  signal: AbortSignal
): Promise<void> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.endpoint,
    timeout: 300000 // 5 minutes, image generation can be slow
  })

  // Extract prompt from the last user message
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
  const prompt = lastUserMessage?.content || ''
  if (!prompt) {
    throw new Error('No prompt found for image generation')
  }

  logger.info(`Image generation: model=${modelId}, prompt="${prompt.substring(0, 80)}..."`)

  const result = await client.images.generate(
    {
      model: modelId,
      prompt,
      n: 1,
      size: '1024x1024'
    },
    { signal }
  )

  const imageData = result.data?.[0]
  if (!imageData) throw new Error('No image data in response')

  logger.info(`Image generation response: b64_json=${!!imageData.b64_json}, url=${!!imageData.url}, revised_prompt=${!!imageData.revised_prompt}`)

  let b64 = imageData.b64_json || ''

  // If server returned a URL instead of b64_json, fetch and convert
  if (!b64 && imageData.url) {
    logger.info(`Fetching image from URL: ${imageData.url.substring(0, 100)}...`)
    const imgResponse = await fetch(imageData.url)
    if (!imgResponse.ok) {
      throw new Error(`Failed to fetch image from URL: ${imgResponse.status}`)
    }
    const arrayBuffer = await imgResponse.arrayBuffer()
    b64 = Buffer.from(arrayBuffer).toString('base64')
  }

  if (!b64) {
    throw new Error('No image data (b64_json or url) in response')
  }

  const revisedPrompt = imageData.revised_prompt || ''

  let content = ''
  if (revisedPrompt) {
    content += `${revisedPrompt}\n\n`
  }
  content += `![Generated Image](data:image/png;base64,${b64})`

  const emit = new StreamEmitter(window, taskId)
  emit.delta(content)
  emit.done()
}

async function streamOpenAICompatible(
  emit: StreamEmitter,
  client: OpenAI,
  modelId: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  tools?: ToolDefinition[],
  enableThinking?: boolean
): Promise<void> {
  const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model: modelId,
    messages: buildOpenAIMessages(messages),
    stream: true
  }
  if (tools && tools.length > 0) {
    requestParams.tools = toOpenAITools(tools)
  }
  // Some OpenAI-compatible providers (DeepSeek R1, QwQ) return reasoning_content
  // enableThinking enables capturing it

  const stream = await client.chat.completions.create(requestParams, { signal })

  const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()

  for await (const chunk of stream) {
    if (signal.aborted) break
    const delta = chunk.choices[0]?.delta as any
    // Capture reasoning_content (DeepSeek R1, QwQ, etc.)
    if (enableThinking && delta?.reasoning_content) {
      emit.thinkingDelta(delta.reasoning_content)
    }
    if (delta?.content) {
      emit.delta(delta.content)
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index
        if (!pendingToolCalls.has(idx)) {
          pendingToolCalls.set(idx, { id: tc.id || '', name: tc.function?.name || '', arguments: '' })
        }
        const pending = pendingToolCalls.get(idx)!
        if (tc.id) pending.id = tc.id
        if (tc.function?.name) pending.name = tc.function.name
        if (tc.function?.arguments) pending.arguments += tc.function.arguments
      }
    }
    if (chunk.choices[0]?.finish_reason === 'tool_calls') {
      emit.emitPendingToolCalls(pendingToolCalls)
      return
    }
  }

  if (pendingToolCalls.size > 0) {
    emit.emitPendingToolCalls(pendingToolCalls)
    return
  }

  if (!signal.aborted) {
    emit.done()
  }
}

async function streamOpenAI(
  window: BrowserWindow,
  taskId: string,
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  tools?: ToolDefinition[],
  enableThinking?: boolean
): Promise<void> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.endpoint
  })
  await streamOpenAICompatible(
    new StreamEmitter(window, taskId), client, modelId, messages, signal, tools, enableThinking
  )
}

// ============ OpenAI Responses API (/v1/responses) ============

function buildResponsesInput(messages: ChatMessage[]): any[] {
  const items: any[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      items.push({
        type: 'function_call_output',
        call_id: m.toolCallId || '',
        output: m.content
      })
      continue
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      if (m.content) {
        items.push({ role: 'assistant', content: m.content })
      }
      for (const tc of m.toolCalls) {
        items.push({
          type: 'function_call',
          call_id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.input)
        })
      }
      continue
    }
    if (m.contentParts && m.contentParts.length > 0) {
      const content: any[] = []
      for (const p of m.contentParts) {
        if (p.type === 'text' && p.text) {
          content.push({
            type: m.role === 'assistant' ? 'output_text' : 'input_text',
            text: p.text
          })
        } else if (p.type === 'image_base64' && p.base64Data) {
          content.push({
            type: 'input_image',
            image_url: `data:${p.mimeType || 'image/png'};base64,${p.base64Data}`
          })
        }
      }
      items.push({ role: m.role, content })
      continue
    }
    items.push({ role: m.role, content: m.content })
  }
  return items
}

function toResponsesTools(tools: ToolDefinition[]): any[] {
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
    strict: false
  }))
}

async function streamOpenAIResponses(
  window: BrowserWindow,
  taskId: string,
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  tools?: ToolDefinition[],
  enableThinking?: boolean
): Promise<void> {
  const emit = new StreamEmitter(window, taskId)
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.endpoint })

  const params: any = {
    model: modelId,
    input: buildResponsesInput(messages),
    stream: true
  }
  if (tools && tools.length > 0) {
    params.tools = toResponsesTools(tools)
  }
  if (enableThinking) {
    params.reasoning = { effort: 'medium', summary: 'auto' }
  }

  logger.info(`[responses] stream start: model=${modelId}, msgs=${messages.length}, tools=${tools?.length || 0}, lastRole=${messages[messages.length - 1]?.role}`)
  const stream = (await client.responses.create(params, { signal })) as any

  // function_call items: keyed by item.id when present, else item.call_id
  // (some third-party Responses servers populate only one of the two fields)
  const pendingCalls = new Map<string, { callId: string; name: string; args: string }>()
  const fcKey = (item: any): string =>
    String(item?.id ?? item?.call_id ?? '')

  const seenEventTypes = new Set<string>()
  let textDeltaCount = 0

  for await (const event of stream) {
    if (signal.aborted) break
    if (event?.type) seenEventTypes.add(event.type)
    switch (event.type) {
      case 'response.output_text.delta':
        if (event.delta) {
          textDeltaCount++
          emit.delta(event.delta)
        }
        break
      case 'response.output_text.done':
        // Some providers / native-image models never send deltas and only
        // deliver the final text in this `.done` event. Replay it once so
        // the renderer doesn't end up with an empty assistant bubble.
        if (textDeltaCount === 0 && typeof event.text === 'string' && event.text) {
          textDeltaCount++
          emit.delta(event.text)
        }
        break
      case 'response.reasoning_text.delta':
      case 'response.reasoning_summary_text.delta':
        if (enableThinking && event.delta) emit.thinkingDelta(event.delta)
        break
      case 'response.output_item.added':
        if (event.item?.type === 'function_call') {
          pendingCalls.set(fcKey(event.item), {
            callId: event.item.call_id || event.item.id || '',
            name: event.item.name || '',
            args: typeof event.item.arguments === 'string' ? event.item.arguments : ''
          })
        }
        break
      case 'response.function_call_arguments.delta': {
        const key = String(event.item_id ?? event.item?.id ?? '')
        const fc = pendingCalls.get(key)
        if (fc && event.delta) fc.args += event.delta
        break
      }
      case 'response.function_call_arguments.done': {
        // Some providers only deliver the full arguments string in this event
        const key = String(event.item_id ?? event.item?.id ?? '')
        const fc = pendingCalls.get(key)
        if (fc && typeof event.arguments === 'string' && !fc.args) {
          fc.args = event.arguments
        }
        break
      }
      case 'response.output_item.done':
        // Fallback: some providers skip `added` and only emit `done` with the full item,
        // or include the full `arguments` string here instead of streaming via deltas.
        if (event.item?.type === 'function_call') {
          const key = fcKey(event.item)
          const existing = pendingCalls.get(key)
          const fullArgs = typeof event.item.arguments === 'string' ? event.item.arguments : ''
          if (existing) {
            if (!existing.args && fullArgs) existing.args = fullArgs
            if (!existing.callId && event.item.call_id) existing.callId = event.item.call_id
            if (!existing.name && event.item.name) existing.name = event.item.name
          } else if (key) {
            pendingCalls.set(key, {
              callId: event.item.call_id || event.item.id || '',
              name: event.item.name || '',
              args: fullArgs
            })
          }
        } else if (event.item?.type === 'image_generation_call') {
          // Native image generation result — the image lives on `item.result`
          // as a base64 string. Inline it as a markdown data-URL image so it
          // renders inside the assistant bubble.
          const b64 = typeof event.item.result === 'string' ? event.item.result : ''
          if (b64) {
            const fmt = typeof event.item.output_format === 'string' ? event.item.output_format : 'png'
            const mime = `image/${fmt.toLowerCase().replace(/^jpg$/, 'jpeg')}`
            emit.delta(`\n\n![generated image](data:${mime};base64,${b64})\n\n`)
            logger.info(`[responses] native image_generation_call: format=${fmt}, bytes=${b64.length}`)
          }
        }
        break
      case 'response.completed':
        logger.info(`[responses] completed: textDeltas=${textDeltaCount}, pendingCalls=${pendingCalls.size}, events=[${[...seenEventTypes].join(',')}]`)
        if (pendingCalls.size > 0) {
          for (const [, fc] of pendingCalls) {
            let input: Record<string, any> = {}
            try {
              input = fc.args ? JSON.parse(fc.args) : {}
            } catch {
              logger.warn(`[responses] arg parse failed name=${fc.name} args="${fc.args.slice(0, 200)}"`)
            }
            logger.info(`[responses] toolUse: name=${fc.name}, callId=${fc.callId}, inputKeys=[${Object.keys(input).join(',')}]`)
            emit.toolUse(fc.callId, fc.name, input)
          }
          return
        }
        emit.done()
        return
      case 'response.failed':
      case 'response.incomplete':
        emit.error(
          event.response?.error?.message ||
            event.response?.incomplete_details?.reason ||
            'Responses API stream ended without output'
        )
        return
      case 'response.error':
      case 'error':
        emit.error(event.error?.message || event.message || 'Responses API error')
        return
    }
  }

  // Stream ended without a terminal event (response.completed / .failed / .error).
  // Some third-party gateways close the connection early or drop the final frame.
  // Without this fallback the renderer would spin forever waiting on chat-done.
  logger.warn(`[responses] stream ended without terminal event: textDeltas=${textDeltaCount}, pendingCalls=${pendingCalls.size}, events=[${[...seenEventTypes].join(',')}]`)
  if (pendingCalls.size > 0) {
    for (const [, fc] of pendingCalls) {
      let input: Record<string, any> = {}
      try {
        input = fc.args ? JSON.parse(fc.args) : {}
      } catch {
        /* ignore */
      }
      emit.toolUse(fc.callId, fc.name, input)
    }
    return
  }
  if (textDeltaCount > 0) {
    emit.done()
  } else {
    emit.error('Stream closed before any output was received')
  }
}

async function completeOpenAIResponses(
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[],
  maxTokens = 4096
): Promise<string> {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.endpoint })
  const resp: any = await client.responses.create({
    model: modelId,
    input: buildResponsesInput(messages),
    max_output_tokens: maxTokens
  })
  if (typeof resp.output_text === 'string' && resp.output_text) {
    return resp.output_text.trim()
  }
  for (const item of resp.output || []) {
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if (c.type === 'output_text' && c.text) return c.text.trim()
      }
    }
  }
  return ''
}

async function streamAzureOpenAI(
  window: BrowserWindow,
  taskId: string,
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  tools?: ToolDefinition[],
  enableThinking?: boolean
): Promise<void> {
  const client = new AzureOpenAI({
    apiKey: config.apiKey,
    apiVersion: config.apiVersion || '2025-04-01-preview',
    endpoint: config.endpoint
  })
  await streamOpenAICompatible(
    new StreamEmitter(window, taskId), client, modelId, messages, signal, tools, enableThinking
  )
}

async function streamClaude(
  window: BrowserWindow,
  taskId: string,
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  tools?: ToolDefinition[],
  enableThinking?: boolean
): Promise<void> {
  const emit = new StreamEmitter(window, taskId)
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.endpoint || undefined
  })

  const systemMsg = messages.find((m) => m.role === 'system')

  const requestParams: any = {
    model: modelId,
    max_tokens: enableThinking ? 16000 : 4096,
    system: systemMsg?.content || undefined,
    messages: buildClaudeMessages(messages)
  }
  if (enableThinking) {
    requestParams.thinking = { type: 'enabled', budget_tokens: 10000 }
  }
  if (tools && tools.length > 0) {
    requestParams.tools = toClaudeTools(tools)
  }

  const stream = client.messages.stream(requestParams)

  for await (const event of stream) {
    if (signal.aborted) {
      stream.abort()
      break
    }
    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'thinking_delta') {
        emit.thinkingDelta((event.delta as any).thinking)
      } else if (event.delta.type === 'text_delta') {
        emit.delta(event.delta.text)
      }
    }
  }

  if (!signal.aborted) {
    const finalMessage = await stream.finalMessage()

    // Check for tool_use blocks
    const toolUseBlocks = finalMessage.content.filter((b: any) => b.type === 'tool_use')
    if (toolUseBlocks.length > 0) {
      for (const block of toolUseBlocks) {
        emit.toolUse((block as any).id, (block as any).name, (block as any).input || {})
      }
      return
    }

    emit.done({
      promptTokens: finalMessage.usage.input_tokens,
      completionTokens: finalMessage.usage.output_tokens
    })
  }
}

async function streamGoogle(
  window: BrowserWindow,
  taskId: string,
  config: AIModelConfig,
  modelId: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  tools?: ToolDefinition[],
  webSearchEnabled?: boolean
): Promise<void> {
  const emit = new StreamEmitter(window, taskId)
  const genAI = new GoogleGenerativeAI(config.apiKey)
  const requestOptions = config.endpoint ? { baseUrl: config.endpoint } : undefined

  const modelParams: any = { model: modelId }
  if (tools && tools.length > 0) {
    // Gemini does not allow mixing googleSearch grounding with functionDeclarations.
    // When web search is enabled, use native grounding only (no function calling tools).
    if (webSearchEnabled) {
      modelParams.tools = [{ googleSearch: {} }]
    } else {
      const functionTools = tools.filter((t) => t.name !== 'web_search' && t.name !== 'finish_search' && t.name !== 'web_browse')
      if (functionTools.length > 0) {
        modelParams.tools = toGeminiTools(functionTools)
      }
    }
  } else if (webSearchEnabled) {
    modelParams.tools = [{ googleSearch: {} }]
  }
  const model = genAI.getGenerativeModel(modelParams, requestOptions)

  const systemInstructionText = messages.find((m) => m.role === 'system')?.content
  const systemInstruction = systemInstructionText
    ? { role: 'user' as const, parts: [{ text: systemInstructionText }] }
    : undefined
  const history = messages
    .filter((m) => m.role !== 'system')
    .slice(0, -1)
    .map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: m.toolCallId || 'unknown',
                response: { result: m.content }
              }
            }
          ]
        }
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        const parts: any[] = []
        if (m.content) parts.push({ text: m.content })
        for (const tc of m.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.input } })
        }
        return { role: 'model', parts }
      }
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: buildGeminiParts(m)
      }
    })

  const lastMessage = messages[messages.length - 1]

  const chat = model.startChat({
    history: history as any,
    ...(systemInstruction ? { systemInstruction } : {})
  })

  const result = await chat.sendMessageStream(buildGeminiParts(lastMessage))

  for await (const chunk of result.stream) {
    if (signal.aborted) break
    const text = chunk.text()
    if (text) {
      emit.delta(text)
    }
    // Check for function calls
    const candidates = chunk.candidates || []
    for (const candidate of candidates) {
      for (const part of candidate.content?.parts || []) {
        if ((part as any).functionCall) {
          const fc = (part as any).functionCall
          emit.toolUse(
            `gemini-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            fc.name,
            fc.args || {}
          )
          return
        }
      }
    }
  }

  // Extract grounding metadata from final response (Google Search grounding)
  if (!signal.aborted && webSearchEnabled) {
    try {
      const response = await result.response
      const candidate = response.candidates?.[0]
      const grounding = (candidate as any)?.groundingMetadata
      if (grounding) {
        const queries: string[] = grounding.webSearchQueries || []
        const sources: Array<{ title: string; url: string }> = []
        const chunks = grounding.groundingChunks || []
        for (const chunk of chunks) {
          const web = chunk.web
          if (web?.uri) {
            sources.push({ title: web.title || '', url: web.uri })
          }
        }
        if (queries.length > 0 || sources.length > 0) {
          emit.searchGrounding({ queries, sources })
        }
      }
    } catch {
      // grounding metadata not available — ignore
    }
  }

  if (!signal.aborted) {
    emit.done()
  }
}

// ============ StreamEmitter — centralised IPC event contract ============

class StreamEmitter {
  constructor(
    private window: BrowserWindow,
    private taskId: string
  ) {}

  // The stream keeps producing after the window closes — sending to a
  // destroyed webContents throws, so every emit checks first.
  private send(channel: string, payload: Record<string, unknown>): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return
    this.window.webContents.send(channel, payload)
  }

  delta(content: string): void {
    this.send('ai:chat-delta', { taskId: this.taskId, content })
  }

  thinkingDelta(content: string): void {
    this.send('ai:chat-thinking-delta', { taskId: this.taskId, content })
  }

  toolUse(toolCallId: string, toolName: string, input: Record<string, any>): void {
    this.send('ai:chat-tool-use', {
      taskId: this.taskId,
      toolCallId,
      toolName,
      input
    })
  }

  done(usage?: { promptTokens?: number; completionTokens?: number }): void {
    this.send('ai:chat-done', { taskId: this.taskId, usage: usage || {} })
  }

  error(message: string): void {
    this.send('ai:chat-error', { taskId: this.taskId, error: message })
  }

  searchGrounding(data: { queries: string[]; sources: Array<{ title: string; url: string }> }): void {
    this.send('ai:chat-search-grounding', { taskId: this.taskId, ...data })
  }

  emitPendingToolCalls(
    pendingToolCalls: Map<number, { id: string; name: string; arguments: string }>
  ): void {
    for (const [, tc] of pendingToolCalls) {
      let input: Record<string, any> = {}
      try {
        input = JSON.parse(tc.arguments)
      } catch {
        /* empty */
      }
      this.toolUse(tc.id, tc.name, input)
    }
  }
}
