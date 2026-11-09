import {
  detectVcsType,
  runDiffCommand,
  MAX_DIFF_BYTES,
  MAX_NEW_FILE_BYTES,
  FULL_CONTEXT_LINES,
  type VcsType,
  type VcsDiffResult
} from './vcs.service'

// ── Commit history (History section of the Changes panel) ──
//
// Paging is cursor-based because the three VCS page differently: git skips by
// count, svn and p4 continue below the oldest revision already shown. The cursor
// is opaque to the renderer — it just hands back whatever `nextCursor` it got.

export interface VcsCommit {
  /** Full commit hash / svn revision / p4 changelist number. */
  id: string
  /** Short form for display (7-char hash, `r123`, `123`). */
  shortId: string
  author: string
  /** Commit time, ms since epoch (0 when unknown). */
  date: number
  /** Full commit message (subject + body), trimmed. */
  message: string
}

export interface VcsLogResult {
  type: VcsType
  commits: VcsCommit[]
  /** Pass back to fetch the next page; null when the history is exhausted. */
  nextCursor: string | null
  error?: string
}

export interface VcsCommitFile {
  /** Display path: workspace-relative when inside the workspace, else repo/depot path. */
  path: string
  /** Single-letter status: M / A / D / R / C / T. */
  status: string
  /** Pre-rename display path (git renames/copies). */
  oldPath?: string
  /** VCS-specific locator used to fetch the diff (git path, svn repo path, p4 depot path). */
  ref: string
  oldRef?: string
}

export interface VcsCommitFilesResult {
  type: VcsType
  files: VcsCommitFile[]
  error?: string
}

const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 100
/** Files listed per commit — a giant merge or import should not flood the panel. */
const MAX_COMMIT_FILES = 2000

const FIELD_SEP = '\x1f'
const RECORD_SEP = '\x1e'

function clampLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return DEFAULT_PAGE_SIZE
  return Math.min(Math.floor(limit), MAX_PAGE_SIZE)
}

