import { describe, expect, it } from 'vitest'
import { detectLocalIde, detectAllIdes } from '../ide-detect.service'

describe('ide-detect.service', () => {
  it('detects VS Code on Windows when available', () => {
    const vsCodePath = 'C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'
    const detected = detectLocalIde({
      platform: 'win32',
      home: 'C:\\Users\\test',
      env: {
        LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
        ProgramFiles: 'C:\\Program Files'
      } as NodeJS.ProcessEnv,
      fsExists: (p) => p === vsCodePath,
      execCmd: () => ''
    })

    expect(detected).toBe(vsCodePath)
  })

  it('detects all available IDEs on Windows', () => {
    const vsCodePath = 'C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'
    const cursorPath = 'C:\\Users\\test\\AppData\\Local\\Programs\\Cursor\\Cursor.exe'
    const all = detectAllIdes({
      platform: 'win32',
      home: 'C:\\Users\\test',
      env: {
        LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
        ProgramFiles: 'C:\\Program Files'
      } as NodeJS.ProcessEnv,
      fsExists: (p) => [vsCodePath, cursorPath].includes(p),
      execCmd: () => ''
    })

    expect(all).toHaveLength(2)
    expect(all[0].id).toBe('vscode')
    expect(all[0].isDefault).toBe(true)
    expect(all[1].id).toBe('cursor')
  })

  it('detects macOS IDEs', () => {
    const all = detectAllIdes({
      platform: 'darwin',
      home: '/Users/test',
      fsExists: (p) => p === '/Applications/Visual Studio Code.app'
    })

    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('vscode')
    expect(all[0].path).toBe('/Applications/Visual Studio Code.app')
  })
})
