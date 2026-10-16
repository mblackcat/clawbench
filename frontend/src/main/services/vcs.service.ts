import fs from 'fs'
import { execFile } from 'child_process'
import { dirname, join, resolve, relative } from 'path'
import { getChangedFiles as getGitChangedFiles, getDiffStat as getGitDiffStat, gitExec } from './git.service'

export type VcsType = 'git' | 'svn' | 'perforce' | 'none'

export interface DiffStat {
  additions: number
  deletions: number
}

export interface ChangedFile {
  path: string
  status: string
  staged: boolean
  additions: number
  deletions: number
}

export interface VcsExecResult {
  success: boolean
  output?: string
  error?: string
}

export interface VcsStatusResult {
  type: VcsType
  files: ChangedFile[]
}

/** Raw unified diff for one file or one directory subtree. The renderer parses
 *  it (utils/unified-diff.ts) and decides per file whether it is viewable. */
export interface VcsDiffResult {
  type: VcsType
  /** Workspace-relative path the diff was requested for. */
  path: string
  /** Unified diff text; may cover several files when `path` is a directory. */
  diff: string
  /** Set when the diff was cut short (file/subtree budget exceeded). */
  truncated?: boolean
  error?: string
}

function runSvn(workspacePath: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('svn', args, { cwd: workspacePath, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
      } else {
        resolvePromise(stdout)
      }
    })
  })
}

/** Max ancestor levels to scan when looking for a VCS marker above the workspace. */
const VCS_UPWARD_SEARCH_MAX_DEPTH = 16

/** Walk from `start` (inclusive) up through its ancestors, returning the first
 *  directory for which `match` returns true, or null if none is found within
 *  VCS_UPWARD_SEARCH_MAX_DEPTH levels or the filesystem root is reached. */
function findUpDir(start: string, match: (dir: string) => boolean): string | null {
  let dir = resolve(start)
  for (let i = 0; i < VCS_UPWARD_SEARCH_MAX_DEPTH; i++) {
    try {
      if (match(dir)) return dir
    } catch {
      // ignore transient stat errors and keep climbing
    }
    const parent = dirname(dir)
    if (parent === dir) break // reached the filesystem root
    dir = parent
  }
  return null
}

/** True if any directory from `start` upward contains an entry named `markerName`
 *  (a `.svn` dir, a `p4config` file, …). */
function hasMarkerUp(start: string, markerName: string): boolean {
  return findUpDir(start, (dir) => fs.existsSync(join(dir, markerName))) !== null
}

/** Perforce config filenames treated as workspace markers. The canonical one is
 *  whatever the P4CONFIG env var names (e.g. "p4config"); `p4` itself resolves it by
 *  walking up from the CWD, so we mirror that. The defaults also cover P4CONFIG being
 *  set via the Windows registry (not visible in process.env) and the legacy `.p4`. */
const P4_CONFIG_CANDIDATES = ['.p4config', 'p4config', '.p4']

function hasPerforceMarker(workspacePath: string): boolean {
  const names = new Set(P4_CONFIG_CANDIDATES)
  const envName = process.env.P4CONFIG?.trim()
  if (envName) names.add(envName)
  for (const name of names) {
    if (hasMarkerUp(workspacePath, name)) return true
  }
  return false
}

/** Every VCS whose marker is present in the working directory or an ancestor, in
 *  priority order (git > svn > perforce). Marker-based so it stays cheap (no
 *  subprocess) — fine for the sidebar diff-stat poller. p4 is detected via
 *  P4CONFIG-style config files (see hasPerforceMarker), no server round-trip.
 *
 *  - git: current dir only. Git commands walk up to find their own root, and the
 *    opened workspace is treated as the unit, so we don't search upward here.
 *  - svn: the `.svn` admin dir sits at the checkout root (SVN 1.7+), which may be a
 *    parent of the opened workspace — walk up to find it.
 *  - perforce: P4CONFIG files are resolved by walking up; see hasPerforceMarker. */
