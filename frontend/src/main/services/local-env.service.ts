import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as https from 'https'
import { shell } from 'electron'
import * as logger from '../utils/logger'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

type ToolId =
  | 'python' | 'nodejs' | 'go' | 'java' | 'docker'
  | 'mysql' | 'postgresql' | 'mongodb' | 'redis'
  | 'git' | 'svn' | 'perforce'
  | 'claude-code' | 'codex-cli' | 'gemini-cli' | 'grok-cli'
  | 'opencode' | 'traecli' | 'qoder-cli'
  | 'kimi-code' | 'zcode' | 'mimo-code'
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

let cachedWinRegistryPath: { value: string; timestamp: number } | null = null

/**
 * Windows only: read the live Machine + User PATH straight from the environment
 * (via a fresh PowerShell process), bypassing `process.env.PATH`. The Electron
 * main process only snapshots its environment at launch, so a tool installed by
 * winget/an installer wizard *during this session* updates the registry but is
 * invisible to `process.env` until the app restarts — which made freshly
 * installed tools (e.g. MySQL) keep showing as "not installed" after a
 * successful install + refresh. Re-reading the registry directly fixes that
 * without requiring a restart. Cached briefly to avoid spawning PowerShell on
 * every detection call.
 */
async function getWindowsRegistryPath(): Promise<string> {
  if (cachedWinRegistryPath && Date.now() - cachedWinRegistryPath.timestamp < 5000) {
    return cachedWinRegistryPath.value
  }
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')"
      ],
      { timeout: 8000 }
    )
    const value = stdout.trim()
    cachedWinRegistryPath = { value, timestamp: Date.now() }
    return value
  } catch {
    return ''
  }
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
    env[pathKey] = p
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

  const allPaths = dedup([...python3Paths, ...pythonPaths])

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

async function detectSvn(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  const result: ToolDetectionResult = {
    toolId: 'svn',
    name: 'SVN',
    installed: false,
    installations: []
  }

  const version = await getVersion('svn', ['--version', '--quiet'], env)
  if (version) {
    const svnPaths = await whichAll('svn', env)
    const svnPath = svnPaths[0] || 'svn'

    result.installations.push({ path: svnPath, version: version })
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

  const paths = await whichAll(cmd, env)
  const uniquePaths = dedup(paths)

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

  // Preferred location for native installer (POSIX only — the install.sh is Unix-only)
  if (process.platform !== 'win32') {
    const nativePath = path.join(os.homedir(), '.local', 'bin', 'claude')
    candidates.push(nativePath)
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

  // Preferred location for the native installer (POSIX only — install.sh is Unix-only)
  if (process.platform !== 'win32') {
    const nativePath = path.join(os.homedir(), '.local', 'bin', 'grok')
    candidates.push(nativePath)
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
    process.platform === 'darwin' ? detectBrew(env) : Promise.resolve<ToolDetectionResult>({ toolId: 'homebrew', name: 'Homebrew', installed: false, installations: [] }),
    detectPackageManagers(env)
  ])

  // AI tools kept in user-facing order: Claude → Codex → Gemini → Grok → OpenCode → Trae → Qoder → Kimi → ZCode → MiMo
  const tools: ToolDetectionResult[] = [
    python, nodejs, go, java, docker,
    mysql, postgresql, mongodb, redis,
    git, svn, perforce,
    claudeCode, codexCli, geminiCli, grokCli,
    openCode, traeCli, qoderCli, kimiCode, zcode, mimoCode
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
  'mimo-code': 'https://mimo.xiaomi.com/mimocode/start'
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
  svn: 'subversion'
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
    // Try winget first
    try {
      await execFileAsync('where', ['winget'], { timeout: 5000, env })
      const pkg = WINGET_PACKAGES[id]
      if (pkg) {
        try {
          await execAsync(
            `winget install ${pkg} --accept-source-agreements --accept-package-agreements`,
            { timeout: 600000, env }
          )
          logger.info(`[local-env] Tool installed: ${id}`)
          const launchedSetup = await maybeLaunchPostInstallSetup(id)
          return { success: true, launchedSetup }
        } catch (err: any) {
          logger.error(`Failed to install ${id} via winget:`, err)
          return { success: false, error: err.stderr || err.message }
        }
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
        await execAsync(`winget uninstall ${pkg} --accept-source-agreements`, { timeout: 300000, env })
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
  const cmd = process.platform === 'win32' ? 'python' : 'python3'
  const candidates = dedup(await whichAll(cmd, env))
  return candidates[0] || cmd
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
