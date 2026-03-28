import jwt from 'jsonwebtoken';
import { JWTPayload } from '../models/authToken';

/**
 * JWT 工具函数
 */

// JWT 密钥（在生产环境中应该从环境变量读取）
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * 生成 JWT 令牌
 * @param payload JWT 载荷
 * @returns JWT 令牌字符串
 */
export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '7d',
  });
}

/**
 * 验证 JWT 令牌
 * @param token JWT 令牌字符串
 * @returns JWT 载荷或 null（如果令牌无效）
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * 解码 JWT 令牌（不验证签名）
 * @param token JWT 令牌字符串
 * @returns JWT 载荷或 null
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.decode(token) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * 计算令牌过期时间戳
 * @returns 过期时间戳（毫秒）
 */
export function calculateExpiresAt(): number {
  // 默认 7 天
  const expiresInMs = 7 * 24 * 60 * 60 * 1000;
  return Date.now() + expiresInMs;
}
