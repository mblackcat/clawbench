import { Router } from 'express';
import { feishuAuthorize, feishuCallback, feishuRefreshToken } from '../controllers/authController';

/**
 * 认证相关路由（飞书 OAuth 等）
 */
export const authRouter = Router();

/**
 * GET /api/v1/auth/feishu
 * 飞书 OAuth 授权入口，302 重定向到飞书授权页面
 */
authRouter.get('/feishu', feishuAuthorize);

/**
 * GET /api/v1/auth/feishu/callback
 * 飞书 OAuth 回调，处理授权码并通过 custom protocol 返回 JWT
 */
authRouter.get('/feishu/callback', feishuCallback);

/**
 * POST /api/v1/auth/feishu/refresh-token
 * 刷新飞书 User Access Token（使用 refresh_token）
 */
authRouter.post('/feishu/refresh-token', feishuRefreshToken);
