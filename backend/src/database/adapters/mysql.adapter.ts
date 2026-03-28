import mysql, { Pool, PoolConnection } from 'mysql2/promise';
import { AsyncLocalStorage } from 'async_hooks';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { DatabaseAdapter } from './types';

const txStorage = new AsyncLocalStorage<PoolConnection>();

/**
 * MySQL adapter using `mysql2/promise` connection pool.
 *
 * - `mysql2` supports `?` placeholders natively, so no conversion needed.
 * - Uses AsyncLocalStorage so that `run` / `get` / `all` called inside a
 *   `transaction()` callback transparently reuse the transactional connection.
 */
export class MysqlAdapter implements DatabaseAdapter {
  private pool: Pool | null = null;

  async connect(): Promise<void> {
    this.pool = mysql.createPool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
      waitForConnections: true,
      connectionLimit: 10,
    });

    // Verify connectivity
    const conn = await this.pool.getConnection();
    conn.release();
    logger.info(
      `Connected to MySQL database: ${config.database.host}:${config.database.port}/${config.database.name}`
    );
  }

  private getConnection(): Pool | PoolConnection {
    const txConn = txStorage.getStore();
    if (txConn) return txConn;
    if (!this.pool) throw new Error('Database not connected');
    return this.pool;
  }

  async run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    const conn = this.getConnection();

    try {
      const [result] = await conn.query(sql, params);
      const r = result as any;
      return {
        lastID: r.insertId ?? 0,
        changes: r.affectedRows ?? 0,
      };
    } catch (err) {
      logger.error('Database run error', { sql, params, error: err });
      throw err;
    }
  }

  async get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    const conn = this.getConnection();

    try {
      const [rows] = await conn.query(sql, params);
      return ((rows as any[])[0] as T) ?? undefined;
    } catch (err) {
      logger.error('Database get error', { sql, params, error: err });
      throw err;
    }
  }

  async all<T>(sql: string, params: any[] = []): Promise<T[]> {
    const conn = this.getConnection();

    try {
      const [rows] = await conn.query(sql, params);
      return rows as T[];
    } catch (err) {
      logger.error('Database all error', { sql, params, error: err });
      throw err;
    }
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error('Database not connected');

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await txStorage.run(conn, callback);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async close(): Promise<void> {
    if (!this.pool) return;
    await this.pool.end();
    logger.info('MySQL connection pool closed');
  }
}