function isSafeRevision(id: string): boolean {
  // Hashes, revision numbers and changelists only — never anything that could be
  // read as an option or a path.
  return /^[0-9a-fA-F]{1,64}$/.test(id)
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

/** Whole-file diff for a file that was added or deleted in a revision, built from
 *  its content at the revision where it exists. */
function synthesizeWholeFileDiff(path: string, content: string, kind: 'added' | 'deleted'): string {
  const header = `diff --git a/${path} b/${path}\n${kind === 'added' ? 'new' : 'deleted'} file mode 100644\n`
  if (Buffer.byteLength(content, 'utf8') > MAX_NEW_FILE_BYTES) return `${header}Cannot display: file too large.\n`
  if (content.slice(0, 8192).includes('\0')) {
    return kind === 'added'
      ? `${header}Binary files /dev/null and b/${path} differ\n`
      : `${header}Binary files a/${path} and /dev/null differ\n`
  }
  const from = kind === 'added' ? '/dev/null' : `a/${path}`
  const to = kind === 'added' ? `b/${path}` : '/dev/null'
  if (content === '') return `${header}--- ${from}\n+++ ${to}\n`
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const hadTrailingNewline = lines[lines.length - 1] === ''
  if (hadTrailingNewline) lines.pop()
  const sign = kind === 'added' ? '+' : '-'
  const range = kind === 'added' ? `-0,0 +1,${lines.length}` : `-1,${lines.length} +0,0`
  return (
    `${header}--- ${from}\n+++ ${to}\n@@ ${range} @@\n${lines.map((l) => `${sign}${l}`).join('\n')}\n` +
    (hadTrailingNewline ? '' : '\\ No newline at end of file\n')
  )
}

function finishDiff(type: VcsType, path: string, diff: string): VcsDiffResult {
  if (Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES) {
    return { type, path, diff: diff.slice(0, MAX_DIFF_BYTES), truncated: true }
  }
  return { type, path, diff }
}

// ── git ──

async function getGitLog(workspacePath: string, cursor: string | undefined, limit: number): Promise<VcsLogResult> {
  const skip = Math.max(0, parseInt(cursor || '0', 10) || 0)
  const format = ['%H', '%h', '%an', '%at', '%B'].join('%x1f') + '%x1e'
  let out = ''
  try {
    out = await runDiffCommand('git', workspacePath, [
      'log', `--skip=${skip}`, '-n', String(limit + 1), `--format=${format}`
    ])
  } catch (err) {
    // A repository without any commit has no HEAD — that is an empty history,
    // not an error worth surfacing.
    const msg = (err as Error).message
    if (/does not have any commits|bad default revision|unknown revision/i.test(msg)) {
      return { type: 'git', commits: [], nextCursor: null }
    }
    return { type: 'git', commits: [], nextCursor: null, error: msg }
  }
  const commits: VcsCommit[] = []
  for (const record of out.split(RECORD_SEP)) {
    const fields = record.replace(/^\s+/, '').split(FIELD_SEP)
    if (fields.length < 5 || !fields[0]) continue
    commits.push({
      id: fields[0],
      shortId: fields[1],
      author: fields[2],
      date: (parseInt(fields[3], 10) || 0) * 1000,
      message: fields.slice(4).join(FIELD_SEP).trim()
    })
  }
  const hasMore = commits.length > limit
  return {
    type: 'git',
    commits: commits.slice(0, limit),
    nextCursor: hasMore ? String(skip + limit) : null
  }
}

/** First parent of a commit, or null for a root commit. */
async function getGitFirstParent(workspacePath: string, id: string): Promise<string | null> {
  const out = await runDiffCommand('git', workspacePath, ['rev-list', '--parents', '-n', '1', id])
  const parts = out.trim().split(/\s+/)
  return parts[1] || null
}

async function getGitCommitFiles(workspacePath: string, id: string): Promise<VcsCommitFile[]> {
  const parent = await getGitFirstParent(workspacePath, id)
  // Merges are shown against their first parent (what the branch gained);
  // `-z` keeps CJK / spaced paths verbatim instead of octal-quoted.
  const args = parent
    ? ['diff', '--name-status', '-M', '-z', parent, id]
    : ['diff-tree', '--root', '-r', '--no-commit-id', '--name-status', '-M', '-z', id]
  const out = await runDiffCommand('git', workspacePath, args)
  const tokens = out.split('\0')
  const files: VcsCommitFile[] = []
  for (let i = 0; i < tokens.length && files.length < MAX_COMMIT_FILES; ) {
    const code = tokens[i++]
    if (!code) continue
    const letter = code[0].toUpperCase()
    if (letter === 'R' || letter === 'C') {
      const oldPath = tokens[i++]
      const path = tokens[i++]
      if (!path) break
      files.push({ path, status: letter, oldPath, ref: path, oldRef: oldPath })
    } else {
      const path = tokens[i++]
      if (!path) break
      files.push({ path, status: letter, ref: path })
    }
  }
  return files
}

async function getGitCommitFileDiff(workspacePath: string, id: string, file: VcsCommitFile): Promise<string> {
  const parent = await getGitFirstParent(workspacePath, id)
  const paths = file.oldRef && file.oldRef !== file.ref ? [file.oldRef, file.ref] : [file.ref]
  const ctx = `-U${FULL_CONTEXT_LINES}`
  const args = parent
    ? ['diff', '-M', ctx, parent, id, '--', ...paths]
    : ['diff-tree', '-p', '--root', '--no-commit-id', '-M', ctx, id, '--', ...paths]
  return runDiffCommand('git', workspacePath, args)
}

// ── svn ──

interface SvnLogEntry {
  revision: string
  author: string
  date: string
  msg: string
  paths: { action: string; kind: string; path: string }[]
}

function parseSvnLogXml(xml: string): SvnLogEntry[] {
  const entries: SvnLogEntry[] = []
  const entryRe = /<logentry\s+revision="(\d+)"\s*>([\s\S]*?)<\/logentry>/g
  let m: RegExpExecArray | null
  while ((m = entryRe.exec(xml))) {
    const body = m[2]
    const pick = (tag: string): string => {
      const r = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)
      return r ? decodeXml(r[1]) : ''
    }
    const paths: SvnLogEntry['paths'] = []
    const pathRe = /<path\b([^>]*)>([\s\S]*?)<\/path>/g
    let p: RegExpExecArray | null
    while ((p = pathRe.exec(body))) {
      const attrs = p[1]
      const action = /action="(\w)"/.exec(attrs)?.[1] || 'M'
      const kind = /kind="(\w*)"/.exec(attrs)?.[1] || ''
      paths.push({ action, kind, path: decodeXml(p[2]) })
    }
    entries.push({ revision: m[1], author: pick('author'), date: pick('date'), msg: pick('msg'), paths })
  }
  return entries
}

