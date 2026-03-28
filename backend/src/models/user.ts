/**
 * 用户数据模型
 */

/**
 * 用户接口
 */
export interface User {
  userId: string;
  username: string;
  email?: string;
  passwordHash: string;
  feishuOpenId?: string;
  avatarUrl?: string;
  authProvider?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 创建用户输入
 */
export interface CreateUserInput {
  username: string;
  email?: string;
  password: string;
}

/**
 * 创建飞书用户输入
 */
export interface CreateFeishuUserInput {
  username: string;
  feishuOpenId: string;
  email?: string;
  avatarUrl?: string;
  authProvider?: string;
}

/**
 * 用户响应（不包含密码哈希）
 */
export interface UserResponse {
  userId: string;
  username: string;
  email?: string;
  feishuOpenId?: string;
  avatarUrl?: string;
  authProvider?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 数据库用户行（与数据库表结构对应）
 */
export interface UserRow {
  user_id: string;
  username: string;
  email?: string;
  password_hash: string;
  feishu_open_id?: string;
  avatar_url?: string;
  auth_provider?: string;
  created_at: number;
  updated_at: number;
}

/**
 * 将数据库行转换为用户对象
 */
export function userRowToUser(row: UserRow): User {
  return {
    userId: row.user_id,
    username: row.username,
    email: row.email || undefined,
    passwordHash: row.password_hash,
    feishuOpenId: row.feishu_open_id || undefined,
    avatarUrl: row.avatar_url || undefined,
    authProvider: row.auth_provider || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 将用户对象转换为响应对象（移除密码哈希）
 */
export function userToResponse(user: User): UserResponse {
  return {
    userId: user.userId,
    username: user.username,
    email: user.email,
    feishuOpenId: user.feishuOpenId,
    avatarUrl: user.avatarUrl,
    authProvider: user.authProvider,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
