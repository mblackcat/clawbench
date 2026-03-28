import { DatabaseAdapter } from '../adapters/types';
import { logger } from '../../utils/logger';

/**
 * MySQL schema initializer.
 *
 * Notes:
 * - Uses VARCHAR(36) for UUID primary keys, VARCHAR(255) for short text fields.
 * - Uses TEXT for long/variable-length content (description, changelog, content).
 * - Uses BIGINT for timestamps (epoch milliseconds), matching SQLite INTEGER.
 * - Uses InnoDB engine with utf8mb4 character set.
 * - For migration columns, checks INFORMATION_SCHEMA before ALTER TABLE.
 */
export async function initializeMysqlSchema(database: DatabaseAdapter): Promise<void> {
  logger.info('Initializing MySQL schema...');

  // 用户表
  await database.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id VARCHAR(36) PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      feishu_open_id VARCHAR(255),
      avatar_url TEXT,
      auth_provider VARCHAR(50),
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 飞书用户迁移：检查列是否存在后再添加
  const dbName = await database.get<{ db: string }>('SELECT DATABASE() AS db');
  const currentDb = dbName?.db;

  if (currentDb) {
    for (const col of ['feishu_open_id', 'avatar_url', 'auth_provider']) {
      const exists = await database.get<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`,
        [currentDb, col]
      );
      if (!exists || exists.cnt === 0) {
        const colType = col === 'avatar_url' ? 'TEXT' : col === 'auth_provider' ? 'VARCHAR(50)' : 'VARCHAR(255)';
        await database.run(`ALTER TABLE users ADD COLUMN ${col} ${colType}`);
      }
    }
  }

  // 应用表
  await database.run(`
    CREATE TABLE IF NOT EXISTS applications (
      application_id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      owner_id VARCHAR(36) NOT NULL,
      category VARCHAR(100),
      published INTEGER DEFAULT 0,
      download_count INTEGER DEFAULT 0,
      metadata TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 应用版本表
  await database.run(`
    CREATE TABLE IF NOT EXISTS application_versions (
      version_id VARCHAR(36) PRIMARY KEY,
      application_id VARCHAR(36) NOT NULL,
      version VARCHAR(50) NOT NULL,
      changelog TEXT,
      file_path VARCHAR(500) NOT NULL,
      file_size BIGINT NOT NULL,
      published_at BIGINT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES applications(application_id),
      UNIQUE KEY idx_app_version (application_id, version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 认证令牌表
  await database.run(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      token VARCHAR(500) UNIQUE NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      invalidated INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 对话表
  await database.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      conversation_id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      title VARCHAR(255) DEFAULT '新对话',
      favorited INTEGER DEFAULT 0,
      model_id VARCHAR(255),
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 消息表
  await database.run(`
    CREATE TABLE IF NOT EXISTS messages (
      message_id VARCHAR(36) PRIMARY KEY,
      conversation_id VARCHAR(36) NOT NULL,
      role VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      model_id VARCHAR(255),
      created_at BIGINT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 消息表迁移：添加 metadata 列
  {
    const exists = await database.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'metadata'`
    );
    if (!exists || exists.cnt === 0) {
      await database.run(`ALTER TABLE messages ADD COLUMN metadata TEXT`);
    }
  }

  // 聊天附件表
  await database.run(`
    CREATE TABLE IF NOT EXISTS chat_attachments (
      attachment_id VARCHAR(36) PRIMARY KEY,
      message_id VARCHAR(36),
      conversation_id VARCHAR(36) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      file_size BIGINT NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      created_at BIGINT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // OAuth state 表
  await database.run(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state VARCHAR(64) PRIMARY KEY,
      created_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Agent memory table
  await database.run(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      filename VARCHAR(100) NOT NULL,
      content LONGTEXT NOT NULL DEFAULT (''),
      updated_at BIGINT DEFAULT (UNIX_TIMESTAMP() * 1000),
      UNIQUE KEY uq_agent_memories_user_file (user_id, filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 应用表迁移：添加 type 列
  if (currentDb) {
    const typeExists = await database.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'applications' AND COLUMN_NAME = 'type'`,
      [currentDb]
    );
    if (!typeExists || typeExists.cnt === 0) {
      await database.run(`ALTER TABLE applications ADD COLUMN type VARCHAR(50) DEFAULT 'app'`);
    }
  }

  // 创建索引
  const ensureIndex = async (table: string, name: string, ddl: string) => {
    const exists = await database.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [currentDb, table, name]
    );
    if (!exists || exists.cnt === 0) {
      await database.run(ddl);
    }
  };

  if (currentDb) {
    await ensureIndex('applications', 'idx_applications_owner', 'CREATE INDEX idx_applications_owner ON applications(owner_id)');
    await ensureIndex('applications', 'idx_applications_published', 'CREATE INDEX idx_applications_published ON applications(published)');
    await ensureIndex('applications', 'idx_applications_type', 'CREATE INDEX idx_applications_type ON applications(type)');
    await ensureIndex('application_versions', 'idx_versions_application', 'CREATE INDEX idx_versions_application ON application_versions(application_id)');
    await ensureIndex('auth_tokens', 'idx_tokens_user', 'CREATE INDEX idx_tokens_user ON auth_tokens(user_id)');
    await ensureIndex('auth_tokens', 'idx_tokens_token', 'CREATE INDEX idx_tokens_token ON auth_tokens(token)');
    await ensureIndex('conversations', 'idx_conversations_user', 'CREATE INDEX idx_conversations_user ON conversations(user_id)');
    await ensureIndex('conversations', 'idx_conversations_favorited', 'CREATE INDEX idx_conversations_favorited ON conversations(user_id, favorited)');
    await ensureIndex('messages', 'idx_messages_conversation', 'CREATE INDEX idx_messages_conversation ON messages(conversation_id)');
    await ensureIndex('chat_attachments', 'idx_attachments_message', 'CREATE INDEX idx_attachments_message ON chat_attachments(message_id)');
    await ensureIndex('users', 'idx_users_feishu_open_id', 'CREATE UNIQUE INDEX idx_users_feishu_open_id ON users(feishu_open_id)');
  }

  logger.info('MySQL schema initialized successfully');
}
