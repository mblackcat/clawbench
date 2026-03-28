/**
 * Marketplace Service — fetches and installs apps from the backend marketplace.
 * Runs in the main process; no WebContents dependency.
 */

import fs from 'fs'
import { join } from 'path'
import { getTempDir } from '../../utils/paths'
import { unzipArchive } from '../../utils/zip'
import { listSubApps, installApp } from '../subapp.service'
import * as logger from '../../utils/logger'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'

export interface MarketApp {
  applicationId: string
  name: string
  description: string
  category?: string
  ownerName?: string
  version?: string
  downloadCount?: number
  hasLocalUpdate?: boolean
}

/**
 * Fetches the most recent published apps from the marketplace.
 * Annotates each with whether it's already installed or has an update.
 */
export async function listRecentMarketApps(limit = 10): Promise<MarketApp[]> {
  const resp = await fetch(`${API_BASE_URL}/applications?limit=${limit}`)
  if (!resp.ok) throw new Error(`Marketplace API error: ${resp.status}`)
  const json = await resp.json() as { success: boolean; data?: { applications: any[]; total: number } }
  if (!json.success) throw new Error('Failed to list marketplace apps')

  const localApps = listSubApps()
  const localMap = new Map(localApps.map((a) => [a.manifest.id, a.manifest.version]))

  return (json.data?.applications ?? []).map((app) => {
    const localVersion = localMap.get(app.applicationId)
    const hasLocalUpdate = !!localVersion && localVersion !== app.version
    return {
      applicationId: app.applicationId,
      name: app.name,
      description: app.description,
      category: app.category,
      ownerName: app.ownerName,
      version: app.version,
      downloadCount: app.downloadCount,
      // Show only if not installed OR has update
      hasLocalUpdate,
      _isInstalled: !!localVersion && !hasLocalUpdate
    } as any
  }).filter((a: any) => !a._isInstalled)
}

/**
 * Searches published apps by keyword.
 */
export async function searchMarketApps(keywords: string, limit = 10): Promise<MarketApp[]> {
  const query = encodeURIComponent(keywords)
  const resp = await fetch(`${API_BASE_URL}/applications?name=${query}&limit=${limit}`)
  if (!resp.ok) throw new Error(`Marketplace API error: ${resp.status}`)
  const json = await resp.json() as { success: boolean; data?: { applications: any[] } }
  if (!json.success) throw new Error('Failed to search marketplace apps')

  const localApps = listSubApps()
  const localMap = new Map(localApps.map((a) => [a.manifest.id, a.manifest.version]))

  return (json.data?.applications ?? []).map((app) => {
    const localVersion = localMap.get(app.applicationId)
    return {
      applicationId: app.applicationId,
      name: app.name,
      description: app.description,
      category: app.category,
      ownerName: app.ownerName,
      version: app.version,
      downloadCount: app.downloadCount,
      hasLocalUpdate: !!localVersion && localVersion !== app.version
    }
  })
}

/**
 * Downloads and installs an app from the marketplace.
 */
export async function installMarketApp(appId: string): Promise<{ success: boolean; name?: string; error?: string }> {
  try {
    // Download zip
    const resp = await fetch(`${API_BASE_URL}/applications/${encodeURIComponent(appId)}/download`)
    if (!resp.ok) throw new Error(`下载失败: ${resp.status}`)

    const buffer = await resp.arrayBuffer()
    const tmpDir = getTempDir()
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

    const zipPath = join(tmpDir, `market-${appId.replace(/[^a-zA-Z0-9._-]/g, '_')}.zip`)
    fs.writeFileSync(zipPath, Buffer.from(buffer))

    // Extract zip
    const extractDir = join(tmpDir, `market-extract-${Date.now()}`)
    fs.mkdirSync(extractDir, { recursive: true })

    // Extract zip using cross-platform utility
    unzipArchive(zipPath, extractDir)

    // Find the app directory (may be nested one level)
    let appSourceDir = extractDir
    const entries = fs.readdirSync(extractDir, { withFileTypes: true })
    const subDirs = entries.filter((e) => e.isDirectory())
    if (subDirs.length === 1 && !fs.existsSync(join(extractDir, 'manifest.json'))) {
      appSourceDir = join(extractDir, subDirs[0].name)
    }

    const result = installApp(appSourceDir)

    // Cleanup
    try {
      fs.rmSync(zipPath, { force: true })
      fs.rmSync(extractDir, { recursive: true, force: true })
    } catch { /* ignore cleanup errors */ }

    if (!result.success) {
      return { success: false, error: result.error }
    }

    logger.info(`[Marketplace] Installed app: ${result.manifest?.name} (${appId})`)
    return { success: true, name: result.manifest?.name }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`[Marketplace] Install failed for ${appId}:`, msg)
    return { success: false, error: msg }
  }
}
