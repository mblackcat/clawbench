import { exec, execFile, spawn } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as https from 'https'
import { shell } from 'electron'
import * as logger from '../utils/logger'
import { mainT } from '../utils/i18n'
import {
  getLocalEnvMirrorBackup,
  setLocalEnvMirrorBackup,
  type LocalEnvMirrorBackup
} from '../store/settings.store'
import {
  getWindowsRegistryPath,
  invalidateWindowsRegistryPathCache,
  getToolCandidatePaths,
  getOmpCandidatePaths,
  reorderWindowsPathString,
  ensureWindowsPythonPathPriority,
  isWindowsAppsPath
} from '../utils/windows-env'
import { getWorkbenchVenvPythonPath } from '../utils/paths'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

type ToolId =
  | 'python' | 'nodejs' | 'go' | 'java' | 'docker'
  | 'mysql' | 'postgresql' | 'mongodb' | 'redis'
  | 'git' | 'svn' | 'perforce'
  | 'claude-code' | 'codex-cli' | 'gemini-cli' | 'grok-cli'
  | 'opencode' | 'traecli' | 'qoder-cli'
  | 'kimi-code' | 'zcode' | 'mimo-code'
  | 'antigravity-cli' | 'omp'
  | 'homebrew'

interface ToolInstallation {
  path: string
  version: string
  extras?: Record<string, string>
  managedBy?: string
}

interface ToolDetectionResult {
  toolId: ToolId
  name: string
  installed: boolean
  installations: ToolInstallation[]
}

interface PackageManagerInfo {
  brew: boolean
  winget: boolean
  xcodeSelect: boolean
}

interface ToolInstallResult {
  success: boolean
  error?: string
  openedBrowser?: boolean
  /** Windows only: a post-install GUI setup wizard (e.g. MySQL Installer) was auto-launched */
  launchedSetup?: boolean
}

export interface PackageInfo {
  name: string
  version: string
}

export interface PackageListResult {
  success: boolean
  packages?: PackageInfo[]
  error?: string
}

interface LocalEnvDetectionResult {
  tools: ToolDetectionResult[]
  packageManagers: PackageManagerInfo
  platform: string
}

/**
 * Windows only: scan Program Files / Program Files (x86) for a versioned
 * install directory matching `dirPattern` (e.g. /^MySQL Server/i) under
 * `vendorDir`, and return the first path where `binRelPath` exists inside it.
 * Used as a defense-in-depth fallback when an installer doesn't add itself to
 * PATH at all (common for DB server installers).
 */
function scanProgramFilesForBinary(vendorDir: string, dirPattern: RegExp, binRelPath: string): string | null {
  if (process.platform !== 'win32') return null
  const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean) as string[]
  for (const root of roots) {
    const vendorPath = path.join(root, vendorDir)
    try {
      if (!fs.existsSync(vendorPath)) continue
      const entries = fs.readdirSync(vendorPath)
      // Prefer the highest-versioned match if multiple server versions are installed
      const matches = entries.filter((e) => dirPattern.test(e)).sort().reverse()
      for (const entry of matches) {
        const candidate = path.join(vendorPath, entry, binRelPath)
        if (fs.existsSync(candidate)) return candidate
      }
    } catch { /* ignore */ }
  }
  return null
}

async function getAugmentedEnv(): Promise<NodeJS.ProcessEnv> {
  const env = { ...process.env }
  if (process.platform === 'darwin') {
    let p = env.PATH || ''
    const extras = [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin'
    ]
    const parts = p.split(':')
    for (const ep of extras) {
      if (!parts.includes(ep)) {
        p = `${p}:${ep}`
      }
    }
    // Add pyenv shims if present
    const pyenvShims = path.join(os.homedir(), '.pyenv', 'shims')
    if (!parts.includes(pyenvShims) && fs.existsSync(pyenvShims)) {
      p = `${pyenvShims}:${p}`
    }
    // Add nvm default if present
    const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm')
    const nvmDefault = path.join(nvmDir, 'versions', 'node')
    if (fs.existsSync(nvmDefault)) {
      try {
        const versions = fs.readdirSync(nvmDefault)
        if (versions.length > 0) {
          const latestBin = path.join(nvmDefault, versions[versions.length - 1], 'bin')
          if (!parts.includes(latestBin)) {
            p = `${latestBin}:${p}`
          }
        }
      } catch { /* ignore */ }
    }
    env.PATH = p
  } else if (process.platform === 'win32') {
    // Windows PATH is case-insensitive but JS object keys are not. After
    // `{ ...process.env }` the key may be `Path` and `env.PATH` undefined,
    // so read both and write back to whichever key already exists.
    const pathKey = 'PATH' in env ? 'PATH' : 'Path' in env ? 'Path' : 'PATH'
    let p = (env[pathKey] as string | undefined) || ''
    let parts = p.split(';')

    // Merge the live Machine+User PATH from the registry — see getWindowsRegistryPath()
    // for why process.env.PATH alone can be stale during the current app session.
    const registryPath = await getWindowsRegistryPath()
    if (registryPath) {
      for (const rp of registryPath.split(';')) {
        if (rp && !parts.some((x) => x.toLowerCase() === rp.toLowerCase())) {
          p = p ? `${p};${rp}` : rp
          parts.push(rp)
        }
      }
    }

    const extras: string[] = []
    if (process.env.APPDATA) {
      extras.push(path.join(process.env.APPDATA, 'npm'))
    }
    for (const ep of extras) {
      if (ep && !parts.some((x) => x.toLowerCase() === ep.toLowerCase())) {
        p = p ? `${p};${ep}` : ep
        parts.push(ep)
      }
    }
    // Real Python dirs must precede the WindowsApps python.exe Store alias
    env[pathKey] = reorderWindowsPathString(p).newPath
  }
  return env
}

/**
 * Run an executable cross-platform. On Windows, `.cmd`/`.bat` files cannot be
 * executed directly via `child_process.execFile` since Node 16.18/18.20/20.12
 * (CVE-2024-27980 fix) — `shell: true` is required.
 */
function execBinary(
  cmd: string,
  args: string[],
  options: { timeout?: number; env?: NodeJS.ProcessEnv; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  const isWinBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)
  if (isWinBatch) {
    // Quote the path to handle spaces. Args are tool-controlled (e.g. --version)
    // so no user input is interpolated into the shell.
    return execFileAsync(`"${cmd}"`, args, { ...options, shell: true })
  }
  return execFileAsync(cmd, args, options)
}

function dedup(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const p of paths) {
    if (!p) continue
    let resolved = p
    try {
      resolved = fs.realpathSync(p)
    } catch { /* keep original if realpath fails */ }
    if (!seen.has(resolved)) {
      seen.add(resolved)
      result.push(p)
    }
  }
  return result
}

async function whichAll(cmd: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('where', [cmd], { timeout: 5000, env })
      // `where` returns every shim variant (e.g. `claude`, `claude.cmd`, `claude.ps1`).
      // The extensionless entry is a POSIX shell script that won't execute on Windows,
      // so prefer .cmd / .bat / .exe and drop anything else.
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
      const exec = lines.filter((p) => /\.(cmd|bat|exe)$/i.test(p))
      return exec.length > 0 ? exec : lines
    } else {
      const { stdout } = await execAsync(`which -a ${cmd} 2>/dev/null || true`, { timeout: 5000, env })
      return stdout.trim().split(/\n/).filter(Boolean)
    }
  } catch {
    return []
  }
}

async function getVersion(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout } = await execBinary(cmd, args, { timeout: 10000, env })
    return stdout.trim()
  } catch {
    return null
  }
}

async function detectPython(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = {
    toolId: 'python',
    name: 'Python',
    installed: false,
    installations: []
  }

  // Find all python3 and python paths
  const python3Paths = await whichAll('python3', env)
  const pythonPaths = await whichAll('python', env)

  // Add well-known macOS paths
  if (process.platform !== 'win32') {
    const knownPaths = ['/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3']
    for (const kp of knownPaths) {
      if (fs.existsSync(kp) && !python3Paths.includes(kp)) {
        python3Paths.push(kp)
      }
    }
  }

  let allPaths = dedup([...python3Paths, ...pythonPaths])

  if (process.platform === 'win32') {
    // `%LOCALAPPDATA%\Microsoft\WindowsApps\python(3).exe` are App Execution
    // Alias stubs, never a distinct installation: disabled they pop the Store,
    // enabled they forward to a real interpreter already listed. realpath does
    // not follow AppExecLink reparse points, so dedup() can't collapse them.
    const isWindowsAppsAlias = (cand: string): boolean =>
      /[\\/]Microsoft[\\/]WindowsApps[\\/]python(3(\.\d+)?)?\.exe$/i.test(cand)
    allPaths = allPaths.filter((cand) => !isWindowsAppsAlias(cand))
  }

  for (const p of allPaths) {
    const version = await getVersion(p, ['--version'], env)
    if (!version) continue

    const versionStr = version.replace(/^Python\s+/i, '')
    const installation: ToolInstallation = { path: p, version: versionStr }

    // Check for pip
    const pipVersion = await getVersion(p, ['-m', 'pip', '--version'], env)
    if (pipVersion) {
      const pipMatch = pipVersion.match(/pip\s+([\d.]+)/)
      if (pipMatch) {
        installation.extras = { pip: pipMatch[1] }
      }
    }

    // Check if managed by pyenv
    try {
      const realPath = fs.realpathSync(p)
      if (realPath.includes('.pyenv')) {
        installation.managedBy = 'pyenv'
      }
    } catch { /* ignore */ }

    result.installations.push(installation)
  }

  result.installed = result.installations.length > 0
  return result
}

async function detectNodejs(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = {
    toolId: 'nodejs',
    name: 'Node.js',
    installed: false,
    installations: []
  }

  const nodePaths = await whichAll('node', env)
  const allPaths = dedup(nodePaths)

  // Check nvm existence
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm')
  const hasNvm = fs.existsSync(nvmDir)

  for (const p of allPaths) {
    const version = await getVersion(p, ['--version'], env)
    if (!version) continue

    const installation: ToolInstallation = { path: p, version: version.replace(/^v/, '') }

    // Check npm version from the same directory
    const nodeDir = path.dirname(p)
    const npmBin = path.join(nodeDir, process.platform === 'win32' ? 'npm.cmd' : 'npm')
    const npmVersion = await getVersion(npmBin, ['--version'], env)
    if (npmVersion) {
      installation.extras = { npm: npmVersion }
    } else {
      // Try global npm
      const globalNpm = await getVersion('npm', ['--version'], env)
      if (globalNpm) {
        installation.extras = { npm: globalNpm }
      }
    }

    // Check if managed by nvm
    if (hasNvm) {
      try {
        const realPath = fs.realpathSync(p)
        if (realPath.includes('.nvm') || realPath.includes('nvm')) {
          installation.managedBy = 'nvm'
        }
      } catch { /* ignore */ }
    }

    // Check nvm-windows
    if (process.platform === 'win32') {
      try {
        const realPath = fs.realpathSync(p)
        if (realPath.toLowerCase().includes('nvm')) {
          installation.managedBy = 'nvm'
        }
      } catch { /* ignore */ }
    }

    result.installations.push(installation)
  }

  result.installed = result.installations.length > 0
  return result
}

