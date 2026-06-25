/**
 * Skill Install Service
 *
 * Centralizes the AI-skill directory conventions and the unified installer
 * shared by both locally-loaded skills and marketplace downloads.
 *
 * Skill layout follows the per-skill folder spec:
 *   <base>/skills/<name>/SKILL.md  (+ optional scripts/, manifest.json)
 *
 * Four install (placement) modes:
 *   - project-copy              copy source into <workspace>/<tool>/skills/<name>
 *   - global-copy               copy source into ~/<tool>/skills/<name>
 *   - workbench-symlink-project copy into user-apps/<id>, junction it into the project
 *   - workbench-symlink-global  copy into user-apps/<id>, junction it into the global dir
 */

import fs from 'fs'
import os from 'os'
import { join, basename, dirname } from 'path'
import { getUserAppsPath } from '../utils/paths'
import * as logger from '../utils/logger'

export type SkillTool = 'claude' | 'codex' | 'gemini'

export type InstallMode =
  | 'project-copy'
  | 'global-copy'
  | 'workbench-symlink-project'
  | 'workbench-symlink-global'

/** Project-level skills directory, relative to the workspace root. */
export const PROJECT_SKILL_DIRS: Record<SkillTool, string> = {
  claude: '.claude/skills',
  codex: '.codex/skills',
  gemini: '.gemini/skills'
}

/** Marker directories used to detect which AI tools a workspace is configured for. */
export const WORKSPACE_MARKERS: Record<SkillTool, string> = {
  claude: '.claude',
  codex: '.codex',
  gemini: '.gemini'
}

export const ALL_TOOLS: SkillTool[] = ['claude', 'codex', 'gemini']

/** Returns the absolute global skills directory for a tool (~/.claude/skills, ...). */
export function getGlobalSkillDir(tool: SkillTool): string {
  return join(os.homedir(), `.${tool}`, 'skills')
}

/** Returns the absolute project skills directory for a tool within a workspace. */
export function getProjectSkillDir(workspacePath: string, tool: SkillTool): string {
  return join(workspacePath, PROJECT_SKILL_DIRS[tool])
}

export interface SkillMeta {
  /** Deploy/folder name (slug-friendly identifier used as the skills/<name> directory). */
  name: string
  /** Human-readable display name. */
  displayName: string
  description: string
  version: string
  /** Manifest id when a manifest.json exists in the source. */
  manifestId?: string
}

/**
 * Reads skill metadata from a source directory.
 * Prefers SKILL.md frontmatter `name`, then manifest.json, then folder name.
 */
export function readSkillMeta(sourceDir: string): SkillMeta {
  let manifest: Record<string, unknown> | undefined
  const manifestPath = join(sourceDir, 'manifest.json')
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    } catch {
      /* ignore malformed manifest */
    }
  }

  const entry = (manifest?.entry as string) || 'SKILL.md'
  const skillMdPath = join(sourceDir, entry)
  let frontmatter: Record<string, string> = {}
  if (fs.existsSync(skillMdPath)) {
    frontmatter = parseFrontmatter(fs.readFileSync(skillMdPath, 'utf-8'))
  }

  const displayName =
    frontmatter.name || (manifest?.name as string) || basename(sourceDir)
  const name =
    slugify(frontmatter.name) ||
    slugify(manifest?.name as string) ||
    slugify(basename(sourceDir)) ||
    'skill'
  const description =
    frontmatter.description || (manifest?.description as string) || ''
  const version = (manifest?.version as string) || '1.0.0'

  return {
    name,
    displayName,
    description,
    version,
    manifestId: manifest?.id as string | undefined
  }
}

export interface InstallOptions {
  /** Directory that contains SKILL.md (and optionally manifest.json + scripts/). */
  sourceDir: string
  mode: InstallMode
  tools: SkillTool[]
  /** Required for project-* modes. */
  workspacePath?: string
  /** Stable id used for the workbench (user-apps) copy in symlink modes. */
  skillId?: string
}

export interface InstallResult {
  success: boolean
  installedTo: string[]
  error?: string
}

/**
 * Unified skill installer. Places a skill into the project and/or global
 * AI-tool directories according to the chosen mode.
 */
