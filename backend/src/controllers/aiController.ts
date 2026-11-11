import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AuthRequest } from '../middleware/auth';
import { getBuiltinModels, getModelConfig, streamChat, generateTitle, ChatMessage, ContentPart, ToolDefinition, ModelConfig } from '../services/aiService';
import { getSystemModelSecret, listSystemModels } from '../repositories/aiSystemModelRepository';
import { createUsageLog } from '../repositories/aiUsageRepository';
import { AI_MODEL_KINDS, AiModelKind, AiSystemModel, parseSystemModelOptionId, systemModelOptionId } from '../models/aiModel';
import { createMessage } from '../repositories/messageRepository';
import { getConversationById, updateConversation } from '../repositories/conversationRepository';
import { getAttachmentsByIds } from '../repositories/chatAttachmentRepository';
import { logger } from '../utils/logger';
import { config } from '../config/index';

/**
 * 解析模型：先查环境变量内置模型（AI_BUILTIN_MODELS），再查 admin-panel 配置的 chat 系统模型。
 * 返回的 ModelConfig.id 为上游真实模型名；modelRef 为客户端可见的模型 id（用于用量审计）。
 */
async function resolveChatModel(
  optionId: string
): Promise<{ modelConfig: ModelConfig; modelRef: string } | undefined> {
  const builtin = getModelConfig(optionId);
  if (builtin) return { modelConfig: builtin, modelRef: builtin.id };
  // 系统模型选项 id：<配置 id>::<上游模型 id>（单独配置 id 时取默认模型）
  const { modelId, modelName } = parseSystemModelOptionId(optionId);
  const resolved = await getSystemModelSecret(modelId);
  if (!resolved || !resolved.model.enabled || resolved.model.kind !== 'chat' || !resolved.apiKey) return undefined;
  const { model, apiKey } = resolved;
  const upstream = modelName ?? model.modelNames[0];
  if (!upstream || !model.modelNames.includes(upstream)) return undefined;
  return {
    modelRef: model.modelId,
    modelConfig: {
      id: upstream,
      name: model.name,
      provider: model.apiFormat === 'gemini' ? 'google' : 'openai',
      endpoint: model.endpoint,
      apiKey,
    },
  };
}

/** 系统模型配置 → 客户端选项（多模型配置显示为「配置名 · 模型 id」） */
function expandSystemModels(models: AiSystemModel[]) {
  return models.flatMap((m) =>
    m.modelNames.map((modelName) => ({
      optionId: systemModelOptionId(m.modelId, modelName),
      modelId: m.modelId,
      configName: m.name,
      label: m.modelNames.length > 1 ? `${m.name} · ${modelName}` : m.name,
      kind: m.kind,
      apiFormat: m.apiFormat,
      modelName,
    }))
  );
}

/**
 * GET /api/v1/ai/models
 * Get builtin models list (env builtin + admin-configured chat system models)
 */
