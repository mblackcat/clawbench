import { execFile } from 'child_process'
import { promisify } from 'util'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import * as logger from '../utils/logger'

const execFileAsync = promisify(execFile)

export interface DetectedCLI {
  toolType: 'claude' | 'codex' | 'gemini' | 'opencode' | 'qwen' | 'grok' | 'terminal'
  name: string
  installed: boolean
  version?: string
}

/**
 * Cached shell environment loaded from a login shell.
 * When Electron is launched from the GUI (Dock/Launchpad), process.env is
 * minimal and misses variables set in .zshrc/.bashrc/.profile. We spawn a
 * login shell once to capture the full environment and cache it.
 */
let shellEnvCache: Record<string, string> | null = null
let shellEnvLoading: Promise<Record<string, string>> | null = null

/**
 * Load the user's full shell environment by spawning a login shell.
 * Result is cached for the lifetime of the process.
 */
export async function loadShellEnv(): Promise<Record<string, string>> {
  if (shellEnvCache) return shellEnvCache
  if (shellEnvLoading) return shellEnvLoading

  shellEnvLoading = (async () => {
    if (process.platform === 'win32') {
      shellEnvCache = { ...process.env } as Record<string, string>
      return shellEnvCache
    }

    const shell = process.env.SHELL || '/bin/zsh'
    try {
      // Use login shell to source profile files, then print env.
      // NOTE: Do NOT use -i (interactive) flag here — it modifies the parent
      // terminal's stty settings (disables isig), which breaks Ctrl+C in the
      // terminal that launched `npm run dev`.
      const { stdout } = await execFileAsync(shell, ['-lc', 'env'], {
        timeout: 5000,
        env: { ...process.env }
      })
      const parsed: Record<string, string> = {}
      for (const line of stdout.split('\n')) {
        const eqIdx = line.indexOf('=')
        if (eqIdx > 0) {
          const key = line.slice(0, eqIdx)
          const value = line.slice(eqIdx + 1)
          // Skip function definitions and multiline values
          if (!key.includes(' ') && !key.startsWith('BASH_FUNC_')) {
            parsed[key] = value
          }
        }
      }
      // Merge: process.env as base, then overlay shell env
      shellEnvCache = { ...process.env, ...parsed } as Record<string, string>
    } catch (err) {
      // If shell env loading fails, fall back to process.env
      logger.warn(`[shell-env] Failed to load login shell env (${err}), falling back to process.env`)
      shellEnvCache = { ...process.env } as Record<string, string>
    }
    return shellEnvCache
  })()

  return shellEnvLoading
}

/**
 * Synchronous version: returns cached shell env if available, otherwise process.env.
 * Call loadShellEnv() at app startup to ensure the cache is populated.
 */
function getBaseEnv(): Record<string, string> {
  return shellEnvCache ?? ({ ...process.env } as Record<string, string>)
}

/**
 * Build an augmented PATH that includes common npm global and tool binary
 * locations so CLI tools installed outside the default PATH can be found.
 */
export function getAugmentedEnv(): NodeJS.ProcessEnv {
  const env = getBaseEnv()
  const home = os.homedir()

  if (process.platform === 'win32') {
    // Windows PATH is case-insensitive at the OS level but JS object keys are not.
    // After spreading process.env the key may be `Path`, leaving `env.PATH` undefined —
    // read and write to whichever key already exists so we don't clobber the system PATH.
    const pathKey = 'PATH' in env ? 'PATH' : 'Path' in env ? 'Path' : 'PATH'
    const current = (env[pathKey] as string | undefined) || ''
    const parts = current.split(';')
    const appData = process.env.APPDATA
    if (appData) {
      const npmGlobal = path.join(appData, 'npm')
      if (!parts.some((x) => x.toLowerCase() === npmGlobal.toLowerCase())) {
        env[pathKey] = current ? `${current};${npmGlobal}` : npmGlobal
      }
    }
  } else {
    let p = env.PATH || ''
    const extras = [
      '/usr/local/bin',
      path.join(home, '.local', 'bin'), // Official Claude Code native installer location
      path.join(home, '.npm-global', 'bin'),
      '/opt/homebrew/bin'
    ]

    // nvm current symlink
    const nvmCurrent = path.join(home, '.nvm', 'current', 'bin')
    if (fs.existsSync(nvmCurrent)) {
      extras.push(nvmCurrent)
    } else {
      // Try to find the latest nvm version bin
      const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm')
      const nvmVersions = path.join(nvmDir, 'versions', 'node')
      if (fs.existsSync(nvmVersions)) {
        try {
          const versions = fs.readdirSync(nvmVersions)
          if (versions.length > 0) {
            extras.push(path.join(nvmVersions, versions[versions.length - 1], 'bin'))
          }
        } catch {
          /* ignore */
        }
      }
    }

    const parts = p.split(':')
    for (const ep of extras) {
      if (!parts.includes(ep)) {
        p = `${p}:${ep}`
      }
    }
    env.PATH = p
  }

  return env
}

