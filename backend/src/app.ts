import express, { Application } from 'express';
import cors from 'cors';
import path from 'path';
import rateLimit from 'express-rate-limit';
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
import { adminRouter } from './routes/adminRoutes';
import { projectRouter } from './routes/projectRoutes';
import { commonAppRouter } from './routes/commonAppRoutes';
import { feishuEventRouter } from './routes/feishuEventRoutes';

/**
 * 创建 Express 应用
 */
export function createApp(): Application {
  const app = express();

  // 基础中间件
  // CORS：设置了 CORS_ORIGIN 时启用白名单。生产环境缺失会在 config 加载时
  // 直接报错（fail-secure），因此走到 else 开放分支的只可能是开发环境。
  // 非生产环境下额外放行 localhost / 127.0.0.1 任意端口（Vite / electron-vite dev）。
  if (config.cors.origins) {
    const allowlist = new Set(config.cors.origins);
    const isDevLocalOrigin = (origin: string): boolean =>
      config.nodeEnv !== 'production' &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

    app.use(
      cors({
        origin(origin, callback) {
          // Non-browser / same-origin / Electron file:// may omit Origin
          if (!origin || allowlist.has(origin) || isDevLocalOrigin(origin)) {
            callback(null, true);
            return;
          }
          callback(new Error(`CORS blocked for origin: ${origin}`));
        },
        credentials: true,
      })
    );
  } else {
    logger.warn('CORS_ORIGIN is not set — all origins are allowed (development only).');
    app.use(cors());
  }
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 请求日志
  app.use(requestLogger);

  // 登录/注册限流，防暴力破解（测试环境跳过，避免用例间相互限流）
  if (config.nodeEnv !== 'test') {
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts, please try again later' },
      },
    });
    app.use('/api/v1/users/login', authLimiter);
    app.use('/api/v1/users/register', authLimiter);
  }

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

  // Admin routes (require auth + admin role)
  app.use('/api/v1/admin', adminRouter);

  // Projects (multi-tenant) + common apps (builtin registry, kill-switch/pin)
  app.use('/api/v1/projects', projectRouter);
  app.use('/api/v1/common-apps', commonAppRouter);

  // Feishu drive events (callback + SSE for CoPiper sync)
  app.use('/api/v1/feishu', feishuEventRouter);

  // 默认路由重定向到管理面板
  app.get('/', (req, res) => res.redirect('/admin/dashboard'));

  // === Static file serving for admin/store web panel ===
  const adminPublicDir = path.join(__dirname, '..', 'admin-panel', 'dist');

  // Serve built assets (JS, CSS, images, etc.) with appropriate caching
  app.use('/admin', express.static(adminPublicDir, {
    setHeaders: (res, filePath) => {
      // HTML files should not be cached (they reference hashed bundles)
      if (filePath.endsWith('.html')) {
        res.set('Cache-Control', 'no-cache');
      } else if (filePath.match(/\.(js|css|svg|png|ico|woff2?)$/)) {
        // Hashed assets can be cached for 1 year
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.use('/store', express.static(adminPublicDir));

  // SPA fallback: serve index.html for all /admin/* and /store/* routes
  const serveAdminIndex = (req: express.Request, res: express.Response) => {
    res.set('Cache-Control', 'no-cache');
    const indexPath = path.join(adminPublicDir, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(200).json({
          success: true,
          message: 'Admin panel not built yet. Run: cd admin-panel && npm run build',
        });
      }
    });
  };

  app.get('/admin', serveAdminIndex);
  app.get('/admin/*', serveAdminIndex);
  app.get('/store', serveAdminIndex);
  app.get('/store/*', serveAdminIndex);

  // 404 处理
  app.use(notFoundHandler);

  // 错误处理
  app.use(errorHandler);

  return app;
}
