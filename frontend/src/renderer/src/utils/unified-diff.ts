/**
 * Minimal unified-diff parser for the Changes panel diff viewer.
 *
 * Handles the flavours the VCS service produces: `git diff` (including the
 * synthesized "new file" diffs for untracked files), `svn diff` and `p4 diff -du`.
 * Written by hand rather than pulled from a diff library — the grammar we need is
 * a few line prefixes, and the viewer only has to render, not to apply, patches.
 */

export type DiffLineType = 'context' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  /** Line content without the +/-/space prefix. */
  content: string
  oldNumber?: number
  newNumber?: number
  /** True when the source file has no trailing newline at this line. */
  noNewline?: boolean
}

export interface DiffHunk {
  header: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

/** Why a file cannot be rendered as text. */
export type DiffUnviewableReason = 'binary' | 'too-large' | 'property-only' | 'no-text-changes'

export interface DiffFile {
  /** Path shown in the UI (the post-change path when it exists). */
  path: string
  oldPath?: string
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  hunks: DiffHunk[]
  additions: number
  deletions: number
  /** Set when there is nothing text-diffable to show (binary, props only, …). */
  unviewable?: DiffUnviewableReason
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
const GIT_HEADER_RE = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/
const SVN_HEADER_RE = /^Index: (.+)$/

function createFile(path: string): DiffFile {
  return { path, status: 'modified', hunks: [], additions: 0, deletions: 0 }
}

function stripQuotes(p: string): string {
  return p.replace(/^"(.*)"$/, '$1')
}

function normalizePath(raw: string): string {
  // `--- a/foo.ts` / `+++ b/foo.ts`, plus the trailing tab-separated revision
  // info svn appends (`foo.ts\t(revision 12)`).
  const withoutRevision = raw.split('\t')[0].trim()
  const unquoted = stripQuotes(withoutRevision)
  if (unquoted === '/dev/null') return ''
  return unquoted.replace(/^[ab]\//, '')
}

/** Parse a unified diff that may describe several files. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  if (!text) return []
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0
  let sawPropertyChange = false
  let sawDevNullSource = false
  let sawDevNullTarget = false

  const finishFile = (): void => {
    if (!file) return
    if (!file.unviewable && file.hunks.length === 0) {
      file.unviewable = sawPropertyChange ? 'property-only' : 'no-text-changes'
    }
    files.push(file)
  }

  const startFile = (path: string): DiffFile => {
    finishFile()
    file = createFile(path)
    hunk = null
    sawPropertyChange = false
    sawDevNullSource = false
    sawDevNullTarget = false
    return file
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '')

    const gitHeader = GIT_HEADER_RE.exec(line)
    if (gitHeader) {
      file = startFile(stripQuotes(gitHeader[2] || gitHeader[1]))
      continue
    }
    const svnHeader = SVN_HEADER_RE.exec(line)
    if (svnHeader && !hunk) {
      file = startFile(svnHeader[1].trim())
      continue
    }

    if (!file) {
      // Diff bodies without any header (e.g. bare `p4 diff` output) still start
      // with ---/+++ pairs; open an anonymous file so they are not dropped.
      if (line.startsWith('--- ') || line.startsWith('+++ ')) file = startFile('')
      else continue
    }
    const current: DiffFile = file

    if (line.startsWith('Property changes on:')) {
      sawPropertyChange = true
      hunk = null
      continue
    }
    if (
      /^Binary files .* differ$/.test(line) ||
      line.startsWith('GIT binary patch') ||
      line.startsWith('Cannot display: file marked as a binary type')
    ) {
      current.unviewable = 'binary'
      continue
    }
    if (line.startsWith('Cannot display: file too large')) {
      current.unviewable = 'too-large'
      continue
    }
    if (line.startsWith('new file mode') || line.startsWith('new mode 100')) {
      current.status = 'added'
      continue
    }
    if (line.startsWith('deleted file mode')) {
      current.status = 'deleted'
      continue
    }
    if (line.startsWith('rename from ')) {
      current.status = 'renamed'
      current.oldPath = line.slice('rename from '.length).trim()
      continue
    }
    if (line.startsWith('rename to ')) {
      current.status = 'renamed'
      current.path = line.slice('rename to '.length).trim()
      continue
    }
    if (line.startsWith('--- ')) {
      const p = normalizePath(line.slice(4))
      sawDevNullSource = p === ''
      if (p) current.oldPath = p
      hunk = null
      continue
    }
    if (line.startsWith('+++ ')) {
      const p = normalizePath(line.slice(4))
      sawDevNullTarget = p === ''
      if (p && !current.path) current.path = p
      if (sawDevNullSource) current.status = 'added'
      else if (sawDevNullTarget) current.status = 'deleted'
      if (!current.path && current.oldPath) current.path = current.oldPath
      hunk = null
      continue
    }

    const hunkMatch = HUNK_RE.exec(line)
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10) || 1
      newLine = parseInt(hunkMatch[2], 10) || 1
      hunk = { header: line, oldStart: oldLine, newStart: newLine, lines: [] }
      current.hunks.push(hunk)
      continue
    }

    if (!hunk) continue

    if (line.startsWith('\\')) {
      const last = hunk.lines[hunk.lines.length - 1]
      if (last) last.noNewline = true
      continue
    }
    if (line.startsWith('+')) {
      hunk.lines.push({ type: 'add', content: line.slice(1), newNumber: newLine++ })
      current.additions++
    } else if (line.startsWith('-')) {
      hunk.lines.push({ type: 'del', content: line.slice(1), oldNumber: oldLine++ })
      current.deletions++
    } else if (line.startsWith(' ') || line === '') {
      // A fully blank context line arrives without its leading space in some
      // outputs; treat it as context so numbering stays aligned.
      hunk.lines.push({
        type: 'context',
        content: line.slice(1),
        oldNumber: oldLine++,
        newNumber: newLine++
      })
    }
    // Anything else (trailing "no changes" notices, svn separators) is ignored.
  }

  finishFile()
  return files.filter((f) => f.path || f.hunks.length > 0)
}

export interface SideBySideRow {
  left?: DiffLine
  right?: DiffLine
}

/**
 * Pair a hunk's lines into two columns: a run of deletions is matched
 * one-to-one with the additions that immediately follow it, so a modified line
 * shows old and new side by side; leftovers get an empty cell.
 */
export function buildSideBySideRows(lines: DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type === 'context') {
      rows.push({ left: line, right: line })
      i++
      continue
    }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].type === 'del') dels.push(lines[i++])
    while (i < lines.length && lines[i].type === 'add') adds.push(lines[i++])
    if (dels.length === 0 && adds.length === 0) {
      i++
      continue
    }
    const pairs = Math.max(dels.length, adds.length)
    for (let p = 0; p < pairs; p++) rows.push({ left: dels[p], right: adds[p] })
  }
  return rows
}

