import fs from 'fs'
import { execFile } from 'child_process'
import { join, resolve, relative } from 'path'
import { getChangedFiles as getGitChangedFiles, getDiffStat as getGitDiffStat, gitExec } from './git.service'

export type VcsType = 'git' | 'svn' | 'none'

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

export function detectVcsType(workspacePath: string): VcsType {
  try {
    if (fs.existsSync(join(workspacePath, '.git'))) return 'git'
    if (fs.existsSync(join(workspacePath, '.svn'))) return 'svn'
  } catch {
    return 'none'
  }
  return 'none'
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

export async function getVcsChangedFiles(workspacePath: string): Promise<VcsStatusResult> {
  const type = detectVcsType(workspacePath)
  if (type === 'git') return { type, files: await getGitChangedFiles(workspacePath) }
  if (type === 'svn') return { type, files: await getSvnChangedFiles(workspacePath) }
  return { type, files: [] }
}

export async function getVcsDiffStat(workspacePath: string): Promise<DiffStat & { type: VcsType }> {
  const type = detectVcsType(workspacePath)
  if (type === 'git') return { type, ...(await getGitDiffStat(workspacePath)) }
  if (type === 'svn') return { type, ...(await getSvnDiffStat(workspacePath)) }
  return { type, additions: 0, deletions: 0 }
}

export async function commitVcs(workspacePath: string, message: string): Promise<VcsExecResult> {
  const type = detectVcsType(workspacePath)
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
  return { success: false, error: 'No supported VCS found' }
}

export async function pushVcs(workspacePath: string): Promise<VcsExecResult> {
  const type = detectVcsType(workspacePath)
  if (type === 'git') return gitExec(workspacePath, ['push'])
  if (type === 'svn') return { success: false, error: 'SVN does not support push' }
  return { success: false, error: 'No supported VCS found' }
}

export async function pullVcs(workspacePath: string): Promise<VcsExecResult> {
  const type = detectVcsType(workspacePath)
  if (type === 'git') return gitExec(workspacePath, ['pull'])
  if (type === 'svn') return svnExec(workspacePath, ['update'])
  return { success: false, error: 'No supported VCS found' }
}

export async function discardVcsFile(workspacePath: string, filePath: string, isUntracked: boolean): Promise<VcsExecResult> {
  const type = detectVcsType(workspacePath)
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
  return { success: false, error: 'No supported VCS found' }
}
