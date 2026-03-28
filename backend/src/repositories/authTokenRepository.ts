import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import { AuthToken, AuthTokenRow, authTokenRowToAuthToken } from '../models/authToken';

/**
 * 认证令牌数据访问层
 */

/**
 * 创建新的认证令牌
 * @param userId 用户ID
 * @param token JWT 令牌字符串
 * @param expiresAt 过期时间戳
 * @returns 创建的令牌对象
 */
export async function createAuthToken(
  userId: string,
  token: string,
  expiresAt: number
): Promise<AuthToken> {
  const tokenId = uuidv4();
  const now = Date.now();

  await database.run(
    `INSERT INTO auth_tokens (token_id, user_id, token, expires_at, created_at, invalidated)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tokenId, userId, token, expiresAt, now, 0]
  );

  return {
    tokenId,
    userId,
    token,
    expiresAt,
    createdAt: now,
    invalidated: false,
  };
}

/**
 * 根据令牌字符串查询令牌
 * @param token JWT 令牌字符串
 * @returns 令牌对象或 undefined
 */
export async function getAuthTokenByToken(token: string): Promise<AuthToken | undefined> {
  const row = await database.get<AuthTokenRow>(
    'SELECT * FROM auth_tokens WHERE token = ?',
    [token]
  );

  return row ? authTokenRowToAuthToken(row) : undefined;
}

/**
 * 根据令牌ID查询令牌
 * @param tokenId 令牌ID
 * @returns 令牌对象或 undefined
 */
export async function getAuthTokenById(tokenId: string): Promise<AuthToken | undefined> {
  const row = await database.get<AuthTokenRow>(
    'SELECT * FROM auth_tokens WHERE token_id = ?',
    [tokenId]
  );

  return row ? authTokenRowToAuthToken(row) : undefined;
}

/**
 * 使令牌失效
 * @param token JWT 令牌字符串
 * @returns 是否成功
 */
export async function invalidateToken(token: string): Promise<boolean> {
  const result = await database.run(
    'UPDATE auth_tokens SET invalidated = 1 WHERE token = ?',
    [token]
  );

  return result.changes > 0;
}

/**
 * 使用户的所有令牌失效
 * @param userId 用户ID
 * @returns 失效的令牌数量
 */
export async function invalidateUserTokens(userId: string): Promise<number> {
  const result = await database.run(
    'UPDATE auth_tokens SET invalidated = 1 WHERE user_id = ?',
    [userId]
  );

  return result.changes;
}

/**
 * 检查令牌是否有效
 * @param token JWT 令牌字符串
 * @returns 是否有效
 */
export async function isTokenValid(token: string): Promise<boolean> {
  const authToken = await getAuthTokenByToken(token);
  
  if (!authToken) {
    return false;
  }

  // 检查是否已失效
  if (authToken.invalidated) {
    return false;
  }

  // 检查是否过期
  if (authToken.expiresAt < Date.now()) {
    return false;
  }

  return true;
}

/**
 * 清理过期的令牌
 * @returns 清理的令牌数量
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const now = Date.now();
  const result = await database.run(
    'DELETE FROM auth_tokens WHERE expires_at < ?',
    [now]
  );

  return result.changes;
}
