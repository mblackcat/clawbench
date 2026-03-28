#!/usr/bin/env node
/**
 * upload-release.mjs
 *
 * 读取 .env 中的 VITE_API_BASE_URL 和上传凭证，
 * 将 dist/ 目录下的制品逐个上传到 backend releases 接口。
 *
 * 用法（由 npm scripts 调用）：
 *   node scripts/upload-release.mjs mac   → 只上传 macOS 制品
 *   node scripts/upload-release.mjs win   → 只上传 Windows 制品
 *   node scripts/upload-release.mjs all   → 上传所有制品
 *
 * 凭证优先级：
 *   1. UPLOAD_TOKEN  —— 直接使用已有 JWT
 *   2. 本地 Electron 应用已登录会话（api-credentials.json）
 *   3. UPLOAD_USERNAME + UPLOAD_PASSWORD  —— 登录后获取 JWT
 */

import { readFile, readdir } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { homedir, platform } from 'os'

// Load .env
const require = createRequire(import.meta.url)
const dotenv = require('dotenv')
dotenv.config({ path: resolve(process.cwd(), '.env') })

const API_BASE = (process.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1').replace(/\/$/, '')
const UPLOAD_URL = `${API_BASE}/releases/upload`

const PLATFORM = process.argv[2] || 'all'

// ---------------------------------------------------------------------------
// File filter by platform
// ---------------------------------------------------------------------------

const MAC_EXTS = /\.(dmg|zip|blockmap|yml)$/i
const WIN_EXTS = /\.(exe|blockmap|yml)$/i
const ALL_EXTS = /\.(dmg|zip|exe|blockmap|yml)$/i

const MAC_EXCLUDE = /^(win|Setup)/i
const WIN_EXCLUDE = /mac/i

function shouldUpload(filename) {
  if (PLATFORM === 'mac') return MAC_EXTS.test(filename) && !MAC_EXCLUDE.test(filename)
  if (PLATFORM === 'win') return WIN_EXTS.test(filename) && !WIN_EXCLUDE.test(filename)
  return ALL_EXTS.test(filename)
}

// ---------------------------------------------------------------------------
// Read token from local Electron app session (electron-store)
// ---------------------------------------------------------------------------

function getElectronStoreCredentialsPath() {
  const appName = 'clawbench'
  if (platform() === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), appName, 'api-credentials.json')
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appName, 'api-credentials.json')
  }
  // Linux
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), appName, 'api-credentials.json')
}

async function getTokenFromElectronStore() {
  try {
    const credPath = getElectronStoreCredentialsPath()
    const raw = await readFile(credPath, 'utf-8')
    const data = JSON.parse(raw)
    if (data.apiToken && typeof data.apiToken === 'string' && data.apiToken.length > 0) {
      return data.apiToken
    }
  } catch {
    // File doesn't exist or isn't readable — that's fine
  }
  return null
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function getToken() {
  // 1. Explicit env override
  if (process.env.UPLOAD_TOKEN) {
    return process.env.UPLOAD_TOKEN
  }

  // 2. Read from locally logged-in Electron app session
  const localToken = await getTokenFromElectronStore()
  if (localToken) {
    log('Using token from local Electron app session')
    return localToken
  }

  // 3. Username + password login
  const username = process.env.UPLOAD_USERNAME
  const password = process.env.UPLOAD_PASSWORD

  if (!username || !password) {
    throw new Error(
      'No credentials found.\n' +
      '  • Log in via the ClawBench desktop app, OR\n' +
      '  • Set UPLOAD_TOKEN (JWT) in your .env file, OR\n' +
      '  • Set UPLOAD_USERNAME + UPLOAD_PASSWORD in your .env file.'
    )
  }

  log('Logging in...')
  const res = await fetch(`${API_BASE}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })

  const json = await res.json()
  if (!json.success || !json.data?.token) {
    throw new Error(`Login failed: ${json.error?.message || JSON.stringify(json)}`)
  }

  log('Login successful')
  return json.data.token
}

// ---------------------------------------------------------------------------
// Upload (one file per request for reliability)
// ---------------------------------------------------------------------------

async function uploadFile(token, filename, buffer) {
  const form = new FormData()
  form.append('files', new Blob([buffer]), filename)

  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  })

  const json = await res.json()
  if (!json.success) {
    throw new Error(`Upload failed for "${filename}": ${JSON.stringify(json.error)}`)
  }

  return json.data.files[0]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(...args) {
  console.log('[upload-release]', ...args)
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const distDir = resolve(process.cwd(), 'dist')

  log(`Platform filter : ${PLATFORM}`)
  log(`API base        : ${API_BASE}`)
  log(`Upload endpoint : ${UPLOAD_URL}`)

  // Collect artifacts
  let allFiles
  try {
    allFiles = await readdir(distDir)
  } catch {
    throw new Error(`dist/ directory not found. Run the build step first.`)
  }

  const artifacts = allFiles.filter(shouldUpload)

  if (artifacts.length === 0) {
    throw new Error(`No artifacts found in dist/ for platform "${PLATFORM}". Run the build step first.`)
  }

  log(`Found ${artifacts.length} file(s) to upload:`)
  artifacts.forEach(f => log(`  • ${f}`))

  // Authenticate
  const token = await getToken()

  // Upload each file
  log('Uploading...')
  for (const filename of artifacts) {
    const buffer = await readFile(join(distDir, filename))
    const result = await uploadFile(token, filename, buffer)
    log(`  ✓ ${result.filename} (${formatSize(result.size)})`)
  }

  log(`Done. ${artifacts.length} file(s) uploaded.`)
}

main().catch(err => {
  console.error('\n[upload-release] Error:', err.message)
  process.exit(1)
})
