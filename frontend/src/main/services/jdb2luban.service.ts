/**
 * JDB → Luban intermediate bridge (Solution 1).
 *
 * Produces Luban-compatible JSON record lists (+ optional schema XML),
 * then optionally invokes the existing Luban CLI (dotnet Luban.dll).
 *
 * Native CoPiper python/json export is unchanged; this only runs when
 * export format includes "luban".
 */

import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import * as logger from '../utils/logger'
import type { ColDef, JDBTableData } from './jdb.service'

export const LUBAN_DOCS_URL = 'https://www.datable.cn/docs/intro'
export const LUBAN_GITHUB_URL = 'https://github.com/focus-creative-games/luban'

export interface LubanExportOptions {
  /** Intermediate JSON dir (absolute or workspace-relative). Default: config/Datas/_jdb */
  intermediateDataDir?: string
  /** Intermediate schema dir. Default: config/Defines/_jdb_gen */
  intermediateSchemaDir?: string
  /** Path to Luban.dll. Default: tools/Luban/Luban.dll */
  lubanDllPath?: string
  /** Path to luban.conf. Default: config/luban.conf */
  lubanConfPath?: string
  /** Invoke Luban after writing intermediates. Default: true when dll+conf exist */
  runLuban?: boolean
  /** -x outputCodeDir */
  outputCodeDir?: string
  /** -x outputDataDir */
  outputDataDir?: string
  /** -t target. Default: all */
  target?: string
  /** module name for generated schema XML. Default: from relDir or "jdb" */
  moduleName?: string
  /** -c code target. Default: cpp-sharedptr-bin */
  codeTarget?: string
  /** -d data targets (comma or multi). Default: bin,json */
  dataTargets?: string[]
}

export interface LubanTableExportResult {
  tableName: string
  format: 'luban'
  outputPath: string
  success: boolean
  error?: string
  rowCount: number
  skipped?: boolean
  /** Schema XML path written (if any) */
  schemaPath?: string
  /** Luban CLI log snippet */
  lubanInfo?: string
}

export interface LubanPaths {
  dataDir: string
  schemaDir: string
  lubanDllPath: string
  lubanConfPath: string
  outputCodeDir: string
  outputDataDir: string
  moduleName: string
  target: string
  codeTarget: string
  dataTargets: string[]
  runLuban: boolean
}

function resolveUnderWorkspace(workspacePath: string, p: string | undefined, fallbackRel: string): string {
  const raw = (p && p.trim()) || fallbackRel
  return path.isAbsolute(raw) ? raw : path.join(workspacePath, raw)
}

export function resolveLubanPaths(workspacePath: string, options?: LubanExportOptions): LubanPaths {
  const dataDir = resolveUnderWorkspace(workspacePath, options?.intermediateDataDir, path.join('config', 'Datas', '_jdb'))
  const schemaDir = resolveUnderWorkspace(workspacePath, options?.intermediateSchemaDir, path.join('config', 'Defines', '_jdb_gen'))
  const lubanDllPath = resolveUnderWorkspace(workspacePath, options?.lubanDllPath, path.join('tools', 'Luban', 'Luban.dll'))
  const lubanConfPath = resolveUnderWorkspace(workspacePath, options?.lubanConfPath, path.join('config', 'luban.conf'))
  const outputCodeDir = resolveUnderWorkspace(
    workspacePath,
    options?.outputCodeDir,
    path.join('output', 'luban', 'code')
  )
  const outputDataDir = resolveUnderWorkspace(
    workspacePath,
    options?.outputDataDir,
    path.join('output', 'luban', 'data')
  )
  const moduleName = (options?.moduleName && options.moduleName.trim()) || 'jdb'
  const target = (options?.target && options.target.trim()) || 'all'
  const codeTarget = (options?.codeTarget && options.codeTarget.trim()) || 'cpp-sharedptr-bin'
  const dataTargets = options?.dataTargets && options.dataTargets.length > 0
    ? options.dataTargets
    : ['bin', 'json']

  const dllOk = fs.existsSync(lubanDllPath)
  const confOk = fs.existsSync(lubanConfPath)
  const runLuban = options?.runLuban !== undefined
    ? options.runLuban
    : dllOk && confOk

  return {
    dataDir,
    schemaDir,
    lubanDllPath,
    lubanConfPath,
    outputCodeDir,
    outputDataDir,
    moduleName,
    target,
    codeTarget,
    dataTargets,
    runLuban
  }
}

/** snake_case for Luban output file names. */
export function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[\s.-]+/g, '_')
    .toLowerCase()
}

export function tableOutputName(tableName: string): string {
  return toSnakeCase(tableName)
}

export function tableLubanName(tableName: string): string {
  return tableName.startsWith('Tb') ? tableName : `Tb${tableName}`
}

/**
 * Map CoPiper j_type → Luban type string for schema generation.
 * Unknown / complex types fall back to string with a note in comment.
 */
