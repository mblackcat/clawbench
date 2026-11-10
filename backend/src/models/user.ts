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
  role: 'admin' | 'user';
  /** 最近一次登录 / 会话同步时服务端观察到的客户端 IP（受 TRUST_PROXY 约束，仅 admin 可见） */
  lastLoginIp?: string;
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
  role: 'admin' | 'user';
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
  role: string;
  last_login_ip?: string | null;
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
    role: (row.role as 'admin' | 'user') || 'user',
    lastLoginIp: row.last_login_ip || undefined,
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
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Admin 用户列表响应：在公开响应之外附带最近登录 IP。
 * IP 属于个人信息，只能经 admin 接口（/api/v1/admin/users）下发，勿在其它响应中使用。
 */
export interface AdminUserResponse extends UserResponse {
  lastLoginIp?: string;
}

export function userToAdminResponse(user: User): AdminUserResponse {
  return { ...userToResponse(user), lastLoginIp: user.lastLoginIp };
}
