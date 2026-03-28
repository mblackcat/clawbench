import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../middleware/auth';
import {
  createConversation,
  getConversationById,
  getConversationsByUser,
  countConversationsByUser,
  updateConversation,
  deleteConversation,
  isConversationOwner,
} from '../repositories/conversationRepository';
import {
  createMessage,
  getMessagesByConversation,
  deleteMessageById,
  deleteMessagesFromId,
} from '../repositories/messageRepository';
import {
  createAttachment,
  getAttachmentById,
  getAttachmentsByMessage,
  linkAttachmentsToMessage,
  getAttachmentsByIds,
} from '../repositories/chatAttachmentRepository';
import {
  conversationToResponse,
  messageToResponse,
} from '../models/conversation';
import { logger } from '../utils/logger';
import { config } from '../config/index';

/**
 * 聊天控制器
 */

const CHAT_UPLOADS_DIR = path.join(config.storage.path, 'chat');

/**
 * 确保聊天上传目录存在
 */
function ensureChatUploadsDir(): void {
  if (!fs.existsSync(CHAT_UPLOADS_DIR)) {
    fs.mkdirSync(CHAT_UPLOADS_DIR, { recursive: true });
  }
}

/**
 * 创建新对话
 * POST /api/v1/chat/conversations
 */
export async function createConversationHandler(
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

    const { title, modelId } = req.body;

    if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Title must be a non-empty string' },
      });
      return;
    }

    if (modelId !== undefined && typeof modelId !== 'string') {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Model ID must be a string' },
      });
      return;
    }

    const conversation = await createConversation(req.userId, {
      title: title?.trim(),
      modelId,
    });

    res.status(201).json({
      success: true,
      data: conversationToResponse(conversation),
    });

    logger.info(`Conversation created: ${conversation.conversationId} by user ${req.userId}`);
  } catch (error) {
    logger.error('Error creating conversation:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 获取对话列表
 * GET /api/v1/chat/conversations
 */
export async function getConversationsHandler(
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

    const favoritedParam = req.query.favorited as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    if (isNaN(limit) || limit < 1 || limit > 100) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Limit must be a number between 1 and 100' },
      });
      return;
    }

    if (isNaN(offset) || offset < 0) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Offset must be a non-negative number' },
      });
      return;
    }

    const filterOptions: { favorited?: boolean; limit: number; offset: number } = {
      limit,
      offset,
    };

    if (favoritedParam !== undefined) {
      filterOptions.favorited = favoritedParam === '1';
    }

    const conversations = await getConversationsByUser(req.userId, filterOptions);
    const total = await countConversationsByUser(req.userId, {
      favorited: filterOptions.favorited,
    });

    res.status(200).json({
      success: true,
      data: {
        conversations: conversations.map(conversationToResponse),
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error('Error getting conversations:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 获取对话详情（包含消息）
 * GET /api/v1/chat/conversations/:id
 */
export async function getConversationDetailHandler(
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

    const { id } = req.params;

    const conversation = await getConversationById(id);
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

    const messages = await getMessagesByConversation(id);

    // Fetch attachments for each message
    const messagesWithAttachments = await Promise.all(
      messages.map(async (msg) => {
        const attachments = await getAttachmentsByMessage(msg.messageId);
        return messageToResponse(msg, attachments);
      })
    );

    res.status(200).json({
      success: true,
      data: {
        ...conversationToResponse(conversation),
        messages: messagesWithAttachments,
      },
    });
  } catch (error) {
    logger.error('Error getting conversation detail:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 更新对话
 * PUT /api/v1/chat/conversations/:id
 */
export async function updateConversationHandler(
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

    const { id } = req.params;

    const conversation = await getConversationById(id);
    if (!conversation) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found' },
      });
      return;
    }

    const isOwner = await isConversationOwner(id, req.userId);
    if (!isOwner) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only conversation owner can perform this action' },
      });
      return;
    }

    const { title, favorited } = req.body;

    if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Title must be a non-empty string' },
      });
      return;
    }

    if (favorited !== undefined && typeof favorited !== 'boolean') {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Favorited must be a boolean' },
      });
      return;
    }

    const updateData: { title?: string; favorited?: boolean } = {};
    if (title !== undefined) updateData.title = title.trim();
    if (favorited !== undefined) updateData.favorited = favorited;

    const updated = await updateConversation(id, updateData);
    if (!updated) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update conversation' },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: conversationToResponse(updated),
    });

    logger.info(`Conversation updated: ${id} by user ${req.userId}`);
  } catch (error) {
    logger.error('Error updating conversation:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 删除对话
 * DELETE /api/v1/chat/conversations/:id
 */
export async function deleteConversationHandler(
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

    const { id } = req.params;

    const conversation = await getConversationById(id);
    if (!conversation) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found' },
      });
      return;
    }

    const isOwner = await isConversationOwner(id, req.userId);
    if (!isOwner) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only conversation owner can perform this action' },
      });
      return;
    }

    const deleted = await deleteConversation(id);
    if (!deleted) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete conversation' },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { message: 'Conversation deleted successfully' },
    });

    logger.info(`Conversation deleted: ${id} by user ${req.userId}`);
  } catch (error) {
    logger.error('Error deleting conversation:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 发送消息
 * POST /api/v1/chat/conversations/:id/messages
 */
export async function sendMessageHandler(
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

    const { id } = req.params;

    const conversation = await getConversationById(id);
    if (!conversation) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found' },
      });
      return;
    }

    const isOwner = await isConversationOwner(id, req.userId);
    if (!isOwner) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
      return;
    }

    const { role, content, modelId, metadata } = req.body;

    if (!role || !['user', 'assistant', 'system'].includes(role)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Role must be one of: user, assistant, system' },
      });
      return;
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Content is required and must be a non-empty string' },
      });
      return;
    }

    if (modelId !== undefined && typeof modelId !== 'string') {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Model ID must be a string' },
      });
      return;
    }

    const message = await createMessage(id, {
      role,
      content: content.trim(),
      modelId,
      metadata: metadata || null,
    });

    // Update conversation's updated_at timestamp
    await updateConversation(id, {});

    res.status(201).json({
      success: true,
      data: messageToResponse(message),
    });

    logger.info(`Message sent in conversation ${id} by user ${req.userId}`);
  } catch (error) {
    logger.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 获取消息列表
 * GET /api/v1/chat/conversations/:id/messages
 */
export async function getMessagesHandler(
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

    const { id } = req.params;

    const conversation = await getConversationById(id);
    if (!conversation) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found' },
      });
      return;
    }

    const isOwner = await isConversationOwner(id, req.userId);
    if (!isOwner) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
      return;
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit < 1 || limit > 100)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Limit must be a number between 1 and 100' },
      });
      return;
    }

    if (offset !== undefined && (isNaN(offset) || offset < 0)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Offset must be a non-negative number' },
      });
      return;
    }

    const messages = await getMessagesByConversation(id, { limit, offset });

    const messagesWithAttachments = await Promise.all(
      messages.map(async (msg) => {
        const attachments = await getAttachmentsByMessage(msg.messageId);
        return messageToResponse(msg, attachments);
      })
    );

    res.status(200).json({
      success: true,
      data: {
        messages: messagesWithAttachments,
      },
    });
  } catch (error) {
    logger.error('Error getting messages:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 上传附件
 * POST /api/v1/chat/conversations/:id/attachments
 */
export async function uploadAttachmentHandler(
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

    const { id } = req.params;

    const conversation = await getConversationById(id);
    if (!conversation) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found' },
      });
      return;
    }

    const isOwner = await isConversationOwner(id, req.userId);
    if (!isOwner) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
      return;
    }

    if (!req.file) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'File is required' },
      });
      return;
    }

    const { messageId } = req.body;
    // messageId is optional — attachments can be uploaded before message creation

    // Save file to chat uploads directory
    ensureChatUploadsDir();

    const ext = path.extname(req.file.originalname);
    const fileName = `${uuidv4()}${ext}`;
    const relativePath = path.join('chat', id, fileName);
    const fullDir = path.join(CHAT_UPLOADS_DIR, id);

    if (!fs.existsSync(fullDir)) {
      fs.mkdirSync(fullDir, { recursive: true });
    }

    const fullPath = path.join(fullDir, fileName);
    await fs.promises.writeFile(fullPath, req.file.buffer);

    const attachment = await createAttachment({
      messageId: messageId || null,
      conversationId: id,
      fileName: req.file.originalname,
      filePath: relativePath,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
    });

    res.status(201).json({
      success: true,
      data: {
        attachmentId: attachment.attachmentId,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType,
      },
    });

    logger.info(`Attachment uploaded: ${attachment.attachmentId} in conversation ${id}`);
  } catch (error) {
    logger.error('Error uploading attachment:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 下载附件
 * GET /api/v1/chat/attachments/:id/download
 */
export async function downloadAttachmentHandler(
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

    const { id } = req.params;

    const attachment = await getAttachmentById(id);
    if (!attachment) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Attachment not found' },
      });
      return;
    }

    // Check conversation ownership
    const isOwner = await isConversationOwner(attachment.conversationId, req.userId);
    if (!isOwner) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
      return;
    }

    const fullPath = path.join(config.storage.path, attachment.filePath);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'File not found on disk' },
      });
      return;
    }

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.fileName}"`);
    res.setHeader('Content-Length', attachment.fileSize);

    const fileStream = fs.createReadStream(fullPath);
    fileStream.pipe(res);
  } catch (error) {
    logger.error('Error downloading attachment:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 关联附件到消息
 * PUT /api/v1/chat/attachments/link
 */
export async function linkAttachmentsHandler(
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

    const { attachmentIds, messageId } = req.body;

    if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'attachmentIds must be a non-empty array' },
      });
      return;
    }

    if (!messageId || typeof messageId !== 'string') {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'messageId is required' },
      });
      return;
    }

    // Verify ownership: check that all attachments belong to conversations owned by the user
    const attachments = await getAttachmentsByIds(attachmentIds);
    if (attachments.length === 0) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No attachments found' },
      });
      return;
    }

    for (const att of attachments) {
      const isOwner = await isConversationOwner(att.conversationId, req.userId);
      if (!isOwner) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied' },
        });
        return;
      }
    }

    await linkAttachmentsToMessage(attachmentIds, messageId);

    res.status(200).json({
      success: true,
      data: { linked: attachmentIds.length },
    });

    logger.info(`Linked ${attachmentIds.length} attachments to message ${messageId}`);
  } catch (error) {
    logger.error('Error linking attachments:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * Delete message(s)
 * DELETE /api/v1/chat/conversations/:id/messages/:messageId
 * Query: ?mode=single|from-here
 */
export async function deleteMessageHandler(
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

    const { id: conversationId, messageId } = req.params;
    const mode = (req.query.mode as string) || 'single';

    const isOwner = await isConversationOwner(conversationId, req.userId);
    if (!isOwner) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not your conversation' },
      });
      return;
    }

    if (mode === 'from-here') {
      const count = await deleteMessagesFromId(conversationId, messageId);
      res.json({ success: true, data: { deleted: count } });
    } else {
      const ok = await deleteMessageById(messageId);
      res.json({ success: true, data: { deleted: ok ? 1 : 0 } });
    }

    logger.info(`Deleted message(s) mode=${mode} messageId=${messageId} conversationId=${conversationId}`);
  } catch (error: any) {
    logger.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
}
