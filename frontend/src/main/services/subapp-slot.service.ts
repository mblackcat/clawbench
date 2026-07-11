import { spawn, type SpawnOptions } from 'child_process'
import { randomUUID } from 'crypto'
import fs from 'fs'
import { join } from 'path'
import { getTempDir } from '../utils/paths'
import * as logger from '../utils/logger'

export interface SlotExecutionRequest {
  appPath: string
  entryFile: string
  slot: string
  params: Record<string, unknown>
  workspace: {
    name: string
    path: string
    vcsType?: string
  }
  pythonPath: string
  sdkPath: string
  timeoutMs?: number
}

export interface SpawnedSlotProcess {
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  kill(signal?: NodeJS.Signals | number): boolean
  on(event: 'close', listener: (code: number | null) => void): this
  on(event: 'error', listener: (error: Error) => void): this
}

type SpawnSlotProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => SpawnedSlotProcess

export interface SlotResolverDependencies {
  spawnProcess?: SpawnSlotProcess
  tempDir?: string
  writeFile?: (path: string, data: string, encoding: BufferEncoding) => void
}

function buildPythonEnvironment(sdkPath: string): NodeJS.ProcessEnv {
  const existingPythonPath = process.env.PYTHONPATH || ''
  const pathSeparator = process.platform === 'win32' ? ';' : ':'
  const pythonPath = existingPythonPath
    ? `${sdkPath}${pathSeparator}${existingPythonPath}`
    : sdkPath

  let executablePath = process.env.PATH || ''
  if (process.platform === 'darwin') {
    const extraPaths = [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin'
    ]
    for (const path of extraPaths) {
      if (!executablePath.split(':').includes(path)) {
        executablePath = `${executablePath}:${path}`
      }
    }
  }

  return {
    ...process.env,
    PATH: executablePath,
    PYTHONPATH: pythonPath,
    PYTHONUNBUFFERED: '1'
  }
}

function removeTemporaryFiles(paths: string[]): void {
  for (const path of paths) {
    try {
      if (fs.existsSync(path)) fs.unlinkSync(path)
    } catch (error) {
      logger.warn(`Failed to clean slot resolver temp file ${path}:`, error)
    }
  }
}

/**
 * Runs an App in one-shot slot mode and returns the matching slot_result data.
 * This path is intentionally separate from normal task execution: it creates
 * no task record and emits no renderer task events.
 */
export function resolveSubAppSlot(
  request: SlotExecutionRequest,
  deps: SlotResolverDependencies = {}
): Promise<unknown> {
  const timeoutMs = request.timeoutMs ?? 30_000
  const tempDir = deps.tempDir ?? getTempDir()
  const spawnProcess: SpawnSlotProcess = deps.spawnProcess ?? ((command, args, options) =>
    spawn(command, args, options))
  const writeFile = deps.writeFile ?? fs.writeFileSync

  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  const requestId = randomUUID()
  const paramsFile = join(tempDir, `slot-params-${requestId}.json`)
  const workspaceFile = join(tempDir, `slot-workspace-${requestId}.json`)
  const temporaryFiles = [paramsFile, workspaceFile]

  try {
    writeFile(paramsFile, JSON.stringify(request.params, null, 2), 'utf-8')
    writeFile(
      workspaceFile,
      JSON.stringify(
        {
          path: request.workspace.path,
          name: request.workspace.name,
          vcs_type: request.workspace.vcsType || 'none'
        },
        null,
        2
      ),
      'utf-8'
    )
  } catch (error) {
    removeTemporaryFiles(temporaryFiles)
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    let stdoutBuffer = ''
    let stderrBuffer = ''
    let resultSeen = false
    let resultData: unknown
    let protocolError: Error | undefined
    let appError = ''

    const finish = (error?: Error, data?: unknown): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      removeTemporaryFiles(temporaryFiles)
      if (error) reject(error)
      else resolve(data)
    }

    const processLine = (rawLine: string): void => {
      const line = rawLine.trim()
      if (!line) return

      let message: Record<string, unknown>
      try {
        const parsed = JSON.parse(line)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
        message = parsed as Record<string, unknown>
      } catch {
        logger.debug(`[Slot ${request.slot}] ${line}`)
        return
      }

      if (message.type === 'slot_result') {
        const returnedSlot = typeof message.slot === 'string' ? message.slot : ''
        if (returnedSlot !== request.slot) {
          protocolError = new Error(`Unexpected slot result: ${returnedSlot || '<missing>'}`)
          return
        }
        if (!Object.prototype.hasOwnProperty.call(message, 'data')) {
          protocolError = new Error(`Malformed slot result: ${request.slot}`)
          return
        }
        if (resultSeen) {
          protocolError = new Error(`Duplicate slot result: ${request.slot}`)
          return
        }
        resultSeen = true
        resultData = message.data
        return
      }

      if (message.type === 'error') {
        const details = typeof message.details === 'string' ? message.details.trim() : ''
        const summary = typeof message.message === 'string' ? message.message.trim() : ''
        appError = details || summary || 'App slot resolver failed'
      }
    }

    let child: SpawnedSlotProcess
    try {
      child = spawnProcess(
        request.pythonPath,
        [
          request.entryFile,
          '--params',
          paramsFile,
          '--workspace',
          workspaceFile,
          '--slot',
          request.slot
        ],
        {
          cwd: request.appPath,
          env: buildPythonEnvironment(request.sdkPath),
          windowsHide: true
        }
      )
    } catch (error) {
      const spawnError = error instanceof Error ? error : new Error(String(error))
      finish(spawnError)
      return
    }

    child.stdout?.on('data', (data: Buffer | string) => {
      stdoutBuffer += data.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() || ''
      for (const line of lines) processLine(line)
    })

    child.stderr?.on('data', (data: Buffer | string) => {
      stderrBuffer += data.toString()
    })

    child.on('error', (error) => finish(error))

    child.on('close', (code) => {
      if (stdoutBuffer.trim()) processLine(stdoutBuffer)

      if (protocolError) {
        finish(protocolError)
        return
      }
      if (appError) {
        finish(new Error(appError))
        return
      }
      if (code !== 0) {
        finish(new Error(stderrBuffer.trim() || `Slot resolver exited with code ${code ?? 'unknown'}`))
        return
      }
      if (!resultSeen) {
        finish(new Error(`No matching slot result: ${request.slot}`))
        return
      }
      finish(undefined, resultData)
    })

    timer = setTimeout(() => {
      child.kill()
      finish(new Error(`Slot resolver timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
}
