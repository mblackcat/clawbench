import { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { ErrorCode } from '../types/api';
import { validateRegistrationInput } from '../utils/validation';
import { createUser, emailExists, usernameExists, getUserById, updateUserLastLoginIp } from '../repositories/userRepository';
import { getClientIp } from '../utils/clientIp';
import { userToResponse } from '../models/user';
import { loginUser as loginUserService, logoutUser as logoutUserService } from '../services/authService';
import { AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

/**
 * 用户注册处理器
 * POST /api/v1/users/register
 */
export async function registerUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { username, email, password } = req.body;

    // 验证输入格式
    const validation = validateRegistrationInput(username, email, password);
    if (!validation.valid) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid input',
        { errors: validation.errors }
      );
    }

    // 检查用户名是否已存在
    if (await usernameExists(username)) {
      throw new AppError(
        ErrorCode.ALREADY_EXISTS,
        'Username already exists',
        { field: 'username' }
      );
    }

    // 检查邮箱是否已存在
    if (email && await emailExists(email)) {
      throw new AppError(
        ErrorCode.ALREADY_EXISTS,
        'Email already exists',
        { field: 'email' }
      );
    }

    // 创建用户
    const user = await createUser({ username, email, password });

    logger.info(`User registered: ${user.userId}`, {
      userId: user.userId,
      username: user.username,
      email: user.email,
    });

    // 返回用户信息（不包含密码哈希）
    res.status(201).json({
      success: true,
      data: userToResponse(user),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 用户登录处理器
 * POST /api/v1/users/login
 */
export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { username, password } = req.body;

    // 验证必需字段
    if (!username || !password) {
      throw new AppError(
        ErrorCode.MISSING_FIELD,
        'Username and password are required',
        {
          missingFields: [
            !username ? 'username' : null,
            !password ? 'password' : null
          ].filter(Boolean)
        }
      );
    }

    // 调用认证服务
    const loginResponse = await loginUserService(username, password);

    if (!loginResponse) {
      throw new AppError(
        ErrorCode.INVALID_CREDENTIALS,
        'Invalid credentials'
      );
    }

    // 记录服务端观察到的客户端 IP（仅 admin 用户列表可见；失败不影响登录）
    await updateUserLastLoginIp(loginResponse.userId, getClientIp(req)).catch((err) =>
      logger.warn('Failed to record login IP:', err)
    );

    logger.info(`User login successful: ${loginResponse.userId}`);

    // 返回登录响应
    res.status(200).json({
      success: true,
      data: loginResponse,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 用户注销处理器
 * POST /api/v1/users/logout
 */
export async function logout(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 从认证中间件获取令牌
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      throw new AppError(
        ErrorCode.AUTH_REQUIRED,
        'Authentication required'
      );
    }

    // 调用注销服务
    const success = await logoutUserService(token);

    logger.info(`User logout: ${req.userId}`);

    // 返回成功响应
    res.status(200).json({
      success: true,
      data: { success },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 获取当前用户信息处理器
 * GET /api/v1/users/me
 */
export async function getCurrentUser(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 从认证中间件获取用户ID
    if (!req.userId) {
      throw new AppError(
        ErrorCode.AUTH_REQUIRED,
        'Authentication required'
      );
    }

    // 获取用户信息
    const user = await getUserById(req.userId);

    if (!user) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        'User not found'
      );
    }

    logger.info(`Get current user: ${user.userId}`);

    // 返回用户信息
    res.status(200).json({
      success: true,
      data: userToResponse(user),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 会话同步：记录当前会话的客户端 IP（登录后 / 客户端启动恢复会话时调用）
 * POST /api/v1/users/report-ip
 *
 * IP 取自服务端观察到的 req.ip（受 TRUST_PROXY 约束），忽略请求体中的任何自报 IP。
 */
export async function reportUserIp(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.userId) {
      throw new AppError(ErrorCode.AUTH_REQUIRED, 'Authentication required');
    }
    await updateUserLastLoginIp(req.userId, getClientIp(req));
    res.status(200).json({ success: true, data: { recorded: true } });
  } catch (error) {
    next(error);
  }
}
