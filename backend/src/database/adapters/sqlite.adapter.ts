import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { DatabaseAdapter } from './types';

/**
 * SQLite adapter — extracted from the original Database class.
 */
export class SqliteAdapter implements DatabaseAdapter {
  private db: sqlite3.Database | null = null;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const dbDir = path.dirname(config.database.path);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      this.db = new sqlite3.Database(
        config.database.path,
        sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
        (err) => {
          if (err) {
            logger.error('Failed to connect to SQLite database', err);
            reject(err);
          } else {
            logger.info(`Connected to SQLite database: ${config.database.path}`);
            resolve();
          }
        }
      );
    });
  }

  async run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function (err) {
        if (err) {
          logger.error('Database run error', { sql, params, error: err });
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Database get error', { sql, params, error: err });
          reject(err);
        } else {
          resolve(row as T);
        }
      });
    });
  }

  async all<T>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database not connected');

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Database all error', { sql, params, error: err });
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    await this.run('BEGIN TRANSACTION');
    try {
      const result = await callback();
      await this.run('COMMIT');
      return result;
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      this.db!.close((err) => {
        if (err) {
          logger.error('Failed to close SQLite database', err);
          reject(err);
        } else {
          logger.info('SQLite database connection closed');
          resolve();
        }
      });
    });
  }
}
