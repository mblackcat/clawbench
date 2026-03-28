import fs from 'fs'
import { join } from 'path'
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

export type VcsType = 'git' | 'svn' | 'perforce' | 'none'

/**
 * Detects the version control system used in a directory.
 */
export function detectVcsType(dirPath: string): VcsType {
  try {
    // Check SVN first (SVN working copies shouldn't have .git)
    if (fs.existsSync(join(dirPath, '.svn'))) return 'svn'
    if (fs.existsSync(join(dirPath, '.git'))) return 'git'
    if (fs.existsSync(join(dirPath, '.p4config'))) return 'perforce'
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
  path: string,
  vcsType?: string
): { success: boolean; workspace?: Workspace; error?: string } {
  if (!fs.existsSync(path)) {
    return { success: false, error: `Directory does not exist: ${path}` }
  }

  const stat = fs.statSync(path)
  if (!stat.isDirectory()) {
    return { success: false, error: `Path is not a directory: ${path}` }
  }

  // 如果用户指定了 vcsType，使用用户指定的；否则自动检测
  const finalVcsType = (vcsType as VcsType) || detectVcsType(path)
  const workspace = addWorkspace({ name, path, vcsType: finalVcsType })
  logger.info(`Workspace created: ${name} (${finalVcsType}) at ${path}`)
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