export function detectVcsTypes(workspacePath: string): VcsType[] {
  try {
    const found: VcsType[] = []
    if (fs.existsSync(join(workspacePath, '.git'))) found.push('git')
    if (hasMarkerUp(workspacePath, '.svn')) found.push('svn')
    if (hasPerforceMarker(workspacePath)) found.push('perforce')
    return found
  } catch {
    return []
  }
}

/** Primary VCS for a directory (first by priority), or 'none'. */
export function detectVcsType(workspacePath: string): VcsType {
  return detectVcsTypes(workspacePath)[0] || 'none'
}

/** Normalize an absolute or depot path to a workspace-relative posix path. */
function toRelativePath(workspacePath: string, target: string): string {
  if (target.startsWith('//')) return target.replace(/\\/g, '/') // p4 depot path
  try {
    const rel = relative(resolve(workspacePath), resolve(target))
    return rel && !rel.startsWith('..') ? rel.replace(/\\/g, '/') : target.replace(/\\/g, '/')
  } catch {
    return target.replace(/\\/g, '/')
  }
}

// ── Perforce ──

function runP4(workspacePath: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('p4', args, { cwd: workspacePath, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
      } else {
        resolvePromise(stdout)
      }
    })
  })
}

/** Files open in perforce (the p4 notion of "changed"). Depot paths are mapped to
 *  workspace-relative local paths via `p4 where` (best-effort, falls back to depot).
 *  Best-effort: p4 support can't be exercised without a live server. */
