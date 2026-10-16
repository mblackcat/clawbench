import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync, spawn } from 'child_process'
import { getWorkbenchVenvPythonPath } from '../utils/paths'
import { mainT } from '../utils/i18n'

export interface PythonDetectOptions {
  platform?: string
  home?: string
  env?: NodeJS.ProcessEnv
  fsExists?: (p: string) => boolean
  execCmd?: (cmd: string) => string
  probeCmd?: (p: string) => Promise<string | null>
}

export interface DetectedPythonOption {
  id: string
  name: string
  path: string
  version?: string
  isDefault?: boolean
  description?: string
}

/**
 * Probe a Python executable by running `<path> --version`.
 */
export function probePythonVersion(pythonPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(pythonPath, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 4000,
        windowsHide: true
      })

      let output = ''
      proc.stdout?.on('data', (d) => {
        output += d.toString()
      })
      proc.stderr?.on('data', (d) => {
        output += d.toString()
      })

      let settled = false
      const finish = (ver: string | null): void => {
        if (settled) return
        settled = true
        resolve(ver)
      }

      proc.on('close', (code) => {
        const match = output.match(/Python\s+([\d.]+)/i)
        finish(code === 0 && match ? match[1] : null)
      })

      proc.on('error', () => finish(null))
    } catch {
      resolve(null)
    }
  })
}

let cachedPythons: DetectedPythonOption[] | null = null

/** Drop the cached scan so the next {@link scanAvailablePythons} call re-probes. */
export function invalidatePythonScanCache(): void {
  cachedPythons = null
}

/**
 * Scan all available Python environments on the host machine.
 * The first result is marked `isDefault`. Results are cached unless
 * `forceRefresh` is set or test hooks are injected via `options`.
 */