export function installSkill(opts: InstallOptions): InstallResult {
  const { sourceDir, mode, tools, workspacePath } = opts

  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    return { success: false, installedTo: [], error: `源目录不存在: ${sourceDir}` }
  }
  const meta = readSkillMeta(sourceDir)
  const skillMd = join(sourceDir, 'SKILL.md')
  if (!fs.existsSync(skillMd) && !fs.existsSync(join(sourceDir, 'manifest.json'))) {
    return { success: false, installedTo: [], error: '源目录中找不到 SKILL.md' }
  }

  const isProject = mode === 'project-copy' || mode === 'workbench-symlink-project'
  if (isProject && !workspacePath) {
    return { success: false, installedTo: [], error: '安装到项目需要先选择工作区' }
  }
  if (!tools || tools.length === 0) {
    return { success: false, installedTo: [], error: '未选择目标 AI 工具' }
  }

  // For symlink modes, ensure the source lives in the workbench (user-apps).
  let linkTargetDir = sourceDir
  if (mode === 'workbench-symlink-project' || mode === 'workbench-symlink-global') {
    const ensured = ensureWorkbenchCopy(sourceDir, meta, opts.skillId)
    if (!ensured.success || !ensured.dir) {
      return { success: false, installedTo: [], error: ensured.error || '复制到工作台失败' }
    }
    linkTargetDir = ensured.dir
  }

  const installedTo: string[] = []
  for (const tool of tools) {
    const baseDir = isProject
      ? getProjectSkillDir(workspacePath as string, tool)
      : getGlobalSkillDir(tool)
    const dest = join(baseDir, meta.name)

    try {
      fs.mkdirSync(baseDir, { recursive: true })
      // Clear any prior install (file, dir, or stale link).
      removePathSafe(dest)

      if (mode === 'project-copy' || mode === 'global-copy') {
        copyDirSync(sourceDir, dest)
      } else {
        createLink(linkTargetDir, dest)
      }
      installedTo.push(dest)
      logger.info(`Skill "${meta.name}" installed (${mode}) -> ${dest}`)
    } catch (err) {
      logger.error(`Failed to install skill to ${tool} (${mode}):`, err)
    }
  }

  if (installedTo.length === 0) {
    return { success: false, installedTo, error: '安装失败，请检查目录权限' }
  }
  return { success: true, installedTo }
}

/**
 * Removes a previously installed skill from project and/or global tool dirs.
 */
export function uninstallSkill(
  skillName: string,
  tools: SkillTool[],
  scope: 'project' | 'global',
  workspacePath?: string
): { success: boolean; removedFrom: string[] } {
  const removedFrom: string[] = []
  for (const tool of tools) {
    const baseDir =
      scope === 'project'
        ? workspacePath
          ? getProjectSkillDir(workspacePath, tool)
          : undefined
        : getGlobalSkillDir(tool)
    if (!baseDir) continue
    const dest = join(baseDir, skillName)
    if (pathExists(dest)) {
      try {
        removePathSafe(dest)
        removedFrom.push(dest)
      } catch (err) {
        logger.error(`Failed to remove skill ${skillName} from ${dest}:`, err)
      }
    }
  }
  return { success: removedFrom.length > 0, removedFrom }
}

/**
 * Copies a source skill directory into the workbench (user-apps/<id>), so it
 * can be symlinked elsewhere. Synthesizes a manifest if none exists.
 */
function ensureWorkbenchCopy(
  sourceDir: string,
  meta: SkillMeta,
  explicitId?: string
): { success: boolean; dir?: string; error?: string } {
  try {
    const id = explicitId || meta.manifestId || `skill.${meta.name}`
    const userApps = getUserAppsPath()
    fs.mkdirSync(userApps, { recursive: true })
    const targetDir = join(userApps, id)

    // If the source already IS this workbench dir, nothing to do.
    if (fs.existsSync(targetDir) && fs.realpathSync(targetDir) === fs.realpathSync(sourceDir)) {
      return { success: true, dir: targetDir }
    }

    removePathSafe(targetDir)
    copyDirSync(sourceDir, targetDir)

    // Guarantee a manifest so the skill shows up in the managed list.
    const manifestPath = join(targetDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      const synthesized = {
        id,
        name: meta.displayName,
        version: meta.version,
        description: meta.description,
        type: 'ai-skill',
        entry: 'SKILL.md'
      }
      fs.writeFileSync(manifestPath, JSON.stringify(synthesized, null, 2), 'utf-8')
    }
    return { success: true, dir: targetDir }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

/** Creates a directory link (junction on Windows, dir symlink elsewhere). */
export function createLink(target: string, linkPath: string): void {
  removePathSafe(linkPath)
  fs.mkdirSync(dirname(linkPath), { recursive: true })
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  fs.symlinkSync(target, linkPath, type)
}

/** True if the path exists or is a (possibly broken) symlink. */
export function pathExists(p: string): boolean {
  try {
    fs.lstatSync(p)
    return true
  } catch {
    return false
  }
}

/** True if the path is a symbolic link / junction. */
export function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

/** Removes a file, directory, or symlink/junction without following it. */
function removePathSafe(p: string): void {
  if (!pathExists(p)) return
  fs.rmSync(p, { recursive: true, force: true })
}

/** Parses YAML frontmatter (--- block) into a flat string map. */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.+)$/)
    if (kv) {
      result[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  return result
}

/** Slugify, returning null when empty (e.g. pure CJK input). */
export function slugify(str: string | undefined): string | null {
  if (!str) return null
  const slug = str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return slug || null
}

/** Recursively copy a directory (dereferences symlinked sources). */
export function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(srcPath)
      if (fs.statSync(real).isDirectory()) copyDirSync(real, destPath)
      else fs.copyFileSync(real, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
