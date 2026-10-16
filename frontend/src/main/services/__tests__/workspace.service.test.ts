import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const workspaces: Array<{ id: string; name: string; path: string; vcsType: string }> = []

vi.mock('../../store/workspace.store', () => ({
  getAllWorkspaces: () => workspaces,
  getWorkspaceById: vi.fn(),
  addWorkspace: (w: { name: string; path: string; vcsType: string }) => {
    const ws = { id: String(workspaces.length + 1), ...w }
    workspaces.push(ws)
    return ws
  },
  updateWorkspaceInStore: vi.fn(),
  removeWorkspace: vi.fn(),
  getActiveWorkspaceId: vi.fn(),
  setActiveWorkspaceId: vi.fn()
}))
vi.mock('../ai-coding.service', () => ({ ensureWorkspaceForWorkingDir: vi.fn() }))
vi.mock('../../utils/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../../utils/paths', () => ({ getDefaultUserAppsPath: () => '/tmp/user-apps' }))

import {
  createWorkspace,
  detectVcsType,
  normalizeWorkspacePath,
  DUPLICATE_WORKSPACE_PATH
} from '../workspace.service'

let root: string

beforeEach(() => {
  workspaces.length = 0
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('normalizeWorkspacePath', () => {
  it('strips trailing separators and resolves relative segments', () => {
    expect(normalizeWorkspacePath(`${root}/a/../`)).toBe(normalizeWorkspacePath(root))
  })
})

describe('createWorkspace duplicate detection', () => {
  it('rejects the same directory added twice (trailing slash variant)', () => {
    expect(createWorkspace('one', root).success).toBe(true)
    const dup = createWorkspace('two', `${root}/`)
    expect(dup.success).toBe(false)
    expect(dup.error).toBe(DUPLICATE_WORKSPACE_PATH)
  })
})

describe('detectVcsType', () => {
  it('returns none for an empty directory', () => {
    expect(detectVcsType(root)).toBe('none')
  })

  it('detects a git marker at the root', () => {
    fs.mkdirSync(path.join(root, '.git'))
    expect(detectVcsType(root)).toBe('git')
  })

  it('finds a nested svn checkout and prefers it over git', () => {
    fs.mkdirSync(path.join(root, '.git'))
    fs.mkdirSync(path.join(root, 'trunk', 'proj', '.svn'), { recursive: true })
    expect(detectVcsType(root)).toBe('svn')
  })

  it('skips node_modules and stops at the depth limit', () => {
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg', '.git'), { recursive: true })
    fs.mkdirSync(path.join(root, 'a', 'b', 'c', 'd', '.svn'), { recursive: true })
    expect(detectVcsType(root)).toBe('none')
  })

  it('detects perforce config files', () => {
    fs.writeFileSync(path.join(root, '.p4config'), 'P4PORT=x')
    expect(detectVcsType(root)).toBe('perforce')
  })
})