/** A run of consecutive rows/lines; `collapsed` runs are hidden until expanded. */
export interface CollapsibleSegment<T> {
  collapsed: boolean
  items: T[]
}

export interface CollapseOptions {
  /** Unchanged rows kept visible on each side of a collapsed run. */
  contextLines?: number
  /** Shortest run worth hiding — below this, collapsing only adds noise. */
  minCollapsed?: number
}

/**
 * Split a hunk's rows into visible and collapsible runs, GitHub-style: changed
 * rows and the few unchanged rows around them stay visible, longer unchanged
 * runs become one foldable segment. Runs at the very start/end of the file keep
 * no context on the outer side, so a whole-file diff opens on its changes.
 */
export function buildCollapsibleSegments<T>(
  items: T[],
  isContext: (item: T) => boolean,
  options: CollapseOptions = {}
): CollapsibleSegment<T>[] {
  const contextLines = options.contextLines ?? 4
  const minCollapsed = options.minCollapsed ?? 6
  const segments: CollapsibleSegment<T>[] = []

  const pushVisible = (chunk: T[]): void => {
    if (chunk.length === 0) return
    const last = segments[segments.length - 1]
    if (last && !last.collapsed) last.items.push(...chunk)
    else segments.push({ collapsed: false, items: chunk })
  }

  let i = 0
  while (i < items.length) {
    if (!isContext(items[i])) {
      let j = i
      while (j < items.length && !isContext(items[j])) j++
      pushVisible(items.slice(i, j))
      i = j
      continue
    }
    let j = i
    while (j < items.length && isContext(items[j])) j++
    const run = items.slice(i, j)
    const lead = i === 0 ? 0 : contextLines
    const tail = j === items.length ? 0 : contextLines
    if (run.length - lead - tail < minCollapsed) {
      pushVisible(run)
    } else {
      pushVisible(run.slice(0, lead))
      segments.push({ collapsed: true, items: run.slice(lead, run.length - tail) })
      pushVisible(run.slice(run.length - tail))
    }
    i = j
  }
  return segments
}

/** Total +/- across every parsed file. */
export function sumDiffStat(files: DiffFile[]): { additions: number; deletions: number } {
  return files.reduce(
    (acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
    { additions: 0, deletions: 0 }
  )
}
