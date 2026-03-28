/**
 * Skill Activation Service
 * Detects workspace AI tool type and deploys/removes SKILL.md files
 */

import fs from 'fs'
import { join, basename } from 'path'
import { getUserAppsPath } from '../utils/paths'
import * as logger from '../utils/logger'

export type WorkspaceType = 'claude' | 'codex' | 'gemini'

interface SkillDeployTarget {
  type: WorkspaceType
  commandsDir: string
}

const WORKSPACE_MARKERS: Record<WorkspaceType, string> = {
  claude: '.claude',
  codex: '.codex',
  gemini: '.gemini'
}

const COMMANDS_DIRS: Record<WorkspaceType, string> = {
  claude: '.claude/commands',
  codex: '.codex/agents',
  gemini: '.gemini/commands'
}

/**
 * Detect which AI coding tools are configured in a workspace
 */
export function detectWorkspaceType(workspacePath: string): WorkspaceType[] {
  const types: WorkspaceType[] = []

  for (const [type, marker] of Object.entries(WORKSPACE_MARKERS)) {
    const markerPath = join(workspacePath, marker)
    if (fs.existsSync(markerPath)) {
      types.push(type as WorkspaceType)
    }
  }

  return types
}

/**
 * Activate (deploy) a skill into a workspace's AI tool commands directory
 */
export function activateSkill(
  skillId: string,
  workspacePath: string,
  targetType?: WorkspaceType
): { success: boolean; deployedTo: string[]; error?: string } {
  const userAppsPath = getUserAppsPath()
  const skillDir = join(userAppsPath, skillId)

  // Read manifest
  const manifestPath = join(skillDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    return { success: false, deployedTo: [], error: `Skill not found: ${skillId}` }
  }

  let manifest: any
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  } catch {
    return { success: false, deployedTo: [], error: 'Failed to read skill manifest' }
  }

  // Read SKILL.md
  const skillMdPath = join(skillDir, manifest.entry || 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) {
    return { success: false, deployedTo: [], error: 'SKILL.md not found' }
  }

  const skillContent = fs.readFileSync(skillMdPath, 'utf-8')

  // Extract command name: prefer frontmatter "name" field, then manifest name slug, then skillId
  const skillName = extractFrontmatterName(skillContent)
    || slugify(manifest.name)
    || basename(skillId)

  // Determine targets
  let targets: SkillDeployTarget[]
  if (targetType) {
    targets = [{ type: targetType, commandsDir: join(workspacePath, COMMANDS_DIRS[targetType]) }]
  } else {
    const detected = detectWorkspaceType(workspacePath)
    if (detected.length === 0) {
      return { success: false, deployedTo: [], error: '当前工作区未配置 AI 编码工具（.claude / .codex / .gemini）' }
    }
    targets = detected.map((t) => ({
      type: t,
      commandsDir: join(workspacePath, COMMANDS_DIRS[t])
    }))
  }

  const deployedTo: string[] = []

  for (const target of targets) {
    try {
      // Ensure commands directory exists
      if (!fs.existsSync(target.commandsDir)) {
        fs.mkdirSync(target.commandsDir, { recursive: true })
      }

      // Deploy SKILL.md
      const destPath = join(target.commandsDir, `${skillName}.md`)
      fs.writeFileSync(destPath, skillContent, 'utf-8')
      deployedTo.push(destPath)

      // Deploy scripts/ if present
      const scriptsDir = join(skillDir, 'scripts')
      if (fs.existsSync(scriptsDir) && fs.statSync(scriptsDir).isDirectory()) {
        const destScriptsDir = join(target.commandsDir, `${skillName}-scripts`)
        copyDirSync(scriptsDir, destScriptsDir)
      }

      logger.info(`Skill "${skillName}" deployed to ${target.type}: ${destPath}`)
    } catch (err) {
      logger.error(`Failed to deploy skill to ${target.type}:`, err)
    }
  }

  return { success: deployedTo.length > 0, deployedTo }
}

/**
 * Deactivate (remove) a skill from a workspace
 */
export function deactivateSkill(
  skillId: string,
  workspacePath: string
): { success: boolean; removedFrom: string[] } {
  const userAppsPath = getUserAppsPath()
  const skillDir = join(userAppsPath, skillId)
  const manifestPath = join(skillDir, 'manifest.json')

  let skillName: string
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const skillMdPath = join(skillDir, manifest.entry || 'SKILL.md')
    let skillContent = ''
    try { skillContent = fs.readFileSync(skillMdPath, 'utf-8') } catch {}
    skillName = extractFrontmatterName(skillContent)
      || slugify(manifest.name)
      || basename(skillId)
  } catch {
    skillName = basename(skillId)
  }

  const removedFrom: string[] = []

  for (const [type, cmdDir] of Object.entries(COMMANDS_DIRS)) {
    const filePath = join(workspacePath, cmdDir, `${skillName}.md`)
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
        removedFrom.push(filePath)
        logger.info(`Skill "${skillName}" removed from ${type}: ${filePath}`)
      } catch (err) {
        logger.error(`Failed to remove skill from ${type}:`, err)
      }
    }

    // Remove scripts dir if present
    const scriptsDir = join(workspacePath, cmdDir, `${skillName}-scripts`)
    if (fs.existsSync(scriptsDir)) {
      try {
        fs.rmSync(scriptsDir, { recursive: true, force: true })
      } catch (err) {
        logger.error(`Failed to remove scripts dir:`, err)
      }
    }
  }

  return { success: removedFrom.length > 0, removedFrom }
}

/**
 * Extract "name" field from YAML frontmatter (--- block)
 */
function extractFrontmatterName(content: string): string | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return null
  const nameMatch = match[1].match(/^name:\s*(.+)$/m)
  if (!nameMatch) return null
  const name = nameMatch[1].trim()
  return name || null
}

/**
 * Slugify a string, returning null if result is empty (e.g. pure CJK)
 */
function slugify(str: string | undefined): string | null {
  if (!str) return null
  const slug = str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return slug || null
}

/**
 * Recursively copy a directory
 */
function copyDirSync(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }

  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
