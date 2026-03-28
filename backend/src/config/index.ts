import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config();

export const config = {
  // 服务器配置
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // 数据库配置
  database: {
    type: process.env.DB_TYPE || 'sqlite',
    // SQLite
    path: process.env.DB_PATH || path.join(__dirname, '../../data/marketplace.db'),
    // MySQL / PostgreSQL
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '0', 10) || undefined,
    name: process.env.DB_NAME || 'clawbench',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  },

  // JWT 配置
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  // 文件存储配置
  storage: {
    type: process.env.STORAGE_TYPE || 'local',
    path: process.env.STORAGE_PATH || path.join(__dirname, '../../uploads'),
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || path.join(__dirname, '../../logs'),
  },

  // AI 配置
  ai: {
    builtinModels: (() => {
      try {
        return JSON.parse(process.env.AI_BUILTIN_MODELS || '[]');
      } catch {
        return [];
      }
    })(),
  },

  // 飞书 OAuth 配置
  feishu: {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    redirectUri: process.env.FEISHU_REDIRECT_URI || 'http://localhost:3001/api/v1/auth/feishu/callback',
  },
};
