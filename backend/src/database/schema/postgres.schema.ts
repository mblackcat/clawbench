import { DatabaseAdapter } from '../adapters/types';
import { logger } from '../../utils/logger';

/**
 * PostgreSQL schema initializer.
 *
 * Notes:
 * - Uses TEXT for primary keys (UUIDs stored as text, matching SQLite behaviour).
 * - Uses BIGINT for timestamps (epoch milliseconds), matching SQLite INTEGER.
 * - Uses `ADD COLUMN IF NOT EXISTS` (PG 9.6+) for migration columns.
 * - Placeholder conversion (`?` → `$1`) is handled by the adapter, so DDL here
 *   uses no placeholders.
 */
export async function initializePostgresSchema(database: DatabaseAdapter): Promise<void> {
  logger.info('Initializing PostgreSQL schema...');

  // 用户表
  await database.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      feishu_open_id TEXT,
      avatar_url TEXT,
      auth_provider TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);

  // 飞书用户迁移
  await database.run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS feishu_open_id TEXT`);
  await database.run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
  await database.run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT`);

  // 应用表
  await database.run(`
    CREATE TABLE IF NOT EXISTS applications (
      application_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      owner_id TEXT NOT NULL REFERENCES users(user_id),
      category TEXT,
      published INTEGER DEFAULT 0,
      download_count INTEGER DEFAULT 0,
      metadata TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);

  // 应用版本表
  await database.run(`
    CREATE TABLE IF NOT EXISTS application_versions (
      version_id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES applications(application_id),
      version TEXT NOT NULL,
      changelog TEXT,
      file_path TEXT NOT NULL,
      file_size BIGINT NOT NULL,
      published_at BIGINT NOT NULL,
      UNIQUE(application_id, version)
    )
  `);

  // 认证令牌表
  await database.run(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id),
      token TEXT UNIQUE NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      invalidated INTEGER DEFAULT 0
    )
  `);

  // 对话表
  await database.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      conversation_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id),
      title TEXT DEFAULT '新对话',
      favorited INTEGER DEFAULT 0,
      model_id TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);

  // 消息表
  await database.run(`
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model_id TEXT,
      created_at BIGINT NOT NULL
    )
  `);

  // 消息表迁移：添加 metadata 列
  await database.run(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata TEXT`);

  // 聊天附件表
  await database.run(`
    CREATE TABLE IF NOT EXISTS chat_attachments (
      attachment_id TEXT PRIMARY KEY,
      message_id TEXT REFERENCES messages(message_id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size BIGINT NOT NULL,
      mime_type TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);

  // OAuth state 表
  await database.run(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      created_at BIGINT NOT NULL
    )
  `);

  // Agent memory table
  await database.run(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
      UNIQUE(user_id, filename)
    )
  `);

  // 应用表迁移：添加 type 列
  await database.run(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'app'`);

  // 创建索引
  await database.run(`CREATE INDEX IF NOT EXISTS idx_applications_owner ON applications(owner_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_applications_published ON applications(published)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_applications_type ON applications(type)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_versions_application ON application_versions(application_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_tokens_user ON auth_tokens(user_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_tokens_token ON auth_tokens(token)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_conversations_favorited ON conversations(user_id, favorited)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_attachments_message ON chat_attachments(message_id)`);
  await database.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_feishu_open_id ON users(feishu_open_id)`);

  logger.info('PostgreSQL schema initialized successfully');
}
