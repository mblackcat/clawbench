/**
 * Skill Scan Service
 *
 * Reads existing skill folders from the user's global AI-tool directories
 * (~/.claude/skills, ~/.codex/skills, ...) and from the active workspace
 * project (<ws>/.claude/skills, ...). These are reference-only: they are
 * surfaced in the UI but never copied into the ClawBench managed store.
 */

import fs from 'fs'
import { join } from 'path'
import {
  SkillTool,
  ALL_TOOLS,
  getGlobalSkillDir,
  getProjectSkillDir,
  readSkillMeta,
  isSymlink
} from './skill-install.service'
import * as logger from '../utils/logger'

export interface ScannedSkill {
  /** Deploy folder name (the skills/<name> directory). */
  name: string
  displayName: string
  description: string
  version: string
  tool: SkillTool
  /** Absolute path to the skill folder. */
  path: string
  scope: 'global' | 'project'
  /** True when the entry is a symlink/junction (i.e. ClawBench-managed). */
  managed: boolean
}

function scanDir(dir: string, tool: SkillTool, scope: 'global' | 'project'): ScannedSkill[] {
  const results: ScannedSkill[] = []
  if (!fs.existsSync(dir)) return results

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    logger.warn(`Failed to scan skills dir ${dir}:`, err)
    return results
  }

  for (const entry of entries) {
    // A skill is a folder (real dir or junction/symlink) containing SKILL.md.
    const skillPath = join(dir, entry.name)
    let isDirLike = entry.isDirectory()
    if (entry.isSymbolicLink()) {
      try {
        isDirLike = fs.statSync(skillPath).isDirectory()
      } catch {
        isDirLike = false
      }
    }
    if (!isDirLike) continue
    if (!fs.existsSync(join(skillPath, 'SKILL.md'))) continue

    const meta = readSkillMeta(skillPath)
    results.push({
      name: entry.name,
      displayName: meta.displayName,
      description: meta.description,
      version: meta.version,
      tool,
      path: skillPath,
      scope,
      managed: isSymlink(skillPath)
    })
  }
  return results
}

export function scanGlobalSkills(tools: SkillTool[] = ALL_TOOLS): ScannedSkill[] {
  const all: ScannedSkill[] = []
  for (const tool of tools) {
    all.push(...scanDir(getGlobalSkillDir(tool), tool, 'global'))
  }
  return all
}

export function scanProjectSkills(
  workspacePath: string,
  tools: SkillTool[] = ALL_TOOLS
): ScannedSkill[] {
  const all: ScannedSkill[] = []
  if (!workspacePath) return all
  for (const tool of tools) {
    all.push(...scanDir(getProjectSkillDir(workspacePath, tool), tool, 'project'))
  }
  return all
}
