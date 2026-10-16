import { describe, expect, it, vi } from 'vitest'
import {
  detectLocalTerminal,
  detectAllTerminals,
  resolveLocalTerminalShell,
  isGuiTerminalEmulator,
  buildExternalTerminalLaunch
} from '../terminal-detect.service'
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
      const resolved = resolveLocalTerminalShell({
        platform: 'win32',
        fsExists: (p) => p === 'C:\\Program Files\\Git\\bin\\bash.exe'
      })
      expect(resolved.command).toBe('C:\\Program Files\\Git\\bin\\bash.exe')
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

  describe('resolveLocalTerminalShell — GUI emulators map to a real shell', () => {
    const winList = () => [
      { id: 'wt', name: 'Windows Terminal', path: 'C:\\wt.exe' },
      { id: 'powershell', name: 'Windows PowerShell', path: 'C:\\ps\\powershell.exe' },
      { id: 'cmd', name: 'cmd', path: 'C:\\Windows\\System32\\cmd.exe' }
    ]

    it.each([
      'C:\\Program Files\\WezTerm\\wezterm.exe',
      'C:\\Program Files\\Alacritty\\alacritty.exe',
      'C:\\Users\\u\\AppData\\Local\\Programs\\hyper\\Hyper.exe',
      'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe'
    ])('Windows: %s → powershell (no pwsh installed)', (configured) => {
      const r = resolveLocalTerminalShell({ configured, platform: 'win32', env: {}, listTerminals: winList })
      expect(r.command).toBe('C:\\ps\\powershell.exe')
    })

    it('Windows: prefers pwsh, then falls back to cmd', () => {
      const withPwsh = () => [{ id: 'pwsh', name: 'pwsh', path: 'C:\\pwsh.exe' }, ...winList()]
      expect(
        resolveLocalTerminalShell({ configured: 'wt.exe', platform: 'win32', env: {}, listTerminals: withPwsh }).command
      ).toBe('C:\\pwsh.exe')
      expect(
        resolveLocalTerminalShell({ configured: 'wt.exe', platform: 'win32', env: {}, listTerminals: () => [] }).command
      ).toBe('cmd.exe')
    })

    it.each([
      '/Applications/iTerm.app',
      '/System/Applications/Utilities/Terminal.app',
      '/Applications/Warp.app',
      '/Applications/Ghostty.app',
      '/usr/bin/gnome-terminal',
      '/usr/bin/konsole',
      '/usr/bin/kitty'
    ])('POSIX: %s → $SHELL', (configured) => {
      const r = resolveLocalTerminalShell({ configured, platform: 'darwin', env: { SHELL: '/bin/zsh' } })
      expect(r).toEqual({ command: '/bin/zsh', args: [] })
    })

    it('POSIX: falls back to /bin/bash without $SHELL; keeps real shells', () => {
      expect(resolveLocalTerminalShell({ configured: '', platform: 'linux', env: {} }).command).toBe('/bin/bash')
      expect(resolveLocalTerminalShell({ configured: '/opt/homebrew/bin/fish', platform: 'darwin', env: {} }).command).toBe(
        '/opt/homebrew/bin/fish'
      )
    })

    it('classifies emulators vs shells', () => {
      expect(isGuiTerminalEmulator('C:\\x\\WezTerm.exe')).toBe(true)
      expect(isGuiTerminalEmulator('/Applications/Foo.app/')).toBe(true)
      expect(isGuiTerminalEmulator('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe(false)
      expect(isGuiTerminalEmulator('/bin/zsh')).toBe(false)
      expect(isGuiTerminalEmulator('')).toBe(false)
    })
  })

  describe('buildExternalTerminalLaunch', () => {
    const none = () => false

    it('macOS unset: iTerm via AppleScript when installed, else Terminal.app', () => {
      const iterm = buildExternalTerminalLaunch('', "/w/it's here", 'claude', {
        platform: 'darwin',
        home: '/Users/u',
        env: {},
        fsExists: (p) => p === '/Applications/iTerm.app'
      })
      expect(iterm.file).toBe('osascript')
      expect(iterm.args.join('\n')).toContain('create window with default profile')
      expect(iterm.args.join('\n')).toContain(`write text "cd '/w/it'\\\\''s here' && claude"`)

      const term = buildExternalTerminalLaunch('', '/w/a "b"', 'codex', {
        platform: 'darwin',
        home: '/Users/u',
        env: {},
        fsExists: none
      })
      expect(term.args[1]).toBe(`tell application "Terminal" to do script "cd '/w/a \\"b\\"' && codex"`)
    })

    it('macOS Warp/Ghostty with a command fall back to master behaviour; without, open -a', () => {
      const opts = { platform: 'darwin', home: '/Users/u', env: {}, fsExists: none }
      expect(buildExternalTerminalLaunch('/Applications/Warp.app', '/w', 'claude', opts).file).toBe('osascript')
      expect(buildExternalTerminalLaunch('/Applications/Ghostty.app', '/w', null, opts)).toEqual({
        file: 'open',
        args: ['-a', '/Applications/Ghostty.app', '/w']
      })
    })

    it('macOS WezTerm / Alacritty pass the command', () => {
      const opts = { platform: 'darwin', home: '/Users/u', env: { SHELL: '/bin/zsh' }, fsExists: () => true }
      const wez = buildExternalTerminalLaunch('/Applications/WezTerm.app', '/w d', 'claude', opts)
      expect(wez.file).toBe('/Applications/WezTerm.app/Contents/MacOS/wezterm')
      expect(wez.args).toEqual(['start', '--cwd', '/w d', '--', '/bin/zsh', '-lc', "claude; exec '/bin/zsh' -l"])
      const ala = buildExternalTerminalLaunch('/Applications/Alacritty.app', '/w', 'claude', opts)
      expect(ala.args).toEqual(['--working-directory', '/w', '-e', '/bin/zsh', '-lc', "claude; exec '/bin/zsh' -l"])
    })

    it('Windows unset: wt.exe when present, else cmd /K', () => {
      const env = { LOCALAPPDATA: 'C:\\L' }
      const wtPath = 'C:\\L\\Microsoft\\WindowsApps\\wt.exe'
      const wt = buildExternalTerminalLaunch('', 'C:\\a b', 'claude; x', {
        platform: 'win32',
        env,
        fsExists: (p) => p === wtPath
      })
      expect(wt.file).toBe(wtPath)
      expect(wt.args).toEqual(['-d', 'C:\\a b', 'cmd.exe', '/K', 'claude\\; x'])

      const cmd = buildExternalTerminalLaunch('', 'C:\\a&b (x86)', 'claude', { platform: 'win32', env, fsExists: none })
      expect(cmd.file).toBe('cmd.exe')
      expect(cmd.verbatim).toBe(true)
      expect(cmd.args[0]).toBe('/d /c start "" "cmd.exe" /K cd /d ^"C:\\a^&b ^(x86^)^" ^&^& claude')
    })

    it('Windows configured shells and emulators all pass the command', () => {
      const opts = { platform: 'win32', env: {}, fsExists: none }
      const ps = buildExternalTerminalLaunch('C:\\pwsh.exe', "C:\\it's", 'claude', opts)
      expect(ps.args[0]).toBe(`/d /c start "" "C:\\pwsh.exe" -NoExit -Command Set-Location -LiteralPath 'C:\\it''s'; claude`)
      const gb = buildExternalTerminalLaunch('C:\\Git\\git-bash.exe', 'C:\\a b', 'claude', opts)
      expect(gb.args[0]).toBe('/d /c start "" "C:\\Git\\git-bash.exe" --cd=^"C:\\a b^" -c ^"claude; exec bash^"')
      const wez = buildExternalTerminalLaunch('C:\\WezTerm\\wezterm.exe', 'C:\\w', 'claude', opts)
      expect(wez.args).toEqual(['start', '--cwd', 'C:\\w', '--', 'cmd.exe', '/K', 'claude'])
      const ala = buildExternalTerminalLaunch('C:\\alacritty.exe', 'C:\\w', 'claude', opts)
      expect(ala.args).toEqual(['--working-directory', 'C:\\w', '-e', 'cmd.exe', '/K', 'claude'])
      // Hyper can't take a command → master fallback (cmd window here, no wt)
      expect(buildExternalTerminalLaunch('C:\\Hyper.exe', 'C:\\w', 'claude', opts).file).toBe('cmd.exe')
    })
  })
})