async function getSvnLog(workspacePath: string, cursor: string | undefined, limit: number): Promise<VcsLogResult> {
  const run = (from: string): Promise<string> =>
    runDiffCommand('svn', workspacePath, ['log', '--xml', '-l', String(limit + 1), '-r', `${from}:1`, '.'])
  let xml: string
  try {
    if (cursor && /^\d+$/.test(cursor)) {
      xml = await run(cursor)
    } else {
      // HEAD shows commits the working copy has not been updated to yet; it fails
      // when the path no longer exists at HEAD, so fall back to BASE.
      xml = await run('HEAD').catch(() => run('BASE'))
    }
  } catch (err) {
    return { type: 'svn', commits: [], nextCursor: null, error: (err as Error).message }
  }
  const entries = parseSvnLogXml(xml)
  const commits: VcsCommit[] = entries.slice(0, limit).map((e) => ({
    id: e.revision,
    shortId: `r${e.revision}`,
    author: e.author,
    date: Date.parse(e.date) || 0,
    message: e.msg.trim()
  }))
  const last = commits[commits.length - 1]
  const nextRev = last ? parseInt(last.id, 10) - 1 : 0
  return {
    type: 'svn',
    commits,
    nextCursor: entries.length > limit && nextRev > 0 ? String(nextRev) : null
  }
}

/** Repository path of the workspace (e.g. `/trunk/sub`), used to turn the repo
 *  paths in `svn log -v` into workspace-relative ones. */
async function getSvnWorkspaceRepoPath(workspacePath: string): Promise<string> {
  try {
    const info = await runDiffCommand('svn', workspacePath, ['info', '.'])
    const rel = /^Relative URL:\s*\^(.*)$/m.exec(info)?.[1]?.trim()
    if (rel !== undefined) return decodeURIComponent(rel).replace(/\/+$/, '')
    const url = /^URL:\s*(.+)$/m.exec(info)?.[1]?.trim()
    const root = /^Repository Root:\s*(.+)$/m.exec(info)?.[1]?.trim()
    if (url && root && url.startsWith(root)) return decodeURIComponent(url.slice(root.length)).replace(/\/+$/, '')
  } catch {
    /* fall through — paths stay repo-absolute */
  }
  return ''
}

function svnDisplayPath(repoPath: string, wsRepoPath: string): string {
  if (wsRepoPath && repoPath.startsWith(`${wsRepoPath}/`)) return repoPath.slice(wsRepoPath.length + 1)
  if (!wsRepoPath) return repoPath.replace(/^\/+/, '')
  return repoPath
}

async function getSvnCommitFiles(workspacePath: string, id: string): Promise<VcsCommitFile[]> {
  const [xml, wsRepoPath] = await Promise.all([
    runDiffCommand('svn', workspacePath, ['log', '--xml', '-v', '-r', id, '.']),
    getSvnWorkspaceRepoPath(workspacePath)
  ])
  const entry = parseSvnLogXml(xml)[0]
  if (!entry) return []
  return entry.paths
    .filter((p) => p.kind !== 'dir')
    .slice(0, MAX_COMMIT_FILES)
    .map((p) => ({
      path: svnDisplayPath(p.path, wsRepoPath),
      // `R` in svn means "replaced", not renamed — closest UI meaning is modified.
      status: p.action === 'R' ? 'M' : p.action,
      ref: p.path
    }))
}

