import { DatabaseAdapter } from '../adapters/types';

/** 方言无关的独立 schema 模块（如 ai.schema）共用的列类型映射与幂等 DDL 工具 */
export type Dialect = 'sqlite' | 'mysql' | 'postgres';

export function typeMap(dialect: Dialect) {
  if (dialect === 'mysql') {
    return { id: 'VARCHAR(36)', key: 'VARCHAR(64)', short: 'VARCHAR(255)', text: 'TEXT', int: 'INT', bigint: 'BIGINT', suffix: ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' };
  }
  if (dialect === 'postgres') {
    return { id: 'TEXT', key: 'TEXT', short: 'TEXT', text: 'TEXT', int: 'INTEGER', bigint: 'BIGINT', suffix: '' };
  }
  return { id: 'TEXT', key: 'TEXT', short: 'TEXT', text: 'TEXT', int: 'INTEGER', bigint: 'INTEGER', suffix: '' };
}

/**
 * 幂等加列：PG 用 IF NOT EXISTS；SQLite / MySQL 先查列是否存在再 ALTER
 * （避免每次启动都触发并记录「列已存在」错误），并发竞争时仍吞掉 duplicate column。
 */
export async function addColumnIfMissing(
  database: DatabaseAdapter,
  dialect: Dialect,
  table: string,
  column: string,
  type: string
): Promise<void> {
  if (dialect === 'postgres') {
    await database.run(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
    return;
  }
  if (dialect === 'sqlite') {
    const cols = await database.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (cols.some((c) => c.name === column)) return;
  } else {
    const row = await database.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    if (Number(row?.cnt ?? 0) > 0) return;
  }
  try {
    await database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (err?.code === 'ER_DUP_FIELDNAME' || err?.errno === 1060 || /duplicate column/i.test(msg)) return;
    throw err;
  }
}

/** 幂等建索引：MySQL 不支持 IF NOT EXISTS，吞掉 ER_DUP_KEYNAME */
export async function createIndexes(
  database: DatabaseAdapter,
  dialect: Dialect,
  indexes: Array<[name: string, table: string, cols: string, unique?: boolean]>
): Promise<void> {
  for (const [name, table, cols, unique] of indexes) {
    const kw = unique ? 'UNIQUE INDEX' : 'INDEX';
    if (dialect === 'mysql') {
      try {
        await database.run(`CREATE ${kw} ${name} ON ${table}(${cols})`);
      } catch (err: any) {
        if (err?.code !== 'ER_DUP_KEYNAME' && err?.errno !== 1061) throw err;
      }
    } else {
      await database.run(`CREATE ${kw} IF NOT EXISTS ${name} ON ${table}(${cols})`);
    }
  }
}
