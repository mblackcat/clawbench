import { widenApplicationIdColumns } from '../database/schema/mysql.schema';
import type { DatabaseAdapter } from '../database/adapters/types';

/**
 * Fake MySQL adapter: tracks which "connection" each statement ran on so we
 * can assert the FK toggle and every MODIFY share one dedicated connection.
 */
function makeFakeDb(lengths: Record<string, number | null>, opts: { failOn?: string } = {}) {
  const log: Array<{ conn: string; sql: string }> = [];
  let pinned: string | null = null;
  let poolCounter = 0;
  const connFor = (): string => pinned ?? `pool-${++poolCounter}`;

  const db: DatabaseAdapter = {
    connect: async () => {},
    close: async () => {},
    transaction: async (cb) => cb(),
    run: async (sql: string) => {
      log.push({ conn: connFor(), sql });
      const m = /ALTER TABLE (\w+) MODIFY/.exec(sql);
      if (m) {
        if (opts.failOn === m[1]) throw new Error('boom');
        lengths[m[1]] = 255;
      }
      return { lastID: 0, changes: 0 };
    },
    get: async <T>(_sql: string, params: any[] = []) => {
      const table = params[1] as string;
      const len = lengths[table];
      return (len === undefined ? undefined : { char_len: len }) as T | undefined;
    },
    all: async () => [],
    withConnection: async (cb) => {
      pinned = 'dedicated';
      try {
        return await cb();
      } finally {
        pinned = null;
      }
    },
  };
  return { db, log };
}

describe('widenApplicationIdColumns (MySQL)', () => {
  it('runs FK toggle and MODIFYs on one dedicated connection, per table', async () => {
    // applications already widened by a partial earlier run; children are not
    const { db, log } = makeFakeDb({ applications: 255, application_versions: 36, application_execution_errors: 36 });
    await widenApplicationIdColumns(db, 'cb');
    expect(log.map((l) => l.sql)).toEqual([
      'SET FOREIGN_KEY_CHECKS = 0',
      'ALTER TABLE application_versions MODIFY COLUMN application_id VARCHAR(255) NOT NULL',
      'ALTER TABLE application_execution_errors MODIFY COLUMN application_id VARCHAR(255) NOT NULL',
      'SET FOREIGN_KEY_CHECKS = 1',
    ]);
    expect(new Set(log.map((l) => l.conn))).toEqual(new Set(['dedicated']));
  });

  it('is a no-op when every table is already wide or missing', async () => {
    const { db, log } = makeFakeDb({ applications: 255, application_versions: 255 });
    await widenApplicationIdColumns(db, 'cb');
    expect(log).toEqual([]);
  });

  it('always restores FOREIGN_KEY_CHECKS on the same connection after a failure', async () => {
    const { db, log } = makeFakeDb(
      { applications: 36, application_versions: 36, application_execution_errors: 36 },
      { failOn: 'application_versions' }
    );
    await expect(widenApplicationIdColumns(db, 'cb')).rejects.toThrow('boom');
    expect(log[log.length - 1]).toEqual({ conn: 'dedicated', sql: 'SET FOREIGN_KEY_CHECKS = 1' });
  });
});
