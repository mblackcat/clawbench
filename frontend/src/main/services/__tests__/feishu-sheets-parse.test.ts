import { describe, it, expect } from 'vitest'
import { parseSpreadsheetToken, colIndexToLetter, buildA1Range } from '../feishu-sheets.client'

describe('feishu-sheets parse helpers', () => {
  it('parses raw token', () => {
    expect(parseSpreadsheetToken('shtcnABCDEF')).toBe('shtcnABCDEF')
  })

  it('parses sheets URL', () => {
    expect(
      parseSpreadsheetToken('https://xxx.feishu.cn/sheets/shtcnXYZ?sheet=0')
    ).toBe('shtcnXYZ')
  })

  it('colIndexToLetter', () => {
    expect(colIndexToLetter(0)).toBe('A')
    expect(colIndexToLetter(25)).toBe('Z')
    expect(colIndexToLetter(26)).toBe('AA')
  })

  it('buildA1Range', () => {
    expect(buildA1Range('sid', 0, 1, 2, 10)).toBe('sid!A1:C10')
  })
})
