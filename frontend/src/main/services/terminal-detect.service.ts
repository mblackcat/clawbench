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

// ─── Terminal classification ─────────────────────────────────────────────────

/** Lower-cased basename without `.exe` / `.app`, platform-agnostic. */
function terminalBaseName(p: string): string {
  const trimmed = p.trim().replace(/[\\/]+$/, '')
  const base = trimmed.split(/[\\/]/).pop() || trimmed
  return base.toLowerCase().replace(/\.(exe|app)$/, '')
}

/**
 * Known GUI terminal emulators (window hosts, not shells). These can launch an
 * external window but can't be used as the program of an embedded PTY.
 */
const GUI_TERMINAL_EMULATORS = new Set([
  'wt',
  'windowsterminal',
  'wezterm',
  'wezterm-gui',
  'alacritty',
  'hyper',
  'cmder',
  'conemu',
  'conemu64',
  'mintty',
  'tabby',
  'git-bash',
  'gnome-terminal',
  'gnome-terminal-server',
  'konsole',
  'kitty',
  'xterm',
  'x-terminal-emulator',
  'terminator',
  'tilix',
  'xfce4-terminal',
  'lxterminal',
  'mate-terminal',
  'iterm',
  'iterm2',
  'terminal',
  'warp',
  'ghostty'
])

/** True when `p` points at a GUI terminal emulator (incl. any macOS `.app` bundle). */
export function isGuiTerminalEmulator(p: string | null | undefined): boolean {
  if (!p || !p.trim()) return false
  if (/\.app[\\/]?$/i.test(p.trim())) return true
  return GUI_TERMINAL_EMULATORS.has(terminalBaseName(p))
}

export interface ResolveShellOptions {
  /** Defaults to `settings.localTerminalPath` */
  configured?: string | null
  platform?: string
  env?: NodeJS.ProcessEnv
  fsExists?: (p: string) => boolean
  /** Windows shell lookup (defaults to cached {@link detectAllTerminals}) */
  listTerminals?: () => DetectedTerminalOption[]
}

/** Default interactive shell when the configured terminal isn't a shell. */
function defaultShell(
  platform: string,
  env: NodeJS.ProcessEnv,
  listTerminals: () => DetectedTerminalOption[]
): { command: string; args: string[] } {
  if (platform === 'win32') {
    let all: DetectedTerminalOption[] = []
    try {
      all = listTerminals()
    } catch {
      // detection failure → plain fallbacks below
    }
    const pwsh = all.find((t) => t.id === 'pwsh')
    if (pwsh) return { command: pwsh.path, args: [] }
    const winPs = all.find((t) => t.id === 'powershell')
    if (winPs) return { command: winPs.path, args: [] }
    const cmd = all.find((t) => t.id === 'cmd')
    return { command: cmd?.path || 'cmd.exe', args: [] }
  }
  return { command: env.SHELL || '/bin/bash', args: [] }
}

/**
 * Resolve the interactive shell binary and arguments for an embedded PTY session (e.g. AI Terminal),
 * honoring the user's `localTerminalPath` setting.
 *
 * `localTerminalPath` serves two purposes — the external terminal window and the
 * embedded shell — so GUI emulators (WezTerm, Windows Terminal, iTerm …) map to a
 * real shell here (Windows: pwsh → powershell → cmd; POSIX: $SHELL → /bin/bash).
 */
