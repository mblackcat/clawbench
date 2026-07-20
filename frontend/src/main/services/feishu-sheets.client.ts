/**
 * Feishu Spreadsheet OpenAPI client (user access token).
 * Used by CoPiper for create/link/test/sync — not via lark-cli.
 */

import * as https from 'https'
import * as logger from '../utils/logger'
import { getValidFeishuAccessToken } from './auth.service'
import { isFeishuUser } from '../store/auth.store'
import type { FeishuTestResult } from './jdb-meta'

const FEISHU_API_HOST = 'open.feishu.cn'

export class FeishuSheetsError extends Error {
  code: number
  kind: 'auth' | 'permission' | 'not_found' | 'rate_limit' | 'network' | 'api' | 'unavailable'

  constructor(
    message: string,
    code = -1,
    kind: FeishuSheetsError['kind'] = 'api'
  ) {
    super(message)
    this.name = 'FeishuSheetsError'
    this.code = code
    this.kind = kind
  }
}

export interface FeishuSheetInfo {
  sheetId: string
  title: string
  index: number
  rowCount?: number
  columnCount?: number
}

export interface FeishuSpreadsheetMeta {
  spreadsheetToken: string
  title: string
  url?: string
  ownerId?: string
}

export interface ReadRangeResult {
  range: string
  values: unknown[][]
  revision?: number
}

export function checkFeishuAvailability(): {
  available: boolean
  reason: string
  mode: string
} {
  if (!isFeishuUser()) {
    return {
      available: false,
      reason: 'feishu_login_required',
      mode: 'unavailable'
    }
  }
  return { available: true, reason: '', mode: 'feishu_user' }
}

/**
 * Parse spreadsheet token from Feishu sheets URL or raw token.
 * Supports:
 *  - https://xxx.feishu.cn/sheets/shtcnXXXX
 *  - https://xxx.larksuite.com/sheets/shtXXXX
 *  - raw token sht...
 */
export function parseSpreadsheetToken(urlOrToken: string): string | null {
  const s = (urlOrToken || '').trim()
  if (!s) return null

  // Raw token (no path)
  if (/^sht[a-zA-Z0-9_-]+$/i.test(s)) return s

  try {
    const u = new URL(s)
    // /sheets/{token}
    const sheetsMatch = u.pathname.match(/\/sheets\/([a-zA-Z0-9_-]+)/i)
    if (sheetsMatch?.[1]) return sheetsMatch[1]

    // wiki may embed spreadsheet — leave for later; return null
    const wikiMatch = u.pathname.match(/\/wiki\/([a-zA-Z0-9_-]+)/i)
    if (wikiMatch?.[1]) {
      // Wiki node token is not spreadsheet token; caller must resolve separately
      return null
    }
  } catch {
    // not a URL
  }

  // Last path segment fallback
  const parts = s.split(/[/?#]/).filter(Boolean)
  const last = parts[parts.length - 1]
  if (last && /^sht[a-zA-Z0-9_-]+$/i.test(last)) return last

  return null
}

async function getUat(): Promise<string> {
  if (!isFeishuUser()) {
    throw new FeishuSheetsError(
      'Feishu login required',
      401,
      'unavailable'
    )
  }
  const token = await getValidFeishuAccessToken()
  if (!token) {
    throw new FeishuSheetsError(
      'Feishu access token missing or expired — please re-login with Feishu',
      401,
      'auth'
    )
  }
  return token
}

function httpsJson(
  method: string,
  apiPath: string,
  accessToken: string,
  body?: unknown
): Promise<{ code: number; msg: string; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const req = https.request(
      {
        hostname: FEISHU_API_HOST,
        path: apiPath,
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=utf-8',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk: Buffer) => {
          raw += chunk.toString()
        })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw || '{}') as {
              code?: number
              msg?: string
              data?: Record<string, unknown>
            }
            resolve({
              code: typeof parsed.code === 'number' ? parsed.code : -1,
              msg: parsed.msg || '',
              data: (parsed.data || {}) as Record<string, unknown>
            })
          } catch {
            reject(
              new FeishuSheetsError(
                `Invalid Feishu response: ${raw.slice(0, 200)}`,
                res.statusCode || -1,
                'network'
              )
            )
          }
        })
      }
    )
    req.on('error', (err) => {
      reject(new FeishuSheetsError(err.message, -1, 'network'))
    })
    if (payload) req.write(payload)
    req.end()
  })
}

