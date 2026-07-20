/**
 * CoPiper Feishu sync watcher: revision polling + optional backend SSE events.
 */

import { BrowserWindow } from 'electron'
import * as logger from '../utils/logger'
import { isFeishuUser } from '../store/auth.store'
import { getJwtToken } from '../store/auth.store'
import * as syncService from './copiper-feishu-sync.service'
import * as jdbService from './jdb.service'
import { getFeishuLink, listTables } from './jdb-meta'
import * as sheets from './feishu-sheets.client'

const API_BASE_URL =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL) ||
  process.env.VITE_API_BASE_URL ||
  'http://localhost:3001/api/v1'

interface WatchedFile {
  filePath: string
  timer: ReturnType<typeof setInterval> | null
  lastRevision?: number
  syncing: boolean
}

const watched = new Map<string, WatchedFile>()
let eventAbort: AbortController | null = null
let eventReconnectTimer: ReturnType<typeof setTimeout> | null = null
let mainWindowGetter: (() => BrowserWindow | null) | null = null

export function setMainWindowGetter(fn: () => BrowserWindow | null): void {
  mainWindowGetter = fn
}

function broadcast(channel: string, payload: unknown): void {
  const win = mainWindowGetter?.()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

syncService.onFeishuStatus((status) => {
  broadcast('copiper:feishu-status', status)
})

async function pollFile(filePath: string): Promise<void> {
  if (!isFeishuUser()) return
  const entry = watched.get(filePath)
  if (!entry || entry.syncing) return

  try {
    const link = syncService.getLink(filePath)
    if (!link || !link.enabled || !link.spreadsheetToken) {
      stopWatching(filePath)
      return
    }

    // Cheap revision check: read a small range of first mapped sheet
    const map = link.sheetMaps[0]
    if (!map?.sheetId) return

    const range = sheets.buildA1Range(map.sheetId, 0, 1, 0, 1)
    const remote = await sheets.readRange(link.spreadsheetToken, range)
    const rev = remote.revision
    if (typeof rev === 'number' && rev !== entry.lastRevision && rev !== link.lastRemoteRevision) {
      entry.lastRevision = rev
      entry.syncing = true
      try {
        const result = await syncService.syncFile(filePath, 'poll')
        broadcast('copiper:feishu-sync-result', result)
        if (result.conflicts.length > 0) {
          broadcast('copiper:feishu-conflict', {
            filePath,
            conflicts: result.conflicts
          })
        }
      } finally {
        entry.syncing = false
      }
    } else if (typeof rev === 'number') {
      entry.lastRevision = rev
    }
  } catch (err) {
    logger.warn('Feishu poll failed for', filePath, err)
    broadcast('copiper:feishu-status', {
      filePath,
      linked: true,
      light: 'error',
      message: err instanceof Error ? err.message : String(err),
      lastError: err instanceof Error ? err.message : String(err)
    })
  }
}

export function startWatching(filePath: string): void {
  if (!isFeishuUser()) return
  const link = syncService.getLink(filePath)
  if (!link || !link.enabled) return

  const existing = watched.get(filePath)
  if (existing?.timer) {
    clearInterval(existing.timer)
  }

  const intervalSec = Math.max(10, link.pollIntervalSec || 15)
  const entry: WatchedFile = {
    filePath,
    timer: null,
    lastRevision: link.lastRemoteRevision,
    syncing: false
  }
  entry.timer = setInterval(() => {
    void pollFile(filePath)
  }, intervalSec * 1000)
  watched.set(filePath, entry)

  // Immediate poll
  void pollFile(filePath)
}

export function stopWatching(filePath: string): void {
  const entry = watched.get(filePath)
  if (entry?.timer) clearInterval(entry.timer)
  watched.delete(filePath)
}

export function stopAll(): void {
  for (const fp of [...watched.keys()]) stopWatching(fp)
  stopEventStream()
}

/** Debounced push after local save */
const saveDebounce = new Map<string, ReturnType<typeof setTimeout>>()

export function notifyLocalSaved(filePath: string): void {
  if (!isFeishuUser()) return
  const link = syncService.getLink(filePath)
  if (!link || !link.enabled) return
  if (link.syncMode === 'pull') return

  const prev = saveDebounce.get(filePath)
  if (prev) clearTimeout(prev)
  saveDebounce.set(
    filePath,
    setTimeout(() => {
      saveDebounce.delete(filePath)
      const entry = watched.get(filePath)
      if (entry?.syncing) return
      if (entry) entry.syncing = true
      void syncService
        .syncFile(filePath, 'save')
        .then((result) => {
          broadcast('copiper:feishu-sync-result', result)
          if (result.conflicts.length > 0) {
            broadcast('copiper:feishu-conflict', {
              filePath,
              conflicts: result.conflicts
            })
          }
        })
        .finally(() => {
          if (entry) entry.syncing = false
        })
    }, 1000)
  )
}

/** Scan open workspace data dir for linked files and start watchers */
export function refreshWorkspaceWatchers(workspacePath: string): void {
  if (!isFeishuUser()) {
    stopAll()
    return
  }
  try {
    const dataDir = `${workspacePath}/data`.replace(/\\/g, '/')
    // Use path join properly
    const path = require('path') as typeof import('path')
    const fs = require('fs') as typeof import('fs')
    const root = path.join(workspacePath, 'data')
    if (!fs.existsSync(root)) return

    const found = new Set<string>()
    const walk = (dir: string) => {
      let entries: import('fs').Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue
          walk(full)
        } else if (e.isFile() && e.name.endsWith('.jdb')) {
          try {
            const db = jdbService.loadDatabase(full)
            const link = getFeishuLink(db)
            if (link?.enabled && link.spreadsheetToken) {
              found.add(full)
              startWatching(full)
            }
          } catch {
            /* skip */
          }
        }
      }
    }
    walk(root)

    // Stop watchers for files no longer linked
    for (const fp of [...watched.keys()]) {
      if (!found.has(fp)) stopWatching(fp)
    }

    ensureEventStream()
  } catch (err) {
    logger.warn('refreshWorkspaceWatchers failed', err)
  }
}

