import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import { join } from 'path'
import { WebContents, Notification, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { getTempDir } from '../utils/paths'
import { settingsStore } from '../store/settings.store'
import * as logger from '../utils/logger'

/** Map of taskId to running child process */
const runningTasks = new Map<string, ChildProcess>()

/** Track which tasks have already sent a final status */
const completedTasks = new Set<string>()

/** Map of taskId to app display name */
const taskAppNames = new Map<string, string>()

interface SubAppParams {
  [key: string]: unknown
}

interface WorkspaceInfo {
  id: string
  name: string
  path: string
  [key: string]: unknown
}

/** Callbacks for IM-triggered sub-app execution (no WebContents needed) */
export interface IMExecCallbacks {
  onOutput?: (message: string, level: string) => void
  onProgress?: (percent: number, message: string) => void
  onComplete?: (success: boolean, summary: string) => void
}

export interface PythonResolution {
  path: string
  version: string
  source: 'settings' | 'system'
}

function probePythonCommand(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false
    let stdout = ''
    let stderr = ''
    let timer: NodeJS.Timeout

    const finish = (version: string | null): void => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      resolve(version)
    }

    const proc = spawn(command, ['--version'], { windowsHide: true })
    timer = setTimeout(() => {
      proc.kill()
      finish(null)
    }, 5000)

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      const output = (stdout || stderr).trim()
      const versionMatch = output.match(/Python\s+([\d.]+)/)
      finish(code === 0 && versionMatch ? versionMatch[0] : null)
    })

    proc.on('error', () => finish(null))
  })
}

export async function resolvePythonCommand(): Promise<PythonResolution> {
  const configuredPythonPath = ((settingsStore.get('pythonPath') as string) || '').trim()

  if (configuredPythonPath) {
    const version = await probePythonCommand(configuredPythonPath)
    if (!version) {
      throw new Error(
        `设置中的 Python 路径不可用：${configuredPythonPath}\n请检查「设置」里的 Python 路径，或清空该设置以使用系统 Python。`
      )
    }
    return { path: configuredPythonPath, version, source: 'settings' }
  }

  for (const command of ['python3', 'python']) {
    const version = await probePythonCommand(command)
    if (version) {
      return { path: command, version, source: 'system' }
    }
  }

  throw new Error(
    '未找到可用的 Python 环境。\n请安装 Python，或在「设置」里配置正确的 Python 路径。'
  )
}

/**
 * Ensures the temp directory exists.
 */
function ensureTempDir(): string {
  const tmpDir = getTempDir()
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true })
  }
  return tmpDir
}

/**
 * Cleans up temporary files created for a task.
 */
function cleanupTempFiles(paramsFile: string, workspaceFile: string): void {
  try {
    if (fs.existsSync(paramsFile)) fs.unlinkSync(paramsFile)
    if (fs.existsSync(workspaceFile)) fs.unlinkSync(workspaceFile)
  } catch (err) {
    logger.warn('Failed to cleanup temp files:', err)
  }
}

/**
 * Returns the main BrowserWindow (first window), or null.
 */
function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}

/**
 * Sends an OS notification and a renderer notification:push event when a task completes.
 */
function sendTaskNotification(
  taskId: string,
  success: boolean,
  webContents: WebContents
): void {
  const appName = taskAppNames.get(taskId) ?? '应用'
  const title = success ? `${appName} 执行完成` : `${appName} 执行失败`
  const body = success ? '任务已成功完成' : '任务执行过程中出现错误'

  // OS notification when window is not focused
  const win = getMainWindow()
  if (win && !win.isFocused() && Notification.isSupported()) {
    new Notification({ title, body }).show()
  }

  // Always push to renderer notification center
  if (!webContents.isDestroyed()) {
    webContents.send('notification:push', {
      id: randomUUID(),
      type: success ? 'success' : 'error',
      title,
      body,
      timestamp: Date.now()
    })
  }
}

/**
 * Executes a sub-app Python script as a child process.
 *
 * @param taskId - Unique identifier for this task
 * @param appName - Display name of the sub-app
 * @param appPath - Directory path of the sub-app
 * @param entryFile - Python entry file name (e.g., "main.py")
 * @param params - Parameters to pass to the sub-app
 * @param workspace - Workspace information
 * @param pythonPath - Path to the Python interpreter
 * @param sdkPath - Path to the python-sdk for PYTHONPATH
 * @param webContents - Electron WebContents for sending IPC messages
 */