async function detectGit(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = {
    toolId: 'git',
    name: 'Git',
    installed: false,
    installations: []
  }

  const version = await getVersion('git', ['--version'], env)
  if (version) {
    const versionMatch = version.match(/git version\s+([\d.]+)/)
    const versionStr = versionMatch ? versionMatch[1] : version

    const gitPaths = await whichAll('git', env)
    const gitPath = gitPaths[0] || 'git'

    result.installations.push({ path: gitPath, version: versionStr })
    result.installed = true
  }

  return result
}

/** Windows: the TortoiseSVN install root, whether or not the CLI feature is present. */
function findTortoiseSvnRoot(): string | null {
  if (process.platform !== 'win32') return null
  const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean) as string[]
  for (const root of roots) {
    const candidate = path.join(root, 'TortoiseSVN')
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * TortoiseSVN installs svn.exe at <ProgramFiles>\TortoiseSVN\bin\svn.exe, but
 * only when its "command line client tools" feature was selected. Used as a
 * fallback when `svn` isn't on PATH (CLI-less TortoiseSVN, or the registry PATH
 * refresh hasn't propagated yet).
 */
function findTortoiseSvnCli(): string | null {
  const root = findTortoiseSvnRoot()
  if (!root) return null
  const candidate = path.join(root, 'bin', 'svn.exe')
  return fs.existsSync(candidate) ? candidate : null
}

async function detectSvn(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = {
    toolId: 'svn',
    name: 'SVN',
    installed: false,
    installations: []
  }

  let version = await getVersion('svn', ['--version', '--quiet'], env)
  let svnPath = (await whichAll('svn', env))[0]

  // Fall back to TortoiseSVN's well-known CLI location if `svn` isn't on PATH.
  if (!version) {
    const cli = findTortoiseSvnCli()
    if (cli) {
      version = await getVersion(cli, ['--version', '--quiet'], env)
      if (version) svnPath = cli
    }
  }

  if (version) {
    result.installations.push({ path: svnPath || 'svn', version })
    result.installed = true
  }

  return result
}

async function detectDocker(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = {
    toolId: 'docker',
    name: 'Docker',
    installed: false,
    installations: []
  }

  const version = await getVersion('docker', ['--version'], env)
  if (version) {
    const versionMatch = version.match(/Docker version\s+([\d.]+)/)
    const versionStr = versionMatch ? versionMatch[1] : version

    const dockerPaths = await whichAll('docker', env)
    const dockerPath = dockerPaths[0] || 'docker'

    const installation: ToolInstallation = { path: dockerPath, version: versionStr }

    // Check Docker Compose
    const composeVersion = await getVersion('docker', ['compose', 'version'], env)
    if (composeVersion) {
      const composeMatch = composeVersion.match(/v?([\d.]+)/)
      if (composeMatch) {
        installation.extras = { compose: composeMatch[1] }
      }
    }

    result.installations.push(installation)
    result.installed = true
  }

  return result
}

// ── Additional Base Tools ──

async function detectGo(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = { toolId: 'go', name: 'Go', installed: false, installations: [] }
  const version = await getVersion('go', ['version'], env)
  if (version) {
    const m = version.match(/go version go([\d.]+)/)
    const versionStr = m ? m[1] : version
    const paths = await whichAll('go', env)
    result.installations.push({ path: paths[0] || 'go', version: versionStr })
    result.installed = true
  }
  return result
}

async function detectJava(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = { toolId: 'java', name: 'Java', installed: false, installations: [] }
  try {
    // java -version outputs to stderr
    const { stderr } = await execFileAsync('java', ['-version'], { timeout: 10000, env })
    const raw = stderr.trim()
    if (raw) {
      const m = raw.match(/version "([^"]+)"/)
      const versionStr = m ? m[1] : raw.split('\n')[0]
      const paths = await whichAll('java', env)
      result.installations.push({ path: paths[0] || 'java', version: versionStr })
      result.installed = true
    }
  } catch (err: any) {
    if (err.stderr) {
      const m = err.stderr.match(/version "([^"]+)"/)
      if (m) {
        const paths = await whichAll('java', env)
        result.installations.push({ path: paths[0] || 'java', version: m[1] })
        result.installed = true
      }
    }
  }
  return result
}

// ── Database Tools ──

async function detectMysql(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = { toolId: 'mysql', name: 'MySQL', installed: false, installations: [] }
  const version = await getVersion('mysql', ['--version'], env)
  if (version) {
    const m = version.match(/Ver\s+([\d.]+)/) || version.match(/([\d.]+)/)
    const versionStr = m ? m[1] : version
    const paths = await whichAll('mysql', env)
    result.installations.push({ path: paths[0] || 'mysql', version: versionStr })
    result.installed = true
    return result
  }

  // Windows fallback: the MySQL Installer wizard doesn't always add the server's
  // bin directory to PATH, so `mysql --version` above can miss a real install.
  // Scan the well-known install location directly (e.g. "MySQL Server 8.0").
  if (process.platform === 'win32') {
    const found = scanProgramFilesForBinary('MySQL', /^MySQL Server/i, path.join('bin', 'mysql.exe'))
    if (found) {
      const foundVersion = await getVersion(found, ['--version'], env)
      const m = foundVersion ? (foundVersion.match(/Ver\s+([\d.]+)/) || foundVersion.match(/([\d.]+)/)) : null
      result.installations.push({ path: found, version: m ? m[1] : foundVersion || 'unknown' })
      result.installed = true
    }
  }

  return result
}

async function detectRedis(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = { toolId: 'redis', name: 'Redis', installed: false, installations: [] }
  const version = await getVersion('redis-cli', ['--version'], env)
  if (version) {
    const m = version.match(/redis-cli\s+([\d.]+)/) || version.match(/([\d.]+)/)
    const versionStr = m ? m[1] : version
    const paths = await whichAll('redis-cli', env)
    result.installations.push({ path: paths[0] || 'redis-cli', version: versionStr })
    result.installed = true
    return result
  }

  // Windows fallback: the unofficial tporadowski/redis port installs flat into
  // "Program Files\Redis" (no versioned subfolder) without always registering
  // itself on PATH.
  if (process.platform === 'win32') {
    const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean) as string[]
    for (const root of roots) {
      const candidate = path.join(root, 'Redis', 'redis-cli.exe')
      if (fs.existsSync(candidate)) {
        const foundVersion = await getVersion(candidate, ['--version'], env)
        const m = foundVersion ? (foundVersion.match(/redis-cli\s+([\d.]+)/) || foundVersion.match(/([\d.]+)/)) : null
        result.installations.push({ path: candidate, version: m ? m[1] : foundVersion || 'unknown' })
        result.installed = true
        break
      }
    }
  }

  return result
}

async function detectPostgresql(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = { toolId: 'postgresql', name: 'PostgreSQL', installed: false, installations: [] }
  const version = await getVersion('psql', ['--version'], env)
  if (version) {
    const m = version.match(/([\d.]+)/)
    const versionStr = m ? m[1] : version
    const paths = await whichAll('psql', env)
    result.installations.push({ path: paths[0] || 'psql', version: versionStr })
    result.installed = true
  }
  return result
}

async function detectMongodb(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = { toolId: 'mongodb', name: 'MongoDB', installed: false, installations: [] }
  // Try mongosh first, then mongod
  let version = await getVersion('mongosh', ['--version'], env)
  let cmd = 'mongosh'
  if (!version) {
    version = await getVersion('mongod', ['--version'], env)
    cmd = 'mongod'
  }
  if (version) {
    const m = version.match(/([\d.]+)/)
    const versionStr = m ? m[1] : version
    const paths = await whichAll(cmd, env)
    result.installations.push({ path: paths[0] || cmd, version: versionStr })
    result.installed = true
  }
  return result
}

// ── Version Control ──

async function detectPerforce(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = { toolId: 'perforce', name: 'Perforce', installed: false, installations: [] }
  const version = await getVersion('p4', ['-V'], env)
  if (version) {
    const m = version.match(/Rev\. [^/]+\/[^/]+\/([^/]+)/) || version.match(/([\d.]+)/)
    const versionStr = m ? m[1] : version.split('\n')[0]
    const paths = await whichAll('p4', env)
    result.installations.push({ path: paths[0] || 'p4', version: versionStr })
    result.installed = true
  }
  return result
}

// ── AI Coding Tools ──
async function detectNpmGlobalTool(
  toolId: ToolId,
  name: string,
  cmd: string,
  versionRegex: RegExp | null,
  env: NodeJS.ProcessEnv
): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = { toolId, name, installed: false, installations: [] }

  // Known install locations first (npm/pnpm/bun shims on Windows aren't always
  // on the stale process PATH), then whatever PATH resolves.
  const candidates: string[] = []
  for (const cand of getToolCandidatePaths(cmd)) {
    if (fs.existsSync(cand) && !candidates.includes(cand)) candidates.push(cand)
  }
  for (const p of await whichAll(cmd, env)) {
    if (!candidates.includes(p)) candidates.push(p)
  }
  const uniquePaths = dedup(candidates)

  for (const p of uniquePaths) {
    const raw = await getVersion(p, ['--version'], env)
    if (!raw) continue

    let versionStr = raw
    if (versionRegex) {
      const m = raw.match(versionRegex)
      if (m) versionStr = m[1]
    }

    result.installations.push({ path: p, version: versionStr })
  }

  result.installed = result.installations.length > 0
  return result
}

async function detectClaudeCode(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = { toolId: 'claude-code', name: 'Claude Code', installed: false, installations: [] }

  // The npm package @anthropic-ai/claude-code is deprecated — Anthropic now distributes
  // Claude Code exclusively via the native installer (curl https://claude.ai/install.sh).
  // The native binary is installed to ~/.local/bin/claude and supports `claude update`.
  //
  // Detection strategy:
  // 1. Look for the native binary at ~/.local/bin/claude (preferred)
  // 2. Fall back to `which claude` for other install locations
  // 3. Skip any path inside a Homebrew Cellar — that's the Claude desktop app's
  //    bundled CLI (brew install --cask claude), not the standalone CLI.

  const candidates: string[] = []

  // Known native-installer / package-manager locations (all platforms)
  for (const cand of getToolCandidatePaths('claude')) {
    if (fs.existsSync(cand) && !candidates.includes(cand)) candidates.push(cand)
  }

  // Also check PATH for other locations (includes npm-global shims on Windows)
  const whichPaths = await whichAll('claude', env)
  for (const p of whichPaths) {
    if (!candidates.includes(p)) candidates.push(p)
  }

  for (const binPath of candidates) {
    // Skip Homebrew-cask bundled CLI (Claude desktop app)
    if (binPath.includes('/Cellar/') || binPath.includes('/Caskroom/')) continue

    try {
      const raw = await getVersion(binPath, ['--version'], env)
      if (!raw) continue
      const m = raw.match(/(\d+\.\d+\.\d+)/)
      if (m) {
        result.installations.push({ path: binPath, version: m[1] })
      }
    } catch {
      // Binary not found or not executable
    }
  }

  result.installed = result.installations.length > 0
  return result
}

async function detectCodexCli(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  return detectNpmGlobalTool('codex-cli', 'Codex CLI', 'codex', /(\d+\.\d+\.\d+)/, env)
}

async function detectGeminiCli(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  return detectNpmGlobalTool('gemini-cli', 'Gemini CLI', 'gemini', /(\d+\.\d+\.\d+)/, env)
}

