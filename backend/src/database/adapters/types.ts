/**
 * Database adapter interface.
 * All adapters must implement this contract so repositories can stay
 * database-agnostic.  The API mirrors the original SQLite wrapper.
 */
export interface DatabaseAdapter {
  /** Open a connection (or pool). */
  connect(): Promise<void>;

  /** Execute a write statement (INSERT / UPDATE / DELETE / DDL). */
  run(sql: string, params?: any[]): Promise<{ lastID: number; changes: number }>;

  /** Fetch a single row. */
  get<T>(sql: string, params?: any[]): Promise<T | undefined>;

  /** Fetch all matching rows. */
  all<T>(sql: string, params?: any[]): Promise<T[]>;

  /** Run `callback` inside a single transaction. */
  transaction<T>(callback: () => Promise<T>): Promise<T>;

  /** Close the connection / pool. */
  close(): Promise<void>;
}
