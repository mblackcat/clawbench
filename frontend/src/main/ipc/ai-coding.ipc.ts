import { ipcMain, shell } from 'electron'
import { execFile, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
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
  detectAvailableCLIs
} from '../services/ai-coding.service'
import { listNativeSessions, loadNativeSessionTranscript } from '../services/native-sessions.service'
import { writeToPty, resizePty, killPtySession } from '../services/pty-manager.service'
import { loadShellEnv } from '../services/cli-detect.service'
import { getIMBridgeService } from '../services/im/im-bridge.service'
import { settingsStore } from '../store/settings.store'
import { getIMAutoConnect, setIMAutoConnect } from '../store/ai-coding.store'

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
      return createWorkspace(workingDir, groupId)
    }
  )

  ipcMain.handle(
    'ai-coding:update-workspace',
    async (_event, id: string, updates: Record<string, unknown>) => {
      return updateWorkspace(id, updates)
    }
  )

  ipcMain.handle('ai-coding:delete-workspace', async (_event, id: string) => {
    return deleteWorkspace(id)
  })

  ipcMain.handle('ai-coding:get-workspace-sessions', async (_event, workspaceId: string) => {
    return getSessionsForWorkspace(workspaceId)
  })

  // ── Sessions ──

  ipcMain.handle('ai-coding:get-sessions', async () => {
    return getSessions()
  })

  ipcMain.handle(
    'ai-coding:create-session',
    async (_event, workspaceId: string, toolType: string, source?: string) => {
      return source === 'im'
        ? createSession(workspaceId, toolType as any, 'im')
        : createRuntimeSession(workspaceId, toolType as any)
    }
  )

  ipcMain.handle(
    'ai-coding:update-session',
    async (_event, id: string, updates: Record<string, unknown>) => {
      return updateSession(id, updates)
    }
  )

  ipcMain.handle('ai-coding:delete-session', async (_event, id: string) => {
    return deleteSession(id)
  })

  ipcMain.handle('ai-coding:stop-session', async (_event, id: string) => {
    return stopSession(id)
  })

  ipcMain.handle('ai-coding:launch-session', async (_event, id: string, opts?: { forcePty?: boolean; cols?: number; rows?: number; effort?: string }) => {
    return launchSession(id, opts)
  })

  ipcMain.handle('ai-coding:write-to-session', async (_event, sessionId: string, text: string, images?: { data: string; mediaType: string }[]) => {
    return writeToSession(sessionId, text, images)
  })

  ipcMain.handle('ai-coding:read-file-base64', async (_event, filePath: string) => {
    return readImageBase64(filePath)
  })

  ipcMain.handle('ai-coding:interrupt-session', async (_event, sessionId: string) => {
    interruptSession(sessionId)
    return { success: true }
  })

  ipcMain.handle('ai-coding:execute-slash-command', async (_event, sessionId: string, command: string) => {
    return executeSessionSlashCommand(sessionId, command)
  })

  ipcMain.handle('ai-coding:set-permission-mode', async (_event, sessionId: string, mode: string) => {
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
      return resolveSessionPermission(sessionId, requestId, decision)
    }
  )

  ipcMain.handle(
    'ai-coding:answer-question',
    async (_event, sessionId: string, questionId: string, answers: Record<string, string>) => {
      return answerSessionQuestion(sessionId, questionId, answers)
    }
  )

  ipcMain.handle('ai-coding:set-effort', async (_event, sessionId: string, effort: string) => {
    return setSessionEffort(sessionId, effort)
  })

  // ── PTY management ──

  ipcMain.handle('pty:create', async (_event, sessionId: string) => {
    return launchSession(sessionId)
  })

  ipcMain.handle('pty:write', async (_event, sessionId: string, data: string) => {
    writeToPty(sessionId, data)
  })

  ipcMain.handle('pty:resize', async (_event, sessionId: string, cols: number, rows: number) => {
    resizePty(sessionId, cols, rows)
  })

  ipcMain.handle('pty:kill', async (_event, sessionId: string) => {
    killPtySession(sessionId)
  })

  // ── CLI detection ──

  ipcMain.handle('ai-coding:detect-tools', async () => {
    return detectAvailableCLIs()
  })

  // ── Native session listing (Claude, Codex, Gemini, etc.) ──

  ipcMain.handle('ai-coding:list-native-sessions', async (_event, workingDir: string, toolType: string) => {
    return listNativeSessions(workingDir, toolType as any)
  })

  ipcMain.handle('ai-coding:load-native-session-transcript', async (_event, workingDir: string, toolType: string, sessionId: string) => {
    return loadNativeSessionTranscript(workingDir, toolType as any, sessionId)
  })

  // ── Session output (for IM cards) ──

  ipcMain.handle('ai-coding:get-session-output', async (_event, sessionId: string) => {
    return getSessionOutput(sessionId)
  })

  ipcMain.handle('ai-coding:get-raw-session-output', async (_event, sessionId: string) => {
    return getRawSessionOutput(sessionId)
  })

  // ── Groups ──

  ipcMain.handle('ai-coding:get-groups', async () => {
    return getGroups()
  })

  ipcMain.handle('ai-coding:create-group', async (_event, name: string) => {
    return createGroup(name)
  })

  ipcMain.handle('ai-coding:rename-group', async (_event, id: string, name: string) => {
    return renameGroup(id, name)
  })

  ipcMain.handle('ai-coding:delete-group', async (_event, id: string) => {
    return deleteGroup(id)
  })

  // ── IM Config ──

  ipcMain.handle('ai-coding:get-im-config', async () => {
    return getIMConfig()
  })

  ipcMain.handle('ai-coding:save-im-config', async (_event, config) => {
    return saveIMConfig(config)
  })

  ipcMain.handle('ai-coding:open-directory', async (_event, dirPath: string) => {
    return shell.openPath(dirPath)
  })

  ipcMain.handle('ai-coding:open-terminal', async (_event, dirPath: string, toolCommand?: string) => {
    const platform = process.platform
    // Build the shell command: always cd first, then optionally launch the tool
    const cdAndRun = toolCommand ? `cd "${dirPath}" && ${toolCommand}` : `cd "${dirPath}"`
    if (platform === 'darwin') {
      const configuredTerminal = (settingsStore.get('localTerminalPath') as string) || ''
      const home = os.homedir()

      // Resolve which terminal app to use
      let terminalApp = ''
      if (configuredTerminal) {
        terminalApp = configuredTerminal
      } else {
        const iTermPaths = [`${home}/Applications/iTerm.app`, '/Applications/iTerm.app']
        const foundITerm = iTermPaths.find((p) => fs.existsSync(p))
        terminalApp = foundITerm || ''
      }

      // Escape " and \ in the path for embedding in an AppleScript string
      const escapedPath = dirPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const escapedCmd = toolCommand
        ? `cd \\"${escapedPath}\\" && ${toolCommand}`
        : `cd \\"${escapedPath}\\"`

      // Derive the app name from the .app path (e.g. "Ghostty" from "/Applications/Ghostty.app")
      const appName = terminalApp.replace(/.*\//, '').replace(/\.app$/, '')

      if (appName === 'iTerm' || appName === 'iTerm2') {
        // Use full .app path as AppleScript application identifier for reliability
        const appId = terminalApp || 'iTerm'
        execFile('osascript', [
          '-e', `tell application "${appId}"`,
          '-e', '  activate',
          '-e', '  set newWindow to (create window with default profile)',
          '-e', `  tell current session of newWindow`,
          '-e', `    write text "${escapedCmd}"`,
          '-e', '  end tell',
          '-e', 'end tell'
        ])
      } else if (!terminalApp || appName === 'Terminal') {
        const appId = terminalApp || 'Terminal'
        execFile('osascript', [
          '-e', `tell application "${appId}" to do script "${escapedCmd}"`,
          '-e', `tell application "${appId}" to activate`
        ])
      } else {
        // Generic terminal (Ghostty, Warp, Alacritty, etc.): use `open -a` with dirPath
        // Most modern terminals open a new window in the given directory
        const args = ['-a', terminalApp, dirPath]
        spawn('open', args, { detached: true, stdio: 'ignore' }).unref()
      }
    } else if (platform === 'win32') {
      // Try Windows Terminal first, fall back to cmd.exe
      // Note: 'start' treats the first quoted arg as window title, so we pass '""' as title
      const wtExe = `${process.env.LOCALAPPDATA}\\Microsoft\\WindowsApps\\wt.exe`
      const winCmd = toolCommand
        ? `cd /d "${dirPath}" && ${toolCommand}`
        : `cd /d "${dirPath}"`
      if (fs.existsSync(wtExe)) {
        // Use wt.exe -d to set starting directory; quote dirPath for paths with spaces
        spawn('cmd.exe', ['/c', 'start', '""', 'wt.exe', '-d', `"${dirPath}"`, 'cmd.exe', '/K', toolCommand || ''], {
          detached: true,
          stdio: 'ignore',
          shell: true
        }).unref()
      } else {
        // Wrap the whole winCmd in an extra pair of quotes so cmd.exe /K parses it correctly
        spawn('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/K', `"${winCmd}"`], {
          detached: true,
          stdio: 'ignore',
          shell: true
        }).unref()
      }
    } else {
      void cdAndRun // suppress unused warning; Linux open is best-effort
      execFile('xdg-open', [dirPath])
    }
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
