import OpenAI, { AzureOpenAI } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index';
import { logger } from '../utils/logger';

export interface StreamChunk {
  type: 'delta' | 'thinking_delta' | 'done' | 'error' | 'tool_use' | 'search_grounding';
  content?: string;
  usage?: { promptTokens: number; completionTokens: number };
  message?: string;
  toolCall?: { id: string; name: string; input: Record<string, any> };
  queries?: string[];
  sources?: Array<{ title: string; url: string }>;
}

export interface ContentPart {
  type: 'text' | 'image_base64';
  text?: string;
  mimeType?: string;
  base64Data?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  contentParts?: ContentPart[];
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, any> }>;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  apiKey: string;
  maxTokens?: number;
  apiVersion?: string;
}

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  maxTokens?: number;
}

/**
 * Get builtin models list (without apiKey)
 */
export function getBuiltinModels(): AIModel[] {
  return config.ai.builtinModels.map((m: ModelConfig) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    maxTokens: m.maxTokens,
  }));
}

/**
 * Find a builtin model config by id
 */
export function getModelConfig(modelId: string): ModelConfig | undefined {
  return config.ai.builtinModels.find((m: ModelConfig) => m.id === modelId);
}

/**
 * Generate a conversation title (non-streaming)
 */
export async function generateTitle(
  modelConfig: ModelConfig,
  messages: ChatMessage[]
): Promise<string> {
  const provider = modelConfig.provider.toLowerCase();

  const titlePrompt: ChatMessage[] = [
    {
      role: 'user',
      content: `请用10个字以内总结以下对话的主题，直接回复标题文字，不要加引号和其他内容：\n\n${messages.map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.substring(0, 200)}`).join('\n')}`,
    },
  ];

  if (provider === 'claude' || provider === 'anthropic' || provider === 'anthropic-compatible') {
    return completeClaude(modelConfig, titlePrompt);
  } else if (provider === 'google' || provider === 'gemini') {
    return completeGoogle(modelConfig, titlePrompt);
  } else if (provider === 'azure-openai') {
    return completeAzureOpenAI(modelConfig, titlePrompt);
  } else {
    return completeOpenAI(modelConfig, titlePrompt);
  }
}

function toOpenAITitleMessages(messages: ChatMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages
    .filter(m => m.role !== 'tool')
    .map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));
}

async function completeOpenAI(modelConfig: ModelConfig, messages: ChatMessage[]): Promise<string> {
  const client = new OpenAI({ apiKey: modelConfig.apiKey, baseURL: modelConfig.endpoint });
  const response = await client.chat.completions.create({
    model: modelConfig.id,
    messages: toOpenAITitleMessages(messages),
    max_tokens: 50,
  });
  return response.choices[0]?.message?.content?.trim() || '新对话';
}

async function completeAzureOpenAI(modelConfig: ModelConfig, messages: ChatMessage[]): Promise<string> {
  const client = new AzureOpenAI({
    apiKey: modelConfig.apiKey,
    apiVersion: modelConfig.apiVersion || '2025-04-01-preview',
    endpoint: modelConfig.endpoint,
  });
  const response = await client.chat.completions.create({
    model: modelConfig.id,
    messages: toOpenAITitleMessages(messages),
    max_tokens: 50,
  });
  return response.choices[0]?.message?.content?.trim() || '新对话';
}

async function completeClaude(modelConfig: ModelConfig, messages: ChatMessage[]): Promise<string> {
  const client = new Anthropic({ apiKey: modelConfig.apiKey, baseURL: modelConfig.endpoint || undefined });
  const response = await client.messages.create({
    model: modelConfig.id,
    max_tokens: 50,
    messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  });
  const textBlock = response.content.find(b => b.type === 'text');
  return (textBlock as any)?.text?.trim() || '新对话';
}

async function completeGoogle(modelConfig: ModelConfig, messages: ChatMessage[]): Promise<string> {
  const genAI = new GoogleGenerativeAI(modelConfig.apiKey);
  const requestOptions = modelConfig.endpoint ? { baseUrl: modelConfig.endpoint } : undefined;
  const model = genAI.getGenerativeModel({ model: modelConfig.id }, requestOptions);
  const result = await model.generateContent(messages[messages.length - 1].content);
  return result.response.text().trim() || '新对话';
}

/**
 * Stream chat using appropriate provider adapter
 */
export async function* streamChat(
  modelConfig: ModelConfig,
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  enableThinking?: boolean,
  webSearchEnabled?: boolean
): AsyncGenerator<StreamChunk> {
  const provider = modelConfig.provider.toLowerCase();

  if (provider === 'claude' || provider === 'anthropic' || provider === 'anthropic-compatible') {
    yield* streamClaude(modelConfig, messages, tools, enableThinking);
  } else if (provider === 'google' || provider === 'gemini') {
    yield* streamGoogle(modelConfig, messages, tools, webSearchEnabled);
  } else if (provider === 'azure-openai') {
    yield* streamAzureOpenAI(modelConfig, messages, tools, enableThinking);
  } else {
    // OpenAI-compatible: openai, qwen, doubao, deepseek, kimi, openai-compatible
    yield* streamOpenAICompatible(modelConfig, messages, tools, enableThinking);
  }
}

/**
 * Build OpenAI-format messages (multimodal-aware)
 */
function buildOpenAIMessages(messages: ChatMessage[]): any[] {
  return messages.map(m => {
    if (m.contentParts && m.contentParts.length > 0) {
      const parts: any[] = [];
      for (const p of m.contentParts) {
        if (p.type === 'text' && p.text) {
          parts.push({ type: 'text', text: p.text });
        } else if (p.type === 'image_base64' && p.base64Data) {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${p.mimeType || 'image/png'};base64,${p.base64Data}` },
          });
        }
      }
      return { role: m.role, content: parts.length > 0 ? parts : m.content };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * Build Claude-format messages (multimodal-aware)
 */
