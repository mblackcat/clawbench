import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AuthRequest } from '../middleware/auth';
import { getBuiltinModels, getModelConfig, streamChat, generateTitle, ChatMessage, ContentPart, ToolDefinition } from '../services/aiService';
import { createMessage } from '../repositories/messageRepository';
import { getConversationById, updateConversation } from '../repositories/conversationRepository';
import { getAttachmentsByIds } from '../repositories/chatAttachmentRepository';
import { logger } from '../utils/logger';
import { config } from '../config/index';

/**
 * GET /api/v1/ai/models
 * Get builtin models list
 */
export async function getModelsHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const models = getBuiltinModels();
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

    // Find model config
    const modelConfig = getModelConfig(modelId);
    if (!modelConfig) {
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

    let fullContent = '';

    try {
      const validTools: ToolDefinition[] | undefined = tools && Array.isArray(tools) && tools.length > 0 ? tools : undefined;
      for await (const chunk of streamChat(modelConfig, chatMessages, validTools, enableThinking, webSearchEnabled)) {
        if (chunk.type === 'delta' && chunk.content) {
          fullContent += chunk.content;
        }
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    } catch (streamError: any) {
      logger.error('Stream error:', streamError);
      res.write(`data: ${JSON.stringify({ type: 'error', message: streamError.message })}\n\n`);
    }

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

    const modelConfig = getModelConfig(modelId);
    if (!modelConfig) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Model not found' },
      });
      return;
    }

    const title = await generateTitle(modelConfig, messages as ChatMessage[]);

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
