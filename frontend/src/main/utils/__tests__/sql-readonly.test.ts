import { describe, it, expect } from 'vitest'
import { splitSqlStatements, checkReadOnlySql, parseMongoReadQuery } from '../sql-readonly'

describe('splitSqlStatements', () => {
  it('ignores semicolons in strings, identifiers, comments and dollar quotes', () => {
    expect(splitSqlStatements("SELECT 'a;b', \"c;d\", `e;f` FROM t;")).toHaveLength(1)
    expect(splitSqlStatements('SELECT 1 -- ; DROP TABLE x\n')).toEqual(['SELECT 1'])
    expect(splitSqlStatements('SELECT /* ; */ 1')).toHaveLength(1)
    expect(splitSqlStatements("SELECT $$a;b$$, $x$;$x$")).toHaveLength(1)
    expect(splitSqlStatements("SELECT 'it''s;'; SELECT 2")).toHaveLength(2)
    expect(splitSqlStatements("SELECT 'a\\';' ; DELETE FROM t", 'mysql')).toHaveLength(2)
    // PostgreSQL: backslash is literal and # is an operator
    expect(splitSqlStatements("SELECT 'a\\'; DELETE FROM t", 'postgres')).toHaveLength(2)
    expect(splitSqlStatements('SELECT 1 # 2; DROP TABLE t', 'postgres')).toHaveLength(2)
  })
})

describe('checkReadOnlySql', () => {
  it('accepts read statements per dialect', () => {
    expect(checkReadOnlySql('select * from t', 'mysql').ok).toBe(true)
    expect(checkReadOnlySql('  (SELECT 1)', 'postgres').ok).toBe(true)
    expect(checkReadOnlySql('SHOW TABLES;', 'mysql').ok).toBe(true)
    expect(checkReadOnlySql('WITH a AS (SELECT 1) SELECT * FROM a', 'sqlite').ok).toBe(true)
    expect(checkReadOnlySql('PRAGMA table_info(users)', 'sqlite').ok).toBe(true)
    expect(checkReadOnlySql('/* hi */ EXPLAIN SELECT 1', 'postgres').ok).toBe(true)
  })

  it('rejects writes, DDL, stacked statements and file writes', () => {
    for (const sql of [
      'DELETE FROM t',
      'update t set a=1',
      'DROP TABLE t',
      'CREATE TABLE x(a int)',
      'SELECT 1; DROP TABLE t',
      "SELECT * FROM t INTO OUTFILE '/tmp/x'",
      'COMMIT',
      'SET autocommit=1',
      '',
      '   ;  '
    ]) {
      expect(checkReadOnlySql(sql, 'mysql').ok).toBe(false)
    }
    expect(checkReadOnlySql('PRAGMA journal_mode=DELETE', 'sqlite').ok).toBe(false)
    expect(checkReadOnlySql('PRAGMA journal_mode(DELETE)', 'sqlite').ok).toBe(false)
    expect(checkReadOnlySql('SHOW TABLES', 'sqlite').ok).toBe(false)
    expect(checkReadOnlySql('PRAGMA table_info(t)', 'postgres').ok).toBe(false)
  })
})

describe('parseMongoReadQuery', () => {
  it('parses find / aggregate / count with a capped limit', () => {
    expect(parseMongoReadQuery('{"collection":"u","filter":{"a":1}}')).toMatchObject({
      collection: 'u',
      op: 'find',
      filter: { a: 1 },
      limit: 100
    })
    expect(parseMongoReadQuery('{"collection":"u","op":"aggregate","pipeline":[{"$match":{}}],"limit":99999}').limit).toBe(1000)
    expect(parseMongoReadQuery('{"collection":"u","op":"countDocuments"}').op).toBe('count')
  })

  it('rejects writes and malformed input', () => {
    expect(() => parseMongoReadQuery('db.u.drop()')).toThrow(/JSON/)
    expect(() => parseMongoReadQuery('{"collection":"u","op":"deleteMany"}')).toThrow(/Unsupported/)
    expect(() => parseMongoReadQuery('{"collection":"u","op":"aggregate","pipeline":[{"$out":"x"}]}')).toThrow(/\$out/)
    expect(() => parseMongoReadQuery('{"collection":"u","op":"aggregate","pipeline":[{"$merge":{"into":"x"}}]}')).toThrow()
    expect(() => parseMongoReadQuery('{"op":"find"}')).toThrow(/collection/)
    expect(() => parseMongoReadQuery('[]')).toThrow()
  })
})