function buildClaudeMessages(messages: ChatMessage[]): any[] {
  return messages.filter(m => m.role !== 'system').map(m => {
    if (m.contentParts && m.contentParts.length > 0) {
      const parts: any[] = [];
      for (const p of m.contentParts) {
        if (p.type === 'text' && p.text) {
          parts.push({ type: 'text', text: p.text });
        } else if (p.type === 'image_base64' && p.base64Data) {
          parts.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: p.mimeType || 'image/png',
              data: p.base64Data,
            },
          });
        }
      }
      return { role: m.role as 'user' | 'assistant', content: parts.length > 0 ? parts : m.content };
    }
    return { role: m.role as 'user' | 'assistant', content: m.content };
  });
}

/**
 * Build Gemini-format parts (multimodal-aware)
 */
function buildGeminiParts(msg: ChatMessage): any[] {
  if (msg.contentParts && msg.contentParts.length > 0) {
    const parts: any[] = [];
    for (const p of msg.contentParts) {
      if (p.type === 'text' && p.text) {
        parts.push({ text: p.text });
      } else if (p.type === 'image_base64' && p.base64Data) {
        parts.push({ inlineData: { mimeType: p.mimeType || 'image/png', data: p.base64Data } });
      }
    }
    return parts.length > 0 ? parts : [{ text: msg.content }];
  }
  return [{ text: msg.content }];
}

/**
 * Convert ToolDefinition[] to OpenAI tools format
 */
function toOpenAITools(tools: ToolDefinition[]): any[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

/**
 * Convert ToolDefinition[] to Claude tools format
 */
function toClaudeTools(tools: ToolDefinition[]): any[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

/**
 * Convert ToolDefinition[] to Gemini tools format
 */
function toGeminiTools(tools: ToolDefinition[]): any[] {
  return [{
    functionDeclarations: tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    })),
  }];
}

/**
 * Build OpenAI-format messages including tool call/result messages
 */