export function resolveLocalTerminalShell(options: ResolveShellOptions = {}): { command: string; args: string[] } {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const exists = options.fsExists ?? ((p: string) => fs.existsSync(p))
  const listTerminals = options.listTerminals ?? (() => detectAllTerminals())
  const configured = (
    options.configured !== undefined
      ? options.configured ?? ''
      : ((settingsStore.get('localTerminalPath') as string) || '')
  ).trim()

  if (!configured) return defaultShell(platform, env, listTerminals)

  const lower = configured.toLowerCase()
  const pathMod = platform === 'win32' ? path.win32 : path.posix

  // Git Bash launcher (mintty window) → its bash.exe with login args
  if (lower.endsWith('git-bash.exe')) {
    const gitDir = pathMod.dirname(configured)
    for (const candidate of [pathMod.join(gitDir, 'bin', 'bash.exe'), pathMod.join(gitDir, 'usr', 'bin', 'bash.exe')]) {
      if (exists(candidate)) return { command: candidate, args: ['--login', '-i'] }
    }
    return defaultShell(platform, env, listTerminals)
  }

  if (isGuiTerminalEmulator(configured)) return defaultShell(platform, env, listTerminals)

  // bash.exe: start as interactive login shell
  if (lower.endsWith('bash.exe') || lower === 'bash') {
    return { command: configured, args: ['--login', '-i'] }
  }

  // Any other configured shell (pwsh, powershell, cmd, zsh, fish, nu …)
  return { command: configured, args: [] }
}

// ─── External terminal window ────────────────────────────────────────────────

export interface ExternalTerminalLaunch {
  file: string
  args: string[]
  cwd?: string
  /** Windows: pass the command line verbatim (already quoted/escaped) */
  verbatim?: boolean
}

export interface ExternalTerminalOptions {
  platform?: string
  env?: NodeJS.ProcessEnv
  home?: string
  fsExists?: (p: string) => boolean
}

/** POSIX single-quote a string for `sh`. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Escape a string for embedding inside an AppleScript double-quoted literal. */
function appleScriptString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Caret-escape cmd.exe metacharacters (incl. quotes) so the *outer*
 * `cmd /c start …` passes the text through unchanged to the launched program.
 */
