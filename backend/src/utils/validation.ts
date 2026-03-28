/**
 * 输入验证工具
 */

/**
 * 验证邮箱格式
 * @param email 邮箱地址
 * @returns 是否有效
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * 验证用户名格式
 * 规则：3-30个字符，只能包含字母、数字、下划线和连字符
 * @param username 用户名
 * @returns 是否有效
 */
export function isValidUsername(username: string): boolean {
  if (!username || username.length < 3 || username.length > 30) {
    return false;
  }
  const usernameRegex = /^[a-zA-Z0-9_-]+$/;
  return usernameRegex.test(username);
}

/**
 * 验证密码格式
 * 规则：至少8个字符
 * @param password 密码
 * @returns 是否有效
 */
export function isValidPassword(password: string): boolean {
  return Boolean(password && password.length >= 8);
}

/**
 * 验证注册输入
 * @param username 用户名
 * @param email 邮箱
 * @param password 密码
 * @returns 验证结果，包含是否有效和错误信息
 */
export function validateRegistrationInput(
  username: string,
  email: string | undefined,
  password: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!username) {
    errors.push('Username is required');
  } else if (!isValidUsername(username)) {
    errors.push('Username must be 3-30 characters and contain only letters, numbers, underscores, and hyphens');
  }

  if (email && !isValidEmail(email)) {
    errors.push('Invalid email format');
  }

  if (!password) {
    errors.push('Password is required');
  } else if (!isValidPassword(password)) {
    errors.push('Password must be at least 8 characters');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
