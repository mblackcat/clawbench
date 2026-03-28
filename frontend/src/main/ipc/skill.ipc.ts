import { ipcMain } from 'electron'
import {
  detectWorkspaceType,
  activateSkill,
  deactivateSkill
} from '../services/skill-activation.service'
import * as logger from '../utils/logger'

export function registerSkillIpc(): void {
  ipcMain.handle('skill:detect-workspace-type', async (_event, workspacePath: string) => {
    try {
      const types = detectWorkspaceType(workspacePath)
      return { success: true, types }
    } catch (error) {
      logger.error('skill:detect-workspace-type error:', error)
      return { success: false, types: [], error: String(error) }
    }
  })

  ipcMain.handle(
    'skill:activate',
    async (_event, skillId: string, workspacePath: string, targetType?: string) => {
      try {
        const result = activateSkill(skillId, workspacePath, targetType as any)
        return result
      } catch (error) {
        logger.error('skill:activate error:', error)
        return { success: false, deployedTo: [], error: String(error) }
      }
    }
  )

  ipcMain.handle(
    'skill:deactivate',
    async (_event, skillId: string, workspacePath: string) => {
      try {
        const result = deactivateSkill(skillId, workspacePath)
        return result
      } catch (error) {
        logger.error('skill:deactivate error:', error)
        return { success: false, removedFrom: [], error: String(error) }
      }
    }
  )
}
