import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import {
  ChatAttachment,
  ChatAttachmentRow,
  attachmentRowToAttachment,
  CreateAttachmentInput,
} from '../models/conversation';

/**
 * 聊天附件数据访问层
 */

/**
 * 创建附件记录
 * @param input 附件创建输入
 * @returns 创建的附件
 */
export async function createAttachment(input: CreateAttachmentInput): Promise<ChatAttachment> {
  const attachmentId = uuidv4();
  const now = Date.now();

  await database.run(
    `INSERT INTO chat_attachments (
      attachment_id, message_id, conversation_id, file_name, file_path,
      file_size, mime_type, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attachmentId,
      input.messageId || null,
      input.conversationId,
      input.fileName,
      input.filePath,
      input.fileSize,
      input.mimeType,
      now,
    ]
  );

  return {
    attachmentId,
    messageId: input.messageId || null,
    conversationId: input.conversationId,
    fileName: input.fileName,
    filePath: input.filePath,
    fileSize: input.fileSize,
    mimeType: input.mimeType,
    createdAt: now,
  };
}

/**
 * 根据ID查询附件
 * @param attachmentId 附件ID
 * @returns 附件对象或undefined
 */
export async function getAttachmentById(
  attachmentId: string
): Promise<ChatAttachment | undefined> {
  const row = await database.get<ChatAttachmentRow>(
    'SELECT * FROM chat_attachments WHERE attachment_id = ?',
    [attachmentId]
  );

  return row ? attachmentRowToAttachment(row) : undefined;
}

/**
 * 查询消息的附件列表
 * @param messageId 消息ID
 * @returns 附件列表
 */
export async function getAttachmentsByMessage(messageId: string): Promise<ChatAttachment[]> {
  const rows = await database.all<ChatAttachmentRow>(
    'SELECT * FROM chat_attachments WHERE message_id = ?',
    [messageId]
  );

  return rows.map(attachmentRowToAttachment);
}

/**
 * 批量关联附件到消息
 * @param attachmentIds 附件ID列表
 * @param messageId 消息ID
 */
export async function linkAttachmentsToMessage(
  attachmentIds: string[],
  messageId: string
): Promise<void> {
  for (const id of attachmentIds) {
    await database.run(
      'UPDATE chat_attachments SET message_id = ? WHERE attachment_id = ?',
      [messageId, id]
    );
  }
}

/**
 * 根据ID列表查询附件
 * @param attachmentIds 附件ID列表
 * @returns 附件列表
 */
export async function getAttachmentsByIds(attachmentIds: string[]): Promise<ChatAttachment[]> {
  if (attachmentIds.length === 0) return [];
  const placeholders = attachmentIds.map(() => '?').join(',');
  const rows = await database.all<ChatAttachmentRow>(
    `SELECT * FROM chat_attachments WHERE attachment_id IN (${placeholders})`,
    attachmentIds
  );
  return rows.map(attachmentRowToAttachment);
}

/**
 * 查询对话的所有附件
 * @param conversationId 对话ID
 * @returns 附件列表
 */
export async function getAttachmentsByConversation(conversationId: string): Promise<ChatAttachment[]> {
  const rows = await database.all<ChatAttachmentRow>(
    'SELECT * FROM chat_attachments WHERE conversation_id = ?',
    [conversationId]
  );
  return rows.map(attachmentRowToAttachment);
}
