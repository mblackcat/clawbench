import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync, spawn, execFile } from 'child_process'
import { settingsStore } from '../store/settings.store'
import * as logger from '../utils/logger'
import { mainT } from '../utils/i18n'

export interface TerminalDetectOptions {
  platform?: string
  home?: string
  env?: NodeJS.ProcessEnv
  fsExists?: (p: string) => boolean
  execCmd?: (cmd: string) => string
}

export interface DetectedTerminalOption {
  id: string
  name: string
  path: string
  isDefault?: boolean
}

function checkExecutable(
  p: string,
  exists: (p: string) => boolean,
  runCmd: (cmd: string) => string
): boolean {
  if (!p) return false
  try {
    if (exists(p)) return true
  } catch {
    // ignore
  }
  if (process.platform === 'win32' && /Microsoft[\\/]WindowsApps/i.test(p)) {
    try {
      const base = path.basename(p)
      const out = runCmd(`where "${base}"`)
      return out.toLowerCase().includes(base.toLowerCase())
    } catch {
      return false
    }
  }
  return false
}

/**
 * Detect available local terminal application on the host machine.
 *
 * Windows strategy:
 * 1. Check user-configured default terminal (registry DelegationTerminal) and modern Windows Terminal (wt.exe).
 *    Also checks popular third-party terminals (WezTerm, Alacritty, Hyper, Git Bash).
 * 2. Fallback to PowerShell (PowerShell 7 pwsh.exe first, then Windows PowerShell).
 * 3. Fallback to cmd.exe.
 */
export function detectLocalTerminal(options: TerminalDetectOptions = {}): string | null {
  const platform = options.platform ?? process.platform
  const pathMod = platform === 'win32' ? path.win32 : path.posix
  const home = options.home ?? os.homedir()
  const env = options.env ?? process.env
  const exists = options.fsExists ?? ((p: string) => fs.existsSync(p))
  const runCmd = options.execCmd ?? ((cmd: string) => {
    try {
      return execSync(cmd, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000
      })
    } catch {
      return ''
    }
  })

  if (platform === 'darwin') {
    const candidates = [
      pathMod.join(home, 'Applications', 'iTerm.app'),
      '/Applications/iTerm.app',
      pathMod.join(home, 'Applications', 'Warp.app'),
      '/Applications/Warp.app',
      pathMod.join(home, 'Applications', 'Ghostty.app'),
      '/Applications/Ghostty.app',
      pathMod.join(home, 'Applications', 'Alacritty.app'),
      '/Applications/Alacritty.app',
      '/System/Applications/Utilities/Terminal.app',
      '/Applications/Utilities/Terminal.app'
    ]
    for (const p of candidates) {
      if (exists(p)) return p
    }
    return null
  }

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || ''
    const programFiles = env.ProgramFiles || 'C:\\Program Files'
    const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows'

    // 1. Check user-configured default terminal in Windows registry
    let delegationGuid = ''
    try {
      const regOut = runCmd('reg query "HKCU\\Console\\%%Startup" /v DelegationTerminal')
      const match = regOut.match(/DelegationTerminal\s+REG_SZ\s+([^\r\n]+)/i)
      if (match) {
        delegationGuid = match[1].trim()
      }
    } catch {
      // ignore
    }

    // Windows Console Host GUID
    const isConhostDefault = delegationGuid === '{00000000-0000-0000-0000-000000000000}'

    // If not explicitly set to conhost, prioritize Windows Terminal (wt.exe)
    if (!isConhostDefault) {
      const wtExe = localAppData ? pathMod.join(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe') : ''
      if (wtExe && checkExecutable(wtExe, exists, runCmd)) {
        return wtExe
      }
      const whereWt = runCmd('where wt.exe').trim().split(/\r?\n/)[0]
      if (whereWt && checkExecutable(whereWt, exists, runCmd)) {
        return whereWt
      }
    }

    // Check modern third-party terminals
    const thirdPartyCandidates = [
      pathMod.join(localAppData, 'Programs', 'WezTerm', 'wezterm.exe'),
      pathMod.join(programFiles, 'WezTerm', 'wezterm.exe'),
      pathMod.join(home, '.cargo', 'bin', 'alacritty.exe'),
      pathMod.join(programFiles, 'Alacritty', 'alacritty.exe'),
      pathMod.join(localAppData, 'Programs', 'hyper', 'Hyper.exe'),
      pathMod.join(programFiles, 'Git', 'git-bash.exe')
    ]
    for (const p of thirdPartyCandidates) {
      if (p && exists(p)) return p
    }

    // 2. PowerShell fallback (pwsh.exe first, then Windows PowerShell)
    const pwshCandidates = [
      pathMod.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
      pathMod.join(localAppData, 'Programs', 'PowerShell', '7', 'pwsh.exe'),
      pathMod.join(localAppData, 'Microsoft', 'WindowsApps', 'pwsh.exe')
    ]
    for (const p of pwshCandidates) {
      if (p && checkExecutable(p, exists, runCmd)) return p
    }
    const wherePwsh = runCmd('where pwsh.exe').trim().split(/\r?\n/)[0]
    if (wherePwsh && checkExecutable(wherePwsh, exists, runCmd)) {
      return wherePwsh
    }
    const winPowerShell = pathMod.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (exists(winPowerShell)) {
      return winPowerShell
    }
    const wherePs = runCmd('where powershell.exe').trim().split(/\r?\n/)[0]
    if (wherePs && exists(wherePs)) {
      return wherePs
    }

    // 3. cmd.exe fallback
    const cmdExe = pathMod.join(systemRoot, 'System32', 'cmd.exe')
    if (exists(cmdExe)) {
      return cmdExe
    }
    const whereCmd = runCmd('where cmd.exe').trim().split(/\r?\n/)[0]
    if (whereCmd && exists(whereCmd)) {
      return whereCmd
    }

    return 'cmd.exe'
  }

  // Linux terminal candidates
  const linuxCandidates = [
    '/usr/bin/x-terminal-emulator',
    '/usr/bin/gnome-terminal',
    '/usr/bin/konsole',
    '/usr/bin/kitty',
    '/usr/bin/alacritty',
    '/usr/bin/xterm'
  ]
  for (const p of linuxCandidates) {
    if (exists(p)) return p
  }

  return null
}