async function getP4ChangedFiles(workspacePath: string): Promise<ChangedFile[]> {
  try {
    const opened = await runP4(workspacePath, ['opened'])
    const files: ChangedFile[] = []
    for (const line of opened.split('\n')) {
      const m = line.match(/^(.+?)#\d+\s*-\s*(\w+)/)
      if (!m) continue
      const depot = m[1]
      const action = m[2].toLowerCase()
      let local = depot
      try {
        const where = await runP4(workspacePath, ['where', depot])
        const parts = where.trim().split(/\s+/)
        if (parts.length >= 3) local = parts[parts.length - 1]
      } catch { /* fall back to depot path */ }
      const status =
        action === 'add' || action === 'branch' || action === 'integrate' ? 'A'
        : action === 'delete' ? 'D'
        : 'M'
      files.push({ path: toRelativePath(workspacePath, local), status, staged: true, additions: 0, deletions: 0 })
    }
    return files
  } catch {
    return []
  }
}

/** Sum of added/deleted lines across open files (best-effort, from `p4 diff -ds`).
 *  p4 prints one summary line per kind: `add <blocks> <lines>`,
 *  `deleted <blocks> <lines>`, `changed <blocks> <lines>`. */
async function getP4DiffStat(workspacePath: string): Promise<DiffStat> {
  try {
    const output = await runP4(workspacePath, ['diff', '-ds'])
    let additions = 0
    let deletions = 0
    for (const line of output.split('\n')) {
      const m = line.match(/^(added?|deleted?)\s+\d+\s+(\d+)/i)
      if (m) {
        const lines = parseInt(m[2], 10) || 0
        if (/^delete/i.test(m[1])) deletions += lines
        else additions += lines
      }
    }
    return { additions, deletions }
  } catch {
    return { additions: 0, deletions: 0 }
  }
}

async function p4Exec(workspacePath: string, args: string[]): Promise<VcsExecResult> {
  try {
    const output = await runP4(workspacePath, args)
    return { success: true, output: output.trim() }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

function parseSvnStatus(output: string): ChangedFile[] {
  const files: ChangedFile[] = []
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const statusColumns = line.slice(0, 7)
    const status = statusColumns.split('').find((char) => char !== ' ') || 'M'
    const rawPath = line.length > 8 ? line.substring(8).trim() : line.substring(1).trim()
    if (!rawPath || status === 'X') continue
    files.push({
      path: rawPath.replace(/\\/g, '/'),
      status: status === '?' ? '??' : status,
      staged: status === 'A' || status === 'D',
      additions: 0,
      deletions: 0
    })
  }
  return files
}

function parseSvnDiffStats(output: string): { total: DiffStat; byPath: Record<string, DiffStat> } {
  const byPath: Record<string, DiffStat> = {}
  let currentPath = ''
  let totalAdditions = 0
  let totalDeletions = 0

  const ensureCurrent = (): DiffStat | null => {
    if (!currentPath) return null
    if (!byPath[currentPath]) byPath[currentPath] = { additions: 0, deletions: 0 }
    return byPath[currentPath]
  }

  for (const line of output.split('\n')) {
    if (line.startsWith('Index: ')) {
      currentPath = line.slice('Index: '.length).trim().replace(/\\/g, '/')
      continue
    }
    if (line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('@@')) continue
    if (line.startsWith('+')) {
      const stat = ensureCurrent()
      if (stat) stat.additions += 1
      totalAdditions += 1
    } else if (line.startsWith('-')) {
      const stat = ensureCurrent()
      if (stat) stat.deletions += 1
      totalDeletions += 1
    }
  }

  return { total: { additions: totalAdditions, deletions: totalDeletions }, byPath }
}

async function getSvnChangedFiles(workspacePath: string): Promise<ChangedFile[]> {
  try {
    const [statusOutput, diffOutput] = await Promise.all([
      runSvn(workspacePath, ['status']),
      runSvn(workspacePath, ['diff']).catch(() => '')
    ])
    const files = parseSvnStatus(statusOutput)
    const stats = parseSvnDiffStats(diffOutput)
    for (const file of files) {
      const stat = stats.byPath[file.path]
      if (stat) {
        file.additions = stat.additions
        file.deletions = stat.deletions
      }
    }
    return files
  } catch {
    return []
  }
}

async function getSvnDiffStat(workspacePath: string): Promise<DiffStat> {
  try {
    const diffOutput = await runSvn(workspacePath, ['diff'])
    return parseSvnDiffStats(diffOutput).total
  } catch {
    return { additions: 0, deletions: 0 }
  }
}

async function svnExec(workspacePath: string, args: string[]): Promise<VcsExecResult> {
  try {
    const output = await runSvn(workspacePath, args)
    return { success: true, output: output.trim() }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

function resolveWorkspaceChild(workspacePath: string, filePath: string): string | null {
  const workspaceRoot = resolve(workspacePath)
  const target = resolve(workspaceRoot, filePath)
  const rel = relative(workspaceRoot, target)
  if (rel.startsWith('..') || rel === '' || fs.statSync(workspaceRoot).isFile()) return null
  return target
}

async function prepareSvnCommit(workspacePath: string): Promise<VcsExecResult> {
  const addResult = await svnExec(workspacePath, ['add', '--force', '.', '--auto-props', '--parents', '--depth', 'infinity', '-q'])
  if (!addResult.success) return addResult

  const files = await getSvnChangedFiles(workspacePath)
  for (const file of files) {
    if (file.status !== '!') continue
    const result = await svnExec(workspacePath, ['delete', '--force', file.path])
    if (!result.success) return result
  }
  return { success: true }
}

// ── Unified diff for one path (file or directory) ──

/** Whole-response budget; beyond this the diff is cut and flagged truncated. */
const MAX_DIFF_BYTES = 3 * 1024 * 1024
/** Per-file budget when synthesizing a diff for an added/untracked file. */
const MAX_NEW_FILE_BYTES = 512 * 1024
/** Cap on untracked files walked when the target is a directory. */
const MAX_NEW_FILES = 200
/** Bytes sniffed for a NUL byte when classifying a file as binary. */
const BINARY_SNIFF_BYTES = 8192
/** Context lines requested for a single-file diff, so the viewer receives the
 *  whole file and can collapse the unchanged runs itself (GitHub-style). Kept
 *  off for directory targets, where whole-file context across a subtree would
 *  blow the response budget and truncate later files. */
const FULL_CONTEXT_LINES = 100000

/** Raw stdout of a diff command. Unlike the helpers above this keeps the output
 *  untrimmed (diffs are whitespace-significant) and raises the buffer ceiling,
 *  since a subtree diff easily exceeds execFile's 1 MB default. */
function runDiffCommand(command: string, workspacePath: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      args,
      { cwd: workspacePath, timeout: 30000, maxBuffer: MAX_DIFF_BYTES * 2 },
      (error, stdout, stderr) => {
        // `git diff --no-index` and friends exit non-zero when differences exist;
        // treat any run that produced output as a success.
        if (error && !stdout) reject(new Error(stderr || error.message))
        else resolvePromise(stdout)
      }
    )
  })
}

function isBinaryBuffer(buf: Buffer): boolean {
  const end = Math.min(buf.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < end; i++) if (buf[i] === 0) return true
  return false
}

/** Unified diff for a file that has no counterpart in the repository (untracked
 *  / newly added): every line shows up as an addition. Binary and oversized
 *  files get a marker line the renderer turns into a "not viewable" notice. */
function synthesizeNewFileDiff(workspacePath: string, relPath: string): string {
  const header = `diff --git a/${relPath} b/${relPath}\nnew file mode 100644\n`
  let stat: fs.Stats
  try {
    stat = fs.statSync(join(workspacePath, relPath))
  } catch {
    return ''
  }
  if (stat.size > MAX_NEW_FILE_BYTES) {
    return `${header}Cannot display: file too large.\n`
  }
  let buf: Buffer
  try {
    buf = fs.readFileSync(join(workspacePath, relPath))
  } catch {
    return ''
  }
  if (isBinaryBuffer(buf)) {
    return `${header}Binary files /dev/null and b/${relPath} differ\n`
  }
  const text = buf.toString('utf8')
  if (text === '') return `${header}--- /dev/null\n+++ b/${relPath}\n`
  const lines = text.split('\n')
  const hadTrailingNewline = lines[lines.length - 1] === ''
  if (hadTrailingNewline) lines.pop()
  const body = lines.map((l) => `+${l}`).join('\n')
  return (
    `${header}--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1,${lines.length} @@\n${body}\n` +
    (hadTrailingNewline ? '' : '\\ No newline at end of file\n')
  )
}

/** Untracked files under `relPath` (itself a file or a directory), workspace-relative. */
function collectNewFiles(workspacePath: string, relPath: string, budget: { left: number }): string[] {
  const abs = join(workspacePath, relPath)
  let stat: fs.Stats
  try {
    stat = fs.statSync(abs)
  } catch {
    return []
  }
  if (stat.isFile()) return budget.left-- > 0 ? [relPath] : []
  if (!stat.isDirectory()) return []
  const out: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    if (budget.left <= 0) break
    if (entry.name === '.git' || entry.name === '.svn' || entry.name === 'node_modules') continue
    out.push(...collectNewFiles(workspacePath, `${relPath}/${entry.name}`, budget))
  }
  return out
}