function mapApiError(code: number, msg: string): FeishuSheetsError {
  // Common Feishu codes
  if (code === 99991663 || code === 99991661 || code === 99991664) {
    return new FeishuSheetsError(msg || 'Token invalid or expired', code, 'auth')
  }
  if (
    code === 99991672 ||
    code === 91403 ||
    code === 1310213 ||
    /permission|forbidden|no access/i.test(msg)
  ) {
    return new FeishuSheetsError(msg || 'Permission denied', code, 'permission')
  }
  if (code === 99991400 || code === 99991401) {
    return new FeishuSheetsError(msg || 'Rate limited', code, 'rate_limit')
  }
  if (code === 91402 || /not found|not exist/i.test(msg)) {
    return new FeishuSheetsError(msg || 'Not found', code, 'not_found')
  }
  return new FeishuSheetsError(msg || `Feishu API error ${code}`, code, 'api')
}

async function api(
  method: string,
  apiPath: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const uat = await getUat()
  const res = await httpsJson(method, apiPath, uat, body)
  if (res.code !== 0) {
    logger.warn('Feishu sheets API error', method, apiPath, res.code, res.msg)
    throw mapApiError(res.code, res.msg)
  }
  return res.data
}

export async function createSpreadsheet(
  title: string,
  folderToken?: string
): Promise<FeishuSpreadsheetMeta> {
  const body: Record<string, string> = { title }
  if (folderToken) body.folder_token = folderToken
  const data = await api('POST', '/open-apis/sheets/v3/spreadsheets', body)
  const sp = (data.spreadsheet || data) as Record<string, unknown>
  return {
    spreadsheetToken: String(sp.spreadsheet_token || sp.spreadsheetToken || ''),
    title: String(sp.title || title),
    url: sp.url ? String(sp.url) : undefined,
    ownerId: sp.owner_id ? String(sp.owner_id) : undefined
  }
}

export async function getSpreadsheet(token: string): Promise<FeishuSpreadsheetMeta> {
  const data = await api('GET', `/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(token)}`)
  const sp = (data.spreadsheet || data) as Record<string, unknown>
  return {
    spreadsheetToken: String(sp.spreadsheet_token || token),
    title: String(sp.title || ''),
    url: sp.url ? String(sp.url) : undefined,
    ownerId: sp.owner_id ? String(sp.owner_id) : undefined
  }
}

export async function listSheets(token: string): Promise<FeishuSheetInfo[]> {
  const data = await api(
    'GET',
    `/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(token)}/sheets/query`
  )
  const sheets = (data.sheets || []) as Array<Record<string, unknown>>
  return sheets.map((s, i) => {
    const grid = (s.grid_properties || {}) as Record<string, unknown>
    return {
      sheetId: String(s.sheet_id || s.sheetId || ''),
      title: String(s.title || `Sheet${i + 1}`),
      index: typeof s.index === 'number' ? s.index : i,
      rowCount: typeof grid.row_count === 'number' ? grid.row_count : undefined,
      columnCount: typeof grid.column_count === 'number' ? grid.column_count : undefined
    }
  })
}

/** Add a sheet (worksheet) to an existing spreadsheet */
export async function addSheet(token: string, title: string): Promise<FeishuSheetInfo> {
  // sheets/v2 batch update
  const data = await api(
    'POST',
    `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(token)}/sheets_batch_update`,
    {
      requests: [{ addSheet: { properties: { title } } }]
    }
  )
  const replies = (data.replies || []) as Array<Record<string, unknown>>
  const add = (replies[0]?.addSheet || replies[0]?.add_sheet || {}) as Record<string, unknown>
  const props = (add.properties || {}) as Record<string, unknown>
  return {
    sheetId: String(props.sheetId || props.sheet_id || ''),
    title: String(props.title || title),
    index: typeof props.index === 'number' ? props.index : 0
  }
}

