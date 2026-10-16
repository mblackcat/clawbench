import { ipcMain, shell } from 'electron'
import { openExternalTerminal } from '../services/terminal-detect.service'
import {
  getSessions,
  createSession,
  createRuntimeSession,
  updateSession,
  deleteSession,
  stopSession,
  launchSession,
  resetActiveSessionsOnStart,
  getWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getSessionsForWorkspace,
  writeToSession,
  readImageBase64,
  getSessionOutput,
  getRawSessionOutputSnapshot,
  getRawSessionOutput,
  interruptSession,
  executeSessionSlashCommand,
  setSessionPermissionMode,
  resolveSessionPermission,
  answerSessionQuestion,
  setSessionEffort,
  getGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  getIMConfig,
  saveIMConfig,
  detectAvailableCLIs,
  onPtyInput
} from '../services/ai-coding.service'
import { listNativeSessions, loadNativeSessionTranscript } from '../services/native-sessions.service'
import { writeToPty, resizePty, killPtySession } from '../services/pty-manager.service'
import { loadShellEnv } from '../services/cli-detect.service'
import { getIMBridgeService } from '../services/im/im-bridge.service'
import { settingsStore } from '../store/settings.store'
import { getIMAutoConnect, setIMAutoConnect } from '../store/ai-coding.store'
import {
  validateToolType,
  validateId,
  validateDirPath,
  validateFilePath,
  validatePermissionMode,
  validateEffort,
  validatePtyDimensions,
  validateCommand,
  validateImageData
} from '../utils/ipc-validation'
import * as logger from '../utils/logger'

function assertId(id: unknown, what: string): asserts id is string {
  if (!validateId(id)) throw new Error(`Invalid ${what} ID format`)
}

function assertGroupName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
    throw new Error('Invalid group name')
  }
}

/**
 * Auto-connect IM if AI Coding module is enabled and Feishu credentials
 * are configured. Runs asynchronously after IPC registration so it doesn't
 * block app startup.
 */
async function autoConnectIM(): Promise<void> {
  try {
    const moduleVisibility = settingsStore.get('moduleVisibility') as unknown as
      | Record<string, boolean>
      | undefined
    if (!moduleVisibility?.aiCoding) return

    // Only auto-connect if the user was previously connected (not explicitly disconnected)
    if (!getIMAutoConnect()) return

    const imConfig = getIMConfig()
    // Remote IM control master switch (non-persistent TopBar entry)
    if (!imConfig.remoteEnabled) return

    const { appId, appSecret } = imConfig.feishu
    if (!appId || !appSecret) return

    console.log('[AICoding] Auto-connecting IM (Feishu)…')
    const bridge = getIMBridgeService()
    await bridge.connect('feishu')
    console.log('[AICoding] IM auto-connect succeeded')
  } catch (err) {
    console.error('[AICoding] IM auto-connect failed:', err)
  }
}

