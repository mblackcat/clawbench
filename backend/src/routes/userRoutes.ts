import { Router } from 'express';
import { registerUser, login, logout, getCurrentUser } from '../controllers/userController';
import { getUserApplicationsHandler } from '../controllers/applicationController';
import { authenticate } from '../middleware/auth';

/**
 * 用户相关路由
 */
export const userRouter = Router();

/**
 * POST /api/v1/users/register
 * 用户注册
 */
userRouter.post('/register', registerUser);

/**
 * POST /api/v1/users/login
 * 用户登录
 */
userRouter.post('/login', login);

/**
 * POST /api/v1/users/logout
 * 用户注销（需要认证）
 */
userRouter.post('/logout', authenticate, logout);

/**
 * GET /api/v1/users/me
 * 获取当前用户信息（需要认证）
 */
userRouter.get('/me', authenticate, getCurrentUser);

/**
 * GET /api/v1/users/me/applications
 * 获取当前用户的应用列表（需要认证）
 */
userRouter.get('/me/applications', authenticate, getUserApplicationsHandler);
