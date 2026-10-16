import { describe, it, expect } from 'vitest'
import {
  parseUnifiedDiff,
  buildCollapsibleSegments,
  buildSideBySideRows,
  sumDiffStat
} from '../unified-diff'

describe('parseUnifiedDiff', () => {
  it('parses a git modification with line numbers', () => {
    const files = parseUnifiedDiff(
      [
        'diff --git a/src/app.ts b/src/app.ts',
        'index 1234567..89abcde 100644',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '@@ -10,4 +10,5 @@ function main() {',
        ' const a = 1',
        '-const b = 2',
        '+const b = 3',
        '+const c = 4',
        ' return a',
        ''
      ].join('\n')
    )
    expect(files).toHaveLength(1)
    const [file] = files
    expect(file.path).toBe('src/app.ts')
    expect(file.status).toBe('modified')
    expect(file.additions).toBe(2)
    expect(file.deletions).toBe(1)
    expect(file.unviewable).toBeUndefined()
    const lines = file.hunks[0].lines
    expect(lines[0]).toMatchObject({ type: 'context', oldNumber: 10, newNumber: 10 })
    expect(lines[1]).toMatchObject({ type: 'del', content: 'const b = 2', oldNumber: 11 })
    expect(lines[2]).toMatchObject({ type: 'add', content: 'const b = 3', newNumber: 11 })
    expect(lines[4]).toMatchObject({ type: 'context', oldNumber: 12, newNumber: 13 })
  })

  it('parses several files in one diff', () => {
    const files = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1 +1 @@',
        '-one',
        '+ONE',
        'diff --git a/b.txt b/b.txt',
        '--- a/b.txt',
        '+++ b/b.txt',
        '@@ -1 +1 @@',
        '-two',
        '+TWO'
      ].join('\n')
    )
    expect(files.map((f) => f.path)).toEqual(['a.txt', 'b.txt'])
    expect(sumDiffStat(files)).toEqual({ additions: 2, deletions: 2 })
  })

  it('marks added and deleted files from /dev/null sides', () => {
    const added = parseUnifiedDiff(
      ['diff --git a/n.txt b/n.txt', 'new file mode 100644', '--- /dev/null', '+++ b/n.txt', '@@ -0,0 +1,1 @@', '+hello'].join('\n')
    )
    expect(added[0]).toMatchObject({ status: 'added', path: 'n.txt', additions: 1 })

    const removed = parseUnifiedDiff(
      ['diff --git a/old.txt b/old.txt', 'deleted file mode 100644', '--- a/old.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-gone'].join('\n')
    )
    expect(removed[0]).toMatchObject({ status: 'deleted', deletions: 1 })
  })

  it('flags binary and oversized files as unviewable', () => {
    const binary = parseUnifiedDiff(
      ['diff --git a/logo.png b/logo.png', 'Binary files a/logo.png and b/logo.png differ'].join('\n')
    )
    expect(binary[0].unviewable).toBe('binary')

    const svnBinary = parseUnifiedDiff(
      ['Index: logo.png', '===================================================================', 'Cannot display: file marked as a binary type.'].join('\n')
    )
    expect(svnBinary[0]).toMatchObject({ path: 'logo.png', unviewable: 'binary' })

    const huge = parseUnifiedDiff(
      ['diff --git a/dump.sql b/dump.sql', 'new file mode 100644', 'Cannot display: file too large.'].join('\n')
    )
    expect(huge[0].unviewable).toBe('too-large')
  })

  it('flags svn property-only changes', () => {
    const files = parseUnifiedDiff(
      [
        'Index: script.sh',
        '===================================================================',
        'Property changes on: script.sh',
        '___________________________________________________________________',
        'Added: svn:executable',
        '## -0,0 +1 ##',
        '+*'
      ].join('\n')
    )
    expect(files[0]).toMatchObject({ path: 'script.sh', unviewable: 'property-only' })
  })

  it('handles svn paths with revision suffixes and no-newline markers', () => {
    const files = parseUnifiedDiff(
      [
        'Index: src/x.ts',
        '===================================================================',
        '--- src/x.ts\t(revision 42)',
        '+++ src/x.ts\t(working copy)',
        '@@ -1 +1 @@',
        '-a',
        '+b',
        '\\ No newline at end of file'
      ].join('\n')
    )
    expect(files[0].path).toBe('src/x.ts')
    const lines = files[0].hunks[0].lines
    expect(lines[lines.length - 1].noNewline).toBe(true)
  })

  it('returns nothing for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })
})

describe('buildSideBySideRows', () => {
  it('pairs deletions with the additions that follow', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1,3 +1,4 @@',
        ' keep',
        '-old1',
        '-old2',
        '+new1',
        '+new2',
        '+new3'
      ].join('\n')
    )
    const rows = buildSideBySideRows(file.hunks[0].lines)
    expect(rows).toHaveLength(4)
    expect(rows[0].left?.content).toBe('keep')
    expect(rows[0].right?.content).toBe('keep')
    expect(rows[1].left?.content).toBe('old1')
    expect(rows[1].right?.content).toBe('new1')
    expect(rows[3].left).toBeUndefined()
    expect(rows[3].right?.content).toBe('new3')
  })
})

describe('buildCollapsibleSegments', () => {
  const ctx = (n: number): string[] => Array.from({ length: n }, (_, i) => `c${i}`)
  const isCtx = (s: string): boolean => s.startsWith('c')

  it('keeps short unchanged runs visible', () => {
    const items = [...ctx(3), 'x', ...ctx(3)]
    const segments = buildCollapsibleSegments(items, isCtx)
    expect(segments).toHaveLength(1)
    expect(segments[0].collapsed).toBe(false)
    expect(segments[0].items).toEqual(items)
  })

  it('folds a long run in the middle, keeping context on both sides', () => {
    const items = ['x', ...ctx(30), 'y']
    const segments = buildCollapsibleSegments(items, isCtx, { contextLines: 4, minCollapsed: 6 })
    expect(segments.map((s) => s.collapsed)).toEqual([false, true, false])
    expect(segments[0].items).toEqual(['x', 'c0', 'c1', 'c2', 'c3'])
    expect(segments[1].items).toHaveLength(22)
    expect(segments[2].items).toEqual(['c26', 'c27', 'c28', 'c29', 'y'])
  })

  it('folds the leading and trailing runs of a whole-file diff completely', () => {
    const items = [...ctx(20), 'x', ...ctx(20)]
    const segments = buildCollapsibleSegments(items, isCtx, { contextLines: 4, minCollapsed: 6 })
    expect(segments.map((s) => s.collapsed)).toEqual([true, false, true])
    expect(segments[0].items).toHaveLength(16)
    expect(segments[1].items).toEqual(['c16', 'c17', 'c18', 'c19', 'x', 'c0', 'c1', 'c2', 'c3'])
    expect(segments[2].items).toHaveLength(16)
  })

  it('preserves every item exactly once', () => {
    const items = [...ctx(12), 'x', 'y', ...ctx(40), 'z', ...ctx(2)]
    const segments = buildCollapsibleSegments(items, isCtx)
    expect(segments.flatMap((s) => s.items)).toEqual(items)
  })
})
