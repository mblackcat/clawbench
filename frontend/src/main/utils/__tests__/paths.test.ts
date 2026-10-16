import { describe, expect, it } from 'vitest'
import os from 'os'
import path from 'path'
import {
  getAppDataPath,
  getDefaultUserAppsPath,
  getUserAppsPath,
  getWorkbenchVenvPath,
  getWorkbenchVenvPythonPath
} from '../paths'

describe('paths', () => {
  it('falls back to a temp userData dir outside Electron', () => {
    expect(getAppDataPath()).toBe(path.join(os.tmpdir(), 'fernhollow-userdata'))
    expect(getDefaultUserAppsPath()).toBe(path.join(getAppDataPath(), 'user-apps'))
  })

  it('getUserAppsPath is always the default {userData}/user-apps install root', () => {
    expect(getUserAppsPath()).toBe(getDefaultUserAppsPath())
  })

  it('builds workbench venv paths per platform', () => {
    expect(getWorkbenchVenvPath()).toBe(path.join(getAppDataPath(), 'python-venv'))
    const py = getWorkbenchVenvPythonPath('/v')
    expect(py).toBe(
      process.platform === 'win32' ? path.join('/v', 'Scripts', 'python.exe') : path.join('/v', 'bin', 'python')
    )
  })
})