function newFilesDiff(workspacePath: string, relPath: string): string {
  const budget = { left: MAX_NEW_FILES }
  return collectNewFiles(workspacePath, relPath, budget)
    .map((p) => synthesizeNewFileDiff(workspacePath, p))
    .join('')
}

function isDirectoryTarget(workspacePath: string, relPath: string): boolean {
  try {
    return fs.statSync(join(workspacePath, relPath)).isDirectory()
  } catch {
    return false
  }
}

async function getGitPathDiff(workspacePath: string, relPath: string, fullContext: boolean): Promise<string> {
  // `diff HEAD` covers staged and unstaged in one pass; a repository without any
  // commit yet has no HEAD, so fall back to the index-only diff there.
  const ctx = fullContext ? [`-U${FULL_CONTEXT_LINES}`] : []
  let tracked = ''
  try {
    tracked = await runDiffCommand('git', workspacePath, ['diff', ...ctx, 'HEAD', '--', relPath])
  } catch {
    tracked = await runDiffCommand('git', workspacePath, ['diff', ...ctx, '--cached', '--', relPath]).catch(() => '')
  }
  let untracked = ''
  try {
    const listed = await runDiffCommand('git', workspacePath, [
      'ls-files', '--others', '--exclude-standard', '-z', '--', relPath
    ])
    untracked = listed
      .split('\0')
      .filter(Boolean)
      .slice(0, MAX_NEW_FILES)
      .map((p) => synthesizeNewFileDiff(workspacePath, p))
      .join('')
  } catch {
    /* untracked enumeration is best-effort */
  }
  return tracked + untracked
}

