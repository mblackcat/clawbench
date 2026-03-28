import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { shell } from 'electron'
import * as logger from '../utils/logger'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

type ToolId =
  | 'python' | 'nodejs' | 'go' | 'java' | 'docker'
  | 'mysql' | 'postgresql' | 'mongodb'
  | 'git' | 'svn' | 'perforce'
  | 'claude-code' | 'gemini-cli' | 'codex-cli' | 'opencode' | 'traecli' | 'qwen-code' | 'qoder-cli'
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
}

interface LocalEnvDetectionResult {
  tools: ToolDetectionResult[]
  packageManagers: PackageManagerInfo
  platform: string
}

function getAugmentedEnv(): NodeJS.ProcessEnv {
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
  }
  return env
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
      return stdout.trim().split(/\r?\n/).filter(Boolean)
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
    const { stdout } = await execFileAsync(cmd, args, { timeout: 10000, env })
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

  // Preferred location for native installer
  const nativePath = path.join(os.homedir(), '.local', 'bin', 'claude')
  candidates.push(nativePath)

  // Also check PATH for other locations
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

async function detectGeminiCli(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  return detectNpmGlobalTool('gemini-cli', 'Gemini CLI', 'gemini', /(\d+\.\d+\.\d+)/, env)
}

async function detectCodexCli(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  return detectNpmGlobalTool('codex-cli', 'Codex CLI', 'codex', /(\d+\.\d+\.\d+)/, env)
}

async function detectQwenCode(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  return detectNpmGlobalTool('qwen-code', 'Qwen Code', 'qwen', /(\d+\.\d+\.\d+)/, env)
}

async function detectOpenCode(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  return detectNpmGlobalTool('opencode', 'OpenCode', 'opencode', /(\d+\.\d+\.\d+)/, env)
}

async function detectTraeCli(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  return detectNpmGlobalTool('traecli', 'Trae CLI', 'trae', /(\d+\.\d+\.\d+)/, env)
}

async function detectQoderCli(env: NodeJS.ProcessEnv): Promise<ToolDetectionResult> {
  return detectNpmGlobalTool('qoder-cli', 'Qoder CLI', 'qoder', /(\d+\.\d+\.\d+)/, env)
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
  const env = getAugmentedEnv()

  const [
    python, nodejs, go, java, docker,
    mysql, postgresql, mongodb,
    git, svn, perforce,
    claudeCode, geminiCli, codexCli, openCode, traeCli, qwenCode, qoderCli,
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
    detectGit(env),
    detectSvn(env),
    detectPerforce(env),
    detectClaudeCode(env),
    detectGeminiCli(env),
    detectCodexCli(env),
    detectOpenCode(env),
    detectTraeCli(env),
    detectQwenCode(env),
    detectQoderCli(env),
    process.platform === 'darwin' ? detectBrew(env) : Promise.resolve<ToolDetectionResult>({ toolId: 'homebrew', name: 'Homebrew', installed: false, installations: [] }),
    detectPackageManagers(env)
  ])

  const tools: ToolDetectionResult[] = [
    python, nodejs, go, java, docker,
    mysql, postgresql, mongodb,
    git, svn, perforce,
    claudeCode, geminiCli, codexCli, openCode, traeCli, qwenCode, qoderCli
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
  git: detectGit,
  svn: detectSvn,
  perforce: detectPerforce,
  'claude-code': detectClaudeCode,
  'gemini-cli': detectGeminiCli,
  'codex-cli': detectCodexCli,
  opencode: detectOpenCode,
  traecli: detectTraeCli,
  'qwen-code': detectQwenCode,
  'qoder-cli': detectQoderCli,
  homebrew: detectBrew,
}

export async function detectOne(toolId: string): Promise<ToolDetectionResult> {
  const env = getAugmentedEnv()
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
  git: 'https://git-scm.com/downloads',
  svn: process.platform === 'win32'
    ? 'https://tortoisesvn.net/downloads.html'
    : 'https://subversion.apache.org/packages.html',
  perforce: 'https://www.perforce.com/downloads/helix-command-line-client-p4',
  'claude-code': 'https://docs.anthropic.com/en/docs/claude-code',
  'gemini-cli': 'https://github.com/google-gemini/gemini-cli',
  'codex-cli': 'https://github.com/openai/codex',
  'opencode': 'https://opencode.ai',
  'traecli': 'https://www.trae.ai',
  'qwen-code': 'https://github.com/QwenLM/qwen-code',
  'qoder-cli': 'https://qodo.ai'
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
  git: 'Git.Git',
  svn: 'TortoiseSVN.TortoiseSVN'
}

/** AI coding tools installed via npm install -g */
const NPM_PACKAGES: Partial<Record<ToolId, string>> = {
  // NOTE: claude-code removed — Anthropic deprecated the npm package; native installer only
  'gemini-cli': '@google/gemini-cli',
  'codex-cli': '@openai/codex',
  'opencode': 'opencode-ai',
  'traecli': '@trae-ai/trae-cli',
  'qwen-code': '@qwen-code/qwen-code',
  'qoder-cli': '@qodo-ai/qoder'
}

/** Brew fallback for tools that also support brew (macOS only) */
const BREW_FALLBACK: Partial<Record<ToolId, string>> = {
  'opencode': 'anomalyco/tap/opencode'
}

export async function installTool(toolId: string): Promise<ToolInstallResult> {
  const id = toolId as ToolId
  const env = getAugmentedEnv()
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
          return { success: true }
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