export async function readRange(
  token: string,
  range: string,
  valueRenderOption?: string
): Promise<ReadRangeResult> {
  // range e.g. sheetId!A1:Z1000 — encode carefully
  const encodedRange = encodeURIComponent(range).replace(/%3A/gi, ':').replace(/%21/g, '!')
  let path = `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(token)}/values/${encodedRange}`
  if (valueRenderOption) {
    path += `?valueRenderOption=${encodeURIComponent(valueRenderOption)}`
  }
  const data = await api('GET', path)
  const vr = (data.valueRange || data) as Record<string, unknown>
  return {
    range: String(vr.range || range),
    values: (vr.values as unknown[][]) || [],
    revision: typeof data.revision === 'number' ? data.revision : (vr.revision as number | undefined)
  }
}

export async function writeRange(
  token: string,
  range: string,
  values: unknown[][]
): Promise<{ revision?: number; updatedCells?: number }> {
  const data = await api(
    'PUT',
    `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(token)}/values`,
    {
      valueRange: { range, values }
    }
  )
  return {
    revision: typeof data.revision === 'number' ? data.revision : undefined,
    updatedCells: typeof data.updatedCells === 'number' ? data.updatedCells : undefined
  }
}

/**
 * Connectivity + R/W permission probe for Test button.
 * Reads meta + first sheet small range; attempts a no-op write of empty if readable.
 */
export async function testAccess(token: string): Promise<FeishuTestResult> {
  const checkedAt = Date.now()
  const result: FeishuTestResult = {
    ok: false,
    canRead: false,
    canWrite: false,
    message: '',
    checkedAt
  }

  try {
    const meta = await getSpreadsheet(token)
    result.canRead = true
    const sheets = await listSheets(token)
    if (sheets.length === 0) {
      result.message = `Connected to "${meta.title}" but no sheets found`
      result.ok = true
      return result
    }

    const sheet = sheets[0]
    // Read a small range
    await readRange(token, `${sheet.sheetId}!A1:A1`)

    // Write test: write and restore a far cell to avoid clobbering data
    try {
      const testRange = `${sheet.sheetId}!ZZ1:ZZ1`
      const before = await readRange(token, testRange)
      const prev = before.values?.[0]?.[0] ?? ''
      await writeRange(token, testRange, [['__copiper_rw_test__']])
      await writeRange(token, testRange, [[prev === '' || prev == null ? '' : prev]])
      result.canWrite = true
      result.ok = true
      result.message = `OK — read/write on "${meta.title}" (${sheets.length} sheet(s))`
    } catch (writeErr) {
      const e = writeErr as FeishuSheetsError
      result.canWrite = false
      result.ok = false
      result.message =
        e.kind === 'permission'
          ? `Read OK, write denied: ${e.message}`
          : `Read OK, write failed: ${e.message}`
    }
    return result
  } catch (err) {
    const e = err as FeishuSheetsError
    result.ok = false
    result.canRead = false
    result.canWrite = false
    if (e.kind === 'auth') {
      result.message = `Auth failed: ${e.message}. Please re-login with Feishu.`
    } else if (e.kind === 'permission') {
      result.message = `No permission: ${e.message}. Share the document with your Feishu account (edit).`
    } else if (e.kind === 'unavailable') {
      result.message = e.message
    } else {
      result.message = e.message || String(err)
    }
    return result
  }
}

/** Column index 0 → A, 25 → Z, 26 → AA */
export function colIndexToLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function buildA1Range(
  sheetId: string,
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number
): string {
  const a = colIndexToLetter(startCol)
  const b = colIndexToLetter(endCol)
  return `${sheetId}!${a}${startRow}:${b}${endRow}`
}