async function getSvnPathDiff(workspacePath: string, relPath: string, fullContext: boolean): Promise<string> {
  // `svn diff` only covers versioned paths, so unversioned entries under the
  // target (reported as "?" by `svn status`) are synthesized as added files.
  // `-x -U<n>` is handed to svn's internal diff; older/external diff backends may
  // reject it, so an empty result falls back to the default context.
  const svnDiff = async (): Promise<string> => {
    if (fullContext) {
      const full = await runDiffCommand('svn', workspacePath, [
        'diff', '-x', `-U ${FULL_CONTEXT_LINES}`, relPath
      ]).catch(() => '')
      if (full) return full
    }
    return runDiffCommand('svn', workspacePath, ['diff', relPath]).catch(() => '')
  }
  const [diff, status] = await Promise.all([
    svnDiff(),
    runDiffCommand('svn', workspacePath, ['status', relPath]).catch(() => '')
  ])
  const unversioned = status
    .split('\n')
    .filter((line) => line.startsWith('?'))
    .map((line) => line.slice(1).trim().replace(/\\/g, '/'))
    .filter(Boolean)
    .slice(0, MAX_NEW_FILES)
  return diff + unversioned.map((p) => newFilesDiff(workspacePath, p)).join('')
}

async function getP4PathDiff(workspacePath: string, relPath: string, fullContext: boolean): Promise<string> {
  const target = isDirectoryTarget(workspacePath, relPath) ? `${relPath}/...` : relPath
  if (fullContext) {
    const full = await runDiffCommand('p4', workspacePath, [
      'diff', `-du${FULL_CONTEXT_LINES}`, target
    ]).catch(() => '')
    if (full) return full
  }
  return runDiffCommand('p4', workspacePath, ['diff', '-du', target]).catch(() => '')
}

/**
 * Unified diff for a single changed path. `filePath` is workspace-relative and
 * may be a directory, in which case the diff spans the whole subtree.
 */
export async function getVcsFileDiff(
  workspacePath: string,
  filePath: string,
  vcsType?: VcsType
): Promise<VcsDiffResult> {
  const type = vcsType || detectVcsType(workspacePath)
  const relPath = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!relPath || relPath.startsWith('..') || relPath.includes('../')) {
    return { type, path: filePath, diff: '', error: 'Invalid file path' }
  }
  // A single file is diffed with whole-file context so the viewer can show the
  // full contents with unchanged runs collapsed; subtrees keep the default.
  const fullContext = !isDirectoryTarget(workspacePath, relPath)
  try {
    let diff =
      type === 'git' ? await getGitPathDiff(workspacePath, relPath, fullContext)
      : type === 'svn' ? await getSvnPathDiff(workspacePath, relPath, fullContext)
      : type === 'perforce' ? await getP4PathDiff(workspacePath, relPath, fullContext)
      : ''
    if (type === 'none') return { type, path: relPath, diff: '', error: 'No supported VCS found' }
    let truncated = false
    if (Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES) {
      diff = diff.slice(0, MAX_DIFF_BYTES)
      truncated = true
    }
    return { type, path: relPath, diff, truncated }
  } catch (err) {
    return { type, path: relPath, diff: '', error: (err as Error).message }
  }
}

