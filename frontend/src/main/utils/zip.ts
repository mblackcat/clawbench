/**
 * Cross-platform zip/unzip utilities.
 * Uses system `zip`/`unzip` on macOS/Linux; PowerShell on Windows.
 *
 * All invocations go through `execFileSync` (argv form) rather than a shell
 * string, so paths containing spaces, quotes, `;`, `&`, `$()` etc. cannot be
 * interpreted as commands. On Windows the paths are still interpolated into a
 * PowerShell script, so single quotes are doubled to make them PS string
 * literals (the only character that can break out of a single-quoted PS string).
 */
import { execFileSync } from 'child_process'

/** Escape a string for embedding inside a single-quoted PowerShell literal. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Create a zip archive from a directory.
 * @param sourceDir  Directory to zip (its contents, not the dir itself)
 * @param destZip    Full path of the output .zip file
 */
export function zipDirectory(sourceDir: string, destZip: string): void {
  if (process.platform === 'win32') {
    // PowerShell's Compress-Archive is always available on Windows 10+
    const script = `Compress-Archive -Path ${psQuote(`${sourceDir}\\*`)} -DestinationPath ${psQuote(destZip)} -Force`
    execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'pipe' })
  } else {
    execFileSync('zip', ['-r', destZip, '.'], { cwd: sourceDir, stdio: 'pipe' })
  }
}

/**
 * Extract a zip archive into a target directory.
 * @param archivePath  Full path of the .zip file
 * @param destDir      Directory to extract into
 */
export function unzipArchive(archivePath: string, destDir: string): void {
  if (process.platform === 'win32') {
    const script = `Expand-Archive -Path ${psQuote(archivePath)} -DestinationPath ${psQuote(destDir)} -Force`
    execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'pipe' })
  } else {
    execFileSync('unzip', ['-o', archivePath, '-d', destDir], { stdio: 'pipe' })
  }
}
