import { describe, expect, it, vi } from 'vitest'
import { detectLocalTerminal, detectAllTerminals, resolveLocalTerminalShell } from '../terminal-detect.service'
import { settingsStore } from '../../store/settings.store'

// In-memory settings store: keeps tests off the real electron-store file.
vi.mock('../../store/settings.store', () => {
  const data = new Map<string, unknown>()
  return {
    settingsStore: {
      get: (key: string) => data.get(key),
      set: (key: string, value: unknown) => {
        data.set(key, value)
      }
    }
  }
})

describe('terminal-detect.service', () => {
  describe('Windows detection & fallback hierarchy', () => {
    it('prioritizes Windows Terminal (wt.exe) when available', () => {
      const detected = detectLocalTerminal({
        platform: 'win32',
        home: 'C:\\Users\\test',
        env: {
          LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
          SystemRoot: 'C:\\Windows'
        } as NodeJS.ProcessEnv,
        fsExists: (p) => p.toLowerCase().includes('wt.exe'),
        execCmd: () => ''
      })

      expect(detected).toContain('wt.exe')
    })

    it('detects Windows Terminal via "where wt.exe" PATH lookup', () => {
      const detected = detectLocalTerminal({
        platform: 'win32',
        home: 'C:\\Users\\test',
        env: {
          LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
          SystemRoot: 'C:\\Windows'
        } as NodeJS.ProcessEnv,
        fsExists: (p) => p === 'C:\\CustomPath\\wt.exe',
        execCmd: (cmd) => cmd.includes('where wt.exe') ? 'C:\\CustomPath\\wt.exe' : ''
      })

      expect(detected).toBe('C:\\CustomPath\\wt.exe')
    })

    it('detects third-party terminal if Windows Terminal is not installed', () => {
      const weztermPath = 'C:\\Program Files\\WezTerm\\wezterm.exe'
      const detected = detectLocalTerminal({
        platform: 'win32',
        home: 'C:\\Users\\test',
        env: {
          LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
          ProgramFiles: 'C:\\Program Files',
          SystemRoot: 'C:\\Windows'
        } as NodeJS.ProcessEnv,
        fsExists: (p) => p === weztermPath,
        execCmd: () => ''
      })

      expect(detected).toBe(weztermPath)
    })

    it('falls back to PowerShell (pwsh.exe) when modern terminals are absent', () => {
      const pwshPath = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
      const detected = detectLocalTerminal({
        platform: 'win32',
        home: 'C:\\Users\\test',
        env: {
          LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
          ProgramFiles: 'C:\\Program Files',
          SystemRoot: 'C:\\Windows'
        } as NodeJS.ProcessEnv,
        fsExists: (p) => p === pwshPath,
        execCmd: () => ''
      })

      expect(detected).toBe(pwshPath)
    })

    it('falls back to Windows PowerShell when pwsh.exe is not installed', () => {
      const winPsPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      const detected = detectLocalTerminal({
        platform: 'win32',
        home: 'C:\\Users\\test',
        env: {
          LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
          ProgramFiles: 'C:\\Program Files',
          SystemRoot: 'C:\\Windows'
        } as NodeJS.ProcessEnv,
        fsExists: (p) => p === winPsPath,
        execCmd: () => ''
      })

      expect(detected).toBe(winPsPath)
    })

    it('falls back to cmd.exe when neither Windows Terminal nor PowerShell exists', () => {
      const cmdPath = 'C:\\Windows\\System32\\cmd.exe'
      const detected = detectLocalTerminal({
        platform: 'win32',
        home: 'C:\\Users\\test',
        env: {
          LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
          ProgramFiles: 'C:\\Program Files',
          SystemRoot: 'C:\\Windows'
        } as NodeJS.ProcessEnv,
        fsExists: (p) => p === cmdPath,
        execCmd: () => ''
      })

      expect(detected).toBe(cmdPath)
    })

    it('falls back to "cmd.exe" as final safe resort when no files match', () => {
      const detected = detectLocalTerminal({
        platform: 'win32',
        home: 'C:\\Users\\test',
        env: {
          LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local'
        } as NodeJS.ProcessEnv,
        fsExists: () => false,
        execCmd: () => ''
      })

      expect(detected).toBe('cmd.exe')
    })
  })

  describe('macOS detection', () => {
    it('detects iTerm.app if installed', () => {
      const detected = detectLocalTerminal({
        platform: 'darwin',
        home: '/Users/test',
        fsExists: (p) => p === '/Applications/iTerm.app'
      })

      expect(detected).toBe('/Applications/iTerm.app')
    })

    it('detects Terminal.app as macOS fallback', () => {
      const detected = detectLocalTerminal({
        platform: 'darwin',
        home: '/Users/test',
        fsExists: (p) => p === '/System/Applications/Utilities/Terminal.app'
      })

      expect(detected).toBe('/System/Applications/Utilities/Terminal.app')
    })
  })

  describe('Linux detection', () => {
    it('detects gnome-terminal on Linux', () => {
      const detected = detectLocalTerminal({
        platform: 'linux',
        home: '/home/test',
        fsExists: (p) => p === '/usr/bin/gnome-terminal'
      })

      expect(detected).toBe('/usr/bin/gnome-terminal')
    })
  })

  describe('detectAllTerminals', () => {
    it('lists all installed terminals on Windows with default marked', () => {
      const cmdPath = 'C:\\Windows\\System32\\cmd.exe'
      const psPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      const gitBash = 'C:\\Program Files\\Git\\git-bash.exe'
      const all = detectAllTerminals({
        platform: 'win32',
        home: 'C:\\Users\\test',
        env: {
          LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
          ProgramFiles: 'C:\\Program Files',
          SystemRoot: 'C:\\Windows'
        } as NodeJS.ProcessEnv,
        fsExists: (p) => [cmdPath, psPath, gitBash].includes(p),
        execCmd: () => ''
      })

      expect(all.length).toBeGreaterThanOrEqual(3)
      expect(all.some((t) => t.id === 'powershell')).toBe(true)
      expect(all.some((t) => t.id === 'cmd')).toBe(true)
      expect(all.some((t) => t.id === 'git-bash')).toBe(true)
      expect(all.some((t) => t.isDefault)).toBe(true)
    })

    it('lists available macOS terminals', () => {
      const all = detectAllTerminals({
        platform: 'darwin',
        home: '/Users/test',
        fsExists: (p) => ['/Applications/iTerm.app', '/System/Applications/Utilities/Terminal.app'].includes(p)
      })

      expect(all).toHaveLength(2)
      expect(all[0].id).toBe('iterm2')
      expect(all[0].isDefault).toBe(true)
      expect(all[1].id).toBe('terminal')
    })
  })

  describe('resolveLocalTerminalShell', () => {
    it('resolves git-bash.exe to underlying bash.exe with login args', () => {
      settingsStore.set('localTerminalPath', 'C:\\Program Files\\Git\\git-bash.exe')
      const resolved = resolveLocalTerminalShell()
      expect(resolved.command.toLowerCase()).toContain('bash.exe')
      expect(resolved.args).toEqual(['--login', '-i'])
    })

    it('honors powershell.exe when configured in settings', () => {
      const psPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      settingsStore.set('localTerminalPath', psPath)
      const resolved = resolveLocalTerminalShell()
      expect(resolved.command).toBe(psPath)
      expect(resolved.args).toEqual([])
    })
  })
})