async function detectGrokCli(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = { toolId: 'grok-cli', name: 'Grok CLI', installed: false, installations: [] }

  // The official xAI Grok CLI ("Grok Build") is distributed via a native
  // installer (curl https://x.ai/cli/install.sh | bash) — NOT an npm package.
  // The installer places the `grok` binary in ~/.local/bin/ (POSIX), the same
  // convention as Claude Code's native installer.
  const candidates: string[] = []

  // Known native-installer / package-manager locations (all platforms)
  for (const cand of getToolCandidatePaths('grok')) {
    if (fs.existsSync(cand) && !candidates.includes(cand)) candidates.push(cand)
  }

  // Also check PATH for other install locations (e.g. npm-global shims on Windows)
  const whichPaths = await whichAll('grok', env)
  for (const p of whichPaths) {
    if (!candidates.includes(p)) candidates.push(p)
  }

  for (const binPath of candidates) {
    try {
      const raw = await getVersion(binPath, ['--version'], env)
      if (!raw) continue
      const m = raw.match(/(\d+\.\d+\.\d+)/)
      result.installations.push({ path: binPath, version: m ? m[1] : raw })
    } catch {
      // Binary not found or not executable
    }
  }

  result.installed = result.installations.length > 0
  return result
}

async function detectOpenCode(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  return detectNpmGlobalTool('opencode', 'OpenCode', 'opencode', /(\d+\.\d+\.\d+)/, env)
}

async function detectTraeCli(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  return detectNpmGlobalTool('traecli', 'Trae CLI', 'trae', /(\d+\.\d+\.\d+)/, env)
}

async function detectQoderCli(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  // Official package ships bin as `qodercli`; also accept legacy `qoder`
  const primary = await detectNpmGlobalTool('qoder-cli', 'Qoder CLI', 'qodercli', /(\d+\.\d+\.\d+)/, env)
  if (primary.installed) return primary
  return detectNpmGlobalTool('qoder-cli', 'Qoder CLI', 'qoder', /(\d+\.\d+\.\d+)/, env)
}

async function detectKimiCode(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  // Official: npm @moonshot-ai/kimi-code or native install script → binary `kimi`
  const result: ToolDetectionResult = { toolId: 'kimi-code', name: 'Kimi Code', installed: false, installations: [] }
  const candidates: string[] = []
  if (process.platform !== 'win32') {
    candidates.push(path.join(os.homedir(), '.local', 'bin', 'kimi'))
  }
  for (const p of await whichAll('kimi', env)) {
    if (!candidates.includes(p)) candidates.push(p)
  }
  for (const binPath of candidates) {
    try {
      const raw = await getVersion(binPath, ['--version'], env)
      if (!raw) continue
      const m = raw.match(/(\d+\.\d+\.\d+)/)
      result.installations.push({ path: binPath, version: m ? m[1] : raw })
    } catch { /* skip */ }
  }
  result.installed = result.installations.length > 0
  return result
}

async function detectZCode(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  // ZCode is primarily a desktop app (Z.ai / Zhipu). Detect CLI binary and app install.
  const result: ToolDetectionResult = { toolId: 'zcode', name: 'ZCode', installed: false, installations: [] }
  const candidates: string[] = []

  if (process.platform === 'darwin') {
    const appBin = '/Applications/ZCode.app/Contents/MacOS/ZCode'
    if (fs.existsSync(appBin)) candidates.push(appBin)
    if (fs.existsSync('/Applications/ZCode.app')) {
      // App present even if we cannot resolve the MacOS binary path
      candidates.push('/Applications/ZCode.app')
    }
  } else if (process.platform === 'win32') {
    const roots = [process.env['LOCALAPPDATA'], process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean) as string[]
    for (const root of roots) {
      const exe = path.join(root, 'ZCode', 'ZCode.exe')
      if (fs.existsSync(exe)) candidates.push(exe)
    }
  }

  for (const p of await whichAll('zcode', env)) {
    if (!candidates.includes(p)) candidates.push(p)
  }

  for (const binPath of candidates) {
    // .app bundle path — mark installed without version probe
    if (binPath.endsWith('.app')) {
      result.installations.push({ path: binPath, version: 'app' })
      continue
    }
    try {
      const raw = await getVersion(binPath, ['--version'], env)
      if (raw) {
        const m = raw.match(/(\d+\.\d+\.\d+)/)
        result.installations.push({ path: binPath, version: m ? m[1] : raw })
      } else if (fs.existsSync(binPath)) {
        result.installations.push({ path: binPath, version: 'installed' })
      }
    } catch {
      if (fs.existsSync(binPath)) {
        result.installations.push({ path: binPath, version: 'installed' })
      }
    }
  }

  result.installed = result.installations.length > 0
  return result
}

async function detectMimoCode(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  // Xiaomi MiMo Code: npm @mimo-ai/cli or curl install script → binary `mimo`
  const result: ToolDetectionResult = { toolId: 'mimo-code', name: 'MiMo Code', installed: false, installations: [] }
  const candidates: string[] = []
  if (process.platform !== 'win32') {
    candidates.push(path.join(os.homedir(), '.local', 'bin', 'mimo'))
  }
  for (const p of await whichAll('mimo', env)) {
    if (!candidates.includes(p)) candidates.push(p)
  }
  for (const binPath of candidates) {
    try {
      const raw = await getVersion(binPath, ['--version'], env)
      if (!raw) continue
      const m = raw.match(/(\d+\.\d+\.\d+)/)
      result.installations.push({ path: binPath, version: m ? m[1] : raw })
    } catch { /* skip */ }
  }
  result.installed = result.installations.length > 0
  return result
}

async function detectAntigravityCli(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = {
    toolId: 'antigravity-cli',
    name: 'Antigravity CLI',
    installed: false,
    installations: []
  }
  const candidates: string[] = []
  for (const bin of ['agy', 'antigravity']) {
    for (const cand of getToolCandidatePaths(bin)) {
      if (fs.existsSync(cand) && !candidates.includes(cand)) candidates.push(cand)
    }
    for (const p of await whichAll(bin, env)) {
      if (!candidates.includes(p)) candidates.push(p)
    }
  }
  for (const binPath of candidates) {
    try {
      const raw = await getVersion(binPath, ['--version'], env)
      if (!raw) continue
      const m = raw.match(/(\d+\.\d+\.\d+)/)
      if (m) result.installations.push({ path: binPath, version: m[1] })
    } catch {
      // Binary not found or not executable
    }
  }
  result.installed = result.installations.length > 0
  return result
}

async function detectOmp(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = { toolId: 'omp', name: 'Oh My Pi', installed: false, installations: [] }
  const candidates: string[] = []
  for (const p of getOmpCandidatePaths()) {
    if (fs.existsSync(p) && !candidates.includes(p)) candidates.push(p)
  }
  for (const p of await whichAll('omp', env)) {
    if (!candidates.includes(p)) candidates.push(p)
  }
  for (const binPath of candidates) {
    try {
      const raw = await getVersion(binPath, ['--version'], env)
      if (!raw) continue
      const m = raw.match(/(\d+\.\d+\.\d+)/)
      result.installations.push({ path: binPath, version: m ? m[1] : raw })
    } catch {
      // Binary not found or not executable
    }
  }
  result.installed = result.installations.length > 0
  return result
}

// ── Package Managers / System Tools ──

async function detectBrew(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = { toolId: 'homebrew', name: 'Homebrew', installed: false, installations: [] }
  const version = await getVersion('brew', ['--version'], env)
  if (version) {
    // "Homebrew 4.3.1\nHomebrew/homebrew-core..."
    const m = version.match(/Homebrew\s+([\d.]+)/)
    const versionStr = m ? m[1] : version.split('\n')[0]
    const paths = await whichAll('brew', env)
    result.installations.push({ path: paths[0] || '/opt/homebrew/bin/brew', version: versionStr })
    result.installed = true
  }
  return result
}

async function detectPackageManagers(env: NodeJS.ProcessEnv): Promise<PackageManagerInfo> {
  const info: PackageManagerInfo = { brew: false, winget: false, xcodeSelect: false }

  if (process.platform === 'win32') {
    try {
      await execFileAsync('where', ['winget'], { timeout: 5000, env })
      info.winget = true
    } catch { /* not available */ }
  } else {
    try {
      await execFileAsync('which', ['brew'], { timeout: 5000, env })
      info.brew = true
    } catch { /* not available */ }

    try {
      await execFileAsync('which', ['xcode-select'], { timeout: 5000, env })
      info.xcodeSelect = true
    } catch { /* not available */ }
  }

  return info
}

export async function detectAll(): Promise<LocalEnvDetectionResult> {
  const env = await getAugmentedEnv()

  const [
    python, nodejs, go, java, docker,
    mysql, postgresql, mongodb, redis,
    git, svn, perforce,
    claudeCode, codexCli, geminiCli, grokCli,
    openCode, traeCli, qoderCli, kimiCode, zcode, mimoCode,
    antigravityCli, omp,
    homebrew,
    packageManagers
  ] = await Promise.all([
    detectPython(env),
    detectNodejs(env),
    detectGo(env),
    detectJava(env),
    detectDocker(env),
    detectMysql(env),
    detectPostgresql(env),
    detectMongodb(env),
    detectRedis(env),
    detectGit(env),
    detectSvn(env),
    detectPerforce(env),
    detectClaudeCode(env),
    detectCodexCli(env),
    detectGeminiCli(env),
    detectGrokCli(env),
    detectOpenCode(env),
    detectTraeCli(env),
    detectQoderCli(env),
    detectKimiCode(env),
    detectZCode(env),
    detectMimoCode(env),
    detectAntigravityCli(env),
    detectOmp(env),
    process.platform === 'darwin' ? detectBrew(env) : Promise.resolve<ToolDetectionResult>({ toolId: 'homebrew', name: 'Homebrew', installed: false, installations: [] }),
    detectPackageManagers(env)
  ])

  // AI tools kept in user-facing order: Claude → Codex → Gemini → Grok → OpenCode → Trae → Qoder → Kimi → ZCode → MiMo → Antigravity → Oh My Pi
  const tools: ToolDetectionResult[] = [
    python, nodejs, go, java, docker,
    mysql, postgresql, mongodb, redis,
    git, svn, perforce,
    claudeCode, codexCli, geminiCli, grokCli,
    openCode, traeCli, qoderCli, kimiCode, zcode, mimoCode,
    antigravityCli, omp
  ]

  // Include Homebrew only on macOS
  if (process.platform === 'darwin') {
    tools.unshift(homebrew)
  }

  return {
    tools,
    packageManagers,
    platform: process.platform
  }
}

const DETECT_FN_MAP: Partial<Record<ToolId, (env: NodeJS.ProcessEnv) => Promise<ToolDetectionResult>>> = {
  python: detectPython,
  nodejs: detectNodejs,
  go: detectGo,
  java: detectJava,
  docker: detectDocker,
  mysql: detectMysql,
  postgresql: detectPostgresql,
  mongodb: detectMongodb,
  redis: detectRedis,
  git: detectGit,
  svn: detectSvn,
  perforce: detectPerforce,
  'claude-code': detectClaudeCode,
  'codex-cli': detectCodexCli,
  'gemini-cli': detectGeminiCli,
  'grok-cli': detectGrokCli,
  opencode: detectOpenCode,
  traecli: detectTraeCli,
  'qoder-cli': detectQoderCli,
  'kimi-code': detectKimiCode,
  zcode: detectZCode,
  'mimo-code': detectMimoCode,
  'antigravity-cli': detectAntigravityCli,
  omp: detectOmp,
  homebrew: detectBrew,
}