export async function getModelsHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const systemChatModels = expandSystemModels(
      (await listSystemModels({ kind: 'chat', enabledOnly: true })).filter((m) => m.hasApiKey)
    ).map((o) => ({ id: o.optionId, name: o.label, provider: o.apiFormat === 'gemini' ? 'google' : 'openai' }));
    const models = [...getBuiltinModels(), ...systemChatModels];
    res.status(200).json({
      success: true,
      data: { models },
    });
  } catch (error) {
    logger.error('Error getting models:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * POST /api/v1/ai/chat/stream
 * SSE streaming chat
 */
export async function streamChatHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const { modelId, messages, conversationId, attachmentIds, tools, enableThinking, webSearchEnabled } = req.body;

    // Validate
    if (!modelId || !messages || !Array.isArray(messages)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'modelId and messages are required' },
      });
      return;
    }

    // Find model config (env builtin or admin-configured system model)
    const resolvedModel = typeof modelId === 'string' ? await resolveChatModel(modelId) : undefined;
    if (!resolvedModel) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Model not found' },
      });
      return;
    }

    // Verify conversation ownership if provided
    if (conversationId) {
      const conversation = await getConversationById(conversationId);
      if (!conversation || conversation.userId !== req.userId) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized' },
        });
        return;
      }
    }

    // Build multimodal messages if attachments are provided
    let chatMessages: ChatMessage[] = messages;
    if (attachmentIds && Array.isArray(attachmentIds) && attachmentIds.length > 0) {
      try {
        const attachments = await getAttachmentsByIds(attachmentIds);
        if (attachments.length > 0) {
          // Build contentParts for the last user message
          const lastUserIdx = chatMessages.length - 1;
          const lastMsg = chatMessages[lastUserIdx];
          if (lastMsg && lastMsg.role === 'user') {
            const parts: ContentPart[] = [{ type: 'text', text: lastMsg.content }];
            for (const att of attachments) {
              const fullPath = path.join(config.storage.path, att.filePath);
              if (fs.existsSync(fullPath) && att.mimeType.startsWith('image/')) {
                const fileData = fs.readFileSync(fullPath);
                parts.push({
                  type: 'image_base64',
                  mimeType: att.mimeType,
                  base64Data: fileData.toString('base64'),
                });
              }
            }
            chatMessages = [...chatMessages];
            chatMessages[lastUserIdx] = { ...lastMsg, contentParts: parts };
          }
        }
      } catch (err) {
        logger.error('Error loading attachments for streaming:', err);
      }
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Abort the upstream provider request as soon as the client disconnects,
    // so we stop paying for tokens nobody will receive.
    const upstreamAbort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        upstreamAbort.abort();
      }
    });

    const { modelConfig, modelRef } = resolvedModel;
    let fullContent = '';
    const started = Date.now();
    let usage: { promptTokens: number; completionTokens: number } | undefined;
    let streamFailed = false;

    try {
      const validTools: ToolDefinition[] | undefined = tools && Array.isArray(tools) && tools.length > 0 ? tools : undefined;
      for await (const chunk of streamChat(modelConfig, chatMessages, validTools, enableThinking, webSearchEnabled, upstreamAbort.signal)) {
        if (upstreamAbort.signal.aborted) break;
        if (chunk.type === 'delta' && chunk.content) {
          fullContent += chunk.content;
        }
        if (chunk.type === 'done' && chunk.usage) usage = chunk.usage;
        if (chunk.type === 'error') streamFailed = true;
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    } catch (streamError: any) {
      if (upstreamAbort.signal.aborted) {
        logger.info('Stream aborted: client disconnected');
      } else {
        streamFailed = true;
        logger.error('Stream error:', streamError);
        res.write(`data: ${JSON.stringify({ type: 'error', message: streamError.message })}\n\n`);
      }
    }

    // 用量审计（仅元数据，不记录对话内容）
    createUsageLog({
      userId: req.userId,
      source: 'system',
      modelRef,
      modelName: modelConfig.id,
      kind: 'chat',
      scene: 'chat.stream',
      status: streamFailed ? 'error' : 'success',
      durationMs: Date.now() - started,
      inputTokens: usage?.promptTokens ?? null,
      outputTokens: usage?.completionTokens ?? null,
      outputCount: null,
      errorCode: streamFailed ? 'STREAM_ERROR' : upstreamAbort.signal.aborted ? 'CLIENT_ABORTED' : null,
    }).catch((err) => logger.error('Error writing usage log:', err));

    // Save assistant message to DB if conversation provided
    if (conversationId && fullContent) {
      try {
        await createMessage(conversationId, {
          role: 'assistant',
          content: fullContent,
          modelId: modelId,
        });
      } catch (saveError) {
        logger.error('Error saving assistant message:', saveError);
      }
    }

    res.end();
  } catch (error) {
    logger.error('Error in stream chat:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Internal server error' })}\n\n`);
      res.end();
    }
  }
}

/**
 * POST /api/v1/ai/chat/generate-title
 * Generate a conversation title from messages
 */
export async function generateTitleHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const { modelId, messages, conversationId } = req.body;

    if (!modelId || !messages || !Array.isArray(messages)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'modelId and messages are required' },
      });
      return;
    }

    // Only the owner may retitle a conversation: check before spending a model call
    if (conversationId !== undefined && conversationId !== null) {
      if (typeof conversationId !== 'string' || !conversationId) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'conversationId must be a string' },
        });
        return;
      }
      const conversation = await getConversationById(conversationId);
      if (!conversation) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Conversation not found' },
        });
        return;
      }
      if (conversation.userId !== req.userId) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied' },
        });
        return;
      }
    }

    const resolvedModel = typeof modelId === 'string' ? await resolveChatModel(modelId) : undefined;
    if (!resolvedModel) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Model not found' },
      });
      return;
    }

    const title = await generateTitle(resolvedModel.modelConfig, messages as ChatMessage[]);

    // Update conversation title if conversationId provided
    if (conversationId) {
      try {
        await updateConversation(conversationId, { title });
      } catch (updateError) {
        logger.error('Error updating conversation title:', updateError);
      }
    }

    res.status(200).json({
      success: true,
      data: { title },
    });
  } catch (error) {
    logger.error('Error generating title:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to generate title' },
    });
  }
}

/**
 * GET /api/v1/ai/system-models?kind=chat|image
 * 客户端「系统」分组：已启用且已配置密钥的系统模型（不含密钥 / endpoint）
 */
export async function listSystemModelsHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    if (kind && !AI_MODEL_KINDS.includes(kind as AiModelKind)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid kind' } });
      return;
    }
    // 一条配置的每个上游模型 id 展开为一个选项；optionId 回传给 /ai/chat/stream 等接口
    const models = expandSystemModels(
      (await listSystemModels({ kind: kind as AiModelKind | undefined, enabledOnly: true })).filter((m) => m.hasApiKey)
    ).map((o) => ({
      optionId: o.optionId,
      modelId: o.modelId,
      name: o.label,
      configName: o.configName,
      kind: o.kind,
      apiFormat: o.apiFormat,
      modelName: o.modelName,
    }));
    res.json({ success: true, data: { models } });
  } catch (error) {
    logger.error('Error listing system models:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
}

/**
 * POST /api/v1/ai/usage/report
 * 客户端上报「自用」模型调用用量（不含 prompt / 内容）。
 * Body: { kind, modelName, scene, status, durationMs?, inputTokens?, outputTokens?, outputCount?, errorCode? }
 */
export async function reportUsageHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const b = req.body ?? {};
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
    const num = (v: unknown) =>
      v === undefined || v === null ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : NaN;
    const modelName = str(b.modelName, 200);
    const scene = str(b.scene, 64);
    const values = [num(b.durationMs), num(b.inputTokens), num(b.outputTokens), num(b.outputCount)];
    if (
      !AI_MODEL_KINDS.includes(b.kind) ||
      !modelName ||
      !scene ||
      !['success', 'error'].includes(b.status) ||
      values.some((v) => Number.isNaN(v))
    ) {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid usage report' } });
      return;
    }
    await createUsageLog({
      userId: req.userId!,
      source: 'personal',
      modelRef: null,
      modelName,
      kind: b.kind,
      scene,
      status: b.status,
      durationMs: values[0],
      inputTokens: values[1],
      outputTokens: values[2],
      outputCount: values[3],
      errorCode: b.status === 'error' ? str(b.errorCode, 64) : null,
    });
    res.status(201).json({ success: true, data: { recorded: true } });
  } catch (error) {
    logger.error('Error recording usage report:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
}
