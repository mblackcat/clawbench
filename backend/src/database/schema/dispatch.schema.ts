import { DatabaseAdapter } from '../adapters/types';
import { logger } from '../../utils/logger';

/**
 * Remote task dispatch schema (all three dialects).
 *
 * - `applications.dispatchable`: an admin must explicitly opt an app in before
 *   it can be dispatched.
 * - `dispatched_tasks`: task definitions (never hard-deleted; audit trail).
 * - `dispatched_task_executions`: one row per (task, machine) — the unique
 *   index is what makes claiming atomic.
 *
 * Must run AFTER the dialect's base schema (it ALTERs `applications`, so the
 * table has to exist first — avoids the PG ALTER-before-CREATE ordering bug).
 */
export type DispatchDialect = 'sqlite' | 'mysql' | 'postgres';

interface TypeMap {
  id: string;
  appId: string;
  short: string;
  key: string;
  text: string;
  longText: string;
  int: string;
  bigint: string;
  suffix: string;
}

function typeMap(dialect: DispatchDialect): TypeMap {
  if (dialect === 'mysql') {
    return {
      id: 'VARCHAR(64)',
      appId: 'VARCHAR(255)',
      short: 'VARCHAR(255)',
      key: 'VARCHAR(64)',
      text: 'TEXT',
      // a 32K-char CJK excerpt is ~96KB, above MySQL TEXT's 64KB limit
      longText: 'MEDIUMTEXT',
      int: 'INTEGER',
      bigint: 'BIGINT',
      suffix: ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    };
  }
  const int = 'INTEGER';
  const bigint = dialect === 'postgres' ? 'BIGINT' : 'INTEGER';
  return {
    id: 'TEXT',
    appId: 'TEXT',
    short: 'TEXT',
    key: 'TEXT',
    text: 'TEXT',
    longText: 'TEXT',
    int,
    bigint,
    suffix: '',
  };
}

async function currentMysqlDb(database: DatabaseAdapter): Promise<string | undefined> {
  const row = await database.get<{ db: string }>('SELECT DATABASE() AS db');
  return row?.db || undefined;
}

async function addDispatchableColumn(database: DatabaseAdapter, dialect: DispatchDialect): Promise<void> {
  const definition = 'INTEGER NOT NULL DEFAULT 0';
  if (dialect === 'postgres') {
    await database.run(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS dispatchable ${definition}`);
    return;
  }
  if (dialect === 'sqlite') {
    const cols = await database.all<{ name: string }>(`PRAGMA table_info(applications)`);
    if (!cols.some((c) => c.name === 'dispatchable')) {
      await database.run(`ALTER TABLE applications ADD COLUMN dispatchable ${definition}`);
    }
    return;
  }
  const db = await currentMysqlDb(database);
  if (!db) return;
  const exists = await database.get<{ cnt: number | string }>(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'applications' AND COLUMN_NAME = 'dispatchable'`,
    [db]
  );
  if (!exists || Number(exists.cnt) === 0) {
    await database.run(`ALTER TABLE applications ADD COLUMN dispatchable ${definition}`);
  }
}

type IndexSpec = [name: string, table: string, columns: string, unique?: boolean];

async function createIndexes(
  database: DatabaseAdapter,
  dialect: DispatchDialect,
  specs: IndexSpec[]
): Promise<void> {
  const db = dialect === 'mysql' ? await currentMysqlDb(database) : undefined;
  for (const [name, table, columns, unique] of specs) {
    const kind = unique ? 'UNIQUE INDEX' : 'INDEX';
    if (dialect !== 'mysql') {
      await database.run(`CREATE ${kind} IF NOT EXISTS ${name} ON ${table}(${columns})`);
      continue;
    }
    if (!db) continue;
    const exists = await database.get<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [db, table, name]
    );
    if (!exists || Number(exists.cnt) === 0) {
      await database.run(`CREATE ${kind} ${name} ON ${table}(${columns})`);
    }
  }
}

export async function initializeDispatchSchema(
  database: DatabaseAdapter,
  dialect: DispatchDialect
): Promise<void> {
  const t = typeMap(dialect);

  await addDispatchableColumn(database, dialect);

  await database.run(`
    CREATE TABLE IF NOT EXISTS dispatched_tasks (
      task_id ${t.id} PRIMARY KEY,
      app_id ${t.appId} NOT NULL,
      app_name ${t.short} NOT NULL,
      app_version ${t.key} NOT NULL,
      package_sha256 ${t.key} NOT NULL,
      target_scope ${t.key} NOT NULL,
      target_id ${t.id},
      preset_params ${t.text},
      force_confirm ${t.int} NOT NULL DEFAULT 0,
      auto_install ${t.int} NOT NULL DEFAULT 0,
      reason ${t.short},
      dispatched_by ${t.id} NOT NULL,
      created_at ${t.bigint} NOT NULL,
      expires_at ${t.bigint} NOT NULL,
      revoked_at ${t.bigint},
      revoked_by ${t.id}
    )${t.suffix}
  `);

  await database.run(`
    CREATE TABLE IF NOT EXISTS dispatched_task_executions (
      execution_id ${t.id} PRIMARY KEY,
      task_id ${t.id} NOT NULL,
      user_id ${t.id} NOT NULL,
      machine_id ${t.key} NOT NULL,
      status ${t.key} NOT NULL,
      reason_code ${t.key},
      exit_code ${t.int},
      duration_ms ${t.bigint},
      summary ${t.text},
      log_excerpt ${t.longText},
      claimed_at ${t.bigint} NOT NULL,
      started_at ${t.bigint},
      completed_at ${t.bigint},
      lease_expires_at ${t.bigint},
      updated_at ${t.bigint} NOT NULL,
      FOREIGN KEY (task_id) REFERENCES dispatched_tasks(task_id)
    )${t.suffix}
  `);

  await createIndexes(database, dialect, [
    ['uk_dte_task_machine', 'dispatched_task_executions', 'task_id, machine_id', true],
    ['idx_dte_machine_status', 'dispatched_task_executions', 'machine_id, status'],
    ['idx_dte_status_lease', 'dispatched_task_executions', 'status, lease_expires_at'],
    ['idx_dt_created', 'dispatched_tasks', 'created_at'],
    ['idx_dt_expires', 'dispatched_tasks', 'expires_at'],
  ]);

  logger.info('Dispatch schema initialized');
}
