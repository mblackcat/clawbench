import { database } from './index';
import { config } from '../config';
import { logger } from '../utils/logger';
import { initializeSqliteSchema } from './schema/sqlite.schema';
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

  // Remote task dispatch tables (after the base schema: it ALTERs applications)
  await initializeDispatchSchema(
    database,
    dbType === 'mysql' || dbType === 'postgres' ? dbType : 'sqlite'
  );
}
