/**
 * Shared AI-skill types used across the renderer (stores, pages, components)
 * and the typed window.api surface.
 */

export type SkillTool = 'claude' | 'codex' | 'gemini'

export type SkillInstallMode =
  | 'project-copy'
  | 'global-copy'
  | 'workbench-symlink-project'
  | 'workbench-symlink-global'

/** Metadata read from a skill source (SKILL.md frontmatter + optional manifest). */
export interface SkillMeta {
  name: string
  displayName: string
  description: string
  version: string
  manifestId?: string
}

/** A skill discovered on disk in a global or project AI-tool directory. */
export interface ScannedSkill {
  name: string
  displayName: string
  description: string
  version: string
  tool: SkillTool
  path: string
  scope: 'global' | 'project'
  /** True when the entry is a symlink/junction (ClawBench-managed). */
  managed: boolean
}

/** A skill loaded from disk by drag-in / file picker (reference only). */
export interface SkillSource {
  id: string
  name: string
  sourcePath: string
  description?: string
  addedAt: string
}
