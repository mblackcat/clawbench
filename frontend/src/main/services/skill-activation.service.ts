/**
 * Skill Activation Service
 *
 * Thin compatibility layer over skill-install.service for activating a
 * ClawBench-managed skill (user-apps/<id>) into the active workspace.
 * Deployment now follows the per-skill folder spec (<tool>/skills/<name>/),
 * and deactivation cleans both the new layout and the legacy single-file
 * commands/agents layout used by earlier versions.
 */

import fs from 'fs'
import { join, basename } from 'path'
import { getUserAppsPath } from '../utils/paths'
import {
  SkillTool,
  ALL_TOOLS,
  WORKSPACE_MARKERS,
  PROJECT_SKILL_DIRS,
  getProjectSkillDir,
  readSkillMeta,
  installSkill,
  pathExists
} from './skill-install.service'
import * as logger from '../utils/logger'

export type WorkspaceType = SkillTool

/** Legacy single-file deploy directories (pre-skills-spec). */
const LEGACY_COMMANDS_DIRS: Record<SkillTool, string> = {
  claude: '.claude/commands',
  codex: '.codex/agents',
  gemini: '.gemini/commands'
}

/**
 * Detect which AI coding tools are configured in a workspace.
 */
export function detectWorkspaceType(workspacePath: string): WorkspaceType[] {
  const types: WorkspaceType[] = []
  for (const [type, marker] of Object.entries(WORKSPACE_MARKERS)) {
    if (fs.existsSync(join(workspacePath, marker))) {
      types.push(type as WorkspaceType)
    }
  }
  return types
}

/**
 * Activate (deploy) a managed skill into a workspace's skills directory.
 * Defaults to copying into the project; when no targetType is given, deploys
 * to every detected AI tool in the workspace.
 */
export function activateSkill(
  skillId: string,
  workspacePath: string,
  targetType?: WorkspaceType
): { success: boolean; deployedTo: string[]; error?: string } {
  const skillDir = join(getUserAppsPath(), skillId)
  if (!fs.existsSync(join(skillDir, 'manifest.json'))) {
    return { success: false, deployedTo: [], error: `Skill not found: ${skillId}` }
  }

  let tools: SkillTool[]
  if (targetType) {
    tools = [targetType]
  } else {
    const detected = detectWorkspaceType(workspacePath)
    if (detected.length === 0) {
      return {
        success: false,
        deployedTo: [],
        error: '当前工作区未配置 AI 编码工具（.claude / .codex / .gemini）'
      }
    }
    tools = detected
  }

  const result = installSkill({
    sourceDir: skillDir,
    mode: 'project-copy',
    tools,
    workspacePath,
    skillId
  })
  return { success: result.success, deployedTo: result.installedTo, error: result.error }
}

/**
 * Deactivate (remove) a skill from a workspace. Cleans both the new folder
 * layout (<tool>/skills/<name>) and the legacy single-file layout.
 */
export function deactivateSkill(
  skillId: string,
  workspacePath: string
): { success: boolean; removedFrom: string[] } {
  const skillDir = join(getUserAppsPath(), skillId)
  const meta = fs.existsSync(skillDir)
    ? readSkillMeta(skillDir)
    : { name: basename(skillId), displayName: skillId, description: '', version: '1.0.0' }
  const skillName = meta.name

  const removedFrom: string[] = []

  for (const tool of ALL_TOOLS) {
    // New layout: <tool>/skills/<name>/
    const folder = join(getProjectSkillDir(workspacePath, tool), skillName)
    if (pathExists(folder)) {
      try {
        fs.rmSync(folder, { recursive: true, force: true })
        removedFrom.push(folder)
      } catch (err) {
        logger.error(`Failed to remove skill folder ${folder}:`, err)
      }
    }

    // Legacy layout: <tool>/commands|agents/<name>.md (+ <name>-scripts/)
    const legacyDir = join(workspacePath, LEGACY_COMMANDS_DIRS[tool])
    const legacyFile = join(legacyDir, `${skillName}.md`)
    if (pathExists(legacyFile)) {
      try {
        fs.rmSync(legacyFile, { force: true })
        removedFrom.push(legacyFile)
      } catch (err) {
        logger.error(`Failed to remove legacy skill ${legacyFile}:`, err)
      }
    }
    const legacyScripts = join(legacyDir, `${skillName}-scripts`)
    if (pathExists(legacyScripts)) {
      try {
        fs.rmSync(legacyScripts, { recursive: true, force: true })
      } catch (err) {
        logger.error(`Failed to remove legacy scripts ${legacyScripts}:`, err)
      }
    }
  }

  return { success: removedFrom.length > 0, removedFrom }
}

// Re-export for callers that referenced the old constant name.
export { PROJECT_SKILL_DIRS }