export async function scanAvailablePythons(
  options: PythonDetectOptions = {},
  forceRefresh = false
): Promise<DetectedPythonOption[]> {
  const isTest = Boolean(options.fsExists || options.execCmd || options.probeCmd || options.platform)
  if (!isTest && !forceRefresh && cachedPythons !== null && cachedPythons.length > 0) {
    return cachedPythons
  }

  const platform = options.platform ?? process.platform
  // Build candidate paths with the *target* platform's separator rules so the
  // injectable options work (and tests pass) regardless of the host OS.
  const pathMod = platform === 'win32' ? path.win32 : path.posix
  const home = options.home ?? os.homedir()
  const env = options.env ?? process.env
  const exists = options.fsExists ?? ((p: string) => fs.existsSync(p))
  const probe = options.probeCmd ?? probePythonVersion
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

  const candidates: string[] = []

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || ''
    const programFiles = env.ProgramFiles || 'C:\\Program Files'
    const userProfile = env.USERPROFILE || home

    // 1. PATH lookup
    const whereOut = runCmd('where python python3 py').trim().split(/\r?\n/)
    for (const p of whereOut) {
      const trimmed = p.trim()
      if (trimmed) candidates.push(trimmed)
    }

    // 2. Python.org standard installation paths
    const pyProgDir = localAppData ? pathMod.join(localAppData, 'Programs', 'Python') : ''
    if (pyProgDir && exists(pyProgDir)) {
      try {
        const entries = fs.readdirSync(pyProgDir)
        for (const entry of entries) {
          const exe = pathMod.join(pyProgDir, entry, 'python.exe')
          candidates.push(exe)
        }
      } catch {
        // ignore
      }
    }

    // Root drive standard directories (e.g. C:\Python312\python.exe)
    const rootDirs = ['C:\\', 'D:\\']
    for (const root of rootDirs) {
      if (!exists(root)) continue
      try {
        const entries = fs.readdirSync(root)
        for (const entry of entries) {
          if (/^python\d+$/i.test(entry)) {
            candidates.push(pathMod.join(root, entry, 'python.exe'))
          }
        }
      } catch {
        // ignore
      }
    }

    // Program Files
    const pfPy = pathMod.join(programFiles, 'Python')
    if (exists(pfPy)) {
      try {
        const entries = fs.readdirSync(pfPy)
        for (const entry of entries) {
          candidates.push(pathMod.join(pfPy, entry, 'python.exe'))
        }
      } catch {
        // ignore
      }
    }

    // Conda / Miniconda
    const condaCandidates = [
      pathMod.join(userProfile, 'miniconda3', 'python.exe'),
      pathMod.join(userProfile, 'anaconda3', 'python.exe'),
      'C:\\ProgramData\\miniconda3\\python.exe',
      'C:\\ProgramData\\anaconda3\\python.exe',
      localAppData ? pathMod.join(localAppData, 'miniconda3', 'python.exe') : '',
      localAppData ? pathMod.join(localAppData, 'anaconda3', 'python.exe') : ''
    ].filter(Boolean)
    candidates.push(...condaCandidates)

    // Pyenv-win
    const pyenvWinVersions = pathMod.join(userProfile, '.pyenv', 'pyenv-win', 'versions')
    if (exists(pyenvWinVersions)) {
      try {
        const versions = fs.readdirSync(pyenvWinVersions)
        for (const ver of versions) {
          candidates.push(pathMod.join(pyenvWinVersions, ver, 'python.exe'))
        }
      } catch {
        // ignore
      }
    }
  } else if (platform === 'darwin') {
    // macOS
    candidates.push(
      '/usr/bin/python3',
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      pathMod.join(home, '.pyenv', 'shims', 'python3'),
      pathMod.join(home, '.pyenv', 'shims', 'python'),
      pathMod.join(home, 'miniconda3', 'bin', 'python3'),
      pathMod.join(home, 'anaconda3', 'bin', 'python3'),
      '/opt/miniconda3/bin/python3',
      '/opt/anaconda3/bin/python3'
    )
    const whichOut = runCmd('which -a python3 python').trim().split(/\r?\n/)
    candidates.push(...whichOut.filter(Boolean))
  } else {
    // Linux
    candidates.push(
      '/usr/bin/python3',
      '/usr/local/bin/python3',
      pathMod.join(home, '.pyenv', 'shims', 'python3'),
      pathMod.join(home, 'miniconda3', 'bin', 'python3'),
      pathMod.join(home, 'anaconda3', 'bin', 'python3')
    )
    const whichOut = runCmd('which -a python3 python').trim().split(/\r?\n/)
    candidates.push(...whichOut.filter(Boolean))
  }

  // The dedicated workbench venv (if created) is always the preferred option.
  let venvPy = ''
  try {
    venvPy = getWorkbenchVenvPythonPath()
    if (venvPy && exists(venvPy)) {
      candidates.unshift(venvPy)
    }
  } catch {
    venvPy = ''
  }
  const results: DetectedPythonOption[] = []
  const seenPaths = new Set<string>()

  for (const p of candidates) {
    if (!p) continue
    // Filter WindowsApps alias stubs
    if (/[\\/]Microsoft[\\/]WindowsApps[\\/]python(3(\.\d+)?)?\.exe$/i.test(p)) continue
    const normalized = p.toLowerCase().trim()
    if (seenPaths.has(normalized)) continue
    if (!exists(p)) continue
    seenPaths.add(normalized)

    const version = await probe(p)
    if (!version) continue

    let description = ''
    if (venvPy && normalized === venvPy.toLowerCase().trim()) {
      description = mainT('python.workbenchVenv')
    } else if (p.toLowerCase().includes('conda')) {
      description = 'Conda'
    } else if (p.toLowerCase().includes('.pyenv')) {
      description = 'pyenv'
    } else if (p.toLowerCase().endsWith('py.exe')) {
      description = 'Python Launcher'
    }
    const name = description ? `Python ${version} (${description})` : `Python ${version}`

    results.push({
      id: `py-${results.length + 1}`,
      name,
      path: p,
      version,
      description,
      isDefault: results.length === 0
    })
  }
  if (!isTest) {
    cachedPythons = results
  }

  return results
}
