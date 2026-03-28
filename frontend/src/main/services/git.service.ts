import { execFile } from 'child_process'

interface BranchInfo {
  current: string
  local: string[]
  remote: string[]
}

interface CheckoutResult {
  success: boolean
  error?: string
}

export interface DiffStat {
  additions: number
  deletions: number
}

export interface ChangedFile {
  path: string
  status: string // M, A, D, ??, R, etc.
  staged: boolean
  additions: number
  deletions: number
}

export interface GitExecResult {
  success: boolean
  output?: string
  error?: string
}

function runGit(workspacePath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: workspacePath, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
      } else {
        resolve(stdout)
      }
    })
  })
}

export async function listBranches(workspacePath: string): Promise<BranchInfo> {
  const [branchOutput, currentOutput] = await Promise.all([
    runGit(workspacePath, ['branch', '-a']),
    runGit(workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  ])

  const current = currentOutput.trim()
  const local: string[] = []
  const remote: string[] = []

  for (const line of branchOutput.split('\n')) {
    const trimmed = line.replace(/^\*?\s+/, '').trim()
    if (!trimmed) continue

    if (trimmed.startsWith('remotes/')) {
      // Filter out HEAD pointer entries like "remotes/origin/HEAD -> origin/main"
      if (trimmed.includes(' -> ')) continue
      // Strip "remotes/" prefix
      const name = trimmed.replace(/^remotes\//, '')
      remote.push(name)
    } else {
      local.push(trimmed)
    }
  }

  return { current, local, remote }
}

export async function checkoutBranch(
  workspacePath: string,
  branchName: string
): Promise<CheckoutResult> {
  try {
    // For remote branches like "origin/feature-x", strip the remote prefix
    // so git auto-creates a local tracking branch
    const localName = branchName.replace(/^[^/]+\//, '')
    await runGit(workspacePath, ['checkout', localName])
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

function parseNumstat(output: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of output.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 2) {
      const add = parseInt(parts[0], 10)
      const del = parseInt(parts[1], 10)
      if (!isNaN(add)) additions += add
      if (!isNaN(del)) deletions += del
    }
  }
  return { additions, deletions }
}

export async function getDiffStat(workspacePath: string): Promise<DiffStat> {
  try {
    const [unstaged, staged] = await Promise.all([
      runGit(workspacePath, ['diff', '--numstat']).catch(() => ''),
      runGit(workspacePath, ['diff', '--cached', '--numstat']).catch(() => '')
    ])
    const u = parseNumstat(unstaged)
    const s = parseNumstat(staged)
    return { additions: u.additions + s.additions, deletions: u.deletions + s.deletions }
  } catch {
    return { additions: 0, deletions: 0 }
  }
}

export async function getChangedFiles(workspacePath: string): Promise<ChangedFile[]> {
  try {
    const porcelain = await runGit(workspacePath, ['status', '--porcelain=v1'])
    const files: ChangedFile[] = []
    for (const line of porcelain.split('\n')) {
      if (!line || line.length < 4) continue
      const indexStatus = line[0]
      const workTreeStatus = line[1]
      const filePath = line.substring(3).trim()
      // Determine display status and staged flag
      let status = '?'
      let staged = false
      if (indexStatus === '?' && workTreeStatus === '?') {
        status = '??'
      } else if (indexStatus !== ' ' && indexStatus !== '?') {
        status = indexStatus
        staged = true
      } else {
        status = workTreeStatus
      }
      files.push({ path: filePath, status, staged, additions: 0, deletions: 0 })
    }
    // Enrich with per-file numstat for tracked files
    try {
      const [unstagedNum, stagedNum] = await Promise.all([
        runGit(workspacePath, ['diff', '--numstat']).catch(() => ''),
        runGit(workspacePath, ['diff', '--cached', '--numstat']).catch(() => '')
      ])
      const numstatMap: Record<string, { additions: number; deletions: number }> = {}
      for (const raw of [unstagedNum, stagedNum]) {
        for (const l of raw.split('\n')) {
          const parts = l.trim().split(/\s+/)
          if (parts.length >= 3) {
            const a = parseInt(parts[0], 10) || 0
            const d = parseInt(parts[1], 10) || 0
            const p = parts.slice(2).join(' ')
            if (numstatMap[p]) {
              numstatMap[p].additions += a
              numstatMap[p].deletions += d
            } else {
              numstatMap[p] = { additions: a, deletions: d }
            }
          }
        }
      }
      for (const f of files) {
        const stat = numstatMap[f.path]
        if (stat) {
          f.additions = stat.additions
          f.deletions = stat.deletions
        }
      }
    } catch { /* ignore numstat enrichment errors */ }
    return files
  } catch {
    return []
  }
}

export async function gitExec(workspacePath: string, args: string[]): Promise<GitExecResult> {
  try {
    const output = await runGit(workspacePath, args)
    return { success: true, output: output.trim() }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