export function executeSubApp(
  taskId: string,
  appName: string,
  appPath: string,
  entryFile: string,
  params: SubAppParams,
  workspace: WorkspaceInfo,
  pythonPath: string,
  sdkPath: string,
  webContents: WebContents
): void {
  logger.info(`Starting task ${taskId}: ${entryFile} in ${appPath}`)

  taskAppNames.set(taskId, appName)

  // Write params and workspace info to temp JSON files
  const tmpDir = ensureTempDir()
  const paramsFile = join(tmpDir, `params-${taskId}.json`)
  const workspaceFile = join(tmpDir, `workspace-${taskId}.json`)

  fs.writeFileSync(paramsFile, JSON.stringify(params, null, 2), 'utf-8')
  // Convert vcsType to vcs_type for Python SDK compatibility
  const workspaceData = {
    path: workspace.path,
    name: workspace.name,
    vcs_type: workspace.vcsType || 'none'
  }
  fs.writeFileSync(workspaceFile, JSON.stringify(workspaceData, null, 2), 'utf-8')

  // Build the PYTHONPATH environment variable
  const existingPythonPath = process.env.PYTHONPATH || ''
  const pathSep = process.platform === 'win32' ? ';' : ':'
  const pythonPathEnv = existingPythonPath ? `${sdkPath}${pathSep}${existingPythonPath}` : sdkPath

  // Augment PATH for packaged macOS apps where the default PATH from launchd
  // may not include directories like /opt/homebrew/bin (Apple Silicon Homebrew).
  // Without this, subprocess calls to git/svn/p4 inside Python sub-apps may
  // fail with FileNotFoundError.
  let pathEnv = process.env.PATH || ''
  if (process.platform === 'darwin') {
    const extraPaths = [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin'
    ]
    for (const p of extraPaths) {
      if (!pathEnv.split(':').includes(p)) {
        pathEnv = `${pathEnv}:${p}`
      }
    }
  }

  // Spawn the Python process
  const proc = spawn(pythonPath, [entryFile, '--params', paramsFile, '--workspace', workspaceFile], {
    cwd: appPath,
    env: {
      ...process.env,
      PATH: pathEnv,
      PYTHONPATH: pythonPathEnv,
      PYTHONUNBUFFERED: '1'
    }
  })

  runningTasks.set(taskId, proc)
  completedTasks.delete(taskId)

  // Buffer for incomplete lines from stdout
  let stdoutBuffer = ''
  let stderrBuffer = ''

  proc.stdout?.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString()
    const lines = stdoutBuffer.split('\n')

    // Keep the last incomplete line in the buffer
    stdoutBuffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      processOutputLine(taskId, line, webContents)
    }
  })

  proc.stderr?.on('data', (data: Buffer) => {
    const errorText = data.toString()
    stderrBuffer += errorText
    logger.warn(`Task ${taskId} stderr:`, errorText)

    if (!webContents.isDestroyed()) {
      webContents.send('subapp:output', {
        taskId,
        type: 'error',
        message: errorText,
        content: errorText
      })
    }
  })

  proc.on('close', (code) => {
    logger.info(`Task ${taskId} exited with code ${code}`)

    // Process any remaining data in the stdout buffer
    if (stdoutBuffer.trim()) {
      processOutputLine(taskId, stdoutBuffer, webContents)
      stdoutBuffer = ''
    }

    // Send final status if not already sent
    if (!completedTasks.has(taskId) && !webContents.isDestroyed()) {
      const success = code === 0
      const errorSummary = stderrBuffer.trim()
      webContents.send('subapp:task-status', {
        taskId,
        status: success ? 'completed' : 'failed',
        exitCode: code,
        summary: success
          ? undefined
          : errorSummary || `Process exited with code ${code ?? 'unknown'}`
      })
      sendTaskNotification(taskId, success, webContents)
    }

    // Cleanup
    runningTasks.delete(taskId)
    completedTasks.delete(taskId)
    taskAppNames.delete(taskId)
    cleanupTempFiles(paramsFile, workspaceFile)
  })

  proc.on('error', (err) => {
    logger.error(`Task ${taskId} process error:`, err.message)

    if (!webContents.isDestroyed()) {
      const message = `Process failed to start: ${err.message}`
      webContents.send('subapp:output', {
        taskId,
        type: 'error',
        message,
        details: `Python command: ${pythonPath}`
      })
      webContents.send('subapp:task-status', {
        taskId,
        status: 'failed',
        error: err.message,
        summary: message
      })
      sendTaskNotification(taskId, false, webContents)
    }

    completedTasks.add(taskId)
    runningTasks.delete(taskId)
    taskAppNames.delete(taskId)
    cleanupTempFiles(paramsFile, workspaceFile)
  })
}

/**
 * Processes a single output line from the Python process.
 * Attempts to parse as JSON; if successful, routes based on the type field.
 */
function processOutputLine(taskId: string, line: string, webContents: WebContents): void {
  if (webContents.isDestroyed()) return

  try {
    const data = JSON.parse(line)
    const messageType = data.type as string

    switch (messageType) {
      case 'output':
        webContents.send('subapp:output', { taskId, ...data })
        break
      case 'progress':
        webContents.send('subapp:progress', { taskId, ...data })
        break
      case 'result':
        webContents.send('subapp:task-status', {
          taskId,
          status: data.success ? 'completed' : 'failed',
          ...data
        })
        completedTasks.add(taskId)
        sendTaskNotification(taskId, !!data.success, webContents)
        break
      case 'error':
        webContents.send('subapp:output', { taskId, ...data })
        break
      case 'ui_show':
      case 'ui_update':
      case 'ui_close':
        webContents.send('subapp:ui', { taskId, ...data })
        break
      default:
        // Unknown JSON type, send as generic output
        webContents.send('subapp:output', { taskId, type: 'output', content: line })
        break
    }
  } catch {
    // Not valid JSON, treat as plain text output
    webContents.send('subapp:output', {
      taskId,
      type: 'output',
      content: line
    })
  }
}

