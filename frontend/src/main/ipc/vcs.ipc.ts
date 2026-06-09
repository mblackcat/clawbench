import { ipcMain } from 'electron'
import {
  commitVcs,
  detectVcsType,
  discardVcsFile,
  getVcsChangedFiles,
  getVcsDiffStat,
  pullVcs,
  pushVcs
} from '../services/vcs.service'

export function registerVcsIpc(): void {
  ipcMain.handle('vcs:detect', async (_event, workspacePath: string) => {
    return detectVcsType(workspacePath)
  })

  ipcMain.handle('vcs:diff-stat', async (_event, workspacePath: string) => {
    return getVcsDiffStat(workspacePath)
  })

  ipcMain.handle('vcs:changed-files', async (_event, workspacePath: string) => {
    return getVcsChangedFiles(workspacePath)
  })

  ipcMain.handle('vcs:commit', async (_event, workspacePath: string, commitMessage: string) => {
    return commitVcs(workspacePath, commitMessage)
  })

  ipcMain.handle('vcs:push', async (_event, workspacePath: string) => {
    return pushVcs(workspacePath)
  })

  ipcMain.handle('vcs:pull', async (_event, workspacePath: string) => {
    return pullVcs(workspacePath)
  })

  ipcMain.handle('vcs:discard-file', async (_event, workspacePath: string, filePath: string, isUntracked: boolean) => {
    return discardVcsFile(workspacePath, filePath, isUntracked)
  })
}
