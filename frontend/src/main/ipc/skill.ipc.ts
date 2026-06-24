import { ipcMain } from 'electron'
import fs from 'fs'
import { statSync } from 'fs'
import { dirname } from 'path'
import {
  detectWorkspaceType,
  activateSkill,
  deactivateSkill
} from '../services/skill-activation.service'
import {
  installSkill,
  uninstallSkill,
  readSkillMeta,
  InstallMode,
  SkillTool
} from '../services/skill-install.service'
import { scanGlobalSkills, scanProjectSkills } from '../services/skill-scan.service'
import {
  getSkillSources,
  addSkillSource,
  removeSkillSource
} from '../store/skill-sources.store'
import * as logger from '../utils/logger'

/** Resolve a dropped/picked path to the directory that contains SKILL.md. */
function resolveSkillSourceDir(inputPath: string): string | null {
  if (!fs.existsSync(inputPath)) return null
  const stat = statSync(inputPath)
  // A SKILL.md file → its parent directory.
  if (stat.isFile()) {
    return /SKILL\.md$/i.test(inputPath) ? dirname(inputPath) : null
  }
  // A directory must contain SKILL.md.
  return fs.existsSync(`${inputPath}/SKILL.md`) ? inputPath : null
}

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
        return activateSkill(skillId, workspacePath, targetType as SkillTool | undefined)
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
        return deactivateSkill(skillId, workspacePath)
      } catch (error) {
        logger.error('skill:deactivate error:', error)
        return { success: false, removedFrom: [], error: String(error) }
      }
    }
  )

  // ---- Unified install (four placement modes) ----
  ipcMain.handle(
    'skill:install',
    async (
      _event,
      opts: {
        sourceDir: string
        mode: InstallMode
        tools: SkillTool[]
        workspacePath?: string
        skillId?: string
      }
    ) => {
      try {
        return installSkill(opts)
      } catch (error) {
        logger.error('skill:install error:', error)
        return { success: false, installedTo: [], error: String(error) }
      }
    }
  )

  ipcMain.handle(
    'skill:uninstall',
    async (
      _event,
      skillName: string,
      tools: SkillTool[],
      scope: 'project' | 'global',
      workspacePath?: string
    ) => {
      try {
        return uninstallSkill(skillName, tools, scope, workspacePath)
      } catch (error) {
        logger.error('skill:uninstall error:', error)
        return { success: false, removedFrom: [], error: String(error) }
      }
    }
  )

  // ---- Live scans (reference-only) ----
  ipcMain.handle('skill:scan-global', async (_event, tools?: SkillTool[]) => {
    try {
      return { success: true, skills: scanGlobalSkills(tools) }
    } catch (error) {
      logger.error('skill:scan-global error:', error)
      return { success: false, skills: [], error: String(error) }
    }
  })

  ipcMain.handle(
    'skill:scan-project',
    async (_event, workspacePath: string, tools?: SkillTool[]) => {
      try {
        return { success: true, skills: scanProjectSkills(workspacePath, tools) }
      } catch (error) {
        logger.error('skill:scan-project error:', error)
        return { success: false, skills: [], error: String(error) }
      }
    }
  )

  // ---- Local-loaded sources (drag-in / picker) ----
  ipcMain.handle('skill:load-local', async (_event, inputPath: string) => {
    try {
      const sourceDir = resolveSkillSourceDir(inputPath)
      if (!sourceDir) {
        return { success: false, error: '所选位置不是有效的技能（缺少 SKILL.md）' }
      }
      const meta = readSkillMeta(sourceDir)
      const source = addSkillSource({
        name: meta.displayName,
        sourcePath: sourceDir,
        description: meta.description
      })
      return { success: true, source, meta }
    } catch (error) {
      logger.error('skill:load-local error:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('skill:list-local-sources', async () => {
    try {
      // Filter out sources whose folder no longer exists on disk.
      const sources = getSkillSources().filter((s) => fs.existsSync(s.sourcePath))
      return { success: true, sources }
    } catch (error) {
      logger.error('skill:list-local-sources error:', error)
      return { success: false, sources: [], error: String(error) }
    }
  })

  ipcMain.handle('skill:remove-local-source', async (_event, id: string) => {
    try {
      return { success: removeSkillSource(id) }
    } catch (error) {
      logger.error('skill:remove-local-source error:', error)
      return { success: false, error: String(error) }
    }
  })
}