let cachedTerminals: DetectedTerminalOption[] | null = null

/**
 * Scan all available terminal applications on the host machine.
 */
export function detectAllTerminals(
  options: TerminalDetectOptions = {},
  forceRefresh = false
): DetectedTerminalOption[] {
  const isTest = Boolean(options.fsExists || options.execCmd || options.platform)
  if (!isTest && !forceRefresh && cachedTerminals !== null && cachedTerminals.length > 0) {
    return cachedTerminals
  }

  const platform = options.platform ?? process.platform
  const pathMod = platform === 'win32' ? path.win32 : path.posix
  const home = options.home ?? os.homedir()
  const env = options.env ?? process.env
  const exists = options.fsExists ?? ((p: string) => fs.existsSync(p))
  const runCmd = options.execCmd ?? ((cmd: string) => {
    try {
      return execSync(cmd, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000
      })
    } catch {
      return ''
    }
  })

  const defaultTerminal = detectLocalTerminal(options)
  const results: DetectedTerminalOption[] = []
  const seenPaths = new Set<string>()

  const addOption = (id: string, name: string, termPath: string): void => {
    if (!termPath) return
    const normalized = termPath.toLowerCase().trim()
    if (seenPaths.has(normalized)) return
    seenPaths.add(normalized)
    results.push({
      id,
      name,
      path: termPath,
      isDefault: defaultTerminal ? termPath.toLowerCase() === defaultTerminal.toLowerCase() : false
    })
  }

  if (platform === 'darwin') {
    const candidates = [
      { id: 'iterm2', name: 'iTerm2', paths: [pathMod.join(home, 'Applications', 'iTerm.app'), '/Applications/iTerm.app'] },
      { id: 'terminal', name: 'Terminal.app', paths: ['/System/Applications/Utilities/Terminal.app', '/Applications/Utilities/Terminal.app'] },
      { id: 'warp', name: 'Warp', paths: [pathMod.join(home, 'Applications', 'Warp.app'), '/Applications/Warp.app'] },
      { id: 'ghostty', name: 'Ghostty', paths: [pathMod.join(home, 'Applications', 'Ghostty.app'), '/Applications/Ghostty.app'] },
      { id: 'alacritty', name: 'Alacritty', paths: [pathMod.join(home, 'Applications', 'Alacritty.app'), '/Applications/Alacritty.app'] },
      { id: 'kitty', name: 'Kitty', paths: [pathMod.join(home, 'Applications', 'kitty.app'), '/Applications/kitty.app'] },
      { id: 'wezterm', name: 'WezTerm', paths: [pathMod.join(home, 'Applications', 'WezTerm.app'), '/Applications/WezTerm.app'] },
      { id: 'hyper', name: 'Hyper', paths: [pathMod.join(home, 'Applications', 'Hyper.app'), '/Applications/Hyper.app'] }
    ]

    for (const item of candidates) {
      for (const p of item.paths) {
        if (exists(p)) {
          addOption(item.id, item.name, p)
          break
        }
      }
    }
  } else if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || ''
    const programFiles = env.ProgramFiles || 'C:\\Program Files'
    const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows'

    // 1. Windows Terminal
    const wtPaths = [
      pathMod.join(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe'),
      runCmd('where wt.exe').trim().split(/\r?\n/)[0]
    ]
    for (const p of wtPaths) {
      if (p && checkExecutable(p, exists, runCmd)) {
        addOption('wt', 'Windows Terminal', p)
        break
      }
    }

    // 2. PowerShell 7 (pwsh.exe)
    const pwshPaths = [
      pathMod.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
      pathMod.join(programFilesX86, 'PowerShell', '7', 'pwsh.exe'),
      pathMod.join(localAppData, 'Programs', 'PowerShell', '7', 'pwsh.exe'),
      pathMod.join(localAppData, 'Microsoft', 'WindowsApps', 'pwsh.exe'),
      runCmd('where pwsh.exe').trim().split(/\r?\n/)[0]
    ]
    for (const p of pwshPaths) {
      if (p && checkExecutable(p, exists, runCmd)) {
        addOption('pwsh', 'PowerShell 7', p)
        break
      }
    }

    // 3. Windows PowerShell
    const winPsPaths = [
      pathMod.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      runCmd('where powershell.exe').trim().split(/\r?\n/)[0]
    ]
    for (const p of winPsPaths) {
      if (p && checkExecutable(p, exists, runCmd)) {
        addOption('powershell', 'Windows PowerShell', p)
        break
      }
    }

    // 4. Command Prompt (cmd.exe)
    const cmdPaths = [
      pathMod.join(systemRoot, 'System32', 'cmd.exe'),
      runCmd('where cmd.exe').trim().split(/\r?\n/)[0]
    ]
    let cmdAdded = false
    for (const p of cmdPaths) {
      if (p && checkExecutable(p, exists, runCmd)) {
        addOption('cmd', mainT('terminal.cmdName'), p)
        cmdAdded = true
        break
      }
    }
    if (!cmdAdded) {
      addOption('cmd', mainT('terminal.cmdName'), 'cmd.exe')
    }

    // 5. Git Bash
    const gitBashPaths = [
      pathMod.join(programFiles, 'Git', 'git-bash.exe'),
      pathMod.join(programFiles, 'Git', 'bin', 'bash.exe'),
      pathMod.join(programFilesX86, 'Git', 'git-bash.exe'),
      pathMod.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
      pathMod.join(localAppData, 'Programs', 'Git', 'git-bash.exe'),
      pathMod.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe')
    ]
    for (const p of gitBashPaths) {
      if (p && checkExecutable(p, exists, runCmd)) {
        addOption('git-bash', 'Git Bash', p)
        break
      }
    }

    // 6. WSL (Windows Subsystem for Linux)
    const wslPath = pathMod.join(systemRoot, 'System32', 'wsl.exe')
    if (checkExecutable(wslPath, exists, runCmd)) {
      addOption('wsl', 'WSL (bash)', wslPath)
    }

    // 7. Third-party terminals
    const thirdParties = [
      { id: 'wezterm', name: 'WezTerm', paths: [pathMod.join(localAppData, 'Programs', 'WezTerm', 'wezterm.exe'), pathMod.join(programFiles, 'WezTerm', 'wezterm.exe')] },
      { id: 'alacritty', name: 'Alacritty', paths: [pathMod.join(programFiles, 'Alacritty', 'alacritty.exe'), pathMod.join(home, '.cargo', 'bin', 'alacritty.exe')] },
      { id: 'hyper', name: 'Hyper', paths: [pathMod.join(localAppData, 'Programs', 'hyper', 'Hyper.exe')] },
      { id: 'cmder', name: 'Cmder', paths: [pathMod.join(localAppData, 'Programs', 'cmder', 'Cmder.exe'), 'C:\\cmder\\Cmder.exe'] }
    ]
    for (const item of thirdParties) {
      for (const p of item.paths) {
        if (p && checkExecutable(p, exists, runCmd)) {
          addOption(item.id, item.name, p)
          break
        }
      }
    }
  } else {
    // Linux
    const linuxCandidates = [
      { id: 'gnome-terminal', name: 'GNOME Terminal', path: '/usr/bin/gnome-terminal' },
      { id: 'konsole', name: 'Konsole', path: '/usr/bin/konsole' },
      { id: 'kitty', name: 'Kitty', path: '/usr/bin/kitty' },
      { id: 'alacritty', name: 'Alacritty', path: '/usr/bin/alacritty' },
      { id: 'wezterm', name: 'WezTerm', path: '/usr/bin/wezterm' },
      { id: 'x-terminal-emulator', name: 'Default Terminal', path: '/usr/bin/x-terminal-emulator' },
      { id: 'xterm', name: 'XTerm', path: '/usr/bin/xterm' }
    ]
    for (const item of linuxCandidates) {
      if (exists(item.path)) {
        addOption(item.id, item.name, item.path)
      }
    }
  }

  // If no terminal was marked isDefault but we have a defaultTerminal, or results has items:
  if (results.length > 0 && !results.some((r) => r.isDefault)) {
    results[0].isDefault = true
  }

  if (!isTest) {
    cachedTerminals = results
  }

  return results
}

