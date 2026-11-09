import { ipcMain } from 'electron'
import {
  commitVcs,
  detectVcsType,
  detectVcsTypes,
  discardVcsFile,
  getVcsChangedFiles,
  getVcsDiffStat,
  getVcsFileDiff,
  pullVcs,
  pushVcs,
  type VcsType
} from '../services/vcs.service'
import {
  getVcsCommitFileDiff,
  getVcsCommitFiles,
  getVcsLog,
  type VcsCommitFile
} from '../services/vcs-history.service'

export function registerVcsIpc(): void {
  ipcMain.handle('vcs:detect', async (_event, workspacePath: string) => {
    return detectVcsType(workspacePath)
  })

  // All VCS whose markers are present (priority git > svn > perforce). Drives the
  // multi-VCS capsule switcher in the Changes panel.
  ipcMain.handle('vcs:detect-types', async (_event, workspacePath: string) => {
    return detectVcsTypes(workspacePath)
  })

  // Each operation accepts an optional explicit VCS type so the panel can target a
  // specific VCS when several coexist; omitted → auto-detect (priority order).
  ipcMain.handle('vcs:diff-stat', async (_event, workspacePath: string, vcsType?: string) => {
    return getVcsDiffStat(workspacePath, vcsType as VcsType | undefined)
  })

  ipcMain.handle('vcs:changed-files', async (_event, workspacePath: string, vcsType?: string) => {
    return getVcsChangedFiles(workspacePath, vcsType as VcsType | undefined)
  })

  // Unified diff for one changed path (file or directory subtree) — drives the
  // diff viewer opened by double-clicking an entry in the Changes panel.
  ipcMain.handle('vcs:file-diff', async (_event, workspacePath: string, filePath: string, vcsType?: string) => {
    return getVcsFileDiff(workspacePath, filePath, vcsType as VcsType | undefined)
  })

  ipcMain.handle('vcs:commit', async (_event, workspacePath: string, commitMessage: string, vcsType?: string) => {
    return commitVcs(workspacePath, commitMessage, vcsType as VcsType | undefined)
  })

  ipcMain.handle('vcs:push', async (_event, workspacePath: string, vcsType?: string) => {
    return pushVcs(workspacePath, vcsType as VcsType | undefined)
  })

  ipcMain.handle('vcs:pull', async (_event, workspacePath: string, vcsType?: string) => {
    return pullVcs(workspacePath, vcsType as VcsType | undefined)
  })

  ipcMain.handle('vcs:discard-file', async (_event, workspacePath: string, filePath: string, isUntracked: boolean, vcsType?: string) => {
    return discardVcsFile(workspacePath, filePath, isUntracked, vcsType as VcsType | undefined)
  })

  // History section: paged commit log, the files one commit touched, and the
  // diff of one of those files (reuses the Changes diff viewer).
  ipcMain.handle('vcs:log', async (_event, workspacePath: string, vcsType?: string, cursor?: string, limit?: number) => {
    return getVcsLog(workspacePath, vcsType as VcsType | undefined, cursor, limit)
  })

  ipcMain.handle('vcs:commit-files', async (_event, workspacePath: string, commitId: string, vcsType?: string) => {
    return getVcsCommitFiles(workspacePath, commitId, vcsType as VcsType | undefined)
  })

  ipcMain.handle(
    'vcs:commit-file-diff',
    async (_event, workspacePath: string, commitId: string, file: VcsCommitFile, vcsType?: string) => {
      return getVcsCommitFileDiff(workspacePath, commitId, file, vcsType as VcsType | undefined)
    }
  )
}
