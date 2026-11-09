import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getVcsCommitFileDiff, getVcsCommitFiles, getVcsLog } from '../vcs-history.service'

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Runs against a real throwaway git repository: the history service is a thin
 * layer over `git log` / `git diff` output parsing, which is what we want to pin.
 */
describe.skipIf(!hasGit())('vcs history (git)', () => {
  let repo = ''
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

  beforeAll(() => {
    repo = fs.mkdtempSync(join(os.tmpdir(), 'cb-vcs-history-'))
    git('init', '-q')
    git('config', 'user.name', 'Tester')
    git('config', 'user.email', 'tester@example.com')
    git('config', 'commit.gpgsign', 'false')

    fs.writeFileSync(join(repo, 'a.txt'), 'one\n')
    git('add', '.')
    git('commit', '-q', '-m', 'first commit')

    fs.writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
    fs.writeFileSync(join(repo, '中文 文件.txt'), 'hello\n')
    git('add', '.')
    git('commit', '-q', '-m', 'second\n\nwith a body')

    git('mv', 'a.txt', 'b.txt')
    git('commit', '-q', '-m', 'rename a to b')
  })

  afterAll(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true })
  })

  it('returns an empty history (no error) for a repo without commits', async () => {
    const empty = fs.mkdtempSync(join(os.tmpdir(), 'cb-vcs-empty-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: empty })
      const res = await getVcsLog(empty, 'git')
      expect(res.commits).toEqual([])
      expect(res.nextCursor).toBeNull()
      expect(res.error).toBeUndefined()
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })

  it('pages the log newest first with an opaque cursor', async () => {
    const page1 = await getVcsLog(repo, 'git', undefined, 2)
    expect(page1.commits.map((c) => c.message)).toEqual(['rename a to b', 'second\n\nwith a body'])
    expect(page1.commits[0].author).toBe('Tester')
    expect(page1.commits[0].shortId.length).toBeGreaterThanOrEqual(7)
    expect(page1.commits[0].date).toBeGreaterThan(0)
    expect(page1.nextCursor).not.toBeNull()

    const page2 = await getVcsLog(repo, 'git', page1.nextCursor!, 2)
    expect(page2.commits.map((c) => c.message)).toEqual(['first commit'])
    expect(page2.nextCursor).toBeNull()
  })

  it('lists files of a commit incl. renames, CJK paths and the root commit', async () => {
    const { commits } = await getVcsLog(repo, 'git')
    const [rename, second, root] = commits

    const renamed = await getVcsCommitFiles(repo, rename.id, 'git')
    expect(renamed.files).toEqual([{ path: 'b.txt', status: 'R', oldPath: 'a.txt', ref: 'b.txt', oldRef: 'a.txt' }])

    const changed = await getVcsCommitFiles(repo, second.id, 'git')
    expect(changed.files.map((f) => `${f.status} ${f.path}`).sort()).toEqual(['A 中文 文件.txt', 'M a.txt'])

    const first = await getVcsCommitFiles(repo, root.id, 'git')
    expect(first.files).toEqual([{ path: 'a.txt', status: 'A', ref: 'a.txt' }])
  })

  it('diffs one file of a commit (including the root commit)', async () => {
    const { commits } = await getVcsLog(repo, 'git')
    const second = commits[1]
    const diff = await getVcsCommitFileDiff(repo, second.id, { path: 'a.txt', status: 'M', ref: 'a.txt' }, 'git')
    expect(diff.error).toBeUndefined()
    expect(diff.diff).toContain('+two')

    const root = commits[2]
    const rootDiff = await getVcsCommitFileDiff(repo, root.id, { path: 'a.txt', status: 'A', ref: 'a.txt' }, 'git')
    expect(rootDiff.diff).toContain('+one')
  })

  it('rejects revisions and refs that could be read as options', async () => {
    expect((await getVcsCommitFiles(repo, '--all', 'git')).error).toBe('Invalid revision')
    expect((await getVcsCommitFiles(repo, 'HEAD~1', 'git')).error).toBe('Invalid revision')
    const { commits } = await getVcsLog(repo, 'git')
    const bad = await getVcsCommitFileDiff(repo, commits[0].id, { path: 'x', status: 'M', ref: '--output=/tmp/x' }, 'git')
    expect(bad.error).toBe('Invalid file path')
  })
})
