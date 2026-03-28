import express, { Application } from 'express';
import cors from 'cors';
import { config } from './config/index';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { userRouter } from './routes/userRoutes';
import { applicationRouter } from './routes/applicationRoutes';
import { chatRouter } from './routes/chatRoutes';
import { aiRouter } from './routes/aiRoutes';
import { authRouter } from './routes/authRoutes';
import { releaseRouter } from './routes/releaseRoutes';
import { agentMemoryRouter } from './routes/agentMemoryRoutes';

/**
 * 创建 Express 应用
 */
export function createApp(): Application {
  const app = express();

  // 基础中间件
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 请求日志
  app.use(requestLogger);

  // 健康检查端点
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API 路由
  app.get('/api/v1', (req, res) => {
    res.json({
      message: 'App Marketplace API v1',
      version: '1.0.0',
      endpoints: {
        users: '/api/v1/users',
        applications: '/api/v1/applications',
        chat: '/api/v1/chat',
        ai: '/api/v1/ai',
        auth: '/api/v1/auth',
      },
    });
  });

  // 认证路由（飞书 OAuth）
  app.use('/api/v1/auth', authRouter);

  // 用户路由
  app.use('/api/v1/users', userRouter);

  // 应用路由
  app.use('/api/v1/applications', applicationRouter);

  // 聊天路由
  app.use('/api/v1/chat', chatRouter);

  // AI 路由
  app.use('/api/v1/ai', aiRouter);

  // 发布版本路由
  app.use('/api/v1/releases', releaseRouter);

  // Agent memory 路由
  app.use('/api/v1/agent', agentMemoryRouter);

  // 404 处理
  app.use(notFoundHandler);

  // 错误处理
  app.use(errorHandler);

  return app;
}