export async function detectOne(toolId: string): Promise<ToolDetectionResult> {
  const env = await getAugmentedEnv()
  const fn = DETECT_FN_MAP[toolId as ToolId]
  if (!fn) {
    return { toolId: toolId as ToolId, name: toolId, installed: false, installations: [] }
  }
  return fn(env)
}

const DOWNLOAD_URLS: Partial<Record<ToolId, string>> = {
  homebrew: 'https://brew.sh',
  nodejs: 'https://nodejs.org/',
  go: 'https://go.dev/dl/',
  java: 'https://adoptium.net/',
  docker: 'https://www.docker.com/products/docker-desktop/',
  mysql: 'https://dev.mysql.com/downloads/',
  postgresql: 'https://www.postgresql.org/download/',
  mongodb: 'https://www.mongodb.com/try/download/community',
  redis: process.platform === 'win32'
    ? 'https://github.com/tporadowski/redis/releases'
    : 'https://redis.io/download',
  git: 'https://git-scm.com/downloads',
  svn: process.platform === 'win32'
    ? 'https://tortoisesvn.net/downloads.html'
    : 'https://subversion.apache.org/packages.html',
  perforce: 'https://www.perforce.com/downloads/helix-command-line-client-p4',
  'claude-code': 'https://docs.anthropic.com/en/docs/claude-code',
  'codex-cli': 'https://github.com/openai/codex',
  'gemini-cli': 'https://github.com/google-gemini/gemini-cli',
  'grok-cli': 'https://x.ai/cli',
  opencode: 'https://opencode.ai',
  traecli: 'https://www.trae.ai',
  'qoder-cli': 'https://docs.qoder.com/cli/install',
  'kimi-code': 'https://code.kimi.com',
  zcode: 'https://zcode.z.ai/en',
  'mimo-code': 'https://mimo.xiaomi.com/mimocode/start',
  'antigravity-cli': 'https://antigravity.google',
  omp: 'https://omp.sh'
}

const BREW_PACKAGES: Partial<Record<ToolId, string>> = {
  python: 'python@3',
  nodejs: 'node',
  go: 'go',
  java: 'openjdk',
  docker: '--cask docker',
  mysql: 'mysql',
  postgresql: 'postgresql@16',
  mongodb: 'mongodb/brew/mongodb-community',
  redis: 'redis',
  git: 'git',
  svn: 'subversion',
  'antigravity-cli': '--cask antigravity-cli'
}

const WINGET_PACKAGES: Partial<Record<ToolId, string>> = {
  python: 'Python.Python.3',
  nodejs: 'OpenJS.NodeJS.LTS',
  go: 'GoLang.Go',
  java: 'EclipseAdoptium.Temurin.21.JDK',
  docker: 'Docker.DockerDesktop',
  mysql: 'Oracle.MySQL',
  postgresql: 'PostgreSQL.PostgreSQL',
  // Official Redis doesn't publish native Windows binaries; this is the
  // widely-used unofficial Windows port (tporadowski/redis).
  redis: 'tporadowski.redis',
  git: 'Git.Git',
  svn: 'TortoiseSVN.TortoiseSVN'
}

/**
 * Windows only: per-tool installer arguments appended to winget's own silent
 * args via `--custom`. `--custom` (append) rather than `--override` (replace):
 * override discards winget's generated silent/no-restart flags, turning a
 * silent MSI into an interactive one that blocks behind an unseen window.
 *
 * TortoiseSVN's MSI installs the shell extension by default but NOT the
 * Subversion command-line tools — `svn.exe` only lands in ...\TortoiseSVN\bin
 * when the `CLI` feature is selected. ADDLOCAL=ALL requests the complete
 * feature set (Main + ProgramMenu + CLI).
 */
const WINGET_INSTALL_CUSTOM: Partial<Record<ToolId, string>> = {
  svn: 'ADDLOCAL=ALL'
}

// ── Windows install plumbing ──

interface StreamedRunResult {
  code: number | null
  output: string
  timedOut: boolean
}

/** winget: 0x8A15002B — package is already installed / no applicable upgrade. */
const WINGET_NO_APPLICABLE_UPGRADE = 0x8a15002b
/** Windows ERROR_CANCELLED — the user dismissed the UAC prompt. */
const ERROR_CANCELLED = 1223

function isWingetAlreadyInstalled(code: number | null): boolean {
  return code !== null && (code >>> 0) === WINGET_NO_APPLICABLE_UPGRADE
}

function isUacCancelled(code: number | null): boolean {
  return code !== null && (code >>> 0) === ERROR_CANCELLED
}

/** Drop winget's spinner/progress-bar redraws, keep lines with real content. */
function isMeaningfulOutputLine(line: string): boolean {
  return /[A-Za-z一-龥]/.test(line)
}

/**
 * Spawn a command and log each output line as it arrives, then resolve with its
 * exit code instead of throwing. A buffered execFile surfaced nothing at all
 * when an install hung, so a stalled install looked like "spinner forever, no
 * logs, no toast".
 */
async function runStreaming(
  command: string,
  args: string[],
  opts: { timeout: number; env?: NodeJS.ProcessEnv; label: string }
): Promise<StreamedRunResult> {
  logger.info(`[local-env] ${opts.label}: ${command} ${args.join(' ')}`)
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { env: opts.env, windowsHide: true })
    } catch (err: unknown) {
      logger.error(`[local-env] ${opts.label} failed to spawn:`, err)
      resolve({ code: null, output: err instanceof Error ? err.message : String(err), timedOut: false })
      return
    }

    let output = ''
    let timedOut = false
    let lastLogged = ''

    const onChunk = (buf: Buffer): void => {
      const text = buf.toString()
      output += text
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line === lastLogged || !isMeaningfulOutputLine(line)) continue
        lastLogged = line
        logger.info(`[local-env] ${opts.label} | ${line}`)
      }
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)

    const timer = setTimeout(() => {
      timedOut = true
      logger.error(`[local-env] ${opts.label} timed out after ${opts.timeout}ms, killing`)
      try { child.kill() } catch { /* already gone */ }
    }, opts.timeout)

    child.on('error', (err) => {
      clearTimeout(timer)
      logger.error(`[local-env] ${opts.label} error:`, err)
      resolve({ code: null, output: `${output}\n${err.message}`.trim(), timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      logger.info(`[local-env] ${opts.label} exited with code ${code}`)
      resolve({ code, output: output.trim(), timedOut })
    })
  })
}

/**
 * Windows: re-run a command through a foreground UAC prompt. winget cannot
 * elevate itself mid-run; a package MSI's own UAC prompt can end up behind the
 * app window (or be auto-denied). Requesting elevation up front makes the
 * prompt explicit and turns a declined prompt into a reportable error.
 */
async function runElevatedWindows(
  command: string,
  args: string[],
  opts: { timeout: number; label: string }
): Promise<StreamedRunResult> {
  const psList = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
  const script =
    `try { ` +
    `$p = Start-Process -FilePath '${command.replace(/'/g, "''")}' -ArgumentList ${psList} -Verb RunAs -Wait -PassThru; ` +
    `exit $p.ExitCode ` +
    `} catch { Write-Output $_.Exception.Message; exit ${ERROR_CANCELLED} }`
  return runStreaming(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: opts.timeout, label: `${opts.label} (elevated)` }
  )
}

/**
 * Windows: persist `dir` into the *user* PATH if it isn't on PATH already, and
 * make it visible to the running app without a restart.
 *
 * Only used for TortoiseSVN's bin dir: its CLI feature appends to the *machine*
 * PATH, which silently does nothing when the MSI ran without admin rights.
 * Adding it to the user PATH needs no elevation and makes `svn` work in a newly
 * opened terminal. This is an explicit, persistent change (HKCU\Environment).
 */
async function ensureWindowsUserPathContains(dir: string): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const normalize = (p: string): string => p.trim().replace(/\\+$/, '').toLowerCase()
  const target = normalize(dir)

  const known = `${process.env.PATH || ''};${await getWindowsRegistryPath()}`
  if (known.split(';').some((p) => normalize(p) === target)) return false

  const script =
    `$d = '${dir.replace(/'/g, "''")}'; ` +
    `$u = [Environment]::GetEnvironmentVariable('Path','User'); ` +
    `if ($null -eq $u) { $u = '' }; ` +
    `$parts = @($u -split ';' | Where-Object { $_ -ne '' }); ` +
    `if (($parts | ForEach-Object { $_.TrimEnd('\\').ToLower() }) -notcontains $d.TrimEnd('\\').ToLower()) { ` +
    `[Environment]::SetEnvironmentVariable('Path', (($parts + $d) -join ';'), 'User'); ` +
    `Write-Output 'PATH updated' }`

  const result = await runStreaming(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 15000, label: 'path-update' }
  )
  if (result.code !== 0) {
    logger.error(`[local-env] Failed to add ${dir} to user PATH: ${result.output}`)
    return false
  }

  // Also make it usable in this session (process env was snapshotted at launch).
  process.env.PATH = `${process.env.PATH || ''};${dir}`
  invalidateWindowsRegistryPathCache()
  logger.info(`[local-env] Added to user PATH: ${dir}`)
  return true
}

/**
 * Windows: the real winget.exe inside the DesktopAppInstaller package. `winget`
 * on PATH is a per-user App Execution Alias; an elevated Start-Process can run
 * under a profile where that alias doesn't exist. Falls back to the alias.
 */
function resolveWingetForElevation(): string {
  const programFiles = process.env['ProgramFiles']
  if (!programFiles) return 'winget'
  const appsDir = path.join(programFiles, 'WindowsApps')
  try {
    const match = fs
      .readdirSync(appsDir)
      .filter((e) => /^Microsoft\.DesktopAppInstaller_.*_x64__8wekyb3d8bbwe$/.test(e))
      .sort()
      .reverse()
      .map((e) => path.join(appsDir, e, 'winget.exe'))
      .find((p) => fs.existsSync(p))
    if (match) return match
  } catch { /* WindowsApps is ACL-locked on some machines */ }
  return 'winget'
}

/**
 * Windows: install a winget package, retrying once with explicit elevation when
 * the unelevated attempt fails or stalls.
 */
async function wingetInstall(
  pkg: string,
  opts: { label: string; custom?: string; force?: boolean; timeout?: number; env?: NodeJS.ProcessEnv }
): Promise<StreamedRunResult> {
  // `--id <pkg> -e` (exact match) so a partial-id collision can't trigger an
  // interactive "choose a package" prompt; --disable-interactivity turns any
  // remaining prompt into a clean error instead of a hang.
  const args = [
    'install', '--id', pkg, '-e', '--silent',
    '--accept-source-agreements', '--accept-package-agreements',
    '--disable-interactivity'
  ]
  // --force skips the "already installed" short-circuit (reinstall with more features).
  if (opts.force) args.push('--force')
  if (opts.custom) args.push('--custom', opts.custom)

  const timeout = opts.timeout ?? 480000
  const first = await runStreaming('winget', args, { timeout, label: opts.label, env: opts.env })
  if (first.code === 0 || isWingetAlreadyInstalled(first.code)) return first

  logger.warn(
    `[local-env] winget install of ${pkg} ${first.timedOut ? 'timed out' : `failed (code ${first.code})`}, retrying elevated`
  )
  return runElevatedWindows(resolveWingetForElevation(), args, { timeout, label: opts.label })
}

