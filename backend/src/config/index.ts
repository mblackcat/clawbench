import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config();

// JWT 密钥守卫：生产环境必须显式配置强密钥，否则拒绝启动
const KNOWN_PLACEHOLDER_SECRETS = [
  'default-secret-change-in-production',
  'your-secret-key-change-in-production',
  'CHANGE_ME_TO_A_STRONG_RANDOM_SECRET',
];
const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || KNOWN_PLACEHOLDER_SECRETS[0];
if (
  nodeEnv === 'production' &&
  (KNOWN_PLACEHOLDER_SECRETS.includes(jwtSecret) || jwtSecret.length < 16)
) {
  throw new Error(
    'FATAL: JWT_SECRET must be set to a strong random value (>= 16 chars) in production'
  );
}

// CORS 守卫：生产环境必须显式配置 CORS_ORIGIN 白名单，否则拒绝启动。
// 缺省放行所有来源属 fail-open，生产环境不可接受。
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : null;
if (nodeEnv === 'production' && (!corsOrigins || corsOrigins.length === 0)) {
  throw new Error(
    'FATAL: CORS_ORIGIN must be set to an explicit origin allowlist in production'
  );
}

/**
 * TRUST_PROXY → Express `trust proxy` setting.
 * 未设置 / 'false' / '0' → false（默认，直连部署）；'true' → true；
 * 正整数 → 信任的代理跳数（反代后通常为 1）；其它字符串（如 'loopback'、子网列表）原样传给 Express。
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string {
  const value = (raw ?? '').trim();
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) {
    const hops = parseInt(value, 10);
    return hops === 0 ? false : hops;
  }
  return value;
}

/** 读取正整数环境变量，非法值回退默认值 */
function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  // 服务器配置
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv,

  // CORS 白名单（逗号分隔的 origin 列表；开发环境不设置时允许所有来源，
  // 生产环境必须设置，见上方守卫）
  cors: {
    origins: corsOrigins,
  },

  // 反向代理：Express `trust proxy`（默认关闭；部署在 Nginx/Caddy 后时设 TRUST_PROXY=1，
  // 否则限流会按代理 IP 计数）
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  // 限流阈值（每个客户端 IP；test 环境不启用限流）
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    /** 登录/注册：每 15 分钟 */
    authPer15Min: envInt('RATE_LIMIT_AUTH_PER_15MIN', 20),
    /** 安装包下载（不含 latest*.yml / .blockmap 元数据）：每小时 */
    releaseDownloadPerHour: envInt('RATE_LIMIT_RELEASE_DOWNLOAD_PER_HOUR', 50),
    /** 市场应用下载：每小时 */
    appDownloadPerHour: envInt('RATE_LIMIT_APP_DOWNLOAD_PER_HOUR', 100),
    /** 上传（应用包 / 通用应用归档 / 安装包）：每小时 */
    uploadPerHour: envInt('RATE_LIMIT_UPLOAD_PER_HOUR', 30),
    /** AI 流式对话 / 标题生成：每 15 分钟 */
    aiStreamPer15Min: envInt('RATE_LIMIT_AI_STREAM_PER_15MIN', 100),
    /** 创建应用（仅 POST /api/v1/applications）：每小时 */
    createAppPerHour: envInt('RATE_LIMIT_CREATE_APP_PER_HOUR', 10),
  },

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
    secret: jwtSecret,
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