/**
 * Executes a sub-app Python script without a WebContents reference (for IM-triggered tasks).
 * Output is delivered via callbacks instead of IPC.
 */
export function executeSubAppWithCallbacks(
  taskId: string,
  appName: string,
  appPath: string,
  entryFile: string,
  params: SubAppParams,
  workspace: WorkspaceInfo,
  pythonPath: string,
  sdkPath: string,
  callbacks: IMExecCallbacks
): void {
  logger.info(`[IM] Starting task ${taskId}: ${entryFile} in ${appPath}`)

  taskAppNames.set(taskId, appName)

  const tmpDir = ensureTempDir()
  const paramsFile = join(tmpDir, `params-${taskId}.json`)
  const workspaceFile = join(tmpDir, `workspace-${taskId}.json`)

  fs.writeFileSync(paramsFile, JSON.stringify(params, null, 2), 'utf-8')
  const workspaceData = {
    path: workspace.path,
    name: workspace.name,
    vcs_type: (workspace as any).vcsType || 'none'
  }
  fs.writeFileSync(workspaceFile, JSON.stringify(workspaceData, null, 2), 'utf-8')

  const existingPythonPath = process.env.PYTHONPATH || ''
  const pathSep2 = process.platform === 'win32' ? ';' : ':'
  const pythonPathEnv = existingPythonPath ? `${sdkPath}${pathSep2}${existingPythonPath}` : sdkPath

  let pathEnv = process.env.PATH || ''
  if (process.platform === 'darwin') {
    const extraPaths = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin']
    for (const p of extraPaths) {
      if (!pathEnv.split(':').includes(p)) pathEnv = `${pathEnv}:${p}`
    }
  }

  const proc = spawn(pythonPath, [entryFile, '--params', paramsFile, '--workspace', workspaceFile], {
    cwd: appPath,
    env: { ...process.env, PATH: pathEnv, PYTHONPATH: pythonPathEnv, PYTHONUNBUFFERED: '1' }
  })

  runningTasks.set(taskId, proc)
  completedTasks.delete(taskId)

  let stdoutBuffer = ''
  let lastSummary = ''

  proc.stdout?.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString()
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const json = JSON.parse(line)
        switch (json.type) {
          case 'output':
            callbacks.onOutput?.(json.message || line, json.level || 'info')
            break
          case 'error':
            callbacks.onOutput?.(
              [json.message, json.details].filter(Boolean).join('\n'),
              'error'
            )
            break
          case 'progress':
            callbacks.onProgress?.(json.percent ?? 0, json.message || '')
            break
          case 'result':
            lastSummary = json.summary || (json.success ? '执行成功' : '执行失败')
            callbacks.onComplete?.(!!json.success, lastSummary)
            completedTasks.add(taskId)
            break
          default:
            callbacks.onOutput?.(json.message || line, 'info')
        }
      } catch {
        callbacks.onOutput?.(line, 'info')
      }
    }
  })

  proc.stderr?.on('data', (data: Buffer) => {
    callbacks.onOutput?.(data.toString(), 'error')
  })

  proc.on('close', (code) => {
    if (stdoutBuffer.trim()) {
      callbacks.onOutput?.(stdoutBuffer, 'info')
    }
    if (!completedTasks.has(taskId)) {
      const success = code === 0
      callbacks.onComplete?.(success, lastSummary || (success ? '执行完成' : '执行失败'))
    }
    runningTasks.delete(taskId)
    completedTasks.delete(taskId)
    taskAppNames.delete(taskId)
    cleanupTempFiles(paramsFile, workspaceFile)
  })

  proc.on('error', (err) => {
    callbacks.onComplete?.(false, `进程启动失败: ${err.message}`)
    completedTasks.add(taskId)
    runningTasks.delete(taskId)
    taskAppNames.delete(taskId)
    cleanupTempFiles(paramsFile, workspaceFile)
  })
}

/**
 * Cancels a running task by killing the child process.
 */
export function cancelTask(taskId: string): boolean {
  const proc = runningTasks.get(taskId)
  if (!proc) {
    logger.warn(`Cannot cancel task ${taskId}: not found or already completed`)
    return false
  }

  logger.info(`Cancelling task ${taskId}`)
  if (process.platform === 'win32') {
    // Windows: SIGTERM is not supported; use default kill (TerminateProcess)
    proc.kill()
  } else {
    proc.kill('SIGTERM')
  }

  // Force kill after 5 seconds if still running
  setTimeout(() => {
    if (runningTasks.has(taskId)) {
      logger.warn(`Force killing task ${taskId}`)
      proc.kill('SIGKILL')
    }
  }, 5000)

  return true
}

/**
 * Checks whether a task is currently running.
 */
export function isRunning(taskId: string): boolean {
  return runningTasks.has(taskId)
}
