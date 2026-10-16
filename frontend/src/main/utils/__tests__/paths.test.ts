import { afterEach, describe, expect, it } from 'vitest'
import os from 'os'
import path from 'path'
import {
  getAppDataPath,
  getDefaultUserAppsPath,
  getUserAppsPath,
  getWorkbenchVenvPath,
  getWorkbenchVenvPythonPath,
  registerUserAppsDirResolver
} from '../paths'

describe('paths', () => {
  afterEach(() => registerUserAppsDirResolver(null))

  it('falls back to a temp userData dir outside Electron', () => {
    expect(getAppDataPath()).toBe(path.join(os.tmpdir(), 'fernhollow-userdata'))
    expect(getDefaultUserAppsPath()).toBe(path.join(getAppDataPath(), 'user-apps'))
  })

  it('getUserAppsPath honors a configured dir, else the default', () => {
    expect(getUserAppsPath()).toBe(getDefaultUserAppsPath())
    registerUserAppsDirResolver(() => '/custom/apps')
    expect(getUserAppsPath()).toBe('/custom/apps')
    registerUserAppsDirResolver(() => '   ')
    expect(getUserAppsPath()).toBe(getDefaultUserAppsPath())
    registerUserAppsDirResolver(() => {
      throw new Error('store not ready')
    })
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
