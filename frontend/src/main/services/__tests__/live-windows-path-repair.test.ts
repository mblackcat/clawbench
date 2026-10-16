import { describe, expect, it } from 'vitest'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  ensureWindowsPythonPathPriority,
  getWindowsRegistryPath,
  invalidateWindowsRegistryPathCache,
  isWindowsAppsPath
} from '../../utils/windows-env'
import { findHostBasePython } from '../python-venv.service'
import { scanAvailablePythons } from '../python-detect.service'

const execFileAsync = promisify(execFile)

/**
 * Live tests against the real machine (Windows only). The registry test
 * rewrites — and then restores — the user's HKCU PATH, so the whole suite is
 * opt-in: set CB_LIVE_WINDOWS_TESTS=1 to run it.
 */
const runLive = process.platform === 'win32' && process.env.CB_LIVE_WINDOWS_TESTS === '1'

describe.skipIf(!runLive)('live Windows real-environment test', () => {
  it('real scanAvailablePythons excludes WindowsApps on actual machine', async () => {
    if (process.platform !== 'win32') return
    const pythons = await scanAvailablePythons({}, true)
    expect(pythons.length).toBeGreaterThan(0)
    for (const p of pythons) {
      expect(isWindowsAppsPath(p.path)).toBe(false)
    }
  })

  it('real findHostBasePython finds a valid executable without bareword fallback', async () => {
    if (process.platform !== 'win32') return
    const basePython = await findHostBasePython()
    expect(basePython).toBeTruthy()
    expect(isWindowsAppsPath(basePython!)).toBe(false)

    // Execute it to prove it's a real Python and does not trigger store
    const { stdout } = await execFileAsync(basePython!, ['--version'])
    expect(stdout).toMatch(/Python\s+3\./)
  })

  it('reorders real registry User PATH when WindowsApps is placed ahead of Python, then restores', async () => {
    if (process.platform !== 'win32') return

    // 1. Backup original User PATH
    const psReadCmd = `
$reg = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
if ($reg) {
  $val = $reg.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  if ($val) {
    [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($val))
  }
}
`.trim()

    const { stdout: backupOut } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', psReadCmd],
      { timeout: 8000 }
    )
    const originalBase64 = backupOut.trim()
    const originalUserPath = originalBase64 ? Buffer.from(originalBase64, 'base64').toString('utf-8') : ''
    expect(originalUserPath).toBeTruthy()

    try {
      // 2. Intentionally inject corrupted order: WindowsApps at the very front, Python at the very end
      const corruptedPath = [
        '%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps',
        'C:\\Windows\\system32',
        'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python313\\Scripts',
        'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python313'
      ].join(';')

      const corruptBase64 = Buffer.from(corruptedPath, 'utf-8').toString('base64')
      const psCorruptCmd = `
$ErrorActionPreference = 'Stop'
$raw = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${corruptBase64}'))
$regKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$regKey.SetValue('Path', $raw, [Microsoft.Win32.RegistryValueKind]::ExpandString)
$regKey.Close()
`.trim()
      await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCorruptCmd])
      invalidateWindowsRegistryPathCache()

      // Verify the registry is indeed corrupted (WindowsApps is first)
      const { stdout: verifyCorruptOut } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', psReadCmd]
      )
      const currentCorrupt = Buffer.from(verifyCorruptOut.trim(), 'base64').toString('utf-8')
      const corruptParts = currentCorrupt.split(';')
      expect(isWindowsAppsPath(corruptParts[0])).toBe(true)

      // 3. Execute our repair function live
      const repairResult = await ensureWindowsPythonPathPriority([], { persistToRegistry: true })
      expect(repairResult.changed).toBe(true)
      expect(repairResult.persisted).toBe(true)

      // 4. Read back registry from Windows to prove it was repaired
      const { stdout: repairedOut } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', psReadCmd]
      )
      const repairedPath = Buffer.from(repairedOut.trim(), 'base64').toString('utf-8')
      const repairedParts = repairedPath.split(';')

      const winAppsIdx = repairedParts.findIndex((p) => isWindowsAppsPath(p))
      const pyScriptsIdx = repairedParts.findIndex((p) => p.includes('Scripts'))
      const pyDirIdx = repairedParts.findIndex((p) => p.endsWith('Python313'))

      expect(winAppsIdx).toBeGreaterThan(-1)
      expect(pyScriptsIdx).toBeLessThan(winAppsIdx)
      expect(pyDirIdx).toBeLessThan(winAppsIdx)

      // 5. Verify registry value kind remains REG_EXPAND_SZ
      const psKindCmd = `
$reg = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
$reg.GetValueKind('Path').ToString()
`.trim()
      const { stdout: kindOut } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', psKindCmd]
      )
      expect(kindOut.trim()).toBe('ExpandString')
    } finally {
      // 6. Restore original User PATH cleanly
      const psRestoreCmd = `
$raw = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${originalBase64}'))
$regKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$regKey.SetValue('Path', $raw, [Microsoft.Win32.RegistryValueKind]::ExpandString)
$regKey.Close()
`.trim()
      await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psRestoreCmd])
      invalidateWindowsRegistryPathCache()

      // Verify restored
      const { stdout: finalOut } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', psReadCmd]
      )
      const finalUserPath = Buffer.from(finalOut.trim(), 'base64').toString('utf-8')
      expect(finalUserPath).toBe(originalUserPath)
    }
  }, 30000)
})