/** Human-readable tail of installer output, for surfacing in the UI toast. */
function outputTail(output: string, maxLines = 4): string {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && isMeaningfulOutputLine(l))
  return lines.slice(-maxLines).join('; ')
}

/** Readable error for a failed winget run: timeout vs UAC cancel vs exit code. */
function describeWingetFailure(name: string, result: StreamedRunResult): string {
  if (result.timedOut) return mainT('localEnv.installTimeout', name)
  if (isUacCancelled(result.code)) return mainT('localEnv.installUacCancelled', name)
  const tail = outputTail(result.output)
  return mainT('localEnv.installWingetFailed', name, String(result.code), tail ? `: ${tail}` : '')
}

/**
 * Windows SVN: install TortoiseSVN *with* the command-line client, then make
 * `svn` resolvable from a normal shell:
 *  1. the MSI must run to completion (elevation, no interactive prompt);
 *  2. the CLI feature must be selected (ADDLOCAL=ALL; --force over a CLI-less
 *     existing install, which winget would otherwise treat as a no-op);
 *  3. ...\TortoiseSVN\bin must be on PATH — added to the user PATH explicitly.
 */
async function installSvnWindows(env: NodeJS.ProcessEnv): Promise<ToolInstallResult> {
  const pkg = WINGET_PACKAGES.svn!
  const openDownloadPage = async (error: string): Promise<ToolInstallResult> => {
    await shell.openExternal(DOWNLOAD_URLS.svn!)
    return { success: false, error }
  }

  try {
    await execFileAsync('where', ['winget'], { timeout: 5000, env })
  } catch {
    await shell.openExternal(DOWNLOAD_URLS.svn!)
    return { success: true, openedBrowser: true }
  }

  const needsCliRepair = findTortoiseSvnRoot() !== null && findTortoiseSvnCli() === null
  if (needsCliRepair) {
    logger.info('[local-env] TortoiseSVN present without CLI tools, forcing reinstall with ADDLOCAL=ALL')
  }

  const result = await wingetInstall(pkg, {
    label: 'svn-install',
    custom: WINGET_INSTALL_CUSTOM.svn,
    force: needsCliRepair,
    env
  })
  const wingetOk = result.code === 0 || isWingetAlreadyInstalled(result.code)

  const cli = findTortoiseSvnCli()
  if (!cli) {
    if (!wingetOk) return openDownloadPage(describeWingetFailure('SVN', result))
    return openDownloadPage(mainT('localEnv.svnCliMissing'))
  }

  // svn.exe exists — guarantee it is reachable as `svn` from a new shell.
  await ensureWindowsUserPathContains(path.dirname(cli))

  const version = await getVersion(cli, ['--version', '--quiet'], env)
  if (!version) {
    return { success: false, error: mainT('localEnv.svnVersionFailed', cli) }
  }

  logger.info(`[local-env] Tool installed: svn ${version} at ${cli}`)
  return { success: true }
}

/**
 * Windows only: some winget packages only install a setup wizard rather than
 * the finished product (Oracle's "MySQL Installer" is the canonical example —
 * `winget install Oracle.MySQL` merely stages the interactive installer, which
 * must still be run to pick & configure the actual MySQL Server). For these,
 * auto-launch the wizard right after winget succeeds so the user isn't left
 * wondering why nothing happened.
 */
const WINDOWS_POST_INSTALL_LAUNCHERS: Partial<Record<ToolId, string[]>> = {
  mysql: [
    'MySQL\\MySQL Installer for Windows\\MySQLInstaller.exe'
  ]
}

/** Best-effort: look for and open a post-install setup wizard under Program Files. */
async function maybeLaunchPostInstallSetup(id: ToolId): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const relPaths = WINDOWS_POST_INSTALL_LAUNCHERS[id]
  if (!relPaths) return false
  const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean) as string[]
  for (const root of roots) {
    for (const rel of relPaths) {
      const candidate = path.join(root, rel)
      if (fs.existsSync(candidate)) {
        try {
          await shell.openPath(candidate)
          logger.info(`[local-env] Launched post-install setup for ${id}: ${candidate}`)
          return true
        } catch (err) {
          logger.error(`[local-env] Failed to launch post-install setup for ${id}:`, err)
        }
      }
    }
  }
  return false
}

/** AI coding tools installed via npm install -g */
const NPM_PACKAGES: Partial<Record<ToolId, string>> = {
  // NOTE: claude-code / grok-cli / zcode use native installers or desktop download
  'gemini-cli': '@google/gemini-cli',
  'codex-cli': '@openai/codex',
  opencode: 'opencode-ai',
  'qoder-cli': '@qoder-ai/qodercli',
  'kimi-code': '@moonshot-ai/kimi-code',
  'mimo-code': '@mimo-ai/cli'
}

/** Brew fallback for tools that also support brew (macOS only) */
const BREW_FALLBACK: Partial<Record<ToolId, string>> = {
  'opencode': 'anomalyco/tap/opencode'
}

export async function installTool(toolId: string): Promise<ToolInstallResult> {
  const id = toolId as ToolId
  const env = await getAugmentedEnv()
  logger.info(`[local-env] Installing tool: ${id}`)

  // Homebrew — run the official install script in Terminal.app (macOS only)
  if (id === 'homebrew') {
    if (process.platform !== 'darwin') {
      return { success: false, error: 'Homebrew 仅支持 macOS/Linux' }
    }
    // Open brew.sh — the official install script requires interactive shell
    await shell.openExternal('https://brew.sh')
    return { success: true, openedBrowser: true }
  }

  // Claude Code — install via official native installer (npm package is deprecated)
  if (id === 'claude-code') {
    if (process.platform === 'win32') {
      // Windows: native installer not yet supported via CLI; open docs page
      await shell.openExternal('https://docs.anthropic.com/en/docs/claude-code')
      return { success: true, openedBrowser: true }
    }
    try {
      await execAsync('curl -fsSL https://claude.ai/install.sh | bash', { timeout: 600000, env })
      invalidateWindowsRegistryPathCache()
      logger.info(`[local-env] Tool installed: ${id}`)
      return { success: true }
    } catch (err: any) {
      logger.error('Failed to install Claude Code via native installer:', err)
      await shell.openExternal('https://docs.anthropic.com/en/docs/claude-code')
      return { success: true, openedBrowser: true }
    }
  }

  // Grok CLI — install via official xAI native installer (not an npm package)
  if (id === 'grok-cli') {
    if (process.platform === 'win32') {
      // Windows: native installer guidance; open the install page
      await shell.openExternal('https://x.ai/cli')
      return { success: true, openedBrowser: true }
    }
    try {
      await execAsync('curl -fsSL https://x.ai/cli/install.sh | bash', { timeout: 600000, env })
      invalidateWindowsRegistryPathCache()
      logger.info(`[local-env] Tool installed: ${id}`)
      return { success: true }
    } catch (err: any) {
      logger.error('Failed to install Grok CLI via native installer:', err)
      await shell.openExternal('https://x.ai/cli')
      return { success: true, openedBrowser: true }
    }
  }

  // Kimi Code — prefer official install script (no Node required); npm as fallback
  if (id === 'kimi-code') {
    if (process.platform === 'win32') {
      try {
        await execAsync(
          'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://code.kimi.com/kimi-code/install.ps1 | iex"',
          { timeout: 600000, env }
        )
        logger.info(`[local-env] Tool installed: ${id}`)
        return { success: true }
      } catch (err: any) {
        logger.error('Failed to install Kimi Code via PowerShell script:', err)
        // fall through to npm
      }
    } else {
      try {
        await execAsync('curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash', { timeout: 600000, env })
        logger.info(`[local-env] Tool installed: ${id}`)
        return { success: true }
      } catch (err: any) {
        logger.error('Failed to install Kimi Code via install script:', err)
        // fall through to npm
      }
    }
  }

  // MiMo Code — official script on POSIX; npm on all platforms
  if (id === 'mimo-code' && process.platform !== 'win32') {
    try {
      await execAsync('curl -fsSL https://mimo.xiaomi.com/install | bash', { timeout: 600000, env })
      logger.info(`[local-env] Tool installed: ${id}`)
      return { success: true }
    } catch (err: any) {
      logger.error('Failed to install MiMo Code via install script:', err)
      // fall through to npm
    }
  }

  // Oh My Pi — official installer script on every platform (PowerShell on Windows)
  if (id === 'omp') {
    try {
      if (process.platform === 'win32') {
        await execAsync(
          'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://omp.sh/install.ps1 | iex"',
          { timeout: 600000, env }
        )
        invalidateWindowsRegistryPathCache()
        const ompDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'omp')
        if (fs.existsSync(ompDir)) {
          process.env.PATH = `${process.env.PATH || ''};${ompDir}`
        }
      } else {
        await execAsync('curl -fsSL https://omp.sh/install | sh', { timeout: 600000, env })
      }
      logger.info(`[local-env] Tool installed: ${id}`)
      return { success: true }
    } catch (err: unknown) {
      logger.error('Failed to install Oh My Pi via install script:', err)
      await shell.openExternal('https://omp.sh')
      return { success: true, openedBrowser: true }
    }
  }

  // Antigravity CLI — official installer script (PowerShell on Windows, curl on POSIX)
  if (id === 'antigravity-cli') {
    try {
      if (process.platform === 'win32') {
        await execAsync(
          'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://antigravity.google/cli/install.ps1 | iex"',
          { timeout: 600000, env }
        )
        invalidateWindowsRegistryPathCache()
        const agyDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agy', 'bin')
        if (fs.existsSync(agyDir)) {
          process.env.PATH = `${process.env.PATH || ''};${agyDir}`
        }
      } else {
        await execAsync('curl -fsSL https://antigravity.google/cli/install.sh | bash', { timeout: 600000, env })
      }
      logger.info(`[local-env] Tool installed: ${id}`)
      return { success: true }
    } catch (err: unknown) {
      logger.error('Failed to install Antigravity CLI via install script:', err)
      // macOS: fall back to the Homebrew cask before sending the user to the browser
      if (process.platform === 'darwin' && BREW_PACKAGES[id]) {
        try {
          await execFileAsync('which', ['brew'], { timeout: 5000, env })
          await execAsync(`brew install ${BREW_PACKAGES[id]}`, { timeout: 600000, env })
          logger.info(`[local-env] Tool installed via brew: ${id}`)
          return { success: true }
        } catch (brewErr: unknown) {
          logger.error('Failed to install Antigravity CLI via brew cask:', brewErr)
        }
      }
      await shell.openExternal('https://antigravity.google/docs/cli/install')
      return { success: true, openedBrowser: true }
    }
  }

  // ZCode is a desktop app — open official download page
  if (id === 'zcode') {
    await shell.openExternal('https://zcode.z.ai/en')
    return { success: true, openedBrowser: true }
  }

  // Trae CLI — no reliable npm package; open official site
  if (id === 'traecli') {
    await shell.openExternal('https://www.trae.ai')
    return { success: true, openedBrowser: true }
  }

  // AI coding tools — install via npm install -g
  const npmPkg = NPM_PACKAGES[id]
  if (npmPkg) {
    try {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      await execFileAsync(npmCmd, ['install', '-g', npmPkg], { timeout: 600000, env })
      invalidateWindowsRegistryPathCache()
      logger.info(`[local-env] Tool installed: ${id}`)
      return { success: true }
    } catch (err: any) {
      logger.error(`Failed to install ${id} via npm:`, err)
      // On macOS/Linux, try brew fallback before opening browser
      if (process.platform === 'darwin' || process.platform === 'linux') {
        const brewPkg = BREW_FALLBACK[id]
        if (brewPkg) {
          try {
            await execFileAsync('which', ['brew'], { timeout: 5000, env })
            await execAsync(`brew install ${brewPkg}`, { timeout: 600000, env })
            logger.info(`[local-env] Tool installed: ${id}`)
            return { success: true }
          } catch (brewErr: any) {
            logger.error(`Failed to install ${id} via brew fallback:`, brewErr)
          }
        }
      }
      // Fallback: open browser
      const url = DOWNLOAD_URLS[id]
      if (url) {
        await shell.openExternal(url)
        return { success: true, openedBrowser: true }
      }
      return { success: false, error: err.stderr || err.message }
    }
  }

  if (process.platform === 'darwin' || process.platform === 'linux') {
    // Try brew first
    try {
      await execFileAsync('which', ['brew'], { timeout: 5000, env })
      const pkg = BREW_PACKAGES[id]
      if (pkg) {
        try {
          await execAsync(`brew install ${pkg}`, { timeout: 600000, env })
          logger.info(`[local-env] Tool installed: ${id}`)
          return { success: true }
        } catch (err: any) {
          logger.error(`Failed to install ${id} via brew:`, err)
          return { success: false, error: err.stderr || err.message }
        }
      }
    } catch {
      // brew not available, fall back to browser
    }
  } else if (process.platform === 'win32') {
    // SVN needs more than a plain winget install: CLI feature + PATH wiring
    if (id === 'svn') return installSvnWindows(env)

    // Try winget first
    try {
      await execFileAsync('where', ['winget'], { timeout: 5000, env })
      const pkg = WINGET_PACKAGES[id]
      if (pkg) {
        const result = await wingetInstall(pkg, {
          label: `${id}-install`,
          custom: WINGET_INSTALL_CUSTOM[id],
          env
        })
        if (result.code === 0 || isWingetAlreadyInstalled(result.code)) {
          invalidateWindowsRegistryPathCache()
          logger.info(`[local-env] Tool installed: ${id}`)
          if (id === 'python') {
            // Process-only PATH reorder (no registry rewrite): real Python dirs
            // ahead of the WindowsApps Store alias for this session's children.
            try {
              await ensureWindowsPythonPathPriority()
            } catch (err: unknown) {
              logger.warn('[local-env] Failed to reorder Python PATH after install:', err)
            }
          }
          const launchedSetup = await maybeLaunchPostInstallSetup(id)
          return { success: true, launchedSetup }
        }
        logger.error(`Failed to install ${id} via winget (code ${result.code})`)
        return { success: false, error: describeWingetFailure(id, result) }
      }
    } catch {
      // winget not available, fall back to browser
    }
  }

  // Fallback: open browser
  const url = DOWNLOAD_URLS[id]
  if (url) {
    await shell.openExternal(url)
    return { success: true, openedBrowser: true }
  }

  return { success: false, error: '不支持的工具' }
}

