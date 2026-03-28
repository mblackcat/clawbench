import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import {
  createConversationHandler,
  getConversationsHandler,
  getConversationDetailHandler,
  updateConversationHandler,
  deleteConversationHandler,
  sendMessageHandler,
  getMessagesHandler,
  uploadAttachmentHandler,
  downloadAttachmentHandler,
  linkAttachmentsHandler,
  deleteMessageHandler,
} from '../controllers/chatController';

// 配置 multer 用于聊天文件上传（使用内存存储）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

/**
 * 聊天相关路由
 */
export const chatRouter = Router();

/**
 * POST /api/v1/chat/conversations
 * 创建新对话
 */
chatRouter.post('/conversations', authenticate, createConversationHandler);

/**
 * GET /api/v1/chat/conversations
 * 获取对话列表
 */
chatRouter.get('/conversations', authenticate, getConversationsHandler);

/**
 * GET /api/v1/chat/conversations/:id
 * 获取对话详情（包含消息）
 */
chatRouter.get('/conversations/:id', authenticate, getConversationDetailHandler);

/**
 * PUT /api/v1/chat/conversations/:id
 * 更新对话信息
 */
chatRouter.put('/conversations/:id', authenticate, updateConversationHandler);

/**
 * DELETE /api/v1/chat/conversations/:id
 * 删除对话
 */
chatRouter.delete('/conversations/:id', authenticate, deleteConversationHandler);

/**
 * POST /api/v1/chat/conversations/:id/messages
 * 发送消息
 */
chatRouter.post('/conversations/:id/messages', authenticate, sendMessageHandler);

/**
 * GET /api/v1/chat/conversations/:id/messages
 * 获取消息列表
 */
chatRouter.get('/conversations/:id/messages', authenticate, getMessagesHandler);

/**
 * DELETE /api/v1/chat/conversations/:id/messages/:messageId
 * 删除消息（支持 ?mode=single|from-here）
 */
chatRouter.delete('/conversations/:id/messages/:messageId', authenticate, deleteMessageHandler);

/**
 * POST /api/v1/chat/conversations/:id/attachments
 * 上传附件
 */
chatRouter.post(
  '/conversations/:id/attachments',
  authenticate,
  upload.single('file'),
  uploadAttachmentHandler
);

/**
 * GET /api/v1/chat/attachments/:id/download
 * 下载附件
 */
chatRouter.get('/attachments/:id/download', authenticate, downloadAttachmentHandler);

/**
 * PUT /api/v1/chat/attachments/link
 * 关联附件到消息
 */
chatRouter.put('/attachments/link', authenticate, linkAttachmentsHandler);
