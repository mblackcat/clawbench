import { describe, expect, it } from 'vitest'
import { scanAvailablePythons } from '../python-detect.service'

describe('python-detect.service', () => {
  it('scans and returns valid Python installations on Windows', async () => {
    const pyPath = 'C:\\Users\\test\\AppData\\Local\\Programs\\Python\\Python313\\python.exe'
    const results = await scanAvailablePythons({
      platform: 'win32',
      home: 'C:\\Users\\test',
      env: {
        LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
        ProgramFiles: 'C:\\Program Files'
      } as NodeJS.ProcessEnv,
      fsExists: (p) => p === pyPath,
      execCmd: (cmd) => (cmd.includes('where') ? pyPath : ''),
      probeCmd: async (p) => (p === pyPath ? '3.13.2' : null)
    })

    expect(results).toHaveLength(1)
    expect(results[0].path).toBe(pyPath)
    expect(results[0].version).toBe('3.13.2')
    expect(results[0].name).toBe('Python 3.13.2')
    expect(results[0].isDefault).toBe(true)
  })

  it('filters out WindowsApps python alias stubs', async () => {
    const aliasPath = 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe'
    const results = await scanAvailablePythons({
      platform: 'win32',
      home: 'C:\\Users\\test',
      env: {
        LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local'
      } as NodeJS.ProcessEnv,
      fsExists: (p) => p === aliasPath,
      execCmd: (cmd) => (cmd.includes('where') ? aliasPath : ''),
      probeCmd: async () => '3.13.0'
    })

    expect(results).toHaveLength(0)
  })

  it('scans macOS python paths', async () => {
    const results = await scanAvailablePythons({
      platform: 'darwin',
      home: '/Users/test',
      fsExists: (p) => p === '/opt/homebrew/bin/python3',
      execCmd: () => '',
      probeCmd: async (p) => (p === '/opt/homebrew/bin/python3' ? '3.12.1' : null)
    })

    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('/opt/homebrew/bin/python3')
    expect(results[0].version).toBe('3.12.1')
  })
})
