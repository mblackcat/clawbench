import { describe, it, expect } from 'vitest'
import {
  COPIPER_META_KEY,
  listTables,
  getMeta,
  getFeishuLink,
  setFeishuLink,
  tablesOnly,
  validateSheetMaps,
  createDefaultFeishuLink,
  isTableKey,
  rowContentHash
} from '../jdb-meta'
import type { JDBTableData } from '../jdb.service'

const sampleTable: JDBTableData = {
  columns: [
    {
      id: 'id',
      name: 'id',
      rname: 'ID',
      type: 'int',
      j_type: 'int',
      req_or_opt: 'required',
      c_type: 'data',
      c_index: 1,
      src: ''
    }
  ],
  rows: [{ id: 1, idx_name: 'a' }]
}

describe('jdb-meta', () => {
  it('listTables excludes __copiper__', () => {
    const db = {
      ItemData: sampleTable,
      [COPIPER_META_KEY]: { version: 1, feishu: null }
    }
    expect(listTables(db)).toEqual(['ItemData'])
    expect(isTableKey(COPIPER_META_KEY)).toBe(false)
  })

  it('tablesOnly strips meta', () => {
    const db = {
      A: sampleTable,
      [COPIPER_META_KEY]: {
        version: 1,
        feishu: createDefaultFeishuLink({
          spreadsheetUrl: 'https://feishu.cn/sheets/sht1',
          spreadsheetToken: 'sht1',
          sheetMaps: []
        })
      }
    }
    const only = tablesOnly(db)
    expect(Object.keys(only)).toEqual(['A'])
    expect(only.A.rows[0].id).toBe(1)
  })

  it('setFeishuLink / getFeishuLink roundtrip', () => {
    const db = { ItemData: sampleTable }
    const link = createDefaultFeishuLink({
      spreadsheetUrl: 'https://feishu.cn/sheets/shtcnABC',
      spreadsheetToken: 'shtcnABC',
      sheetMaps: [
        {
          jdbTable: 'ItemData',
          sheetId: 'sid1',
          sheetTitle: 'ItemData',
          headerMode: 'name',
          keyColumn: 'id',
          headerRow: 1,
          dataStartRow: 2
        }
      ]
    })
    const next = setFeishuLink(db, link)
    expect(getMeta(next)?.version).toBe(1)
    expect(getFeishuLink(next)?.spreadsheetToken).toBe('shtcnABC')
    expect(listTables(next)).toEqual(['ItemData'])
  })

  it('validateSheetMaps requires all tables', () => {
    const v = validateSheetMaps(
      ['A', 'B'],
      [
        {
          jdbTable: 'A',
          sheetId: '1',
          sheetTitle: 'A',
          headerMode: 'name',
          keyColumn: 'id',
          headerRow: 1,
          dataStartRow: 2
        }
      ]
    )
    expect(v.ok).toBe(false)
    expect(v.missing).toEqual(['B'])
  })

  it('rowContentHash is stable', () => {
    const a = rowContentHash({ id: 1, name: 'x', z: 2 }, ['id', 'name', 'z'])
    const b = rowContentHash({ z: 2, name: 'x', id: 1 }, ['id', 'name', 'z'])
    expect(a).toBe(b)
    const c = rowContentHash({ id: 1, name: 'y', z: 2 }, ['id', 'name', 'z'])
    expect(a).not.toBe(c)
  })
})