export function mapJTypeToLuban(jType: string, src?: string): { type: string; comment?: string } {
  const t = (jType || '').trim()
  if (!t) return { type: 'string', comment: 'empty j_type' }

  if (t === 'int') return { type: 'int' }
  if (t === 'float') return { type: 'float' }
  if (t === 'bool') return { type: 'bool' }
  if (t === 'str' || t === 'tstr' || t === 'istr') return { type: 'string' }
  if (t === 'enum') return { type: 'string', comment: 'enum options kept as string; define enum in Defines if needed' }
  if (t === 'dict') return { type: 'map,string,string' }
  if (t.startsWith('utc_time')) return { type: 'datetime' }

  if (t === 'index' || t.startsWith('index/')) {
    const ref = src || (t.includes('/') ? t.split('/')[1] : '')
    if (ref) {
      return { type: `int#ref=${ref.startsWith('Tb') ? ref : `Tb${ref}`}?`, comment: `index → id (src=${ref})` }
    }
    return { type: 'int', comment: 'index without src' }
  }

  if (t === 'indices' || t === 'list:index' || t.startsWith('list:index')) {
    const ref = src || ''
    if (ref) {
      return { type: `list,int#ref=${ref.startsWith('Tb') ? ref : `Tb${ref}`}?`, comment: `indices → id list` }
    }
    return { type: 'list,int' }
  }

  if (t.startsWith('list:kv:')) {
    const bean = t.slice('list:kv:'.length)
    return { type: `list,${bean}`, comment: 'kv list; ensure bean defined' }
  }
  if (t.startsWith('kv:')) {
    const bean = t.slice('kv:'.length)
    return { type: bean, comment: 'kv bean; ensure bean defined' }
  }
  if (t.startsWith('list:ckv')) {
    return { type: 'list,string', comment: 'ckv list: MVP as list; refine polymorphic bean manually' }
  }
  if (t.startsWith('ckv')) {
    return { type: 'string', comment: 'ckv: MVP as string/json; refine polymorphic bean manually' }
  }

  if (t.startsWith('list:')) {
    const ele = t.slice('list:'.length)
    if (ele === 'int') return { type: 'list,int' }
    if (ele === 'float') return { type: 'list,float' }
    if (ele === 'bool') return { type: 'list,bool' }
    if (ele === 'str') return { type: 'list,string' }
    return { type: 'list,string', comment: `list element ${ele}` }
  }

  return { type: 'string', comment: `unsupported j_type=${t}, fallback string` }
}

/**
 * Adapt CoPiper export rows for Luban JSON:
 * - ckv: add $type from cls if present
 * - leave arrays/objects as-is (already parsed by buildExportRows)
 */
export function adaptRowsForLuban(
  rows: Record<string, unknown>[],
  table: JDBTableData
): Record<string, unknown>[] {
  const colByName = new Map(table.columns.map((c) => [c.name, c]))

  return rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      const col = colByName.get(key)
      out[key] = adaptValueForLuban(value, col)
    }
    return out
  })
}

