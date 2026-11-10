import { database } from './index';
import { config } from '../config';
import { logger } from '../utils/logger';
import { initializeSqliteSchema } from './schema/sqlite.schema';
import { initializeAiSchema } from './schema/ai.schema';
import { Dialect } from './schema/dialect';
import { initializeDispatchSchema } from './schema/dispatch.schema';

/**
 * Initialise the database schema for the active dialect.
 *
 * MySQL and PostgreSQL schema modules are loaded lazily so their
 * driver packages are only required when actually selected.
 */
export async function initializeSchema(): Promise<void> {
  logger.info('Initializing database schema...');

  const dbType = config.database.type;

  switch (dbType) {
    case 'sqlite':
      await initializeSqliteSchema(database);
      break;

    case 'mysql': {
      const { initializeMysqlSchema } = require('./schema/mysql.schema');
      await initializeMysqlSchema(database);
      break;
    }

    case 'postgres': {
      const { initializePostgresSchema } = require('./schema/postgres.schema');
      await initializePostgresSchema(database);
      break;
    }

    default:
      await initializeSqliteSchema(database);
      break;
  }

  // 方言无关的独立 schema 模块（按方言映射列类型）
  const dialect: Dialect = dbType === 'mysql' || dbType === 'postgres' ? dbType : 'sqlite';
  // 系统模型 / 用量审计
  await initializeAiSchema(database, dialect);

  // Remote task dispatch tables (after the base schema: it ALTERs applications)
  await initializeDispatchSchema(database, dialect);
}
