/**
 * Cross-platform zip/unzip utilities.
 * Uses system `zip`/`unzip` on macOS/Linux; PowerShell on Windows.
 */
import { execSync } from 'child_process'

/**
 * Create a zip archive from a directory.
 * @param sourceDir  Directory to zip (its contents, not the dir itself)
 * @param destZip    Full path of the output .zip file
 */
export function zipDirectory(sourceDir: string, destZip: string): void {
  if (process.platform === 'win32') {
    // PowerShell's Compress-Archive is always available on Windows 10+
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${destZip}' -Force"`,
      { stdio: 'pipe' }
    )
  } else {
    execSync(`cd "${sourceDir}" && zip -r "${destZip}" .`, { stdio: 'pipe' })
  }
}

/**
 * Extract a zip archive into a target directory.
 * @param archivePath  Full path of the .zip file
 * @param destDir      Directory to extract into
 */
export function unzipArchive(archivePath: string, destDir: string): void {
  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`,
      { stdio: 'pipe' }
    )
  } else {
    execSync(`unzip -o "${archivePath}" -d "${destDir}"`, { stdio: 'pipe' })
  }
}
