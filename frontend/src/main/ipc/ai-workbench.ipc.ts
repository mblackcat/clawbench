import { ipcMain, shell } from 'electron'
import { execFile, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import {
  getSessions,
  createSession,
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
  getSessionOutput,
  interruptSession,
  executeSessionSlashCommand,
  setSessionPermissionMode,
  getGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  getIMConfig,
  saveIMConfig,
  detectAvailableCLIs
} from '../services/ai-workbench.service'
import { listNativeSessions } from '../services/native-sessions.service'
import { writeToPty, resizePty, killPtySession } from '../services/pty-manager.service'
import { loadShellEnv } from '../services/cli-detect.service'
import { getIMBridgeService } from '../services/im/im-bridge.service'
import { settingsStore } from '../store/settings.store'
import { getIMAutoConnect, setIMAutoConnect } from '../store/ai-workbench.store'

/**
 * Auto-connect IM if AI Workbench module is enabled and Feishu credentials
 * are configured. Runs asynchronously after IPC registration so it doesn't
 * block app startup.
 */
async function autoConnectIM(): Promise<void> {
  try {
    const moduleVisibility = settingsStore.get('moduleVisibility') as
      | Record<string, boolean>
      | undefined
    if (!moduleVisibility?.aiWorkbench) return

    // Only auto-connect if the user was previously connected (not explicitly disconnected)
    if (!getIMAutoConnect()) return

    const imConfig = getIMConfig()
    const { appId, appSecret } = imConfig.feishu
    if (!appId || !appSecret) return

    console.log('[AIWorkbench] Auto-connecting IM (Feishu)…')
    const bridge = getIMBridgeService()
    await bridge.connect('feishu')
    console.log('[AIWorkbench] IM auto-connect succeeded')
  } catch (err) {
    console.error('[AIWorkbench] IM auto-connect failed:', err)
  }
}

export function registerAIWorkbenchIpc(): void {
  // Reset any sessions that were active before this process started
  resetActiveSessionsOnStart()

  // Pre-load shell environment so CLI tools inherit user profile variables
  // (e.g. APIROUTER_API_KEY, custom PATH entries from .zshrc/.bashrc)
  loadShellEnv().catch(() => { /* fallback to process.env */ })

  // ── Workspaces ──

  ipcMain.handle('ai-workbench:get-workspaces', async () => {
    return getWorkspaces()
  })

  ipcMain.handle(
    'ai-workbench:create-workspace',
    async (_event, workingDir: string, groupId: string) => {
      return createWorkspace(workingDir, groupId)
    }
  )

  ipcMain.handle(
    'ai-workbench:update-workspace',
    async (_event, id: string, updates: Record<string, unknown>) => {
      return updateWorkspace(id, updates)
    }
  )

  ipcMain.handle('ai-workbench:delete-workspace', async (_event, id: string) => {
    return deleteWorkspace(id)
  })

  ipcMain.handle('ai-workbench:get-workspace-sessions', async (_event, workspaceId: string) => {
    return getSessionsForWorkspace(workspaceId)
  })

  // ── Sessions ──

  ipcMain.handle('ai-workbench:get-sessions', async () => {
    return getSessions()
  })

  ipcMain.handle(
    'ai-workbench:create-session',
    async (_event, workspaceId: string, toolType: string, source?: string) => {
      return createSession(workspaceId, toolType as any, (source as any) || 'local')
    }
  )

  ipcMain.handle(
    'ai-workbench:update-session',
    async (_event, id: string, updates: Record<string, unknown>) => {
      return updateSession(id, updates)
    }
  )

  ipcMain.handle('ai-workbench:delete-session', async (_event, id: string) => {
    return deleteSession(id)
  })

  ipcMain.handle('ai-workbench:stop-session', async (_event, id: string) => {
    return stopSession(id)
  })

  ipcMain.handle('ai-workbench:launch-session', async (_event, id: string, opts?: { forcePty?: boolean }) => {
    return launchSession(id, opts)
  })

  ipcMain.handle('ai-workbench:write-to-session', async (_event, sessionId: string, text: string) => {
    return writeToSession(sessionId, text)
  })

  ipcMain.handle('ai-workbench:interrupt-session', async (_event, sessionId: string) => {
    interruptSession(sessionId)
    return { success: true }
  })

  ipcMain.handle('ai-workbench:execute-slash-command', async (_event, sessionId: string, command: string) => {
    return executeSessionSlashCommand(sessionId, command)
  })

  ipcMain.handle('ai-workbench:set-permission-mode', async (_event, sessionId: string, mode: string) => {
    return setSessionPermissionMode(sessionId, mode)
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

  ipcMain.handle('ai-workbench:detect-tools', async () => {
    return detectAvailableCLIs()
  })

  // ── Native session listing (Claude, Codex, Gemini, etc.) ──

  ipcMain.handle('ai-workbench:list-native-sessions', async (_event, workingDir: string, toolType: string) => {
    return listNativeSessions(workingDir, toolType as any)
  })

  // ── Session output (for IM cards) ──

  ipcMain.handle('ai-workbench:get-session-output', async (_event, sessionId: string) => {
    return getSessionOutput(sessionId)
  })

  // ── Groups ──

  ipcMain.handle('ai-workbench:get-groups', async () => {
    return getGroups()
  })

  ipcMain.handle('ai-workbench:create-group', async (_event, name: string) => {
    return createGroup(name)
  })

  ipcMain.handle('ai-workbench:rename-group', async (_event, id: string, name: string) => {
    return renameGroup(id, name)
  })

  ipcMain.handle('ai-workbench:delete-group', async (_event, id: string) => {
    return deleteGroup(id)
  })

  // ── IM Config ──

  ipcMain.handle('ai-workbench:get-im-config', async () => {
    return getIMConfig()
  })

  ipcMain.handle('ai-workbench:save-im-config', async (_event, config) => {
    return saveIMConfig(config)
  })

  ipcMain.handle('ai-workbench:open-directory', async (_event, dirPath: string) => {
    return shell.openPath(dirPath)
  })

  ipcMain.handle('ai-workbench:open-terminal', async (_event, dirPath: string, toolCommand?: string) => {
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

  ipcMain.handle('ai-workbench:im-connect', async () => {
    const bridge = getIMBridgeService()
    await bridge.connect('feishu')
    setIMAutoConnect(true)
    return { success: true }
  })

  ipcMain.handle('ai-workbench:im-disconnect', async () => {
    const bridge = getIMBridgeService()
    await bridge.disconnect()
    setIMAutoConnect(false)
    return { success: true }
  })

  ipcMain.handle('ai-workbench:im-get-status', async () => {
    const bridge = getIMBridgeService()
    return bridge.getConnectionStatus()
  })

  ipcMain.handle('ai-workbench:im-test', async () => {
    const bridge = getIMBridgeService()
    return bridge.testConnection()
  })

  // Auto-connect IM after startup (async, non-blocking)
  autoConnectIM()
}
