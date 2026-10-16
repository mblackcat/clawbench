import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import crypto from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'
import { getWorkbenchVenvPath, getWorkbenchVenvPythonPath, getTempDir } from '../utils/paths'
import { scanAvailablePythons } from './python-detect.service'
import { ensureWindowsPythonPathPriority, isWindowsAppsPath } from '../utils/windows-env'
import * as logger from '../utils/logger'
import { mainT } from '../utils/i18n'
import { settingsStore } from '../store/settings.store'
import { listSubApps } from './subapp.service'

export interface VenvEnsureResult {
  success: boolean
  pythonPath?: string
  error?: string
}

export interface RequirementsInstallResult {
  success: boolean
  installed: boolean
  cached?: boolean
  error?: string
}

interface InstalledHashes {
  [hash: string]: {
    appPath?: string
    installedAt: number
  }
}

/** Mutex chain to serialize venv creation and pip installations with re-entrancy support */
const venvLockStorage = new AsyncLocalStorage<boolean>()
let venvLock: Promise<unknown> = Promise.resolve()

function withVenvLock<T>(fn: () => Promise<T>): Promise<T> {
  if (venvLockStorage.getStore()) {
    return fn()
  }
  const result = venvLock.then(
    () => venvLockStorage.run(true, fn),
    () => venvLockStorage.run(true, fn)
  )
  venvLock = result.catch(() => {})
  return result
}

function withResolvers<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { promise, resolve } = withResolvers<{ code: number; stdout: string; stderr: string }>()
  let stdout = ''
  let stderr = ''
  let settled = false

  const proc = spawn(command, args, {
    cwd: options.cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: options.env || process.env
  })

  const timer = options.timeoutMs
    ? setTimeout(() => {
        if (!settled) {
          settled = true
          proc.kill()
          resolve({
            code: -1,
            stdout,
            stderr: stderr + `\nProcess timed out after ${options.timeoutMs}ms`
          })
        }
      }, options.timeoutMs)
    : undefined

  proc.stdout?.on('data', (data: Buffer) => {
    stdout += data.toString()
  })

  proc.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString()
  })

  proc.on('close', (code) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve({ code: code ?? -1, stdout, stderr })
  })

  proc.on('error', (err) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve({ code: -1, stdout, stderr: stderr + `\n${err.message}` })
  })

  return promise
}

/**
 * Optional pip index (mirror) URL for venv bootstrap / requirement installs.
 *
 * Source order: `settings.pipIndexUrl`, then the `CB_PIP_INDEX_URL` env var.
 * Empty by default — pip then uses its own configuration (pip.conf /
 * `PIP_INDEX_URL`) or PyPI. We pass it per-invocation (`--index-url`) rather
 * than `pip config set`, which would rewrite the user's global pip config.
 */
export function resolvePipIndexUrl(): string {
  let configured = ''
  try {
    const v = settingsStore.get('pipIndexUrl')
    if (typeof v === 'string') configured = v.trim()
  } catch {
    // settings store unavailable (tests / early bootstrap)
  }
  if (!configured) configured = (process.env.CB_PIP_INDEX_URL || '').trim()
  if (!configured) return ''
  try {
    const u = new URL(configured)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return configured
  } catch {
    return ''
  }
}

/** Extra pip args (`--index-url` / `--trusted-host`) for a configured mirror. */
export function buildPipIndexArgs(indexUrl: string = resolvePipIndexUrl()): string[] {
  if (!indexUrl) return []
  const args = ['--index-url', indexUrl]
  try {
    const u = new URL(indexUrl)
    // pip refuses plain-http indexes unless the host is explicitly trusted
    if (u.protocol === 'http:') args.push('--trusted-host', u.hostname)
  } catch {
    // resolvePipIndexUrl already validated
  }
  return args
}

/**
 * Extracts third-party dependencies from requirements.txt, filtering out
 * comments, blank lines, and the bundled local SDK (clawbench-sdk is provided
 * via PYTHONPATH, so it must never be fetched from an index).
 */
export function extractExternalRequirements(content: string): string[] {
  const lines = content.split(/\r?\n/)
  const deps: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (/^(clawbench|workbench)[-_]sdk(?![a-z0-9_.-])/i.test(trimmed)) continue
    deps.push(trimmed)
  }

  return deps
}

/**
 * Checks if a specific app directory contains its own virtual environment.
 */