function cmdCaretEscape(s: string): string {
  return s.replace(/([\^&|<>()"])/g, '^$1')
}

/** Quote one argument with MSVC (CommandLineToArgvW) rules. */
function winQuoteArg(arg: string): string {
  if (arg && !/[\s"]/.test(arg)) return arg
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
}

/**
 * `cmd /c start "" "<exe>" <tail>` — opens a new console window. `tail` is a
 * raw command line for the target program; it is caret-escaped for the outer cmd.
 */
function winStart(exe: string, tail: string, cwd: string): ExternalTerminalLaunch {
  const line = `/d /c start "" "${exe}"${tail ? ' ' + cmdCaretEscape(tail) : ''}`
  return { file: 'cmd.exe', args: [line], cwd, verbatim: true }
}

/** Master behaviour on Windows: Windows Terminal if present, else a cmd window. */
function windowsFallbackLaunch(
  wtExe: string | null,
  dirPath: string,
  toolCommand: string | null | undefined
): ExternalTerminalLaunch {
  if (wtExe) {
    // wt treats `;` as its own command separator — escape it
    const args = ['-d', dirPath]
    if (toolCommand) args.push('cmd.exe', '/K', toolCommand.replace(/;/g, '\\;'))
    return { file: wtExe, args, cwd: dirPath }
  }
  const inner = toolCommand ? `cd /d "${dirPath}" && ${toolCommand}` : `cd /d "${dirPath}"`
  return winStart('cmd.exe', `/K ${inner}`, dirPath)
}

/** Master behaviour on macOS: iTerm if installed, else Terminal.app, via AppleScript. */
function macAppleScriptLaunch(
  app: string,
  kind: 'iterm' | 'terminal',
  dirPath: string,
  toolCommand: string | null | undefined
): ExternalTerminalLaunch {
  const shellCmd = toolCommand ? `cd ${shQuote(dirPath)} && ${toolCommand}` : `cd ${shQuote(dirPath)}`
  const appId = appleScriptString(app)
  const cmd = appleScriptString(shellCmd)
  if (kind === 'iterm') {
    return {
      file: 'osascript',
      args: [
        '-e', `tell application "${appId}"`,
        '-e', '  activate',
        '-e', '  set newWindow to (create window with default profile)',
        '-e', '  tell current session of newWindow',
        '-e', `    write text "${cmd}"`,
        '-e', '  end tell',
        '-e', 'end tell'
      ]
    }
  }
  return {
    file: 'osascript',
    args: ['-e', `tell application "${appId}" to do script "${cmd}"`, '-e', `tell application "${appId}" to activate`]
  }
}

/**
 * Build the process launch(es) for opening an external terminal at `dirPath`,
 * optionally running `toolCommand`. Pure (aside from `fsExists`) for testability.
 *
 * - `terminalApp` empty → master fallback (macOS: iTerm else Terminal.app;
 *   Windows: wt.exe else `cmd /K`; Linux: xdg-open).
 * - configured → every branch passes the tool command; terminals that can't take
 *   a command (Warp, Ghostty, Hyper …) fall back to the master behaviour when a
 *   command is requested, else just open the folder.
 */
export function buildExternalTerminalLaunch(
  terminalApp: string,
  dirPath: string,
  toolCommand?: string | null,
  options: ExternalTerminalOptions = {}
): ExternalTerminalLaunch {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = options.home ?? os.homedir()
  const exists = options.fsExists ?? ((p: string) => fs.existsSync(p))
  const app = (terminalApp || '').trim()
  const base = app ? terminalBaseName(app) : ''

  if (platform === 'darwin') {
    const posixShell = env.SHELL || '/bin/zsh'
    const keepOpen = (cmd: string): string[] => ['-lc', `${cmd}; exec ${shQuote(posixShell)} -l`]
    const masterFallback = (): ExternalTerminalLaunch => {
      const iTerm = [path.posix.join(home, 'Applications', 'iTerm.app'), '/Applications/iTerm.app'].find((p) =>
        exists(p)
      )
      return iTerm
        ? macAppleScriptLaunch(iTerm, 'iterm', dirPath, toolCommand)
        : macAppleScriptLaunch('Terminal', 'terminal', dirPath, toolCommand)
    }
    if (!app) return masterFallback()
    if (base === 'iterm' || base === 'iterm2') return macAppleScriptLaunch(app, 'iterm', dirPath, toolCommand)
    if (base === 'terminal') return macAppleScriptLaunch(app, 'terminal', dirPath, toolCommand)

    const bundleBin = (name: string): string =>
      app.endsWith('.app') ? path.posix.join(app, 'Contents', 'MacOS', name) : app
    if (base === 'wezterm' || base === 'wezterm-gui') {
      const bin = bundleBin('wezterm')
      if (exists(bin)) {
        const args = ['start', '--cwd', dirPath]
        if (toolCommand) args.push('--', posixShell, ...keepOpen(toolCommand))
        return { file: bin, args, cwd: dirPath }
      }
    } else if (base === 'alacritty') {
      const bin = bundleBin('alacritty')
      if (exists(bin)) {
        const args = ['--working-directory', dirPath]
        if (toolCommand) args.push('-e', posixShell, ...keepOpen(toolCommand))
        return { file: bin, args, cwd: dirPath }
      }
    } else if (base === 'kitty') {
      const bin = bundleBin('kitty')
      if (exists(bin)) {
        const args = ['--directory', dirPath]
        if (toolCommand) args.push(posixShell, ...keepOpen(toolCommand))
        return { file: bin, args, cwd: dirPath }
      }
    }
    // Warp / Ghostty / Hyper / unknown: no reliable way to pass a command
    if (toolCommand) return masterFallback()
    return { file: 'open', args: ['-a', app, dirPath] }
  }

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || ''
    const defaultWt = localAppData ? path.win32.join(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe') : ''
    const masterFallback = (): ExternalTerminalLaunch =>
      windowsFallbackLaunch(defaultWt && exists(defaultWt) ? defaultWt : null, dirPath, toolCommand)
    if (!app) return masterFallback()

    if (base === 'wt' || base === 'windowsterminal') return windowsFallbackLaunch(app, dirPath, toolCommand)

    if (base === 'pwsh' || base === 'powershell') {
      const psDir = dirPath.replace(/'/g, "''")
      const psCmd = toolCommand
        ? `Set-Location -LiteralPath '${psDir}'; ${toolCommand}`
        : `Set-Location -LiteralPath '${psDir}'`
      return winStart(app, `-NoExit -Command ${psCmd}`, dirPath)
    }

    if (base === 'cmd') {
      const inner = toolCommand ? `cd /d "${dirPath}" && ${toolCommand}` : `cd /d "${dirPath}"`
      return winStart(app, `/K ${inner}`, dirPath)
    }

    if (base === 'git-bash') {
      const tail = [`--cd=${winQuoteArg(dirPath)}`]
      if (toolCommand) tail.push('-c', winQuoteArg(`${toolCommand}; exec bash`))
      return winStart(app, tail.join(' '), dirPath)
    }

    if (base === 'bash') {
      const tail = toolCommand
        ? `--login -i -c ${winQuoteArg(`cd ${shQuote(dirPath.replace(/\\/g, '/'))} && ${toolCommand}; exec bash --login -i`)}`
        : '--login -i'
      return winStart(app, tail, dirPath)
    }

    if (base === 'wezterm' || base === 'wezterm-gui') {
      const args = ['start', '--cwd', dirPath]
      if (toolCommand) args.push('--', 'cmd.exe', '/K', toolCommand)
      return { file: app, args, cwd: dirPath }
    }

    if (base === 'alacritty') {
      const args = ['--working-directory', dirPath]
      if (toolCommand) args.push('-e', 'cmd.exe', '/K', toolCommand)
      return { file: app, args, cwd: dirPath }
    }

    // Hyper / Cmder / WSL / unknown: can't reliably pass a command
    if (toolCommand) return masterFallback()
    return { file: app, args: [], cwd: dirPath }
  }

  // Linux
  if (app) {
    const posixShell = env.SHELL || '/bin/bash'
    const run = toolCommand ? [posixShell, '-lc', `${toolCommand}; exec ${shQuote(posixShell)} -l`] : []
    switch (base) {
      case 'gnome-terminal':
        return { file: app, args: [`--working-directory=${dirPath}`, ...(run.length ? ['--', ...run] : [])], cwd: dirPath }
      case 'konsole':
        return { file: app, args: ['--workdir', dirPath, ...(run.length ? ['-e', ...run] : [])], cwd: dirPath }
      case 'kitty':
        return { file: app, args: ['--directory', dirPath, ...run], cwd: dirPath }
      case 'alacritty':
        return { file: app, args: ['--working-directory', dirPath, ...(run.length ? ['-e', ...run] : [])], cwd: dirPath }
      case 'wezterm':
        return { file: app, args: ['start', '--cwd', dirPath, ...(run.length ? ['--', ...run] : [])], cwd: dirPath }
      case 'xterm':
      case 'x-terminal-emulator':
        return { file: app, args: run.length ? ['-e', ...run] : [], cwd: dirPath }
      default:
        break
    }
  }
  return { file: 'xdg-open', args: [dirPath] }
}

/**
 * Launch an external terminal window navigated to `dirPath`, optionally running `toolCommand`.
 * Never runs synchronous detection: an unset `localTerminalPath` uses the master fallback.
 */
export function openExternalTerminal(dirPath: string, toolCommand?: string | null): void {
  const terminalApp = ((settingsStore.get('localTerminalPath') as string) || '').trim()
  const launch = buildExternalTerminalLaunch(terminalApp, dirPath, toolCommand)

  logger.info(
    `[terminal] Opening external terminal: terminalApp="${terminalApp}", dir="${dirPath}", cmd="${toolCommand || ''}" -> ${launch.file}`
  )

  if (launch.file === 'osascript' || launch.file === 'xdg-open') {
    execFile(launch.file, launch.args, (err) => {
      if (err) logger.warn(`[terminal] ${launch.file} failed:`, err)
    })
    return
  }
  try {
    const child = spawn(launch.file, launch.args, {
      cwd: launch.cwd,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: launch.verbatim === true
    })
    child.on('error', (err) => logger.warn(`[terminal] Failed to launch ${launch.file}:`, err))
    child.unref()
  } catch (err) {
    logger.warn(`[terminal] Failed to launch ${launch.file}:`, err)
  }
}
