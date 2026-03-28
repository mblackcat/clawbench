/**
 * 认证令牌数据模型
 */

/**
 * 认证令牌接口
 */
export interface AuthToken {
  tokenId: string;
  userId: string;
  token: string;
  expiresAt: number;
  createdAt: number;
  invalidated: boolean;
}

/**
 * JWT 载荷
 */
export interface JWTPayload {
  userId: string;
  tokenId: string;
}

/**
 * 登录响应
 */
export interface LoginResponse {
  token: string;
  userId: string;
  expiresAt: number;
}

/**
 * 数据库令牌行（与数据库表结构对应）
 */
export interface AuthTokenRow {
  token_id: string;
  user_id: string;
  token: string;
  expires_at: number;
  created_at: number;
  invalidated: number;
}

/**
 * 将数据库行转换为令牌对象
 */
export function authTokenRowToAuthToken(row: AuthTokenRow): AuthToken {
  return {
    tokenId: row.token_id,
    userId: row.user_id,
    token: row.token,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    invalidated: row.invalidated === 1,
  };
}