/**
 * Resolve a binary name to an executable path on the current platform.
 * On Windows, `where` returns every shim variant (e.g. `claude`, `claude.cmd`,
 * `claude.ps1`). The extensionless entry is a POSIX shell script that can't
 * run on Windows, so we prefer `.cmd` / `.bat` / `.exe`.
 */
async function resolveBinaryPath(
  binary: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(whichCmd, [binary], { timeout: 5000, env })
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
    if (lines.length === 0) return null
    if (process.platform === 'win32') {
      const exec = lines.find((p) => /\.(cmd|bat|exe)$/i.test(p))
      return exec || lines[0]
    }
    return lines[0]
  } catch {
    return null
  }
}

/**
 * Run a binary cross-platform. On Windows, `.cmd`/`.bat` files cannot be
 * executed directly via `execFile` since Node 16.18/18.20/20.12
 * (CVE-2024-27980 fix) — `shell: true` is required.
 */
function execBinaryAsync(
  cmd: string,
  args: string[],
  options: { timeout?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string }> {
  const isWinBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)
  if (isWinBatch) {
    return execFileAsync(`"${cmd}"`, args, { ...options, shell: true })
  }
  return execFileAsync(cmd, args, options)
}

/**
 * Detect a single CLI tool by binary name.
 *
 * 1. Runs `which` (unix) / `where` (windows) to find the binary path.
 * 2. Runs `<path> --version` to extract a semver version string.
 */
async function detectTool(
  binary: string,
  toolType: DetectedCLI['toolType'],
  name: string,
  env: NodeJS.ProcessEnv
): Promise<DetectedCLI> {
  const result: DetectedCLI = { toolType, name, installed: false }

  const binPath = await resolveBinaryPath(binary, env)
  if (!binPath) return result

  // Binary found — try to get the version
  result.installed = true
  try {
    const { stdout } = await execBinaryAsync(binPath, ['--version'], { timeout: 10000, env })
    const m = stdout.trim().match(/(\d+\.\d+\.\d+)/)
    if (m) {
      result.version = m[1]
    }
  } catch {
    // Installed but version retrieval failed — still mark as installed
  }

  return result
}

/**
 * Detect Claude Code CLI with priority logic.
 *
 * The npm package @anthropic-ai/claude-code is deprecated — Anthropic now distributes
 * Claude Code via the native installer (curl https://claude.ai/install.sh | sh).
 * The native binary is installed to ~/.local/bin/claude.
 *
 * Claude desktop app (Claude.app) also bundles a CLI, typically available via:
 * - macOS: /usr/local/bin/claude (symlink from Claude.app)
 * - Homebrew cask path
 *
 * Priority:
 * 1. Official native CLI at ~/.local/bin/claude (preferred)
 * 2. Any other `claude` binary in PATH (includes Claude.app bundled CLI)
 */
async function detectClaudeCLI(env: NodeJS.ProcessEnv): Promise<DetectedCLI> {
  const result: DetectedCLI = { toolType: 'claude', name: 'Claude Code', installed: false }

  // 1. Check official native installer path first (POSIX only — install.sh is Unix-only)
  if (process.platform !== 'win32') {
    const nativePath = path.join(os.homedir(), '.local', 'bin', 'claude')
    const nativeExists = await fs.promises
      .access(nativePath, fs.constants.X_OK)
      .then(() => true)
      .catch(() => false)

    if (nativeExists) {
      result.installed = true
      try {
        const { stdout } = await execBinaryAsync(nativePath, ['--version'], { timeout: 10000, env })
        const m = stdout.trim().match(/(\d+\.\d+\.\d+)/)
        if (m) result.version = m[1]
      } catch {
        // Installed but version retrieval failed
      }
      return result
    }
  }

  // 2. Fallback: look for any `claude` in PATH (e.g. npm-global on Windows, Claude.app bundled CLI on macOS)
  return detectTool('claude', 'claude', 'Claude Code', env)
}

/**
 * Detect all supported AI coding CLI tools and the terminal fallback.
 * All detection runs in parallel.
 */
export async function detectAvailableCLIs(): Promise<DetectedCLI[]> {
  const env = getAugmentedEnv()

  const tools: Array<{ binary: string; toolType: DetectedCLI['toolType']; name: string }> = [
    { binary: 'codex', toolType: 'codex', name: 'Codex CLI' },
    { binary: 'gemini', toolType: 'gemini', name: 'Gemini CLI' },
    { binary: 'grok', toolType: 'grok', name: 'Grok CLI' }
  ]

  const [claudeResult, ...otherResults] = await Promise.all([
    detectClaudeCLI(env),
    ...tools.map((t) => detectTool(t.binary, t.toolType, t.name, env))
  ])

  const detected = [claudeResult, ...otherResults]

  // Terminal is always available
  detected.push({
    toolType: 'terminal',
    name: 'Terminal',
    installed: true
  })

  return detected
}