async function getSvnCommitFileDiff(workspacePath: string, id: string, file: VcsCommitFile): Promise<string> {
  const rev = parseInt(id, 10)
  // Explicit peg revisions: they pin the path to where it lived at that revision,
  // and keep names containing `@` from being misread as a peg.
  if (file.status === 'D') {
    const content = await runDiffCommand('svn', workspacePath, ['cat', `^${file.ref}@${rev - 1}`])
    return synthesizeWholeFileDiff(file.path, content, 'deleted')
  }
  const target = `^${file.ref}@${rev}`
  const full = await runDiffCommand('svn', workspacePath, [
    'diff', '-c', String(rev), '-x', `-U ${FULL_CONTEXT_LINES}`, target
  ]).catch(() => '')
  if (full) return full
  return runDiffCommand('svn', workspacePath, ['diff', '-c', String(rev), target])
}

// ── perforce (best-effort, like the rest of the p4 support) ──

async function getP4Log(workspacePath: string, cursor: string | undefined, limit: number): Promise<VcsLogResult> {
  const range = cursor && /^\d+$/.test(cursor) ? `...@1,@${cursor}` : '...'
  let out: string
  try {
    out = await runDiffCommand('p4', workspacePath, [
      'changes', '-s', 'submitted', '-l', '-t', '-m', String(limit + 1), range
    ])
  } catch (err) {
    return { type: 'perforce', commits: [], nextCursor: null, error: (err as Error).message }
  }
  const commits: VcsCommit[] = []
  let current: VcsCommit | null = null
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const head = /^Change (\d+) on (\S+)(?: (\S+))? by ([^@\s]+)@/.exec(line)
    if (head) {
      if (current) commits.push(current)
      const date = Date.parse(`${head[2].replace(/\//g, '-')}T${head[3] || '00:00:00'}`)
      current = { id: head[1], shortId: head[1], author: head[4], date: date || 0, message: '' }
      continue
    }
    if (current && line.startsWith('\t')) current.message += `${line.slice(1)}\n`
  }
  if (current) commits.push(current)
  for (const c of commits) c.message = c.message.trim()
  const page = commits.slice(0, limit)
  const last = page[page.length - 1]
  const nextCl = last ? parseInt(last.id, 10) - 1 : 0
  return {
    type: 'perforce',
    commits: page,
    nextCursor: commits.length > limit && nextCl > 0 ? String(nextCl) : null
  }
}

const P4_ACTION_STATUS: Record<string, string> = {
  add: 'A',
  'move/add': 'A',
  branch: 'A',
  import: 'A',
  delete: 'D',
  'move/delete': 'D',
  purge: 'D',
  archive: 'D'
}

async function getP4CommitFiles(workspacePath: string, id: string): Promise<VcsCommitFile[]> {
  const [described, where] = await Promise.all([
    runDiffCommand('p4', workspacePath, ['describe', '-s', id]),
    runDiffCommand('p4', workspacePath, ['where', '...']).catch(() => '')
  ])
  // `p4 where ...` → "//depot/proj/... //client/proj/... D:\ws\proj\..."
  const depotPrefix = /^(\/\/\S*?)\.\.\.\s/m.exec(where)?.[1] || ''
  const files: VcsCommitFile[] = []
  for (const raw of described.split('\n')) {
    const m = /^\.\.\. (\/\/.+)#(\d+) ([\w/]+)/.exec(raw.replace(/\r$/, ''))
    if (!m || files.length >= MAX_COMMIT_FILES) continue
    const depotPath = m[1]
    files.push({
      path: depotPrefix && depotPath.startsWith(depotPrefix) ? depotPath.slice(depotPrefix.length) : depotPath,
      status: P4_ACTION_STATUS[m[3]] || 'M',
      ref: `${depotPath}#${m[2]}`
    })
  }
  return files
}

