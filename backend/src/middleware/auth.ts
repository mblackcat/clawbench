import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { isTokenValid } from '../repositories/authTokenRepository';
import { logger } from '../utils/logger';

/**
 * 认证中间件
 */

/**
 * 扩展 Express Request 接口以包含用户信息
 */
export interface AuthRequest extends Request {
  userId?: string;
  tokenId?: string;
}

/**
 * 从请求头中提取 Bearer 令牌
 * @param authHeader Authorization 头
 * @returns 令牌字符串或 null
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * 认证中间件 - 验证 JWT 令牌
 * 如果令牌有效，将 userId 和 tokenId 添加到请求对象
 * 如果令牌无效，返回 401 错误
 */
export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 提取令牌
    const token = extractBearerToken(req.headers.authorization);
    
    if (!token) {
      res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Authentication required',
        },
      });
      return;
    }

    // 验证 JWT 签名和过期时间
    const payload = verifyToken(token);
    
    if (!payload) {
      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid token',
        },
      });
      return;
    }

    // 检查令牌是否在数据库中且未失效
    const isValid = await isTokenValid(token);
    
    if (!isValid) {
      res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Token expired or invalidated',
        },
      });
      return;
    }

    // 将用户信息添加到请求对象
    req.userId = payload.userId;
    req.tokenId = payload.tokenId;

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  }
}

/**
 * 可选认证中间件 - 如果提供了令牌则验证，但不强制要求
 * 如果令牌有效，将 userId 和 tokenId 添加到请求对象
 * 如果没有令牌或令牌无效，继续处理但不设置用户信息
 */
export async function optionalAuthenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    
    if (!token) {
      next();
      return;
    }

    const payload = verifyToken(token);
    
    if (!payload) {
      next();
      return;
    }

    const isValid = await isTokenValid(token);
    
    if (isValid) {
      req.userId = payload.userId;
      req.tokenId = payload.tokenId;
    }

    next();
  } catch (error) {
    logger.error('Optional authentication error:', error);
    next();
  }
}