export function registerAICodingIpc(): void {
  // Reset any sessions that were active before this process started
  resetActiveSessionsOnStart()

  // Pre-load shell environment so CLI tools inherit user profile variables
  // (e.g. APIROUTER_API_KEY, custom PATH entries from .zshrc/.bashrc)
  loadShellEnv().catch(() => { /* fallback to process.env */ })

  // ── Workspaces ──

  ipcMain.handle('ai-coding:get-workspaces', async () => {
    return getWorkspaces()
  })

  ipcMain.handle(
    'ai-coding:create-workspace',
    async (_event, workingDir: string, groupId: string) => {
      const safeDir = validateDirPath(workingDir)
      if (!safeDir) throw new Error('Invalid working directory path')
      assertId(groupId, 'group')
      return createWorkspace(safeDir, groupId)
    }
  )

  ipcMain.handle(
    'ai-coding:update-workspace',
    async (_event, id: string, updates: Record<string, unknown>) => {
      assertId(id, 'workspace')
      return updateWorkspace(id, updates)
    }
  )

  ipcMain.handle('ai-coding:delete-workspace', async (_event, id: string) => {
    assertId(id, 'workspace')
    return deleteWorkspace(id)
  })

  ipcMain.handle('ai-coding:get-workspace-sessions', async (_event, workspaceId: string) => {
    assertId(workspaceId, 'workspace')
    return getSessionsForWorkspace(workspaceId)
  })

  // ── Sessions ──

  ipcMain.handle('ai-coding:get-sessions', async () => {
    return getSessions()
  })

  ipcMain.handle(
    'ai-coding:create-session',
    async (_event, workspaceId: string, toolType: string, source?: string) => {
      assertId(workspaceId, 'workspace')
      if (!validateToolType(toolType)) throw new Error('Invalid tool type')
      return source === 'im'
        ? createSession(workspaceId, toolType, 'im')
        : createRuntimeSession(workspaceId, toolType)
    }
  )

  ipcMain.handle(
    'ai-coding:update-session',
    async (_event, id: string, updates: Record<string, unknown>) => {
      assertId(id, 'session')
      return updateSession(id, updates)
    }
  )

  ipcMain.handle('ai-coding:delete-session', async (_event, id: string) => {
    assertId(id, 'session')
    return deleteSession(id)
  })

  ipcMain.handle('ai-coding:stop-session', async (_event, id: string) => {
    assertId(id, 'session')
    return stopSession(id)
  })

  ipcMain.handle('ai-coding:launch-session', async (_event, id: string, opts?: { forcePty?: boolean; cols?: number; rows?: number; effort?: string }) => {
    assertId(id, 'session')
    if (opts?.effort && !validateEffort(opts.effort)) throw new Error('Invalid effort level')
    return launchSession(id, opts)
  })

  ipcMain.handle('ai-coding:write-to-session', async (_event, sessionId: string, text: string, images?: { data: string; mediaType: string }[]) => {
    assertId(sessionId, 'session')
    if (typeof text !== 'string') throw new Error('Invalid message text')
    let safeImages = images
    if (images !== undefined) {
      if (!Array.isArray(images)) throw new Error('Invalid image data')
      safeImages = images.filter((img) => validateImageData(img))
      if (safeImages.length !== images.length) {
        logger.warn(`[AICoding] Dropped ${images.length - safeImages.length} unsupported image attachment(s)`)
      }
    }
    return writeToSession(sessionId, text, safeImages)
  })

  ipcMain.handle('ai-coding:read-file-base64', async (_event, filePath: string) => {
    const safePath = validateFilePath(filePath, { allowParentSegments: true })
    if (!safePath) throw new Error('Invalid file path')
    return readImageBase64(safePath)
  })

  ipcMain.handle('ai-coding:interrupt-session', async (_event, sessionId: string) => {
    assertId(sessionId, 'session')
    interruptSession(sessionId)
    return { success: true }
  })

  ipcMain.handle('ai-coding:execute-slash-command', async (_event, sessionId: string, command: string) => {
    assertId(sessionId, 'session')
    const safeCommand = validateCommand(command)
    if (safeCommand === null) throw new Error('Invalid command')
    return executeSessionSlashCommand(sessionId, safeCommand)
  })

  ipcMain.handle('ai-coding:set-permission-mode', async (_event, sessionId: string, mode: string) => {
    assertId(sessionId, 'session')
    if (!validatePermissionMode(mode)) throw new Error('Invalid permission mode')
    return setSessionPermissionMode(sessionId, mode)
  })

  ipcMain.handle(
    'ai-coding:resolve-permission',
    async (
      _event,
      sessionId: string,
      requestId: string,
      decision: { behavior: 'allow' | 'deny'; message?: string; updatedInput?: Record<string, unknown> }
    ) => {
      assertId(sessionId, 'session')
      assertId(requestId, 'request')
      if (decision?.behavior !== 'allow' && decision?.behavior !== 'deny') {
        throw new Error('Invalid decision behavior')
      }
      return resolveSessionPermission(sessionId, requestId, decision)
    }
  )

  ipcMain.handle(
    'ai-coding:answer-question',
    async (_event, sessionId: string, questionId: string, answers: Record<string, string>) => {
      assertId(sessionId, 'session')
      assertId(questionId, 'question')
      return answerSessionQuestion(sessionId, questionId, answers)
    }
  )

  ipcMain.handle('ai-coding:set-effort', async (_event, sessionId: string, effort: string) => {
    assertId(sessionId, 'session')
    if (!validateEffort(effort)) throw new Error('Invalid effort level')
    return setSessionEffort(sessionId, effort)
  })

  // ── PTY management ──

  ipcMain.handle('pty:create', async (_event, sessionId: string) => {
    assertId(sessionId, 'session')
    return launchSession(sessionId)
  })

  // Keystroke / resize traffic is high-frequency and fire-and-forget: drop
  // malformed calls quietly instead of rejecting into the renderer.
  ipcMain.handle('pty:write', async (_event, sessionId: string, data: string) => {
    if (!validateId(sessionId) || typeof data !== 'string') return
    writeToPty(sessionId, data)
    onPtyInput(sessionId, data)
  })

  ipcMain.handle('pty:resize', async (_event, sessionId: string, cols: number, rows: number) => {
    if (!validateId(sessionId)) return
    const dims = validatePtyDimensions(cols, rows)
    if (!dims) return
    resizePty(sessionId, dims.cols, dims.rows)
  })

  ipcMain.handle('pty:kill', async (_event, sessionId: string) => {
    assertId(sessionId, 'session')
    killPtySession(sessionId)
  })

  // ── CLI detection ──

  ipcMain.handle('ai-coding:detect-tools', async () => {
    return detectAvailableCLIs()
  })

  // ── Native session listing (Claude, Codex, Gemini, etc.) ──

  ipcMain.handle('ai-coding:list-native-sessions', async (_event, workingDir: string, toolType: string) => {
    const safeDir = validateDirPath(workingDir)
    if (!safeDir) throw new Error('Invalid working directory')
    if (!validateToolType(toolType)) throw new Error('Invalid tool type')
    return listNativeSessions(safeDir, toolType)
  })

  ipcMain.handle('ai-coding:load-native-session-transcript', async (_event, workingDir: string, toolType: string, sessionId: string) => {
    const safeDir = validateDirPath(workingDir)
    if (!safeDir) throw new Error('Invalid working directory')
    if (!validateToolType(toolType)) throw new Error('Invalid tool type')
    assertId(sessionId, 'session')
    return loadNativeSessionTranscript(safeDir, toolType, sessionId)
  })

  // ── Session output (for IM cards) ──

  ipcMain.handle('ai-coding:get-session-output', async (_event, sessionId: string) => {
    return getSessionOutput(sessionId)
  })

  ipcMain.handle('ai-coding:get-raw-session-output', async (_event, sessionId: string) => {
    return getRawSessionOutput(sessionId)
  })

  ipcMain.handle('ai-coding:get-raw-session-snapshot', async (_event, sessionId: string) => {
    return getRawSessionOutputSnapshot(sessionId)
  })

  // ── Groups ──

  ipcMain.handle('ai-coding:get-groups', async () => {
    return getGroups()
  })

  ipcMain.handle('ai-coding:create-group', async (_event, name: string) => {
    assertGroupName(name)
    return createGroup(name)
  })

  ipcMain.handle('ai-coding:rename-group', async (_event, id: string, name: string) => {
    assertId(id, 'group')
    assertGroupName(name)
    return renameGroup(id, name)
  })

  ipcMain.handle('ai-coding:delete-group', async (_event, id: string) => {
    assertId(id, 'group')
    return deleteGroup(id)
  })

  // ── IM Config ──

  ipcMain.handle('ai-coding:get-im-config', async () => {
    return getIMConfig()
  })

  ipcMain.handle('ai-coding:save-im-config', async (_event, config) => {
    return saveIMConfig(config)
  })

  ipcMain.handle('ai-coding:list-im-conversations', async () => {
    const { listImConversations } = await import('../services/im/im-agent.service')
    return listImConversations()
  })

  ipcMain.handle('ai-coding:get-im-conversation', async (_event, id: string) => {
    const { getImConversation } = await import('../services/im/im-agent.service')
    return getImConversation(id)
  })

  ipcMain.handle('ai-coding:delete-im-conversation', async (_event, id: string) => {
    const { deleteImConversation } = await import('../services/im/im-agent.service')
    return deleteImConversation(id)
  })

  ipcMain.handle('ai-coding:rename-im-conversation', async (_event, id: string, title: string) => {
    const { renameImConversation } = await import('../services/im/im-agent.service')
    return renameImConversation(id, title)
  })

  ipcMain.handle('ai-coding:open-directory', async (_event, dirPath: string) => {
    if (!validateDirPath(dirPath)) throw new Error('Invalid directory path')
    return shell.openPath(dirPath)
  })

  ipcMain.handle('ai-coding:open-terminal', async (_event, dirPath: string, toolCommand?: string) => {
    const safePath = validateDirPath(dirPath)
    if (!safePath) throw new Error('Invalid directory path')
    const safeCommand = toolCommand ? validateCommand(toolCommand) : undefined
    if (toolCommand && !safeCommand) throw new Error('Invalid terminal command')
    openExternalTerminal(safePath, safeCommand)
    return { success: true }
  })

  // ── IM Bridge ──

  ipcMain.handle('ai-coding:im-connect', async () => {
    const bridge = getIMBridgeService()
    await bridge.connect('feishu')
    setIMAutoConnect(true)
    return { success: true }
  })

  ipcMain.handle('ai-coding:im-disconnect', async () => {
    const bridge = getIMBridgeService()
    await bridge.disconnect()
    setIMAutoConnect(false)
    return { success: true }
  })

  ipcMain.handle('ai-coding:im-get-status', async () => {
    const bridge = getIMBridgeService()
    return bridge.getConnectionStatus()
  })

  ipcMain.handle('ai-coding:im-test', async () => {
    const bridge = getIMBridgeService()
    return bridge.testConnection()
  })

  // Auto-connect IM after startup (async, non-blocking)
  autoConnectIM()
}