async function getP4CommitFileDiff(workspacePath: string, file: VcsCommitFile): Promise<string> {
  const m = /^(.+)#(\d+)$/.exec(file.ref)
  if (!m) return ''
  const depotPath = m[1]
  const rev = parseInt(m[2], 10)
  if (file.status === 'A' || rev <= 1) {
    const content = await runDiffCommand('p4', workspacePath, ['print', '-q', `${depotPath}#${rev}`])
    return synthesizeWholeFileDiff(file.path, content, 'added')
  }
  if (file.status === 'D') {
    const content = await runDiffCommand('p4', workspacePath, ['print', '-q', `${depotPath}#${rev - 1}`])
    return synthesizeWholeFileDiff(file.path, content, 'deleted')
  }
  const out = await runDiffCommand('p4', workspacePath, [
    'diff2', `-du${FULL_CONTEXT_LINES}`, `${depotPath}#${rev - 1}`, `${depotPath}#${rev}`
  ])
  // diff2 opens with a `==== a#1 (text) - a#2 (text) ====` banner and no ---/+++
  // pair; swap it for a git-style header the renderer's parser understands.
  const body = out
    .split('\n')
    .filter((l) => !l.startsWith('==== '))
    .join('\n')
  if (/^\(?binary/im.test(out) && !body.includes('@@')) {
    return `diff --git a/${file.path} b/${file.path}\nBinary files a/${file.path} and b/${file.path} differ\n`
  }
  return `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n${body}`
}

// ── public ──

export async function getVcsLog(
  workspacePath: string,
  vcsType?: VcsType,
  cursor?: string,
  limit?: number
): Promise<VcsLogResult> {
  const type = vcsType || detectVcsType(workspacePath)
  const size = clampLimit(limit)
  if (type === 'git') return getGitLog(workspacePath, cursor, size)
  if (type === 'svn') return getSvnLog(workspacePath, cursor, size)
  if (type === 'perforce') return getP4Log(workspacePath, cursor, size)
  return { type, commits: [], nextCursor: null }
}

export async function getVcsCommitFiles(
  workspacePath: string,
  commitId: string,
  vcsType?: VcsType
): Promise<VcsCommitFilesResult> {
  const type = vcsType || detectVcsType(workspacePath)
  if (!isSafeRevision(commitId)) return { type, files: [], error: 'Invalid revision' }
  try {
    if (type === 'git') return { type, files: await getGitCommitFiles(workspacePath, commitId) }
    if (type === 'svn') return { type, files: await getSvnCommitFiles(workspacePath, commitId) }
    if (type === 'perforce') return { type, files: await getP4CommitFiles(workspacePath, commitId) }
    return { type, files: [], error: 'No supported VCS found' }
  } catch (err) {
    return { type, files: [], error: (err as Error).message }
  }
}

/** Unified diff of one file as changed by one commit — drives the diff viewer
 *  opened from the History section. */
export async function getVcsCommitFileDiff(
  workspacePath: string,
  commitId: string,
  file: VcsCommitFile,
  vcsType?: VcsType
): Promise<VcsDiffResult> {
  const type = vcsType || detectVcsType(workspacePath)
  if (!isSafeRevision(commitId)) return { type, path: file?.path || '', diff: '', error: 'Invalid revision' }
  // Refs come back from getVcsCommitFiles; still refuse anything option-like.
  if (!file?.ref || file.ref.startsWith('-') || file.oldRef?.startsWith('-')) {
    return { type, path: file?.path || '', diff: '', error: 'Invalid file path' }
  }
  try {
    const diff =
      type === 'git' ? await getGitCommitFileDiff(workspacePath, commitId, file)
      : type === 'svn' ? await getSvnCommitFileDiff(workspacePath, commitId, file)
      : type === 'perforce' ? await getP4CommitFileDiff(workspacePath, file)
      : null
    if (diff === null) return { type, path: file.path, diff: '', error: 'No supported VCS found' }
    return finishDiff(type, file.path, diff)
  } catch (err) {
    return { type, path: file.path, diff: '', error: (err as Error).message }
  }
}