export async function getVcsChangedFiles(workspacePath: string, vcsType?: VcsType): Promise<VcsStatusResult> {
  const type = vcsType || detectVcsType(workspacePath)
  if (type === 'git') return { type, files: await getGitChangedFiles(workspacePath) }
  if (type === 'svn') return { type, files: await getSvnChangedFiles(workspacePath) }
  if (type === 'perforce') return { type, files: await getP4ChangedFiles(workspacePath) }
  return { type, files: [] }
}

export async function getVcsDiffStat(workspacePath: string, vcsType?: VcsType): Promise<DiffStat & { type: VcsType }> {
  const type = vcsType || detectVcsType(workspacePath)
  if (type === 'git') return { type, ...(await getGitDiffStat(workspacePath)) }
  if (type === 'svn') return { type, ...(await getSvnDiffStat(workspacePath)) }
  if (type === 'perforce') return { type, ...(await getP4DiffStat(workspacePath)) }
  return { type, additions: 0, deletions: 0 }
}

export async function commitVcs(workspacePath: string, message: string, vcsType?: VcsType): Promise<VcsExecResult> {
  const type = vcsType || detectVcsType(workspacePath)
  if (type === 'git') {
    const addResult = await gitExec(workspacePath, ['add', '-A'])
    if (!addResult.success) return addResult
    return gitExec(workspacePath, ['commit', '-m', message])
  }
  if (type === 'svn') {
    const prepareResult = await prepareSvnCommit(workspacePath)
    if (!prepareResult.success) return prepareResult
    return svnExec(workspacePath, ['commit', '-m', message])
  }
  if (type === 'perforce') {
    // Best-effort: open any workspace/depot differences, then submit the default changelist.
    await p4Exec(workspacePath, ['reconcile', '-f', '...'])
    return p4Exec(workspacePath, ['submit', '-d', message])
  }
  return { success: false, error: 'No supported VCS found' }
}

export async function pushVcs(workspacePath: string, vcsType?: VcsType): Promise<VcsExecResult> {
  const type = vcsType || detectVcsType(workspacePath)
  if (type === 'git') return gitExec(workspacePath, ['push'])
  if (type === 'svn') return { success: false, error: 'SVN does not support push' }
  if (type === 'perforce') return { success: false, error: 'Perforce does not support push' }
  return { success: false, error: 'No supported VCS found' }
}

export async function pullVcs(workspacePath: string, vcsType?: VcsType): Promise<VcsExecResult> {
  const type = vcsType || detectVcsType(workspacePath)
  if (type === 'git') return gitExec(workspacePath, ['pull'])
  if (type === 'svn') return svnExec(workspacePath, ['update'])
  if (type === 'perforce') return p4Exec(workspacePath, ['sync'])
  return { success: false, error: 'No supported VCS found' }
}

export async function discardVcsFile(workspacePath: string, filePath: string, isUntracked: boolean, vcsType?: VcsType): Promise<VcsExecResult> {
  const type = vcsType || detectVcsType(workspacePath)
  if (type === 'git') {
    return gitExec(workspacePath, isUntracked ? ['clean', '-f', '--', filePath] : ['checkout', '--', filePath])
  }
  if (type === 'svn') {
    if (isUntracked) {
      const target = resolveWorkspaceChild(workspacePath, filePath)
      if (!target) return { success: false, error: 'Invalid file path' }
      try {
        await fs.promises.rm(target, { recursive: true, force: true })
        return { success: true }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
    return svnExec(workspacePath, ['revert', '--depth', 'infinity', filePath])
  }
  if (type === 'perforce') {
    if (isUntracked) {
      const target = resolveWorkspaceChild(workspacePath, filePath)
      if (!target) return { success: false, error: 'Invalid file path' }
      try {
        await fs.promises.rm(target, { recursive: true, force: true })
        return { success: true }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
    return p4Exec(workspacePath, ['revert', filePath])
  }
  return { success: false, error: 'No supported VCS found' }
}