/**
 * Resolve the interactive shell binary and arguments for an embedded PTY session (e.g. AI Terminal),
 * honoring the user's `localTerminalPath` setting from settingsStore.
 */
export function resolveLocalTerminalShell(): { command: string; args: string[] } {
  const configured = ((settingsStore.get('localTerminalPath') as string) || '').trim()

  if (configured) {
    const lower = configured.toLowerCase()

    // 1. Windows Terminal (wt.exe):
    // wt.exe is a GUI window wrapper that launches a terminal window.
    // Inside an embedded node-pty session, we need an interactive shell binary.
    // Resolve to PowerShell (pwsh or powershell.exe).
    if (lower.endsWith('wt.exe') || lower === 'wt') {
      const all = detectAllTerminals()
      const pwsh = all.find((t) => t.id === 'pwsh')
      if (pwsh) return { command: pwsh.path, args: [] }
      const winPs = all.find((t) => t.id === 'powershell')
      if (winPs) return { command: winPs.path, args: [] }
      return { command: 'powershell.exe', args: [] }
    }

    // 2. macOS .app bundle (e.g. /Applications/iTerm.app, Terminal.app)
    if (configured.endsWith('.app')) {
      return { command: process.env.SHELL || '/bin/zsh', args: [] }
    }

    // 3. Git Bash (git-bash.exe):
    // git-bash.exe is a GUI launcher (starts mintty window).
    // For embedded node-pty, resolve to bin\bash.exe or usr\bin\bash.exe with login args.
    if (lower.endsWith('git-bash.exe')) {
      const gitDir = path.dirname(configured)
      const binBash = path.join(gitDir, 'bin', 'bash.exe')
      const usrBash = path.join(gitDir, 'usr', 'bin', 'bash.exe')
      if (fs.existsSync(binBash)) {
        return { command: binBash, args: ['--login', '-i'] }
      }
      if (fs.existsSync(usrBash)) {
        return { command: usrBash, args: ['--login', '-i'] }
      }
    }

    // 4. bash.exe: start as interactive login shell
    if (lower.endsWith('bash.exe') || lower === 'bash') {
      return { command: configured, args: ['--login', '-i'] }
    }

    // 5. Any other configured shell (.exe or binary):
    return { command: configured, args: [] }
  }

  // Fallback if not configured:
  if (process.platform === 'win32') {
    const all = detectAllTerminals()
    const preferred = all.find((t) => t.id === 'pwsh' || t.id === 'powershell')
    if (preferred) {
      return { command: preferred.path, args: [] }
    }
    return { command: 'cmd.exe', args: [] }
  }

  return { command: process.env.SHELL || '/bin/bash', args: [] }
}

