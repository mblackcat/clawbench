import { ipcMain } from 'electron'
import { listBranches, checkoutBranch, getDiffStat, getChangedFiles, gitExec } from '../services/git.service'

export function registerGitIpc(): void {
  ipcMain.handle('git:list-branches', async (_event, workspacePath: string) => {
    return listBranches(workspacePath)
  })

  ipcMain.handle('git:checkout', async (_event, workspacePath: string, branchName: string) => {
    return checkoutBranch(workspacePath, branchName)
  })

  ipcMain.handle('git:diff-stat', async (_event, workspacePath: string) => {
    return getDiffStat(workspacePath)
  })

  ipcMain.handle('git:changed-files', async (_event, workspacePath: string) => {
    return getChangedFiles(workspacePath)
  })

  ipcMain.handle('git:commit', async (_event, workspacePath: string, commitMessage: string) => {
    const addResult = await gitExec(workspacePath, ['add', '-A'])
    if (!addResult.success) return addResult
    return gitExec(workspacePath, ['commit', '-m', commitMessage])
  })

  ipcMain.handle('git:push', async (_event, workspacePath: string) => {
    return gitExec(workspacePath, ['push'])
  })

  ipcMain.handle('git:pull', async (_event, workspacePath: string) => {
    return gitExec(workspacePath, ['pull'])
  })

  ipcMain.handle('git:discard-file', async (_event, workspacePath: string, filePath: string, isUntracked: boolean) => {
    if (isUntracked) {
      return gitExec(workspacePath, ['clean', '-f', '--', filePath])
    }
    return gitExec(workspacePath, ['checkout', '--', filePath])
  })
}
