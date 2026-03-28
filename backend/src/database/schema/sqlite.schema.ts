import { DatabaseAdapter } from '../adapters/types';
import { logger } from '../../utils/logger';

/**
 * SQLite schema initializer — extracted from the original schema.ts.
 */
export async function initializeSqliteSchema(database: DatabaseAdapter): Promise<void> {
  logger.info('Initializing SQLite schema...');

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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // 飞书用户迁移：为已有表添加新列（先检查列是否存在）
  const columns = await database.all<{ name: string }>(`PRAGMA table_info(users)`);
  const columnNames = columns.map((c) => c.name);
  if (!columnNames.includes('feishu_open_id')) {
    await database.run(`ALTER TABLE users ADD COLUMN feishu_open_id TEXT`);
  }
  if (!columnNames.includes('avatar_url')) {
    await database.run(`ALTER TABLE users ADD COLUMN avatar_url TEXT`);
  }
  if (!columnNames.includes('auth_provider')) {
    await database.run(`ALTER TABLE users ADD COLUMN auth_provider TEXT`);
  }

  // 应用表
  await database.run(`
    CREATE TABLE IF NOT EXISTS applications (
      application_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      owner_id TEXT NOT NULL,
      category TEXT,
      published INTEGER DEFAULT 0,
      download_count INTEGER DEFAULT 0,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(user_id)
    )
  `);

  // 应用版本表
  await database.run(`
    CREATE TABLE IF NOT EXISTS application_versions (
      version_id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      version TEXT NOT NULL,
      changelog TEXT,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      published_at INTEGER NOT NULL,
      FOREIGN KEY (application_id) REFERENCES applications(application_id),
      UNIQUE(application_id, version)
    )
  `);

  // 认证令牌表
  await database.run(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      invalidated INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  // 对话表
  await database.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      conversation_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT DEFAULT '新对话',
      favorited INTEGER DEFAULT 0,
      model_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  // 消息表
  await database.run(`
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
    )
  `);

  // 消息表迁移：添加 metadata 列
  const msgColumns = await database.all<{ name: string }>(`PRAGMA table_info(messages)`);
  const msgColumnNames = msgColumns.map((c) => c.name);
  if (!msgColumnNames.includes('metadata')) {
    await database.run(`ALTER TABLE messages ADD COLUMN metadata TEXT`);
  }

  // 聊天附件表
  await database.run(`
    CREATE TABLE IF NOT EXISTS chat_attachments (
      attachment_id TEXT PRIMARY KEY,
      message_id TEXT,
      conversation_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
    )
  `);

  // OAuth state 表（用于跨 cluster worker 共享飞书 OAuth state）
  await database.run(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    )
  `);

  // Agent memory table
  await database.run(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      UNIQUE(user_id, filename)
    )
  `);

  // 应用表迁移：添加 type 列
  const appColumns = await database.all<{ name: string }>(`PRAGMA table_info(applications)`);
  const appColumnNames = appColumns.map((c) => c.name);
  if (!appColumnNames.includes('type')) {
    await database.run(`ALTER TABLE applications ADD COLUMN type TEXT DEFAULT 'app'`);
  }

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
  await database.run(`CREATE INDEX IF NOT EXISTS idx_agent_memories_user ON agent_memories(user_id)`);

  logger.info('SQLite schema initialized successfully');
}
