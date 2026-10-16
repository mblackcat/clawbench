import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

let cachedWinRegistryPath: { value: string; timestamp: number } | null = null

export function invalidateWindowsRegistryPathCache(): void {
  cachedWinRegistryPath = null
}

/**
 * Check if a path entry points to the WindowsApps directory (where python.exe stub resides).
 */
export function isWindowsAppsPath(entry: string): boolean {
  if (!entry) return false
  const normalized = entry.trim().replace(/\//g, '\\')
  return (
    /\\Microsoft\\WindowsApps(\\?)$/i.test(normalized) ||
    /%LOCALAPPDATA%\\Microsoft\\WindowsApps(\\?)$/i.test(normalized) ||
    /%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps(\\?)$/i.test(normalized)
  )
}

/**
 * Check if a path entry looks like a real Python directory or Python Scripts directory.
 */
export function isPythonPathEntry(entry: string): boolean {
  if (!entry) return false
  const trimmed = entry.trim()
  if (isWindowsAppsPath(trimmed)) return false
  const lower = trimmed.toLowerCase()
  if (
    /\\Programs\\Python\\Python\d+/i.test(lower) ||
    /\\Python\d+(\\scripts)?(\\?)$/i.test(lower) ||
    /\\(mini|ana)conda3(\\scripts|\\library\\bin)?(\\?)$/i.test(lower) ||
    /\\\.pyenv\\pyenv-win\\(shims|bin|versions)/i.test(lower) ||
    /\\Python\\Launcher(\\?)$/i.test(lower)
  ) {
    return true
  }
  try {
    if (fs.existsSync(path.join(trimmed, 'python.exe')) || fs.existsSync(path.join(trimmed, 'pip.exe'))) {
      return true
    }
  } catch {
    // ignore
  }
  return false
}

/**
 * Discover well-known installed Python directories on Windows.
 */
export function discoverStandardWindowsPythonDirs(): string[] {
  if (process.platform !== 'win32') return []
  const home = os.homedir()
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const dirs: string[] = []

  // 1. Per-user python installations under %LOCALAPPDATA%\Programs\Python
  const pyProgDir = path.join(localAppData, 'Programs', 'Python')
  if (fs.existsSync(pyProgDir)) {
    try {
      const entries = fs.readdirSync(pyProgDir)
      for (const entry of entries) {
        const fullDir = path.join(pyProgDir, entry)
        if (fs.existsSync(path.join(fullDir, 'python.exe'))) {
          const scripts = path.join(fullDir, 'Scripts')
          if (fs.existsSync(scripts)) dirs.push(scripts)
          dirs.push(fullDir)
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Drive root Python installs (e.g. C:\Python312)
  for (const root of ['C:\\', 'D:\\']) {
    if (!fs.existsSync(root)) continue
    try {
      const entries = fs.readdirSync(root)
      for (const entry of entries) {
        if (/^python\d+$/i.test(entry)) {
          const fullDir = path.join(root, entry)
          if (fs.existsSync(path.join(fullDir, 'python.exe'))) {
            const scripts = path.join(fullDir, 'Scripts')
            if (fs.existsSync(scripts)) dirs.push(scripts)
            dirs.push(fullDir)
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Program Files
  const pfPy = path.join(programFiles, 'Python')
  if (fs.existsSync(pfPy)) {
    try {
      const entries = fs.readdirSync(pfPy)
      for (const entry of entries) {
        const fullDir = path.join(pfPy, entry)
        if (fs.existsSync(path.join(fullDir, 'python.exe'))) {
          const scripts = path.join(fullDir, 'Scripts')
          if (fs.existsSync(scripts)) dirs.push(scripts)
          dirs.push(fullDir)
        }
      }
    } catch {
      // ignore
    }
  }

  return dirs
}

/**
 * Reorder a list of Windows PATH entries so that valid Python installations
 * always precede Microsoft WindowsApps (which contains the 0-byte python.exe
 * alias that triggers Microsoft Store).
 */
export function reorderWindowsPathEntries(
  entries: string[],
  extraPythonDirs: string[] = []
): { reordered: string[]; changed: boolean } {
  const cleaned = entries.map((e) => e.trim()).filter(Boolean)
  const norm = (s: string): string => s.toLowerCase().replace(/[\\/]+$/, '')

  const validExtras = extraPythonDirs
    .map((e) => e.trim())
    .filter((e) => e && !isWindowsAppsPath(e))

  const pythonEntries: string[] = []
  const seenPython = new Set<string>()

  const addPython = (p: string): void => {
    const key = norm(p)
    if (!seenPython.has(key)) {
      seenPython.add(key)
      pythonEntries.push(p)
    }
  }

  for (const entry of cleaned) {
    if (isPythonPathEntry(entry)) {
      addPython(entry)
    }
  }
  for (const extra of validExtras) {
    addPython(extra)
  }

  const firstWindowsAppsIdx = cleaned.findIndex((e) => isWindowsAppsPath(e))

  if (firstWindowsAppsIdx === -1) {
    let changed = false
    const result = [...cleaned]
    for (const extra of validExtras) {
      if (!result.some((e) => norm(e) === norm(extra))) {
        result.push(extra)
        changed = true
      }
    }
    return { reordered: result, changed }
  }

  if (pythonEntries.length === 0) {
    return { reordered: cleaned, changed: false }
  }

  let needsReorder = false
  for (const py of pythonEntries) {
    const idx = cleaned.findIndex((e) => norm(e) === norm(py))
    if (idx === -1 || idx > firstWindowsAppsIdx) {
      needsReorder = true
      break
    }
  }

  if (!needsReorder) {
    return { reordered: cleaned, changed: false }
  }

  const nonPythonBefore: string[] = []
  for (let i = 0; i < firstWindowsAppsIdx; i++) {
    const item = cleaned[i]
    if (!seenPython.has(norm(item))) {
      nonPythonBefore.push(item)
    }
  }

  const remainder: string[] = []
  for (let i = firstWindowsAppsIdx; i < cleaned.length; i++) {
    const item = cleaned[i]
    if (!seenPython.has(norm(item))) {
      remainder.push(item)
    }
  }

  const reordered = [...nonPythonBefore, ...pythonEntries, ...remainder]
  return { reordered, changed: true }
}

/**
 * Reorder a semicolon-separated Windows PATH string.
 */
export function reorderWindowsPathString(
  pathStr: string,
  extraPythonDirs: string[] = []
): { newPath: string; changed: boolean } {
  if (!pathStr) {
    return { newPath: pathStr, changed: false }
  }
  const parts = pathStr.split(';').filter(Boolean)
  const { reordered, changed } = reorderWindowsPathEntries(parts, extraPythonDirs)
  return { newPath: reordered.join(';'), changed }
}

export interface EnsureWindowsPythonPathOptions {
  /**
   * Opt-in: also rewrite the persistent user PATH in the registry
   * (`HKCU\Environment\Path`) and broadcast `WM_SETTINGCHANGE`.
   *
   * Defaults to `false`: only the PATH of the current process (and therefore
   * of every child it spawns) is reordered. Rewriting the registry changes the
   * user's environment for every other program, so callers must only pass
   * `true` in response to an explicit user action (e.g. a "Repair PATH"
   * button), never on startup or as a side effect of running an app.
   */
  persistToRegistry?: boolean
}

export interface EnsureWindowsPythonPathResult {
  /** Whether any PATH (process and/or registry) was reordered. */
  changed: boolean
  /** Whether the registry user PATH was rewritten (only with `persistToRegistry`). */
  persisted: boolean
  error?: string
}

function reorderProcessPath(pythonDirs: string[]): boolean {
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH'
  const currentProcPath = (process.env[pathKey] as string) || ''
  if (!currentProcPath) return false
  const { newPath, changed } = reorderWindowsPathString(currentProcPath, pythonDirs)
  if (changed) process.env[pathKey] = newPath
  return changed
}

/**
 * Ensure real Python directories precede Microsoft WindowsApps (whose 0-byte
 * `python.exe` alias opens the Microsoft Store) on PATH. No-op off Windows.
 *
 * By default only `process.env.PATH` is reordered. Pass
 * `{ persistToRegistry: true }` to additionally rewrite the user PATH in the
 * registry — see {@link EnsureWindowsPythonPathOptions.persistToRegistry}.
 */
export async function ensureWindowsPythonPathPriority(
  extraPythonDirs: string[] = [],
  options: EnsureWindowsPythonPathOptions = {}
): Promise<EnsureWindowsPythonPathResult> {
  if (process.platform !== 'win32') {
    return { changed: false, persisted: false }
  }

  const pythonDirsToEnsure = [...extraPythonDirs]
  if (pythonDirsToEnsure.length === 0) {
    pythonDirsToEnsure.push(...discoverStandardWindowsPythonDirs())
  }

  if (!options.persistToRegistry) {
    try {
      return { changed: reorderProcessPath(pythonDirsToEnsure), persisted: false }
    } catch (err: unknown) {
      return { changed: false, persisted: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  try {
    const psReadCmd = `
$reg = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
if ($reg) {
  $val = $reg.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  if ($val) {
    [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($val))
  }
}
`.trim()

    const { stdout: readOut } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', psReadCmd],
      { timeout: 8000, windowsHide: true }
    )

    const base64Val = readOut.trim()
    const rawUserPath = base64Val ? Buffer.from(base64Val, 'base64').toString('utf-8') : ''
    if (!rawUserPath && pythonDirsToEnsure.length === 0) {
      return { changed: reorderProcessPath(pythonDirsToEnsure), persisted: false }
    }

    const { newPath, changed } = reorderWindowsPathString(rawUserPath, pythonDirsToEnsure)
    if (!changed) {
      return { changed: reorderProcessPath(pythonDirsToEnsure), persisted: false }
    }

    const newBase64 = Buffer.from(newPath, 'utf-8').toString('base64')
    const psWriteCmd = `
$ErrorActionPreference = 'Stop'
$raw = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${newBase64}'))
$regKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if ($regKey) {
  $regKey.SetValue('Path', $raw, [Microsoft.Win32.RegistryValueKind]::ExpandString)
  $regKey.Close()
}
Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Auto)]
public static extern System.IntPtr SendMessageTimeout(
    System.IntPtr hWnd,
    uint Msg,
    System.UIntPtr wParam,
    string lParam,
    uint fuFlags,
    uint uTimeout,
    out System.UIntPtr lpdwResult
);
"@
$HWND_BROADCAST = [System.IntPtr]0xffff
$WM_SETTINGCHANGE = 0x001a
$result = [System.UIntPtr]::Zero
[Win32.NativeMethods]::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [System.UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
`.trim()

    await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', psWriteCmd],
      { timeout: 15000, windowsHide: true }
    )

    invalidateWindowsRegistryPathCache()
    reorderProcessPath(pythonDirsToEnsure)

    return { changed: true, persisted: true }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    return { changed: false, persisted: false, error: errorMsg }
  }
}

/**
 * Windows only: read the combined Machine + User PATH directly from the
 * registry. Cached for 5s to avoid spawning PowerShell on every detection call.
 */
export async function getWindowsRegistryPath(): Promise<string> {
  if (process.platform !== 'win32') return ''
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
      { timeout: 8000, windowsHide: true }
    )
    const value = stdout.trim()
    cachedWinRegistryPath = { value, timestamp: Date.now() }
    return value
  } catch {
    return ''
  }
}

/**
 * Known install candidate paths for supported AI coding CLI tools
 * (claude, codex, antigravity, grok, omp).
 * Covers native installer scripts, bun global, npm global, pnpm, etc.
 */
export function getToolCandidatePaths(binary: string): string[] {
  const home = os.homedir()
  const list: string[] = []

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    list.push(
      path.join(localAppData, binary, `${binary}.exe`),
      path.join(localAppData, binary, 'bin', `${binary}.exe`),
      path.join(localAppData, 'Programs', binary, `${binary}.exe`),
      path.join(localAppData, 'Programs', `${binary}-cli`, `${binary}.exe`),
      path.join(home, `.${binary}`, 'bin', `${binary}.exe`),
      path.join(home, '.local', 'bin', `${binary}.exe`),
      path.join(home, '.bun', 'bin', `${binary}.exe`),
      path.join(home, '.bun', 'bin', `${binary}.cmd`),
      path.join(appData, 'npm', `${binary}.cmd`),
      path.join(appData, 'npm', `${binary}.exe`),
      path.join(localAppData, 'npm', `${binary}.cmd`),
      path.join(localAppData, 'pnpm', `${binary}.cmd`),
      path.join(localAppData, 'pnpm', `${binary}.exe`)
    )
    if (binary === 'agy' || binary === 'antigravity') {
      list.push(
        path.join(localAppData, 'agy', 'bin', `${binary}.exe`),
        path.join(localAppData, 'agy', 'bin', 'agy.exe'),
        path.join(localAppData, 'Programs', 'antigravity', 'bin', `${binary}.exe`),
        path.join(localAppData, 'Programs', 'antigravity', 'bin', 'agy.exe')
      )
    }
  } else {
    list.push(
      path.join(home, '.local', 'bin', binary),
      path.join(home, `.${binary}`, 'bin', binary),
      `/usr/local/bin/${binary}`,
      `/opt/homebrew/bin/${binary}`,
      path.join(home, '.bun', 'bin', binary),
      path.join(home, '.npm-global', 'bin', binary)
    )
    if (binary === 'agy' || binary === 'antigravity') {
      list.push(
        path.join(home, '.local', 'bin', 'agy'),
        path.join(home, '.local', 'bin', 'antigravity'),
        '/usr/local/bin/agy',
        '/usr/local/bin/antigravity'
      )
    }
  }

  return list.filter((item, idx) => list.indexOf(item) === idx)
}

export function getOmpCandidatePaths(): string[] {
  return getToolCandidatePaths('omp')
}