// ── Uninstall ──

export async function uninstallTool(toolId: string): Promise<ToolInstallResult> {
  const id = toolId as ToolId
  const env = await getAugmentedEnv()
  logger.info(`[local-env] Uninstalling tool: ${id}`)

  // Claude Code — native installer, no package manager involved
  if (id === 'claude-code') {
    if (process.platform === 'win32') {
      return { success: false, error: 'Windows 上请通过控制面板卸载 Claude Code' }
    }
    try {
      const claudePath = path.join(os.homedir(), '.local', 'bin', 'claude')
      if (fs.existsSync(claudePath)) {
        fs.unlinkSync(claudePath)
      }
      logger.info(`[local-env] Tool uninstalled: ${id}`)
      return { success: true }
    } catch (err: any) {
      logger.error(`Failed to uninstall ${id}:`, err)
      return { success: false, error: err.message }
    }
  }

  // Grok CLI — native installer; remove the binaries it placed in ~/.local/bin
  if (id === 'grok-cli') {
    if (process.platform === 'win32') {
      return { success: false, error: 'Windows 上请手动卸载 Grok CLI' }
    }
    try {
      // The installer ships `grok` plus an `agent` helper binary
      for (const bin of ['grok', 'agent']) {
        const binPath = path.join(os.homedir(), '.local', 'bin', bin)
        if (fs.existsSync(binPath)) {
          fs.unlinkSync(binPath)
        }
      }
      logger.info(`[local-env] Tool uninstalled: ${id}`)
      return { success: true }
    } catch (err: any) {
      logger.error(`Failed to uninstall ${id}:`, err)
      return { success: false, error: err.message }
    }
  }

  // Oh My Pi — installer script drops the binary in ~/.local/bin
  if (id === 'omp') {
    if (process.platform === 'win32') {
      return { success: false, error: mainT('localEnv.windowsManualUninstall', 'Oh My Pi') }
    }
    try {
      const binPath = path.join(os.homedir(), '.local', 'bin', 'omp')
      if (fs.existsSync(binPath)) fs.unlinkSync(binPath)
      logger.info(`[local-env] Tool uninstalled: ${id}`)
      return { success: true }
    } catch (err: unknown) {
      logger.error(`Failed to uninstall ${id}:`, err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // Antigravity CLI — remove the installer-script binary (and the brew cask on macOS)
  if (id === 'antigravity-cli') {
    try {
      if (process.platform === 'win32') {
        const agyPath = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agy', 'bin', 'agy.exe')
        if (fs.existsSync(agyPath)) fs.unlinkSync(agyPath)
      } else {
        for (const bin of ['agy', 'antigravity']) {
          const binPath = path.join(os.homedir(), '.local', 'bin', bin)
          if (fs.existsSync(binPath)) fs.unlinkSync(binPath)
        }
        if (process.platform === 'darwin') {
          try {
            await execFileAsync('brew', ['list', '--cask', 'antigravity-cli'], { timeout: 15000, env })
            await execFileAsync('brew', ['uninstall', '--cask', 'antigravity-cli'], { timeout: 300000, env })
          } catch {
            // not installed via brew (or brew unavailable)
          }
        }
      }
      logger.info(`[local-env] Tool uninstalled: ${id}`)
      return { success: true }
    } catch (err: unknown) {
      logger.error(`Failed to uninstall ${id}:`, err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ZCode desktop app — no safe programmatic uninstall
  if (id === 'zcode') {
    return { success: false, error: '请通过系统方式卸载 ZCode 桌面应用' }
  }

  // Trae — no package manager path
  if (id === 'traecli') {
    return { success: false, error: '请手动卸载 Trae CLI' }
  }

  // Native-script installs (kimi / mimo) — try removing local bin first, then npm
  if (id === 'kimi-code' || id === 'mimo-code') {
    const binName = id === 'kimi-code' ? 'kimi' : 'mimo'
    if (process.platform !== 'win32') {
      const binPath = path.join(os.homedir(), '.local', 'bin', binName)
      if (fs.existsSync(binPath)) {
        try {
          fs.unlinkSync(binPath)
          logger.info(`[local-env] Tool uninstalled: ${id}`)
          return { success: true }
        } catch (err: any) {
          logger.error(`Failed to uninstall ${id} native binary:`, err)
        }
      }
    }
  }

  // npm-managed AI CLI tools
  const npmPkg = NPM_PACKAGES[id]
  if (npmPkg) {
    try {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      await execFileAsync(npmCmd, ['uninstall', '-g', npmPkg], { timeout: 300000, env })
      logger.info(`[local-env] Tool uninstalled: ${id}`)
      return { success: true }
    } catch (err: any) {
      logger.error(`Failed to uninstall ${id} via npm:`, err)
      return { success: false, error: err.stderr || err.message }
    }
  }

  if (process.platform === 'darwin' || process.platform === 'linux') {
    const pkg = BREW_PACKAGES[id]
    if (pkg) {
      try {
        await execFileAsync('which', ['brew'], { timeout: 5000, env })
        await execAsync(`brew uninstall ${pkg}`, { timeout: 300000, env })
        logger.info(`[local-env] Tool uninstalled: ${id}`)
        return { success: true }
      } catch (err: any) {
        logger.error(`Failed to uninstall ${id} via brew:`, err)
        return { success: false, error: err.stderr || err.message }
      }
    }
  } else if (process.platform === 'win32') {
    const pkg = WINGET_PACKAGES[id]
    if (pkg) {
      try {
        await execFileAsync('where', ['winget'], { timeout: 5000, env })
        await execAsync(
          `winget uninstall --id ${pkg} -e --accept-source-agreements --disable-interactivity`,
          { timeout: 300000, env }
        )
        logger.info(`[local-env] Tool uninstalled: ${id}`)
        return { success: true }
      } catch (err: any) {
        logger.error(`Failed to uninstall ${id} via winget:`, err)
        return { success: false, error: err.stderr || err.message }
      }
    }
  }

  return { success: false, error: '该工具暂不支持一键卸载，请手动卸载' }
}

// ── Upgrade (AI Coding CLI tools) ──

export async function upgradeTool(toolId: string): Promise<ToolInstallResult> {
  const id = toolId as ToolId
  const env = await getAugmentedEnv()
  logger.info(`[local-env] Upgrading tool: ${id}`)

  // Claude Code ships its own self-update command
  if (id === 'claude-code') {
    try {
      let claudePath: string | undefined
      if (process.platform !== 'win32') {
        const nativePath = path.join(os.homedir(), '.local', 'bin', 'claude')
        if (fs.existsSync(nativePath)) claudePath = nativePath
      }
      if (!claudePath) {
        const found = await whichAll('claude', env)
        claudePath = found[0]
      }
      if (!claudePath) {
        return { success: false, error: 'Claude Code 未安装' }
      }
      await execBinary(claudePath, ['update'], { timeout: 300000, env })
      logger.info(`[local-env] Tool upgraded: ${id}`)
      return { success: true }
    } catch (err: any) {
      logger.error(`Failed to upgrade ${id}:`, err)
      return { success: false, error: err.stderr || err.message }
    }
  }

  // Grok CLI — re-run the native installer to pull the latest build
  if (id === 'grok-cli') {
    if (process.platform === 'win32') {
      await shell.openExternal('https://x.ai/cli')
      return { success: true, openedBrowser: true }
    }
    try {
      await execAsync('curl -fsSL https://x.ai/cli/install.sh | bash', { timeout: 600000, env })
      logger.info(`[local-env] Tool upgraded: ${id}`)
      return { success: true }
    } catch (err: any) {
      logger.error(`Failed to upgrade ${id} via native installer:`, err)
      return { success: false, error: err.stderr || err.message }
    }
  }

  // Oh My Pi — re-run the official installer to pull the latest release
  if (id === 'omp') {
    try {
      if (process.platform === 'win32') {
        await execAsync(
          'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://omp.sh/install.ps1 | iex"',
          { timeout: 600000, env }
        )
      } else {
        await execAsync('curl -fsSL https://omp.sh/install | sh', { timeout: 600000, env })
      }
      logger.info(`[local-env] Tool upgraded: ${id}`)
      return { success: true }
    } catch (err: any) {
      logger.error(`Failed to upgrade ${id} via install script:`, err)
      return { success: false, error: err.stderr || err.message }
    }
  }

  // Antigravity CLI — ships `agy update`; reinstall when the binary can't be found
  if (id === 'antigravity-cli') {
    try {
      let agyPath: string | undefined
      for (const cand of getToolCandidatePaths('agy')) {
        if (fs.existsSync(cand)) { agyPath = cand; break }
      }
      if (!agyPath) agyPath = (await whichAll('agy', env))[0]
      if (agyPath) {
        await execBinary(agyPath, ['update'], { timeout: 300000, env })
        logger.info(`[local-env] Tool upgraded: ${id}`)
        return { success: true }
      }
      return installTool(id)
    } catch (err: any) {
      logger.error(`Failed to upgrade ${id}:`, err)
      return { success: false, error: err.stderr || err.message }
    }
  }

  // Other AI CLIs — reinstall the npm package at @latest
  const npmPkg = NPM_PACKAGES[id]
  if (npmPkg) {
    try {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      await execFileAsync(npmCmd, ['install', '-g', `${npmPkg}@latest`], { timeout: 600000, env })
      logger.info(`[local-env] Tool upgraded: ${id}`)
      return { success: true }
    } catch (err: any) {
      logger.error(`Failed to upgrade ${id} via npm:`, err)
      return { success: false, error: err.stderr || err.message }
    }
  }

  return { success: false, error: '该工具暂不支持一键升级' }
}

// ── Latest Version Check (AI Coding CLI tools) ──

/**
 * npm packages used only to probe the latest published version — separate from
 * NPM_PACKAGES because Claude Code's native installer doesn't use npm, but
 * Anthropic still publishes @anthropic-ai/claude-code in lockstep with the
 * native binary release, so it's a reliable version source.
 */
const VERSION_CHECK_PACKAGES: Partial<Record<ToolId, string>> = {
  'claude-code': '@anthropic-ai/claude-code',
  // omp installs via its own script, but the CLI is published to npm in
  // lockstep with each release, so the registry is a reliable version source.
  omp: '@oh-my-pi/pi-coding-agent',
  // Grok/ZCode/Trae have no reliable npm version channel
  ...NPM_PACKAGES
}

function fetchNpmLatestVersion(pkg: string): Promise<string | null> {
  return new Promise((resolve) => {
    const url = `https://registry.npmjs.org/${pkg}/latest`
    const req = https.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        resolve(null)
        return
      }
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          resolve(typeof parsed.version === 'string' ? parsed.version : null)
        } catch {
          resolve(null)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

/**
 * Look up the latest published version for each of the given AI coding tools.
 * Returns null for a tool when the registry lookup fails or the tool has no
 * known package (e.g. traecli/qoder-cli whose packages are no longer published).
 */
export async function checkLatestVersions(toolIds: string[]): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    toolIds.map(async (id) => {
      const pkg = VERSION_CHECK_PACKAGES[id as ToolId]
      if (!pkg) return [id, null] as const
      const version = await fetchNpmLatestVersion(pkg)
      return [id, version] as const
    })
  )
  return Object.fromEntries(entries)
}

// ── Package Managers (pip / npm global) ──

/**
 * Resolve an absolute path for `python`/`python3` instead of relying on a
 * bareword lookup at spawn time. Not strictly required for correctness (Node's
 * non-shell execFile already resolves via PATH without consulting cwd), but
 * keeps behavior consistent and deterministic with the npm.cmd resolution
 * below, and avoids ever picking up an unexpected interpreter.
 */
async function resolvePythonPath(pythonPath: string | undefined, env: NodeJS.ProcessEnv): Promise<string> {
  if (pythonPath) return pythonPath
  // Prefer the workbench venv when it exists — that's what sub-apps run with.
  const venvPy = getWorkbenchVenvPythonPath()
  if (fs.existsSync(venvPy)) return venvPy
  const cmd = process.platform === 'win32' ? 'python' : 'python3'
  const candidates = dedup(await whichAll(cmd, env)).filter((p) => !isWindowsAppsPath(path.dirname(p)))
  if (candidates[0]) return candidates[0]

  if (process.platform === 'win32') {
    try {
      const { scanAvailablePythons } = await import('./python-detect.service')
      const scanned = await scanAvailablePythons({ env }, false)
      const found = scanned.find((sp) => sp.path && !isWindowsAppsPath(path.dirname(sp.path)))
      if (found?.path) return found.path
    } catch {
      // ignore — fall back to the bareword
    }
  }
  return cmd
}

/**
 * Resolve npm's absolute path on Windows instead of invoking the bareword
 * `npm.cmd` through `shell: true`. Spawning a fresh `cmd.exe /c npm.cmd ...`
 * this way is unreliable — `%~dp0` inside the real npm.cmd wrapper can end up
 * resolving to the *caller's* cwd (the packaged app's own install directory)
 * rather than npm's own install directory, making it try to load
 * `npm-prefix.js`/`npm-cli.js` from inside the app itself and crash with
 * MODULE_NOT_FOUND. Deriving npm's path from node's own resolved directory
 * (same pattern as detectNodejs above) sidesteps that resolution entirely.
 */
async function resolveNpmCmdPath(env: NodeJS.ProcessEnv): Promise<string> {
  if (process.platform !== 'win32') return 'npm'
  const nodePaths = dedup(await whichAll('node', env))
  for (const nodePath of nodePaths) {
    const npmBin = path.join(path.dirname(nodePath), 'npm.cmd')
    if (fs.existsSync(npmBin)) return npmBin
  }
  const npmPaths = await whichAll('npm.cmd', env)
  return npmPaths[0] || 'npm.cmd'
}

export async function listPipPackages(pythonPath?: string): Promise<PackageListResult> {
  const env = await getAugmentedEnv()
  const py = await resolvePythonPath(pythonPath, env)
  try {
    const { stdout } = await execBinary(py, ['-m', 'pip', 'list', '--format=json'], {
      timeout: 30000,
      env,
      cwd: os.homedir()
    })
    const raw = JSON.parse(stdout) as Array<{ name: string; version: string }>
    const packages = raw
      .map((p) => ({ name: p.name, version: p.version }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { success: true, packages }
  } catch (err: any) {
    logger.error('Failed to list pip packages:', err)
    return { success: false, error: err.stderr || err.message }
  }
}

export async function uninstallPipPackage(packageName: string, pythonPath?: string): Promise<ToolInstallResult> {
  const env = await getAugmentedEnv()
  const py = await resolvePythonPath(pythonPath, env)
  try {
    await execBinary(py, ['-m', 'pip', 'uninstall', '-y', packageName], {
      timeout: 60000,
      env,
      cwd: os.homedir()
    })
    logger.info(`[local-env] pip package uninstalled: ${packageName}`)
    return { success: true }
  } catch (err: any) {
    logger.error(`Failed to uninstall pip package ${packageName}:`, err)
    return { success: false, error: err.stderr || err.message }
  }
}

export async function listNpmGlobalPackages(): Promise<PackageListResult> {
  const env = await getAugmentedEnv()
  try {
    const npmCmd = await resolveNpmCmdPath(env)
    const { stdout } = await execBinary(npmCmd, ['list', '-g', '--depth=0', '--json'], {
      timeout: 30000,
      env,
      cwd: os.homedir()
    })
    return { success: true, packages: parseNpmListOutput(stdout) }
  } catch (err: any) {
    // `npm list -g` can exit non-zero (e.g. peer dep warnings) while still printing valid JSON
    if (err.stdout) {
      try {
        return { success: true, packages: parseNpmListOutput(err.stdout) }
      } catch { /* fall through to error */ }
    }
    logger.error('Failed to list npm global packages:', err)
    return { success: false, error: err.stderr || err.message }
  }
}

function parseNpmListOutput(stdout: string): PackageInfo[] {
  const data = JSON.parse(stdout)
  const deps = (data.dependencies || {}) as Record<string, { version?: string }>
  return Object.entries(deps)
    .filter(([name]) => name !== 'npm') // avoid users accidentally uninstalling npm itself
    .map(([name, info]) => ({ name, version: info?.version || 'unknown' }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function uninstallNpmGlobalPackage(packageName: string): Promise<ToolInstallResult> {
  const env = await getAugmentedEnv()
  try {
    const npmCmd = await resolveNpmCmdPath(env)
    await execBinary(npmCmd, ['uninstall', '-g', packageName], { timeout: 60000, env, cwd: os.homedir() })
    logger.info(`[local-env] npm global package uninstalled: ${packageName}`)
    return { success: true }
  } catch (err: any) {
    logger.error(`Failed to uninstall npm global package ${packageName}:`, err)
    return { success: false, error: err.stderr || err.message }
  }
}

// ── China mirrors (pip / npm / docker) ──

export type MirrorToolId = 'python' | 'nodejs' | 'docker'

export interface MirrorSourceStatus {
  toolId: MirrorToolId
  enabled: boolean
  currentSource: string
  chinaSource: string
  needsRestart?: boolean
}

export interface MirrorSourceResult {
  success: boolean
  status?: MirrorSourceStatus
  error?: string
}

/**
 * Hardcoded China mirrors — pick the most widely used / best maintained
 * public endpoints (as of 2026). Toggle OFF = official defaults above.
 *
 * - pip:    Tsinghua TUNA (docs: mirrors.tuna.tsinghua.edu.cn/help/pypi/)
 * - npm:    npmmirror.com (ex-taobao cnpm; de-facto standard in CN)
 * - docker: DaoCloud public registry-mirrors (docker.m.daocloud.io)
 */
const CHINA_MIRRORS = {
  python: {
    indexUrl: 'https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple',
    trustedHost: 'mirrors.tuna.tsinghua.edu.cn'
  },
  nodejs: {
    registry: 'https://registry.npmmirror.com'
  },
  docker: {
    registryMirrors: ['https://docker.m.daocloud.io']
  }
} as const

/** Official upstream defaults when China mirror is off / restored with no backup */
const OFFICIAL_DEFAULTS = {
  python: 'https://pypi.org/simple',
  nodejs: 'https://registry.npmjs.org/',
  dockerLabel: 'Docker Hub (official)'
} as const

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

function urlsEqual(a: string | null | undefined, b: string): boolean {
  if (!a) return false
  return normalizeUrl(a) === normalizeUrl(b)
}

/** True only when current config matches the mirror *we* apply (not any third-party CN mirror). */
function isOurPipChina(url: string | null | undefined): boolean {
  if (!url) return false
  const u = normalizeUrl(url)
  const ours = normalizeUrl(CHINA_MIRRORS.python.indexUrl)
  // Also accept the older TUNA host form so re-toggle still works after upgrade
  return u === ours || u === normalizeUrl('https://pypi.tuna.tsinghua.edu.cn/simple')
}

function isOurNpmChina(url: string | null | undefined): boolean {
  return urlsEqual(url, CHINA_MIRRORS.nodejs.registry)
}

function isOurDockerChina(mirrors: string[] | null | undefined): boolean {
  if (!mirrors || mirrors.length === 0) return false
  const ours = CHINA_MIRRORS.docker.registryMirrors.map((m) => normalizeUrl(m))
  const cur = mirrors.map((m) => normalizeUrl(m))
  return ours.length === cur.length && ours.every((m, i) => m === cur[i])
}

/** Used when restoring: if previous snapshot itself was a China mirror, fall back to official. */
function isAnyChinaPipUrl(url: string | null | undefined): boolean {
  if (!url) return false
  const u = normalizeUrl(url)
  return (
    u.includes('tuna.tsinghua') ||
    u.includes('mirrors.aliyun.com/pypi') ||
    u.includes('mirrors.cloud.tencent.com/pypi') ||
    u.includes('mirrors.huaweicloud.com/repository/pypi') ||
    u.includes('pypi.douban') ||
    u.includes('npmmirror.com/pypi')
  )
}

function isAnyChinaNpmRegistry(url: string | null | undefined): boolean {
  if (!url) return false
  const u = normalizeUrl(url)
  return (
    u.includes('registry.npmmirror.com') ||
    u.includes('registry.npm.taobao.org') ||
    u.includes('mirrors.cloud.tencent.com/npm') ||
    u.includes('mirrors.huaweicloud.com/repository/npm')
  )
}

function isAnyChinaDockerMirrors(mirrors: string[] | null | undefined): boolean {
  if (!mirrors || mirrors.length === 0) return false
  return mirrors.some((m) => {
    const u = normalizeUrl(m)
    return (
      u.includes('daocloud.io') ||
      u.includes('docker.mirrors.ustc.edu.cn') ||
      u.includes('hub-mirror.c.163.com') ||
      u.includes('mirror.baidubce.com') ||
      u.includes('dockerproxy.com') ||
      u.includes('docker.nju.edu.cn')
    )
  })
}

async function readPipConfig(
  py: string,
  key: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  try {
    const { stdout } = await execBinary(py, ['-m', 'pip', 'config', 'get', key], {
      timeout: 15000,
      env,
      cwd: os.homedir()
    })
    const val = stdout.trim()
    return val || null
  } catch {
    return null
  }
}

async function writePipConfig(
  py: string,
  key: string,
  value: string | null,
  env: NodeJS.ProcessEnv
): Promise<void> {
  if (value === null || value === '') {
    try {
      await execBinary(py, ['-m', 'pip', 'config', 'unset', key], {
        timeout: 15000,
        env,
        cwd: os.homedir()
      })
    } catch {
      // already unset
    }
    return
  }
  await execBinary(py, ['-m', 'pip', 'config', 'set', key, value], {
    timeout: 15000,
    env,
    cwd: os.homedir()
  })
}

async function readNpmRegistry(env: NodeJS.ProcessEnv): Promise<string> {
  const npmCmd = await resolveNpmCmdPath(env)
  try {
    const { stdout } = await execBinary(npmCmd, ['config', 'get', 'registry'], {
      timeout: 15000,
      env,
      cwd: os.homedir()
    })
    return stdout.trim() || OFFICIAL_DEFAULTS.nodejs
  } catch {
    return OFFICIAL_DEFAULTS.nodejs
  }
}

async function writeNpmRegistry(registry: string, env: NodeJS.ProcessEnv): Promise<void> {
  const npmCmd = await resolveNpmCmdPath(env)
  await execBinary(npmCmd, ['config', 'set', 'registry', registry], {
    timeout: 15000,
    env,
    cwd: os.homedir()
  })
}

function dockerDaemonJsonPath(): string {
  return path.join(os.homedir(), '.docker', 'daemon.json')
}

function readDockerDaemonJson(): Record<string, unknown> {
  const p = dockerDaemonJsonPath()
  try {
    if (!fs.existsSync(p)) return {}
    const raw = fs.readFileSync(p, 'utf8').trim()
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (err) {
    logger.warn('[local-env] failed to parse docker daemon.json:', err)
    return {}
  }
}

function writeDockerDaemonJson(data: Record<string, unknown>): void {
  const p = dockerDaemonJsonPath()
  const dir = path.dirname(p)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function readDockerRegistryMirrors(): string[] | null {
  const data = readDockerDaemonJson()
  if (!Object.prototype.hasOwnProperty.call(data, 'registry-mirrors')) return null
  const mirrors = data['registry-mirrors']
  if (!Array.isArray(mirrors)) return []
  return mirrors.map(String)
}

function writeDockerRegistryMirrors(mirrors: string[] | null): void {
  const data = readDockerDaemonJson()
  if (mirrors === null) {
    delete data['registry-mirrors']
  } else {
    data['registry-mirrors'] = mirrors
  }
  writeDockerDaemonJson(data)
}

async function getPythonMirrorStatus(pythonPath?: string): Promise<MirrorSourceStatus> {
  const env = await getAugmentedEnv()
  const py = await resolvePythonPath(pythonPath, env)
  const indexUrl = await readPipConfig(py, 'global.index-url', env)
  const china = CHINA_MIRRORS.python.indexUrl
  const backup = getLocalEnvMirrorBackup('python')
  // Default = official. Switch is ON only when we turned it on, or config already equals our CN mirror.
  const enabled = backup?.enabled === true || isOurPipChina(indexUrl)
  return {
    toolId: 'python',
    enabled,
    currentSource: indexUrl || OFFICIAL_DEFAULTS.python,
    chinaSource: china
  }
}

async function getNodejsMirrorStatus(): Promise<MirrorSourceStatus> {
  const env = await getAugmentedEnv()
  const registry = await readNpmRegistry(env)
  const china = CHINA_MIRRORS.nodejs.registry
  const backup = getLocalEnvMirrorBackup('nodejs')
  const enabled = backup?.enabled === true || isOurNpmChina(registry)
  return {
    toolId: 'nodejs',
    enabled,
    currentSource: registry || OFFICIAL_DEFAULTS.nodejs,
    chinaSource: china
  }
}

function getDockerMirrorStatus(): MirrorSourceStatus {
  const mirrors = readDockerRegistryMirrors()
  const china = CHINA_MIRRORS.docker.registryMirrors
  const backup = getLocalEnvMirrorBackup('docker')
  const enabled = backup?.enabled === true || isOurDockerChina(mirrors)
  const current =
    mirrors === null || mirrors.length === 0
      ? OFFICIAL_DEFAULTS.dockerLabel
      : mirrors.join(', ')
  return {
    toolId: 'docker',
    enabled,
    currentSource: current,
    chinaSource: china.join(', '),
    needsRestart: true
  }
}

export async function getMirrorSource(
  toolId: MirrorToolId,
  pythonPath?: string
): Promise<MirrorSourceResult> {
  try {
    if (toolId === 'python') return { success: true, status: await getPythonMirrorStatus(pythonPath) }
    if (toolId === 'nodejs') return { success: true, status: await getNodejsMirrorStatus() }
    if (toolId === 'docker') return { success: true, status: getDockerMirrorStatus() }
    return { success: false, error: `Unsupported tool: ${toolId}` }
  } catch (err: any) {
    logger.error(`[local-env] getMirrorSource(${toolId}) failed:`, err)
    return { success: false, error: err.stderr || err.message || String(err) }
  }
}

export async function setMirrorSource(
  toolId: MirrorToolId,
  enabled: boolean,
  pythonPath?: string
): Promise<MirrorSourceResult> {
  try {
    if (toolId === 'python') {
      const env = await getAugmentedEnv()
      const py = await resolvePythonPath(pythonPath, env)
      const china = CHINA_MIRRORS.python

      if (enabled) {
        const currentIndex = await readPipConfig(py, 'global.index-url', env)
        const currentHost = await readPipConfig(py, 'global.trusted-host', env)
        const existing = getLocalEnvMirrorBackup('python')
        // Snapshot previous (usually official) only the first time we switch on
        const backup: LocalEnvMirrorBackup = {
          enabled: true,
          previousIndexUrl: existing?.enabled ? existing.previousIndexUrl : currentIndex,
          previousTrustedHost: existing?.enabled ? existing.previousTrustedHost : currentHost
        }
        if (!isOurPipChina(currentIndex)) {
          await writePipConfig(py, 'global.index-url', china.indexUrl, env)
          await writePipConfig(py, 'global.trusted-host', china.trustedHost, env)
        }
        setLocalEnvMirrorBackup('python', backup)
      } else {
        const backup = getLocalEnvMirrorBackup('python')
        // No backup → clear config so pip falls back to official pypi.org
        let restoreIndex: string | null =
          backup && Object.prototype.hasOwnProperty.call(backup, 'previousIndexUrl')
            ? backup.previousIndexUrl ?? null
            : null
        let restoreHost: string | null =
          backup && Object.prototype.hasOwnProperty.call(backup, 'previousTrustedHost')
            ? backup.previousTrustedHost ?? null
            : null
        // Never restore into another China mirror; land on official
        if (isAnyChinaPipUrl(restoreIndex) || isOurPipChina(restoreIndex)) {
          restoreIndex = null
          restoreHost = null
        }
        await writePipConfig(py, 'global.index-url', restoreIndex, env)
        await writePipConfig(py, 'global.trusted-host', restoreHost, env)
        setLocalEnvMirrorBackup('python', null)
      }
      return { success: true, status: await getPythonMirrorStatus(pythonPath) }
    }

    if (toolId === 'nodejs') {
      const env = await getAugmentedEnv()
      const china = CHINA_MIRRORS.nodejs.registry

      if (enabled) {
        const current = await readNpmRegistry(env)
        const existing = getLocalEnvMirrorBackup('nodejs')
        const backup: LocalEnvMirrorBackup = {
          enabled: true,
          previousRegistry: existing?.enabled ? existing.previousRegistry : current
        }
        if (!isOurNpmChina(current)) {
          await writeNpmRegistry(china, env)
        }
        setLocalEnvMirrorBackup('nodejs', backup)
      } else {
        const backup = getLocalEnvMirrorBackup('nodejs')
        let restore = backup?.previousRegistry || OFFICIAL_DEFAULTS.nodejs
        if (isAnyChinaNpmRegistry(restore) || isOurNpmChina(restore)) {
          restore = OFFICIAL_DEFAULTS.nodejs
        }
        await writeNpmRegistry(restore, env)
        setLocalEnvMirrorBackup('nodejs', null)
      }
      return { success: true, status: await getNodejsMirrorStatus() }
    }

    if (toolId === 'docker') {
      const china = [...CHINA_MIRRORS.docker.registryMirrors]

      if (enabled) {
        const current = readDockerRegistryMirrors()
        const existing = getLocalEnvMirrorBackup('docker')
        const backup: LocalEnvMirrorBackup = {
          enabled: true,
          previousRegistryMirrors: existing?.enabled
            ? existing.previousRegistryMirrors
            : current
        }
        if (!isOurDockerChina(current)) {
          writeDockerRegistryMirrors(china)
        }
        setLocalEnvMirrorBackup('docker', backup)
      } else {
        const backup = getLocalEnvMirrorBackup('docker')
        // No backup → remove registry-mirrors (Docker Hub official)
        let restore: string[] | null =
          backup && Object.prototype.hasOwnProperty.call(backup, 'previousRegistryMirrors')
            ? backup.previousRegistryMirrors ?? null
            : null
        if (isAnyChinaDockerMirrors(restore) || isOurDockerChina(restore)) {
          restore = null
        }
        writeDockerRegistryMirrors(restore)
        setLocalEnvMirrorBackup('docker', null)
      }
      return { success: true, status: getDockerMirrorStatus() }
    }

    return { success: false, error: `Unsupported tool: ${toolId}` }
  } catch (err: any) {
    logger.error(`[local-env] setMirrorSource(${toolId}, ${enabled}) failed:`, err)
    return { success: false, error: err.stderr || err.message || String(err) }
  }
}
