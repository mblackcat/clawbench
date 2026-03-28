import { Pool, PoolClient } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { DatabaseAdapter } from './types';
import { toPositionalParams } from './placeholder';

const txStorage = new AsyncLocalStorage<PoolClient>();

/**
 * PostgreSQL adapter using `pg` connection pool.
 *
 * - Converts `?` placeholders to `$1, $2, …` automatically.
 * - Uses AsyncLocalStorage so that `run` / `get` / `all` called inside a
 *   `transaction()` callback transparently reuse the transactional client.
 */
export class PostgresAdapter implements DatabaseAdapter {
  private pool: Pool | null = null;

  async connect(): Promise<void> {
    this.pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
    });

    // Verify connectivity
    const client = await this.pool.connect();
    client.release();
    logger.info(
      `Connected to PostgreSQL database: ${config.database.host}:${config.database.port}/${config.database.name}`
    );
  }

  private getClient(): Pool | PoolClient {
    const txClient = txStorage.getStore();
    if (txClient) return txClient;
    if (!this.pool) throw new Error('Database not connected');
    return this.pool;
  }

  async run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    const pgSql = toPositionalParams(sql);
    const client = this.getClient();

    try {
      const result = await client.query(pgSql, params);
      return {
        lastID: 0, // PG doesn't have a generic lastID; not used by repositories
        changes: result.rowCount ?? 0,
      };
    } catch (err) {
      logger.error('Database run error', { sql: pgSql, params, error: err });
      throw err;
    }
  }

  async get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    const pgSql = toPositionalParams(sql);
    const client = this.getClient();

    try {
      const result = await client.query(pgSql, params);
      return (result.rows[0] as T) ?? undefined;
    } catch (err) {
      logger.error('Database get error', { sql: pgSql, params, error: err });
      throw err;
    }
  }

  async all<T>(sql: string, params: any[] = []): Promise<T[]> {
    const pgSql = toPositionalParams(sql);
    const client = this.getClient();

    try {
      const result = await client.query(pgSql, params);
      return result.rows as T[];
    } catch (err) {
      logger.error('Database all error', { sql: pgSql, params, error: err });
      throw err;
    }
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error('Database not connected');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await txStorage.run(client, callback);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (!this.pool) return;
    await this.pool.end();
    logger.info('PostgreSQL connection pool closed');
  }
}
