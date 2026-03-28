import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import {
  Conversation,
  ConversationRow,
  conversationRowToConversation,
  CreateConversationInput,
} from '../models/conversation';

/**
 * 对话数据访问层
 */

/**
 * 创建新对话
 * @param userId 用户ID
 * @param input 对话创建输入
 * @returns 创建的对话
 */
export async function createConversation(
  userId: string,
  input: CreateConversationInput
): Promise<Conversation> {
  const conversationId = uuidv4();
  const now = Date.now();

  await database.run(
    `INSERT INTO conversations (
      conversation_id, user_id, title, favorited, model_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      conversationId,
      userId,
      input.title || '新对话',
      0,
      input.modelId || null,
      now,
      now,
    ]
  );

  return {
    conversationId,
    userId,
    title: input.title || '新对话',
    favorited: false,
    modelId: input.modelId || null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 根据ID查询对话
 * @param conversationId 对话ID
 * @returns 对话对象或undefined
 */
export async function getConversationById(
  conversationId: string
): Promise<Conversation | undefined> {
  const row = await database.get<ConversationRow>(
    'SELECT * FROM conversations WHERE conversation_id = ?',
    [conversationId]
  );

  return row ? conversationRowToConversation(row) : undefined;
}

/**
 * 查询用户的对话列表
 * @param userId 用户ID
 * @param options 查询选项
 * @returns 对话列表
 */
export async function getConversationsByUser(
  userId: string,
  options?: {
    favorited?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<Conversation[]> {
  let sql = 'SELECT * FROM conversations WHERE user_id = ?';
  const params: any[] = [userId];

  if (options?.favorited !== undefined) {
    sql += ' AND favorited = ?';
    params.push(options.favorited ? 1 : 0);
  }

  sql += ' ORDER BY updated_at DESC';

  if (options?.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  if (options?.offset) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }

  const rows = await database.all<ConversationRow>(sql, params);
  return rows.map(conversationRowToConversation);
}

/**
 * 统计用户的对话数量
 * @param userId 用户ID
 * @param options 查询选项
 * @returns 对话总数
 */
export async function countConversationsByUser(
  userId: string,
  options?: {
    favorited?: boolean;
  }
): Promise<number> {
  let sql = 'SELECT COUNT(*) as count FROM conversations WHERE user_id = ?';
  const params: any[] = [userId];

  if (options?.favorited !== undefined) {
    sql += ' AND favorited = ?';
    params.push(options.favorited ? 1 : 0);
  }

  const result = await database.get<{ count: number }>(sql, params);
  return result?.count || 0;
}

/**
 * 更新对话
 * @param conversationId 对话ID
 * @param data 更新数据
 * @returns 更新后的对话或undefined
 */
export async function updateConversation(
  conversationId: string,
  data: { title?: string; favorited?: boolean }
): Promise<Conversation | undefined> {
  const conv = await getConversationById(conversationId);
  if (!conv) return undefined;

  const now = Date.now();
  const title = data.title !== undefined ? data.title : conv.title;
  const favorited = data.favorited !== undefined ? data.favorited : conv.favorited;

  await database.run(
    `UPDATE conversations
     SET title = ?, favorited = ?, updated_at = ?
     WHERE conversation_id = ?`,
    [title, favorited ? 1 : 0, now, conversationId]
  );

  return getConversationById(conversationId);
}

/**
 * 删除对话
 * @param conversationId 对话ID
 * @returns 是否删除成功
 */
export async function deleteConversation(conversationId: string): Promise<boolean> {
  const result = await database.run(
    'DELETE FROM conversations WHERE conversation_id = ?',
    [conversationId]
  );

  return result.changes > 0;
}

/**
 * 检查用户是否是对话所有者
 * @param conversationId 对话ID
 * @param userId 用户ID
 * @returns 是否是所有者
 */
export async function isConversationOwner(
  conversationId: string,
  userId: string
): Promise<boolean> {
  const conv = await getConversationById(conversationId);
  return conv?.userId === userId;
}