export function getAppVenvPython(appPath: string): string | null {
  if (!appPath || !fs.existsSync(appPath)) return null

  const candidates = process.platform === 'win32'
    ? [
        path.join(appPath, '.venv', 'Scripts', 'python.exe'),
        path.join(appPath, 'venv', 'Scripts', 'python.exe')
      ]
    : [
        path.join(appPath, '.venv', 'bin', 'python'),
        path.join(appPath, 'venv', 'bin', 'python')
      ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/**
 * Checks whether the shared workbench virtual environment is ready.
 */
export function isWorkbenchVenvReady(): boolean {
  return fs.existsSync(getWorkbenchVenvPythonPath())
}

/**
 * Locate a host Python executable to use as the base for creating the virtual environment.
 * Excludes any executable located inside our dedicated venv.
 */
export async function findHostBasePython(): Promise<string | null> {
  const venvDir = path.resolve(getWorkbenchVenvPath()).toLowerCase()

  try {
    const scanned = await scanAvailablePythons({}, true)
    for (const opt of scanned) {
      if (!opt.path || isWindowsAppsPath(opt.path)) continue
      const normalized = path.resolve(opt.path).toLowerCase()
      if (normalized.startsWith(venvDir)) continue

      // Verify execution
      const test = await runProcess(opt.path, ['--version'], { timeoutMs: 4000 })
      if (test.code === 0 && test.stdout.toLowerCase().includes('python')) {
        return opt.path
      }
    }
  } catch (err) {
    logger.warn('[python-venv] Error scanning for host pythons:', err)
  }

  // Fallback probing standard commands — never run bareword on Windows to avoid triggering Microsoft Store
  if (process.platform !== 'win32') {
    for (const cmd of ['python3', 'python']) {
      try {
        const probeRes = await runProcess(cmd, ['--version'], { timeoutMs: 4000 })
        if (probeRes.code === 0 && probeRes.stdout.toLowerCase().includes('python')) {
          return cmd
        }
      } catch {
        // ignore
      }
    }
  }

  return null
}

/**
 * Path to the hash registry file tracking already-installed requirements.
 */
function getInstalledHashesPath(): string {
  return path.join(getWorkbenchVenvPath(), '.installed-hashes.json')
}

function loadInstalledHashes(): InstalledHashes {
  const filePath = getInstalledHashesPath()
  if (!fs.existsSync(filePath)) return {}
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as InstalledHashes
  } catch {
    return {}
  }
}

function saveInstalledHashes(hashes: InstalledHashes): void {
  const filePath = getInstalledHashesPath()
  try {
    fs.writeFileSync(filePath, JSON.stringify(hashes, null, 2), 'utf-8')
  } catch (err) {
    logger.warn('[python-venv] Failed to save installed requirements hash cache:', err)
  }
}

/**
 * Ensures the workbench virtual environment exists and is initialized.
 * Pre-seeds base dependencies (pyyaml, requests), using the optional pip
 * mirror from {@link resolvePipIndexUrl} when one is configured.
 */
export async function ensureWorkbenchVenv(): Promise<VenvEnsureResult> {
  return withVenvLock(async () => {
    // Ensure real Python precedes Microsoft WindowsApps on this process's PATH
    // (process-only — the registry user PATH is never touched here).
    if (process.platform === 'win32') {
      try {
        const fixResult = await ensureWindowsPythonPathPriority()
        if (fixResult.changed) {
          logger.info('[python-venv] Reordered process PATH to prioritize real Python over Microsoft Store')
        }
      } catch (err: unknown) {
        logger.warn('[python-venv] Failed to check/reorder Windows Python PATH priority:', err)
      }
    }

    const venvPython = getWorkbenchVenvPythonPath()
    if (fs.existsSync(venvPython)) {
      return { success: true, pythonPath: venvPython }
    }

    const venvDir = getWorkbenchVenvPath()
    logger.info(`[python-venv] Initializing workbench venv at: ${venvDir}`)

    const hostPython = await findHostBasePython()
    if (!hostPython) {
      const errorMsg = mainT('pythonVenv.noHostPython')
      logger.error(`[python-venv] ${errorMsg}`)
      return { success: false, error: errorMsg }
    }

    logger.info(`[python-venv] Using host Python to create venv: ${hostPython}`)
    if (!fs.existsSync(venvDir)) {
      fs.mkdirSync(venvDir, { recursive: true })
    }

    const createRes = await runProcess(hostPython, ['-m', 'venv', venvDir], { timeoutMs: 120000 })
    if (createRes.code !== 0 || !fs.existsSync(venvPython)) {
      const errorMsg = createRes.stderr || createRes.stdout || mainT('pythonVenv.createFailed')
      logger.error(`[python-venv] Failed to create venv:`, errorMsg)
      return { success: false, error: errorMsg }
    }

    logger.info(`[python-venv] Venv created successfully`)

    // Pre-seed common packages: pyyaml, requests
    logger.info(`[python-venv] Pre-installing seed dependencies (pyyaml, requests)...`)
    const seedRes = await runProcess(
      venvPython,
      ['-m', 'pip', 'install', '--prefer-binary', ...buildPipIndexArgs(), 'pyyaml', 'requests'],
      { timeoutMs: 120000 }
    )
    if (seedRes.code === 0) {
      logger.info(`[python-venv] Seed dependencies installed successfully`)
    } else {
      logger.warn(`[python-venv] Non-fatal: seed dependencies installation finished with status ${seedRes.code}:`, seedRes.stderr)
    }

    return { success: true, pythonPath: venvPython }
  })
}

/**
 * Installs dependencies specified in requirements.txt for a sub-app.
 * Uses sha256 hash caching to avoid redundant installs.
 */
export async function installAppRequirements(
  appPath: string,
  opts?: { force?: boolean }
): Promise<RequirementsInstallResult> {
  if (!appPath) {
    return { success: true, installed: false }
  }

  const reqFile = path.join(appPath, 'requirements.txt')
  if (!fs.existsSync(reqFile)) {
    return { success: true, installed: false }
  }

  let content = ''
  try {
    content = fs.readFileSync(reqFile, 'utf-8').trim()
  } catch (err) {
    logger.warn(`[python-venv] Failed to read ${reqFile}:`, err)
    return { success: true, installed: false }
  }

  if (!content) {
    return { success: true, installed: false }
  }

  const externalDeps = extractExternalRequirements(content)
  const hash = crypto.createHash('sha256').update(content).digest('hex')
  const hashes = loadInstalledHashes()

  if (!opts?.force && hashes[hash]) {
    logger.info(`[python-venv] Requirements already satisfied for ${appPath} (hash: ${hash.slice(0, 8)})`)
    return { success: true, installed: false, cached: true }
  }

  // If all lines are comments or the local SDK, no pip installation is needed
  if (externalDeps.length === 0) {
    hashes[hash] = { appPath, installedAt: Date.now() }
    saveInstalledHashes(hashes)
    logger.info(`[python-venv] No external PyPI dependencies needed for ${appPath}`)
    return { success: true, installed: true }
  }

  return withVenvLock(async () => {
    // Check cache again inside lock
    const currentHashes = loadInstalledHashes()
    if (!opts?.force && currentHashes[hash]) {
      return { success: true, installed: false, cached: true }
    }

    // Determine target Python: app-specific venv takes precedence if present
    const appPython = getAppVenvPython(appPath)
    let targetPython = appPython

    if (!targetPython) {
      const venvRes = await ensureWorkbenchVenv()
      if (!venvRes.success || !venvRes.pythonPath) {
        return { success: false, installed: false, error: venvRes.error || mainT('pythonVenv.notReady') }
      }
      targetPython = venvRes.pythonPath
    }

    // Write a filtered requirements file excluding local SDK packages
    const tempDir = getTempDir()
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    const filteredReqPath = path.join(tempDir, `req-${crypto.randomUUID()}.txt`)
    fs.writeFileSync(filteredReqPath, externalDeps.join('\n') + '\n', 'utf-8')

    logger.info(`[python-venv] Installing requirements for ${appPath} via ${targetPython}: ${externalDeps.join(', ')}`)
    const installRes = await runProcess(
      targetPython,
      ['-m', 'pip', 'install', '--prefer-binary', ...buildPipIndexArgs(), '-r', filteredReqPath],
      { timeoutMs: 180000, cwd: appPath }
    )

    try {
      if (fs.existsSync(filteredReqPath)) fs.unlinkSync(filteredReqPath)
    } catch {
      // ignore temp file cleanup error
    }

    if (installRes.code === 0) {
      logger.info(`[python-venv] Successfully installed requirements for ${appPath}`)
      currentHashes[hash] = {
        appPath,
        installedAt: Date.now()
      }
      saveInstalledHashes(currentHashes)
      return { success: true, installed: true }
    }

    const errorMsg = installRes.stderr || installRes.stdout || mainT('pythonVenv.pipInstallFailed', installRes.code)
    logger.warn(`[python-venv] Failed to install requirements for ${appPath}:`, errorMsg)
    return { success: false, installed: false, error: errorMsg }
  })
}

/**
 * Initializes the workbench venv in the background on startup if not already created,
 * and pre-syncs requirements for all existing installed apps.
 */
export function initWorkbenchVenvInBackground(): void {
  setTimeout(async () => {
    try {
      if (process.platform === 'win32') {
        try {
          await ensureWindowsPythonPathPriority()
        } catch {
          // ignore
        }
      }

      if (!isWorkbenchVenvReady()) {
        logger.info('[python-venv] Starting background workbench venv initialization...')
        const res = await ensureWorkbenchVenv()
        if (!res.success) {
          logger.warn('[python-venv] Background workbench venv initialization failed:', res.error)
          return
        }
      }
      // Pre-sync requirements for all existing installed apps in background
      try {
        const apps = listSubApps()
        for (const app of apps) {
          if (app.path) {
            await installAppRequirements(app.path)
          }
        }
      } catch (scanErr) {
        logger.warn('[python-venv] Failed to pre-sync requirements for existing apps:', scanErr)
      }
    } catch (err) {
      logger.warn('[python-venv] Background venv init error:', err)
    }
  }, 3000)
}
