import { execFile } from 'child_process'
import { promisify } from 'util'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

const execFileAsync = promisify(execFile)

export interface DetectedCLI {
  toolType: 'claude' | 'codex' | 'gemini' | 'opencode' | 'qwen' | 'terminal'
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
    } catch {
      // If shell env loading fails, fall back to process.env
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
    const appData = process.env.APPDATA
    if (appData) {
      const npmGlobal = path.join(appData, 'npm')
      env.PATH = `${env.PATH || ''};${npmGlobal}`
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
 * Detect a single CLI tool by binary name.
 *
 * 1. Runs `which` (unix) / `where` (windows) to find the binary.
 * 2. Runs `<binary> --version` to extract a semver version string.
 */
async function detectTool(
  binary: string,
  toolType: DetectedCLI['toolType'],
  name: string,
  env: NodeJS.ProcessEnv
): Promise<DetectedCLI> {
  const result: DetectedCLI = { toolType, name, installed: false }

  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which'
    await execFileAsync(whichCmd, [binary], { timeout: 5000, env })
  } catch {
    return result
  }

  // Binary found — try to get the version
  result.installed = true
  try {
    const { stdout } = await execFileAsync(binary, ['--version'], { timeout: 10000, env })
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

  // 1. Check official native installer path first
  const nativePath = path.join(os.homedir(), '.local', 'bin', 'claude')
  const nativeExists =
    process.platform !== 'win32' &&
    await fs.promises.access(nativePath, fs.constants.X_OK).then(() => true).catch(() => false)

  if (nativeExists) {
    result.installed = true
    try {
      const { stdout } = await execFileAsync(nativePath, ['--version'], { timeout: 10000, env })
      const m = stdout.trim().match(/(\d+\.\d+\.\d+)/)
      if (m) result.version = m[1]
    } catch {
      // Installed but version retrieval failed
    }
    return result
  }

  // 2. Fallback: look for any `claude` in PATH (e.g. Claude.app bundled CLI)
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
    { binary: 'gemini', toolType: 'gemini', name: 'Gemini CLI' }
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
