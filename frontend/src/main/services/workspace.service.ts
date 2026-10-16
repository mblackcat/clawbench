import fs from 'fs'
import path, { join } from 'path'
import {
  getAllWorkspaces,
  getWorkspaceById,
  addWorkspace,
  updateWorkspaceInStore,
  removeWorkspace,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  Workspace
} from '../store/workspace.store'
import * as logger from '../utils/logger'
import { getDefaultUserAppsPath } from '../utils/paths'
import { ensureWorkspaceForWorkingDir } from './ai-coding.service'

export type VcsType = 'git' | 'svn' | 'perforce' | 'none'

/** Stable path key for duplicate detection (platform-aware). */
export function normalizeWorkspacePath(dirPath: string): string {
  const resolved = path.resolve(dirPath)
  const normalized = path.normalize(resolved).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Error code thrown to renderer when the same directory is added twice. */
export const DUPLICATE_WORKSPACE_PATH = 'DUPLICATE_WORKSPACE_PATH'

/** Directories skipped when scanning for VCS markers (heavy/irrelevant subtrees). */
const VCS_SCAN_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'venv',
  '.venv',
  '__pycache__',
  '.cache',
  'target',
  'vendor'
])

const VCS_SCAN_MAX_DEPTH = 3
/** Upper bound on directories read per detection so huge trees stay fast. */
const VCS_SCAN_MAX_DIRS = 2000

/**
 * Detects the version control system used in a directory, recursing into
 * subdirectories (bounded depth) since the marker may not sit at the
 * workspace root. SVN takes priority; git and Perforce are checked as a
 * fallback in the same pass.
 */
export function detectVcsType(dirPath: string): VcsType {
  try {
    let hasSvn = false
    let hasGit = false
    let hasPerforce = false
    const queue: Array<{ dir: string; depth: number }> = [{ dir: dirPath, depth: 0 }]
    let head = 0

    while (head < queue.length && !hasSvn && head < VCS_SCAN_MAX_DIRS) {
      const { dir, depth } = queue[head++]
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name === '.svn') hasSvn = true
        if (entry.isDirectory() && entry.name === '.git') hasGit = true
        if (entry.name === '.p4config' || entry.name === '.p4') hasPerforce = true

        if (
          entry.isDirectory() &&
          depth < VCS_SCAN_MAX_DEPTH &&
          !VCS_SCAN_SKIP_DIRS.has(entry.name)
        ) {
          queue.push({ dir: join(dir, entry.name), depth: depth + 1 })
        }
      }
    }

    if (hasSvn) return 'svn'
    if (hasGit) return 'git'
    if (hasPerforce) return 'perforce'
  } catch (err) {
    logger.warn('Error detecting VCS type:', err)
  }
  return 'none'
}

/**
 * Returns all workspaces.
 */
export function listWorkspaces(): Workspace[] {
  return getAllWorkspaces()
}

/**
 * Creates a new workspace after validating the directory exists.
 */
export function createWorkspace(
  name: string,
  dirPath: string,
  vcsType?: string
): { success: boolean; workspace?: Workspace; error?: string } {
  if (!fs.existsSync(dirPath)) {
    return { success: false, error: `Directory does not exist: ${dirPath}` }
  }

  const stat = fs.statSync(dirPath)
  if (!stat.isDirectory()) {
    return { success: false, error: `Path is not a directory: ${dirPath}` }
  }

  const key = normalizeWorkspacePath(dirPath)
  const existing = getAllWorkspaces().find(
    (w) => normalizeWorkspacePath(w.path) === key
  )
  if (existing) {
    return { success: false, error: DUPLICATE_WORKSPACE_PATH }
  }

  // 如果用户指定了 vcsType，使用用户指定的；否则自动检测
  const finalVcsType = (vcsType as VcsType) || detectVcsType(dirPath)
  const workspace = addWorkspace({ name, path: dirPath, vcsType: finalVcsType })
  logger.info(`Workspace created: ${name} (${finalVcsType}) at ${dirPath}`)

  // Auto-provision a matching AI Coding workspace for this directory. If one
  // already exists (e.g. the user created it manually), it is skipped — no
  // duplicate, no error. Failures here must never break global workspace
  // creation, so they are logged and swallowed.
  try {
    ensureWorkspaceForWorkingDir(dirPath)
  } catch (err) {
    logger.warn('Failed to auto-create AI Coding workspace:', err)
  }

  return { success: true, workspace }
}

/**
 * Updates fields of an existing workspace.
 */
export function updateWorkspace(
  id: string,
  updates: Partial<Omit<Workspace, 'id' | 'createdAt'>>
): { success: boolean; workspace?: Workspace; error?: string } {
  const updated = updateWorkspaceInStore(id, updates)
  if (!updated) {
    return { success: false, error: `Workspace not found: ${id}` }
  }
  logger.info(`Workspace updated: ${id}`)
  return { success: true, workspace: updated }
}

/**
 * Deletes a workspace by id.
 */
export function deleteWorkspace(id: string): { success: boolean; error?: string } {
  const removed = removeWorkspace(id)
  if (!removed) {
    return { success: false, error: `Workspace not found: ${id}` }
  }
  logger.info(`Workspace deleted: ${id}`)
  return { success: true }
}

/**
 * Sets the active workspace.
 */
export function setActiveWorkspace(id: string): { success: boolean; error?: string } {
  const workspace = getWorkspaceById(id)
  if (!workspace) {
    return { success: false, error: `Workspace not found: ${id}` }
  }
  setActiveWorkspaceId(id)
  logger.info(`Active workspace set to: ${id} (${workspace.name})`)
  return { success: true }
}

/**
 * Returns the currently active workspace or undefined.
 */
export function getActiveWorkspace(): Workspace | undefined {
  const activeId = getActiveWorkspaceId()
  if (!activeId) return undefined
  return getWorkspaceById(activeId)
}

/**
 * Ensures the general-mode default local directory (same as default user-apps:
 * userData/user-apps) exists and returns its absolute path. Does not create a
 * workspace entry — the setup wizard (or caller) decides whether to register it.
 */
export function ensureDefaultGeneralWorkspacePath(): string {
  const dirPath = getDefaultUserAppsPath()
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
    logger.info(`Created default general local directory (user-apps): ${dirPath}`)
  }
  return dirPath
}
