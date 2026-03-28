import { config } from '../config';
import { logger } from '../utils/logger';
import { DatabaseAdapter } from './adapters/types';
import { SqliteAdapter } from './adapters/sqlite.adapter';

/**
 * Create the correct adapter based on `config.database.type`.
 *
 * MySQL and PostgreSQL adapters are loaded lazily so that their
 * native driver packages (`mysql2`, `pg`) are only required when
 * actually selected — SQLite-only setups don't need them installed.
 */
function createAdapter(): DatabaseAdapter {
  const dbType = config.database.type;

  switch (dbType) {
    case 'sqlite':
      return new SqliteAdapter();

    case 'mysql': {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { MysqlAdapter } = require('./adapters/mysql.adapter');
      return new MysqlAdapter();
    }

    case 'postgres': {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PostgresAdapter } = require('./adapters/postgres.adapter');
      return new PostgresAdapter();
    }

    default:
      logger.warn(`Unknown DB_TYPE "${dbType}", falling back to SQLite`);
      return new SqliteAdapter();
  }
}

// 导出单例实例
export const database: DatabaseAdapter = createAdapter();
