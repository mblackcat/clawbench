import bcrypt from 'bcryptjs';

/**
 * 密码哈希和验证工具
 */

// 盐轮数（越高越安全，但越慢）
const SALT_ROUNDS = 10;

/**
 * 对密码进行哈希处理
 * @param password 明文密码
 * @returns 哈希后的密码
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * 验证密码是否匹配
 * @param password 明文密码
 * @param hash 哈希后的密码
 * @returns 是否匹配
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // 飞书用户的 password_hash 为空字符串，不允许通过密码登录
  if (!hash) {
    return false;
  }
  return bcrypt.compare(password, hash);
}
