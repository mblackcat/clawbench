/**
 * 聊天对话数据模型
 */

/**
 * 对话接口
 */
export interface Conversation {
  conversationId: string;
  userId: string;
  title: string;
  favorited: boolean;
  modelId: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * 消息接口
 */
export interface Message {
  messageId: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelId: string | null;
  metadata?: Record<string, any> | null;
  createdAt: number;
}

/**
 * 聊天附件接口
 */
export interface ChatAttachment {
  attachmentId: string;
  messageId: string | null;
  conversationId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  createdAt: number;
}

/**
 * 数据库对话行
 */
export interface ConversationRow {
  conversation_id: string;
  user_id: string;
  title: string;
  favorited: number;
  model_id: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * 数据库消息行
 */
export interface MessageRow {
  message_id: string;
  conversation_id: string;
  role: string;
  content: string;
  model_id: string | null;
  metadata: string | null;
  created_at: number;
}

/**
 * 数据库聊天附件行
 */
export interface ChatAttachmentRow {
  attachment_id: string;
  message_id: string;
  conversation_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  created_at: number;
}

/**
 * 创建对话输入
 */
export interface CreateConversationInput {
  title?: string;
  modelId?: string;
}

/**
 * 创建消息输入
 */
export interface CreateMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelId?: string;
  metadata?: Record<string, any> | null;
}

/**
 * 创建附件输入
 */
export interface CreateAttachmentInput {
  messageId?: string | null;
  conversationId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
}

/**
 * 对话响应
 */
export interface ConversationResponse {
  conversationId: string;
  title: string;
  favorited: boolean;
  modelId: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * 消息响应
 */
export interface MessageResponse {
  messageId: string;
  conversationId: string;
  role: string;
  content: string;
  modelId: string | null;
  metadata?: Record<string, any> | null;
  attachments?: ChatAttachmentResponse[];
  createdAt: number;
}

/**
 * 聊天附件响应
 */
export interface ChatAttachmentResponse {
  attachmentId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

/**
 * 将数据库行转换为对话对象
 */
export function conversationRowToConversation(row: ConversationRow): Conversation {
  return {
    conversationId: row.conversation_id,
    userId: row.user_id,
    title: row.title,
    favorited: row.favorited === 1,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 将对话对象转换为响应对象
 */
export function conversationToResponse(conv: Conversation): ConversationResponse {
  return {
    conversationId: conv.conversationId,
    title: conv.title,
    favorited: conv.favorited,
    modelId: conv.modelId,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  };
}

/**
 * 将数据库行转换为消息对象
 */
export function messageRowToMessage(row: MessageRow): Message {
  let metadata: Record<string, any> | null = null;
  if (row.metadata) {
    try { metadata = JSON.parse(row.metadata); } catch { /* ignore */ }
  }
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    role: row.role as 'user' | 'assistant' | 'system',
    content: row.content,
    modelId: row.model_id,
    metadata,
    createdAt: row.created_at,
  };
}

/**
 * 将消息对象转换为响应对象
 */
export function messageToResponse(msg: Message, attachments?: ChatAttachment[]): MessageResponse {
  const response: MessageResponse = {
    messageId: msg.messageId,
    conversationId: msg.conversationId,
    role: msg.role,
    content: msg.content,
    modelId: msg.modelId,
    createdAt: msg.createdAt,
  };

  if (msg.metadata) {
    response.metadata = msg.metadata;
  }

  if (attachments && attachments.length > 0) {
    response.attachments = attachments.map(attachmentToResponse);
  }

  return response;
}

/**
 * 将数据库行转换为附件对象
 */
export function attachmentRowToAttachment(row: ChatAttachmentRow): ChatAttachment {
  return {
    attachmentId: row.attachment_id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    fileName: row.file_name,
    filePath: row.file_path,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    createdAt: row.created_at,
  };
}

/**
 * 将附件对象转换为响应对象
 */
export function attachmentToResponse(att: ChatAttachment): ChatAttachmentResponse {
  return {
    attachmentId: att.attachmentId,
    fileName: att.fileName,
    fileSize: att.fileSize,
    mimeType: att.mimeType,
  };
}
