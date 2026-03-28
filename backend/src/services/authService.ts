import { getUserByUsername } from '../repositories/userRepository';
import { createAuthToken, invalidateToken } from '../repositories/authTokenRepository';
import { verifyPassword } from '../utils/password';
import { generateToken, calculateExpiresAt } from '../utils/jwt';
import { LoginResponse } from '../models/authToken';
import { logger } from '../utils/logger';

/**
 * 认证服务
 */

/**
 * 用户登录
 * @param username 用户名
 * @param password 密码
 * @returns 登录响应或 null（如果凭证无效）
 */
export async function loginUser(
  username: string,
  password: string
): Promise<LoginResponse | null> {
  try {
    // 查找用户
    const user = await getUserByUsername(username);

    if (!user) {
      logger.warn(`Login attempt with non-existent username: ${username}`);
      return null;
    }

    // 验证密码
    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    
    if (!isPasswordValid) {
      logger.warn(`Failed login attempt for user: ${user.userId}`);
      return null;
    }

    // 生成 JWT 令牌
    const expiresAt = calculateExpiresAt();
    const tokenId = require('uuid').v4();
    
    const token = generateToken({
      userId: user.userId,
      tokenId,
    });

    // 存储令牌到数据库
    await createAuthToken(user.userId, token, expiresAt);

    logger.info(`User logged in successfully: ${user.userId}`);

    return {
      token,
      userId: user.userId,
      expiresAt,
    };
  } catch (error) {
    logger.error('Login error:', error);
    throw error;
  }
}

/**
 * 用户注销
 * @param token JWT 令牌字符串
 * @returns 是否成功
 */
export async function logoutUser(token: string): Promise<boolean> {
  try {
    const success = await invalidateToken(token);
    
    if (success) {
      logger.info('User logged out successfully');
    }
    
    return success;
  } catch (error) {
    logger.error('Logout error:', error);
    throw error;
  }
}
