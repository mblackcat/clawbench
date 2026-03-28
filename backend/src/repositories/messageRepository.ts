import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import {
  Message,
  MessageRow,
  messageRowToMessage,
  CreateMessageInput,
} from '../models/conversation';

/**
 * 消息数据访问层
 */

/**
 * 创建新消息
 * @param conversationId 对话ID
 * @param input 消息创建输入
 * @returns 创建的消息
 */
export async function createMessage(
  conversationId: string,
  input: CreateMessageInput
): Promise<Message> {
  const messageId = uuidv4();
  const now = Date.now();
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

  await database.run(
    `INSERT INTO messages (
      message_id, conversation_id, role, content, model_id, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      messageId,
      conversationId,
      input.role,
      input.content,
      input.modelId || null,
      metadataJson,
      now,
    ]
  );

  return {
    messageId,
    conversationId,
    role: input.role,
    content: input.content,
    modelId: input.modelId || null,
    metadata: input.metadata || null,
    createdAt: now,
  };
}

/**
 * 查询对话的消息列表
 * @param conversationId 对话ID
 * @param options 查询选项
 * @returns 消息列表
 */
export async function getMessagesByConversation(
  conversationId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<Message[]> {
  let sql = 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC';
  const params: any[] = [conversationId];

  if (options?.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  if (options?.offset) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }

  const rows = await database.all<MessageRow>(sql, params);
  return rows.map(messageRowToMessage);
}

/**
 * 根据ID查询消息
 * @param messageId 消息ID
 * @returns 消息对象或undefined
 */
export async function getMessageById(messageId: string): Promise<Message | undefined> {
  const row = await database.get<MessageRow>(
    'SELECT * FROM messages WHERE message_id = ?',
    [messageId]
  );

  return row ? messageRowToMessage(row) : undefined;
}

/**
 * Delete a single message by message_id
 */
export async function deleteMessageById(messageId: string): Promise<boolean> {
  const result = await database.run(
    'DELETE FROM messages WHERE message_id = ?',
    [messageId]
  );
  return (result?.changes ?? 0) > 0;
}

/**
 * Delete a message and all messages after it in the same conversation.
 * Uses the auto-increment id for ordering to avoid same-millisecond edge cases.
 */
export async function deleteMessagesFromId(
  conversationId: string,
  messageId: string
): Promise<number> {
  const row = await database.get<{ id: number }>(
    'SELECT id FROM messages WHERE message_id = ? AND conversation_id = ?',
    [messageId, conversationId]
  );
  if (!row) return 0;

  const result = await database.run(
    'DELETE FROM messages WHERE conversation_id = ? AND id >= ?',
    [conversationId, row.id]
  );
  return result?.changes ?? 0;
}
