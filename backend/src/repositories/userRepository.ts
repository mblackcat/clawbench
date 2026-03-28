import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import { User, UserRow, userRowToUser, CreateUserInput, CreateFeishuUserInput } from '../models/user';
import { hashPassword } from '../utils/password';

/**
 * 用户数据访问层
 */

/**
 * 创建新用户
 * @param input 用户创建输入
 * @returns 创建的用户
 */
export async function createUser(input: CreateUserInput): Promise<User> {
  const userId = uuidv4();
  const passwordHash = await hashPassword(input.password);
  const now = Date.now();

  await database.run(
    `INSERT INTO users (user_id, username, email, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, input.username, input.email || null, passwordHash, now, now]
  );

  return {
    userId,
    username: input.username,
    email: input.email || undefined,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 创建飞书用户（无密码）
 * @param input 飞书用户创建输入
 * @returns 创建的用户
 */
export async function createFeishuUser(input: CreateFeishuUserInput): Promise<User> {
  const userId = uuidv4();
  const now = Date.now();
  // 飞书用户使用空字符串作为 password_hash，bcrypt 不会匹配空字符串
  const passwordHash = '';

  await database.run(
    `INSERT INTO users (user_id, username, email, password_hash, feishu_open_id, avatar_url, auth_provider, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, input.username, input.email || null, passwordHash, input.feishuOpenId, input.avatarUrl || null, input.authProvider || null, now, now]
  );

  return {
    userId,
    username: input.username,
    email: input.email || undefined,
    passwordHash,
    feishuOpenId: input.feishuOpenId,
    avatarUrl: input.avatarUrl || undefined,
    authProvider: input.authProvider || undefined,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 根据用户ID查询用户
 * @param userId 用户ID
 * @returns 用户对象或undefined
 */
export async function getUserById(userId: string): Promise<User | undefined> {
  const row = await database.get<UserRow>(
    'SELECT * FROM users WHERE user_id = ?',
    [userId]
  );

  return row ? userRowToUser(row) : undefined;
}

/**
 * 根据飞书 Open ID 查询用户
 * @param feishuOpenId 飞书 Open ID
 * @returns 用户对象或undefined
 */
export async function getUserByFeishuOpenId(feishuOpenId: string): Promise<User | undefined> {
  const row = await database.get<UserRow>(
    'SELECT * FROM users WHERE feishu_open_id = ?',
    [feishuOpenId]
  );

  return row ? userRowToUser(row) : undefined;
}

/**
 * 根据邮箱查询用户
 * @param email 邮箱
 * @returns 用户对象或undefined
 */
export async function getUserByEmail(email: string): Promise<User | undefined> {
  const row = await database.get<UserRow>(
    'SELECT * FROM users WHERE email = ?',
    [email]
  );

  return row ? userRowToUser(row) : undefined;
}

/**
 * 根据用户名查询用户
 * @param username 用户名
 * @returns 用户对象或undefined
 */
export async function getUserByUsername(username: string): Promise<User | undefined> {
  const row = await database.get<UserRow>(
    'SELECT * FROM users WHERE username = ?',
    [username]
  );

  return row ? userRowToUser(row) : undefined;
}

/**
 * 检查邮箱是否已存在
 * @param email 邮箱
 * @returns 是否存在
 */
export async function emailExists(email: string): Promise<boolean> {
  if (!email) return false;
  const user = await getUserByEmail(email);
  return user !== undefined;
}

/**
 * 检查用户名是否已存在
 * @param username 用户名
 * @returns 是否存在
 */
export async function usernameExists(username: string): Promise<boolean> {
  const user = await getUserByUsername(username);
  return user !== undefined;
}

/**
 * 更新用户信息
 * @param userId 用户ID
 * @param updates 要更新的字段
 * @returns 更新后的用户
 */
export async function updateUser(
  userId: string,
  updates: Partial<Pick<User, 'username' | 'email'>>
): Promise<User | undefined> {
  const user = await getUserById(userId);
  if (!user) return undefined;

  const now = Date.now();
  const username = updates.username ?? user.username;
  const email = updates.email ?? user.email;

  await database.run(
    'UPDATE users SET username = ?, email = ?, updated_at = ? WHERE user_id = ?',
    [username, email, now, userId]
  );

  return getUserById(userId);
}

/**
 * 更新用户头像
 * @param userId 用户ID
 * @param avatarUrl 头像 URL
 */
export async function updateUserAvatar(userId: string, avatarUrl: string): Promise<void> {
  const now = Date.now();
  await database.run(
    'UPDATE users SET avatar_url = ?, updated_at = ? WHERE user_id = ?',
    [avatarUrl, now, userId]
  );
}

/**
 * 删除用户
 * @param userId 用户ID
 * @returns 是否删除成功
 */
export async function deleteUser(userId: string): Promise<boolean> {
  const result = await database.run(
    'DELETE FROM users WHERE user_id = ?',
    [userId]
  );

  return result.changes > 0;
}