function buildOpenAIMessagesWithTools(messages: ChatMessage[]): any[] {
  return messages.map(m => {
    // Tool result message
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content,
      };
    }
    // Assistant message with tool calls
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input),
          },
        })),
      };
    }
    // Regular message (multimodal-aware)
    if (m.contentParts && m.contentParts.length > 0) {
      const parts: any[] = [];
      for (const p of m.contentParts) {
        if (p.type === 'text' && p.text) {
          parts.push({ type: 'text', text: p.text });
        } else if (p.type === 'image_base64' && p.base64Data) {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${p.mimeType || 'image/png'};base64,${p.base64Data}` },
          });
        }
      }
      return { role: m.role, content: parts.length > 0 ? parts : m.content };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * OpenAI-compatible streaming (works for OpenAI, Qwen, Doubao, DeepSeek, Kimi)
 */
async function* streamOpenAICompatible(
  modelConfig: ModelConfig,
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  enableThinking?: boolean
): AsyncGenerator<StreamChunk> {
  const client = new OpenAI({
    apiKey: modelConfig.apiKey,
    baseURL: modelConfig.endpoint,
  });

  try {
    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: modelConfig.id,
      messages: tools ? buildOpenAIMessagesWithTools(messages) : buildOpenAIMessages(messages),
      max_tokens: modelConfig.maxTokens || 4096,
      stream: true,
    };
    if (tools && tools.length > 0) {
      requestParams.tools = toOpenAITools(tools);
    }

    const stream = await client.chat.completions.create(requestParams);

    let totalCompletion = 0;
    // Accumulate tool calls from deltas
    const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta as any;
      // Capture reasoning_content (DeepSeek R1, QwQ, etc.)
      if (enableThinking && delta?.reasoning_content) {
        yield { type: 'thinking_delta', content: delta.reasoning_content };
      }
      if (delta?.content) {
        totalCompletion += delta.content.length;
        yield { type: 'delta', content: delta.content };
      }
      // Detect tool_calls in delta
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!pendingToolCalls.has(idx)) {
            pendingToolCalls.set(idx, { id: tc.id || '', name: tc.function?.name || '', arguments: '' });
          }
          const pending = pendingToolCalls.get(idx)!;
          if (tc.id) pending.id = tc.id;
          if (tc.function?.name) pending.name = tc.function.name;
          if (tc.function?.arguments) pending.arguments += tc.function.arguments;
        }
      }
      // Check finish_reason
      if (chunk.choices[0]?.finish_reason === 'tool_calls') {
        // Emit all accumulated tool calls
        for (const [, tc] of pendingToolCalls) {
          let input: Record<string, any> = {};
          try { input = JSON.parse(tc.arguments); } catch { /* empty */ }
          yield { type: 'tool_use', toolCall: { id: tc.id, name: tc.name, input } };
        }
        return;
      }
    }

    // If we had pending tool calls but no explicit finish_reason, still emit them
    if (pendingToolCalls.size > 0) {
      for (const [, tc] of pendingToolCalls) {
        let input: Record<string, any> = {};
        try { input = JSON.parse(tc.arguments); } catch { /* empty */ }
        yield { type: 'tool_use', toolCall: { id: tc.id, name: tc.name, input } };
      }
      return;
    }

    yield { type: 'done', usage: { promptTokens: 0, completionTokens: totalCompletion } };
  } catch (error: any) {
    logger.error('OpenAI streaming error:', error);
    yield { type: 'error', message: error.message || 'OpenAI API error' };
  }
}

/**
 * Azure OpenAI streaming
 */
async function* streamAzureOpenAI(
  modelConfig: ModelConfig,
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  enableThinking?: boolean
): AsyncGenerator<StreamChunk> {
  const client = new AzureOpenAI({
    apiKey: modelConfig.apiKey,
    apiVersion: modelConfig.apiVersion || '2025-04-01-preview',
    endpoint: modelConfig.endpoint,
  });

  try {
    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: modelConfig.id,
      messages: tools ? buildOpenAIMessagesWithTools(messages) : buildOpenAIMessages(messages),
      max_tokens: modelConfig.maxTokens || 4096,
      stream: true,
    };
    if (tools && tools.length > 0) {
      requestParams.tools = toOpenAITools(tools);
    }

    const stream = await client.chat.completions.create(requestParams);

    let totalCompletion = 0;
    const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta as any;
      if (enableThinking && delta?.reasoning_content) {
        yield { type: 'thinking_delta', content: delta.reasoning_content };
      }
      if (delta?.content) {
        totalCompletion += delta.content.length;
        yield { type: 'delta', content: delta.content };
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!pendingToolCalls.has(idx)) {
            pendingToolCalls.set(idx, { id: tc.id || '', name: tc.function?.name || '', arguments: '' });
          }
          const pending = pendingToolCalls.get(idx)!;
          if (tc.id) pending.id = tc.id;
          if (tc.function?.name) pending.name = tc.function.name;
          if (tc.function?.arguments) pending.arguments += tc.function.arguments;
        }
      }
      if (chunk.choices[0]?.finish_reason === 'tool_calls') {
        for (const [, tc] of pendingToolCalls) {
          let input: Record<string, any> = {};
          try { input = JSON.parse(tc.arguments); } catch { /* empty */ }
          yield { type: 'tool_use', toolCall: { id: tc.id, name: tc.name, input } };
        }
        return;
      }
    }

    if (pendingToolCalls.size > 0) {
      for (const [, tc] of pendingToolCalls) {
        let input: Record<string, any> = {};
        try { input = JSON.parse(tc.arguments); } catch { /* empty */ }
        yield { type: 'tool_use', toolCall: { id: tc.id, name: tc.name, input } };
      }
      return;
    }

    yield { type: 'done', usage: { promptTokens: 0, completionTokens: totalCompletion } };
  } catch (error: any) {
    logger.error('Azure OpenAI streaming error:', error);
    yield { type: 'error', message: error.message || 'Azure OpenAI API error' };
  }
}

/**
 * Claude/Anthropic streaming
 */
async function* streamClaude(
  modelConfig: ModelConfig,
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  enableThinking?: boolean
): AsyncGenerator<StreamChunk> {
  const client = new Anthropic({
    apiKey: modelConfig.apiKey,
    baseURL: modelConfig.endpoint || undefined,
  });

  try {
    // Separate system message
    const systemMessage = messages.find(m => m.role === 'system');

    // Build Claude messages (handle tool results)
    const claudeMessages = messages.filter(m => m.role !== 'system').map(m => {
      // Tool result → user message with tool_result content
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [{
            type: 'tool_result' as const,
            tool_use_id: m.toolCallId || '',
            content: m.content,
          }],
        };
      }
      // Assistant with tool calls → content blocks
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        const blocks: any[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        }
        return { role: 'assistant' as const, content: blocks };
      }
      // Regular multimodal
      if (m.contentParts && m.contentParts.length > 0) {
        const parts: any[] = [];
        for (const p of m.contentParts) {
          if (p.type === 'text' && p.text) {
            parts.push({ type: 'text', text: p.text });
          } else if (p.type === 'image_base64' && p.base64Data) {
            parts.push({
              type: 'image',
              source: { type: 'base64', media_type: p.mimeType || 'image/png', data: p.base64Data },
            });
          }
        }
        return { role: m.role as 'user' | 'assistant', content: parts.length > 0 ? parts : m.content };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    });

    const requestParams: any = {
      model: modelConfig.id,
      max_tokens: enableThinking ? 16000 : (modelConfig.maxTokens || 4096),
      system: systemMessage?.content || undefined,
      messages: claudeMessages,
    };
    if (enableThinking) {
      requestParams.thinking = { type: 'enabled', budget_tokens: 10000 };
    }
    if (tools && tools.length > 0) {
      requestParams.tools = toClaudeTools(tools);
    }

    const stream = client.messages.stream(requestParams);

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'thinking_delta') {
          yield { type: 'thinking_delta', content: (event.delta as any).thinking };
        } else if (event.delta.type === 'text_delta') {
          yield { type: 'delta', content: event.delta.text };
        }
      }
      // Detect tool_use content blocks
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        // We'll get the full tool call when the block stops
      }
      if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
        // Accumulating JSON — handled by the SDK
      }
    }

    const finalMessage = await stream.finalMessage();

    // Check for tool_use blocks in the final message
    const toolUseBlocks = finalMessage.content.filter((b: any) => b.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
      for (const block of toolUseBlocks) {
        yield {
          type: 'tool_use',
          toolCall: {
            id: (block as any).id,
            name: (block as any).name,
            input: (block as any).input || {},
          },
        };
      }
      return;
    }

    yield {
      type: 'done',
      usage: {
        promptTokens: finalMessage.usage.input_tokens,
        completionTokens: finalMessage.usage.output_tokens,
      },
    };
  } catch (error: any) {
    logger.error('Claude streaming error:', error);
    yield { type: 'error', message: error.message || 'Claude API error' };
  }
}

/**
 * Google/Gemini streaming
 */
async function* streamGoogle(
  modelConfig: ModelConfig,
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  webSearchEnabled?: boolean
): AsyncGenerator<StreamChunk> {
  const genAI = new GoogleGenerativeAI(modelConfig.apiKey);
  const requestOptions = modelConfig.endpoint ? { baseUrl: modelConfig.endpoint } : undefined;

  const modelParams: any = { model: modelConfig.id };
  if (tools && tools.length > 0) {
    // Gemini does not allow mixing googleSearch grounding with functionDeclarations.
    // When web search is enabled, use native grounding only (no function calling tools).
    if (webSearchEnabled) {
      modelParams.tools = [{ googleSearch: {} }];
    } else {
      const functionTools = tools.filter((t) => t.name !== 'web_search' && t.name !== 'finish_search' && t.name !== 'web_browse');
      if (functionTools.length > 0) {
        modelParams.tools = toGeminiTools(functionTools);
      }
    }
  } else if (webSearchEnabled) {
    modelParams.tools = [{ googleSearch: {} }];
  }
  const model = genAI.getGenerativeModel(modelParams, requestOptions);

  try {
    // Convert messages to Gemini format (multimodal-aware)
    const history = messages
      .filter(m => m.role !== 'system')
      .slice(0, -1)
      .map(m => {
        // Tool result → function response
        if (m.role === 'tool') {
          return {
            role: 'function',
            parts: [{
              functionResponse: {
                name: m.toolCallId || 'unknown',
                response: { result: m.content },
              },
            }],
          };
        }
        // Assistant with tool calls → function call parts
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          const parts: any[] = [];
          if (m.content) parts.push({ text: m.content });
          for (const tc of m.toolCalls) {
            parts.push({ functionCall: { name: tc.name, args: tc.input } });
          }
          return { role: 'model', parts };
        }
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: buildGeminiParts(m),
        };
      });

    const lastMessage = messages[messages.length - 1];
    const systemInstruction = messages.find(m => m.role === 'system')?.content;

    const chat = model.startChat({
      history: history as any,
      ...(systemInstruction ? { systemInstruction } : {}),
    });

    const result = await chat.sendMessageStream(buildGeminiParts(lastMessage));
    let totalTokens = 0;

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        totalTokens += text.length;
        yield { type: 'delta', content: text };
      }
      // Check for function calls
      const candidates = chunk.candidates || [];
      for (const candidate of candidates) {
        for (const part of (candidate.content?.parts || [])) {
          if ((part as any).functionCall) {
            const fc = (part as any).functionCall;
            yield {
              type: 'tool_use',
              toolCall: {
                id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                name: fc.name,
                input: fc.args || {},
              },
            };
            return;
          }
        }
      }
    }

    // Extract grounding metadata from final response (Google Search grounding)
    if (webSearchEnabled) {
      try {
        const response = await result.response;
        const candidate = response.candidates?.[0];
        const grounding = (candidate as any)?.groundingMetadata;
        if (grounding) {
          const queries: string[] = grounding.webSearchQueries || [];
          const sources: Array<{ title: string; url: string }> = [];
          const chunks = grounding.groundingChunks || [];
          for (const chunk of chunks) {
            const web = (chunk as any).web;
            if (web?.uri) {
              sources.push({ title: web.title || '', url: web.uri });
            }
          }
          if (queries.length > 0 || sources.length > 0) {
            yield { type: 'search_grounding', queries, sources };
          }
        }
      } catch {
        // grounding metadata not available — ignore
      }
    }

    yield { type: 'done', usage: { promptTokens: 0, completionTokens: totalTokens } };
  } catch (error: any) {
    logger.error('Google streaming error:', error);
    yield { type: 'error', message: error.message || 'Google API error' };
  }
}