function stopEventStream(): void {
  if (eventReconnectTimer) {
    clearTimeout(eventReconnectTimer)
    eventReconnectTimer = null
  }
  if (eventAbort) {
    eventAbort.abort()
    eventAbort = null
  }
}

/**
 * Connect to backend SSE for drive.file.edit events (enhancement).
 * Silently no-ops if endpoint missing or not Feishu user.
 */
export function ensureEventStream(): void {
  if (!isFeishuUser()) {
    stopEventStream()
    return
  }
  if (eventAbort) return // already connected / connecting

  const jwt = getJwtToken()
  if (!jwt) return

  const controller = new AbortController()
  eventAbort = controller

  const url = `${API_BASE_URL}/feishu/events/stream`
  void (async () => {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'text/event-stream'
        },
        signal: controller.signal
      })
      if (!res.ok || !res.body) {
        throw new Error(`SSE ${res.status}`)
      }
      logger.info('Feishu event stream connected')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''
        for (const part of parts) {
          const lines = part.split('\n')
          let dataLine = ''
          for (const line of lines) {
            if (line.startsWith('data:')) dataLine += line.slice(5).trim()
          }
          if (!dataLine) continue
          try {
            const evt = JSON.parse(dataLine) as {
              type?: string
              token?: string
              ts?: number
            }
            if (evt.type === 'spreadsheet_edited' && evt.token) {
              handleRemoteEditEvent(evt.token)
            }
          } catch {
            /* ignore bad event */
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      logger.warn('Feishu event stream ended / failed — poll remains primary', err)
    } finally {
      if (eventAbort === controller) eventAbort = null
      // Reconnect after delay
      eventReconnectTimer = setTimeout(() => {
        eventReconnectTimer = null
        ensureEventStream()
      }, 15000)
    }
  })()
}

function handleRemoteEditEvent(spreadsheetToken: string): void {
  for (const [filePath, entry] of watched) {
    const link = syncService.getLink(filePath)
    if (!link || link.spreadsheetToken !== spreadsheetToken) continue
    if (entry.syncing) continue
    entry.syncing = true
    void syncService
      .syncFile(filePath, 'event')
      .then((result) => {
        broadcast('copiper:feishu-sync-result', result)
        if (result.conflicts.length > 0) {
          broadcast('copiper:feishu-conflict', {
            filePath,
            conflicts: result.conflicts
          })
        }
      })
      .finally(() => {
        entry.syncing = false
      })
  }
}

/** Map spreadsheet token → open linked files (for tests / debug) */
export function listWatchedFiles(): string[] {
  return [...watched.keys()]
}

// silence unused import if tree-shaken
void listTables
