import { DatabaseAdapter } from '../adapters/types';
import { logger } from '../../utils/logger';
import { COMMON_APP_SEEDS } from './common-apps.seed';

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
  if (!columnNames.includes('role')) {
    await database.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`);
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
      featured INTEGER DEFAULT 0,
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

  // oauth_states migration: add source column (electron / web)
  const stateColumns = await database.all<{ name: string }>(`PRAGMA table_info(oauth_states)`);
  const stateColumnNames = stateColumns.map((c) => c.name);
  if (!stateColumnNames.includes('source')) {
    await database.run(`ALTER TABLE oauth_states ADD COLUMN source TEXT DEFAULT 'electron'`);
  }

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
  // 应用表迁移：添加 featured 列（推荐字段，admin 可配置）
  if (!appColumnNames.includes('featured')) {
    await database.run(`ALTER TABLE applications ADD COLUMN featured INTEGER DEFAULT 0`);
  }
  // 应用表迁移：添加 execution_count 列（登录用户上报的执行次数）
  if (!appColumnNames.includes('execution_count')) {
    await database.run(`ALTER TABLE applications ADD COLUMN execution_count INTEGER DEFAULT 0`);
  }

  // 应用执行错误日志表（登录用户上报，仅管理员可见）
  await database.run(`
    CREATE TABLE IF NOT EXISTS application_execution_errors (
      error_id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      version TEXT,
      message TEXT NOT NULL,
      details TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (application_id) REFERENCES applications(application_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  // 项目表（多租户）
  await database.run(`
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      vcs_type TEXT NOT NULL DEFAULT 'none',
      repo_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(user_id)
    )
  `);

  // 项目成员表（两级角色：全局 admin / 项目 admin / member）
  await database.run(`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, user_id),
      FOREIGN KEY (project_id) REFERENCES projects(project_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  // 项目级通用应用配置表（覆盖全局 common_apps.config；enabled 为项目内开关）
  await database.run(`
    CREATE TABLE IF NOT EXISTS project_app_configs (
      project_id TEXT NOT NULL,
      app_key TEXT NOT NULL,
      config TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, app_key),
      FOREIGN KEY (project_id) REFERENCES projects(project_id)
    )
  `);

  // 通用应用表（内置 / admin 登记，kill-switch + 置顶 + 全局配置）
  await database.run(`
    CREATE TABLE IF NOT EXISTS common_apps (
      app_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      version TEXT,
      builtin INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      download_count INTEGER NOT NULL DEFAULT 0,
      execution_count INTEGER NOT NULL DEFAULT 0,
      config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // 幂等 seed 内置通用应用（已存在的行不覆盖；ClawBench 默认空种子）
  const seedNow = Date.now();
  for (const seed of COMMON_APP_SEEDS) {
    await database.run(
      `INSERT OR IGNORE INTO common_apps (app_key, name, description, version, builtin, enabled, sort_order, pinned, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [seed.appKey, seed.name, seed.description, seed.version ?? '1.0.0', 1, 1, seed.sortOrder, seed.pinned ? 1 : 0, seed.config, seedNow, seedNow]
    );
  }

  // 通用应用执行错误日志表
  await database.run(`
    CREATE TABLE IF NOT EXISTS common_app_execution_errors (
      error_id TEXT PRIMARY KEY,
      app_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      version TEXT,
      message TEXT NOT NULL,
      details TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (app_key) REFERENCES common_apps(app_key),
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  // 通用应用事件表（下载 / 运行，逐条记录，供 admin stats 分页展示）
  await database.run(`
    CREATE TABLE IF NOT EXISTS common_app_events (
      event_id TEXT PRIMARY KEY,
      app_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 1,
      cancelled INTEGER NOT NULL DEFAULT 0,
      version TEXT,
      error_message TEXT,
      error_details TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (app_key) REFERENCES common_apps(app_key),
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  // 通用应用版本历史表
  await database.run(`
    CREATE TABLE IF NOT EXISTS common_app_version_history (
      version_hist_id TEXT PRIMARY KEY,
      app_key TEXT NOT NULL,
      version TEXT NOT NULL,
      changed_by TEXT,
      source TEXT NOT NULL DEFAULT 'admin',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (app_key) REFERENCES common_apps(app_key)
    )
  `);

  // 创建索引
  await database.run(`CREATE INDEX IF NOT EXISTS idx_applications_owner ON applications(owner_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_applications_published ON applications(published)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_applications_type ON applications(type)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_applications_featured ON applications(featured)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_versions_application ON application_versions(application_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_tokens_user ON auth_tokens(user_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_tokens_token ON auth_tokens(token)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_conversations_favorited ON conversations(user_id, favorited)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_attachments_message ON chat_attachments(message_id)`);
  await database.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_feishu_open_id ON users(feishu_open_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_agent_memories_user ON agent_memories(user_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_exec_errors_application ON application_execution_errors(application_id, created_at)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_common_app_exec_errors ON common_app_execution_errors(app_key, created_at)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_common_app_events ON common_app_events(app_key, event_type, created_at)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_common_app_version_hist ON common_app_version_history(app_key, created_at)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_common_apps_enabled_sort ON common_apps(enabled, sort_order)`);

  logger.info('SQLite schema initialized successfully');
}