function adaptValueForLuban(value: unknown, col?: ColDef): unknown {
  if (value === undefined || value === null) return value
  const jType = col?.j_type || ''

  if (jType.startsWith('ckv') && typeof value === 'object' && !Array.isArray(value)) {
    const obj = { ...(value as Record<string, unknown>) }
    if (obj.cls && !obj.$type) {
      obj.$type = String(obj.cls)
      delete obj.cls
    }
    // Also map CoPiper ckv key-as-type-name if present without $type
    return obj
  }

  if (jType.startsWith('list:ckv') && Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const obj = { ...(item as Record<string, unknown>) }
        if (obj.cls && !obj.$type) {
          obj.$type = String(obj.cls)
          delete obj.cls
        }
        return obj
      }
      return item
    })
  }

  // Luban JSON map: [[k,v],...]; CoPiper is_key list:kv becomes plain object dict
  if (jType.startsWith('list:kv:') && value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, v])
  }

  return value
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function writeLubanJson(dataDir: string, tableName: string, rows: Record<string, unknown>[]): string {
  ensureDir(dataDir)
  const filePath = path.join(dataDir, `${tableName}.json`)
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf-8')
  return filePath
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Generate a minimal Luban schema XML for one table (bean + table).
 * Hand-written Defines remain authoritative for production; this is a bootstrap aid.
 */
export function generateTableSchemaXml(
  moduleName: string,
  tableName: string,
  table: JDBTableData,
  jsonRelInput: string
): string {
  const beanName = tableName
  const tbName = tableLubanName(tableName)
  const output = tableOutputName(tableName)

  const exportCols = table.columns.filter(
    (c) => c.c_type !== 'rdesc' && c.c_type !== 'sup' && c.name !== 'idx_name'
  )

  const fieldLines: string[] = []
  for (const col of exportCols) {
    const mapped = mapJTypeToLuban(col.j_type || col.type || 'str', col.src)
    const comment = [col.rname, mapped.comment].filter(Boolean).join(' — ')
    const commentAttr = comment ? ` <!-- ${xmlEscape(comment)} -->` : ''
    fieldLines.push(`        <var name="${xmlEscape(col.name)}" type="${xmlEscape(mapped.type)}"/>${commentAttr}`)
  }

  return [
    `<!-- Auto-generated by CoPiper jdb2luban. Review before merging into Defines/. -->`,
    `<module name="${xmlEscape(moduleName)}">`,
    `    <bean name="${xmlEscape(beanName)}">`,
    ...fieldLines,
    `    </bean>`,
    ``,
    `    <table name="${xmlEscape(tbName)}" value="${xmlEscape(beanName)}" input="*@${xmlEscape(jsonRelInput)}" index="id" mode="map" output="${xmlEscape(output)}"/>`,
    `</module>`,
    ``
  ].join('\n')
}

export function writeTableSchema(
  schemaDir: string,
  moduleName: string,
  tableName: string,
  table: JDBTableData,
  jsonFileName: string
): string {
  ensureDir(schemaDir)
  // input path relative to dataDir: _jdb is under Datas, so input is *_jdb/Name.json from Datas root
  // When json lives in Datas/_jdb/Name.json, Luban dataDir=Datas → input *@_jdb/Name.json
  const jsonRelInput = `_jdb/${jsonFileName}`
  const xml = generateTableSchemaXml(moduleName, tableName, table, jsonRelInput)
  const filePath = path.join(schemaDir, `${toSnakeCase(tableName)}.xml`)
  fs.writeFileSync(filePath, xml, 'utf-8')
  return filePath
}

/**
 * Write Luban intermediate JSON (+ schema XML) for one table.
 */
export function exportLubanTableIntermediates(
  workspacePath: string,
  tableName: string,
  table: JDBTableData,
  exportedRows: Record<string, unknown>[],
  options?: LubanExportOptions
): LubanTableExportResult {
  const paths = resolveLubanPaths(workspacePath, options)

  if (exportedRows.length === 0) {
    return {
      tableName,
      format: 'luban',
      outputPath: '',
      success: true,
      skipped: true,
      rowCount: 0
    }
  }

  try {
    const lubanRows = adaptRowsForLuban(exportedRows, table)
    const jsonPath = writeLubanJson(paths.dataDir, tableName, lubanRows)
    const schemaPath = writeTableSchema(paths.schemaDir, paths.moduleName, tableName, table, `${tableName}.json`)

    return {
      tableName,
      format: 'luban',
      outputPath: jsonPath,
      success: true,
      rowCount: lubanRows.length,
      schemaPath
    }
  } catch (err: any) {
    logger.error(`jdb2luban intermediate failed for ${tableName}:`, err)
    return {
      tableName,
      format: 'luban',
      outputPath: '',
      success: false,
      error: err?.message || String(err),
      rowCount: 0
    }
  }
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 300000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Luban process timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout?.on('data', (d) => { stdout += d.toString() })
    child.stderr?.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

/**
 * Invoke Luban CLI once after intermediates are ready.
 * Returns a summary string for UI / ExportResult.postProcessInfo.
 */
export async function runLubanCli(
  workspacePath: string,
  options?: LubanExportOptions
): Promise<{ success: boolean; info: string }> {
  const paths = resolveLubanPaths(workspacePath, options)

  if (!paths.runLuban) {
    return {
      success: true,
      info: `Luban CLI skipped (runLuban=false or missing dll/conf). Intermediates at ${paths.dataDir}`
    }
  }

  if (!fs.existsSync(paths.lubanDllPath)) {
    return {
      success: false,
      info: `Luban.dll not found: ${paths.lubanDllPath}. Intermediate JSON still written under ${paths.dataDir}. See ${LUBAN_DOCS_URL}`
    }
  }
  if (!fs.existsSync(paths.lubanConfPath)) {
    return {
      success: false,
      info: `luban.conf not found: ${paths.lubanConfPath}. Intermediate JSON still written. Wire config/ then re-export. Docs: ${LUBAN_DOCS_URL}`
    }
  }

  const confDir = path.dirname(paths.lubanConfPath)
  const args = [
    paths.lubanDllPath,
    '-t', paths.target,
    '-c', paths.codeTarget,
    ...paths.dataTargets.flatMap((d) => ['-d', d]),
    '--conf', paths.lubanConfPath,
    '-x', `outputCodeDir=${paths.outputCodeDir}`,
    '-x', `outputDataDir=${paths.outputDataDir}`,
    '-x', 'outputSaver.bin.cleanUpOutputDir=0',
    '-x', 'outputSaver.json.cleanUpOutputDir=0'
  ]

  logger.info(`Running Luban: dotnet ${args.join(' ')}`)

  try {
    const { code, stdout, stderr } = await runProcess('dotnet', args, confDir)
    const tail = [stdout, stderr].filter(Boolean).join('\n').trim()
    const short = tail.length > 800 ? `${tail.slice(-800)}` : tail

    if (code !== 0) {
      return {
        success: false,
        info: `Luban exit ${code}. ${short || 'no output'}`
      }
    }
    return {
      success: true,
      info: `Luban OK → code: ${paths.outputCodeDir}; data: ${paths.outputDataDir}${short ? ` | ${short.split('\n').slice(-3).join(' ')}` : ''}`
    }
  } catch (err: any) {
    logger.error('Luban CLI failed:', err)
    return {
      success: false,
      info: `Luban CLI error: ${err?.message || String(err)}. Is dotnet SDK installed?`
    }
  }
}