/**
 * Launch an external terminal window navigated to `dirPath`, optionally running `toolCommand`.
 */
export function openExternalTerminal(dirPath: string, toolCommand?: string | null): void {
  const platform = process.platform
  const configuredTerminal = (settingsStore.get('localTerminalPath') as string) || ''
  const terminalApp = configuredTerminal || detectLocalTerminal() || ''

  logger.info(`[terminal] Opening external terminal: terminalApp="${terminalApp}", dir="${dirPath}", cmd="${toolCommand || ''}"`)

  if (platform === 'darwin') {
    const home = os.homedir()
    let effectiveApp = terminalApp
    if (!effectiveApp) {
      const iTermPaths = [path.join(home, 'Applications', 'iTerm.app'), '/Applications/iTerm.app']
      effectiveApp = iTermPaths.find((p) => fs.existsSync(p)) || ''
    }

    const escapedPath = dirPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const escapedCmd = toolCommand
      ? `cd \\"${escapedPath}\\" && ${toolCommand}`
      : `cd \\"${escapedPath}\\"`

    const appName = effectiveApp.replace(/.*\//, '').replace(/\.app$/, '')

    if (appName === 'iTerm' || appName === 'iTerm2') {
      const appId = effectiveApp || 'iTerm'
      execFile('osascript', [
        '-e', `tell application "${appId}"`,
        '-e', '  activate',
        '-e', '  set newWindow to (create window with default profile)',
        '-e', '  tell current session of newWindow',
        '-e', `    write text "${escapedCmd}"`,
        '-e', '  end tell',
        '-e', 'end tell'
      ])
    } else if (!effectiveApp || appName === 'Terminal') {
      const appId = effectiveApp || 'Terminal'
      execFile('osascript', [
        '-e', `tell application "${appId}" to do script "${escapedCmd}"`,
        '-e', `tell application "${appId}" to activate`
      ])
    } else {
      const args = ['-a', effectiveApp, dirPath]
      spawn('open', args, { detached: true, stdio: 'ignore' }).unref()
    }
  } else if (platform === 'win32') {
    const termLower = terminalApp.toLowerCase()
    const isWindowsTerminal = termLower.endsWith('wt.exe') || termLower === 'wt'
    const isPowerShell = termLower.includes('powershell') || termLower.includes('pwsh')
    const isCmd = termLower.endsWith('cmd.exe') || termLower === 'cmd'
    const isGitBash = termLower.includes('git-bash') || termLower.endsWith('bash.exe')

    if (isWindowsTerminal || (!terminalApp && fs.existsSync(`${process.env.LOCALAPPDATA}\\Microsoft\\WindowsApps\\wt.exe`))) {
      const wtCmd = terminalApp || 'wt.exe'
      if (toolCommand) {
        spawn('cmd.exe', ['/c', 'start', '""', wtCmd, '-d', `"${dirPath}"`, 'cmd.exe', '/K', toolCommand], {
          detached: true,
          stdio: 'ignore',
          shell: true
        }).unref()
      } else {
        spawn('cmd.exe', ['/c', 'start', '""', wtCmd, '-d', `"${dirPath}"`], {
          detached: true,
          stdio: 'ignore',
          shell: true
        }).unref()
      }
    } else if (isPowerShell) {
      const psEscapedDir = dirPath.replace(/'/g, "''")
      const psCommand = toolCommand
        ? `Set-Location -LiteralPath '${psEscapedDir}'; ${toolCommand}`
        : `Set-Location -LiteralPath '${psEscapedDir}'`

      spawn('cmd.exe', ['/c', 'start', '""', terminalApp, '-NoExit', '-Command', psCommand], {
        detached: true,
        stdio: 'ignore',
        shell: true
      }).unref()
    } else if (isCmd || !terminalApp) {
      const winCmd = toolCommand
        ? `cd /d "${dirPath}" && ${toolCommand}`
        : `cd /d "${dirPath}"`
      const cmdPath = terminalApp || 'cmd.exe'

      spawn('cmd.exe', ['/c', 'start', '""', cmdPath, '/K', `"${winCmd}"`], {
        detached: true,
        stdio: 'ignore',
        shell: true
      }).unref()
    } else if (isGitBash) {
      spawn('cmd.exe', ['/c', 'start', '""', terminalApp, `--cd="${dirPath}"`], {
        detached: true,
        stdio: 'ignore',
        shell: true
      }).unref()
    } else {
      // Generic Windows terminal executable
      spawn(terminalApp, [], { cwd: dirPath, detached: true, stdio: 'ignore' }).unref()
    }
  } else {
    // Linux fallback
    execFile('xdg-open', [dirPath])
  }
}
