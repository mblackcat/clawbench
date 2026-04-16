/**
 * electron-builder afterPack hook.
 *
 * node-pty ships its prebuilt binaries with `spawn-helper` at 644 (no execute
 * bit). When Electron's embedded Node.js ABI differs from the locally-compiled
 * build/Release/pty.node (built against the dev Node.js), node-pty falls back
 * to the prebuild. The prebuild's spawn-helper is not executable, so
 * posix_spawnp returns EACCES → "posix_spawnp failed.".
 *
 * This hook ensures every spawn-helper file in node-pty prebuilds is chmod 755
 * after the app is packed.
 */

import { chmodSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

export default async function afterPack(context) {
  const { appOutDir, packager } = context
  if (packager.platform.name !== 'mac') return

  const appName = packager.appInfo.productFilename
  const ptyPrebuilds = join(
    appOutDir,
    `${appName}.app`,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'prebuilds'
  )

  if (!existsSync(ptyPrebuilds)) {
    console.log('[afterPack] node-pty prebuilds dir not found, skipping:', ptyPrebuilds)
    return
  }

  for (const platform of readdirSync(ptyPrebuilds)) {
    const helper = join(ptyPrebuilds, platform, 'spawn-helper')
    if (existsSync(helper)) {
      chmodSync(helper, 0o755)
      console.log(`[afterPack] chmod 755 ${helper}`)
    }
  }
}
