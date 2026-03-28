import { ipcRenderer } from 'electron'

// Typed API surface exposed to renderer via contextBridge

export const api = {
  workspace: {
    list: () => ipcRenderer.invoke('workspace:list'),
    create: (name: string, path: string, vcsType?: string) =>
      ipcRenderer.invoke('workspace:create', name, path, vcsType),
    update: (id: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('workspace:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('workspace:delete', id),
    setActive: (id: string) => ipcRenderer.invoke('workspace:set-active', id),
    getActive: () => ipcRenderer.invoke('workspace:get-active')
  },

  subapp: {
    list: () => ipcRenderer.invoke('subapp:list'),
    getManifest: (appId: string) => ipcRenderer.invoke('subapp:get-manifest', appId),
    execute: (appId: string, params?: Record<string, unknown>) =>
      ipcRenderer.invoke('subapp:execute', appId, params),
    cancel: (taskId: string) => ipcRenderer.invoke('subapp:cancel', taskId),
    uninstall: (appId: string) => ipcRenderer.invoke('subapp:uninstall', appId),
    installFromMarket: (appId: string, downloadUrl: string, token?: string) =>
      ipcRenderer.invoke('subapp:install-from-market', appId, downloadUrl, token),
    onOutput: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('subapp:output', handler)
      return () => ipcRenderer.removeListener('subapp:output', handler)
    },
    onProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('subapp:progress', handler)
      return () => ipcRenderer.removeListener('subapp:progress', handler)
    },
    onTaskStatus: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('subapp:task-status', handler)
      return () => ipcRenderer.removeListener('subapp:task-status', handler)
    },
    onUi: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('subapp:ui', handler)
      return () => ipcRenderer.removeListener('subapp:ui', handler)
    },
    onTaskStarted: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('subapp:task-started', handler)
      return () => ipcRenderer.removeListener('subapp:task-started', handler)
    }
  },

  auth: {
    getStatus: () => ipcRenderer.invoke('auth:get-status'),
    startLogin: () => ipcRenderer.invoke('auth:start-login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    onStatusChanged: (callback: (status: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status)
      ipcRenderer.on('auth:status-changed', handler)
      return () => ipcRenderer.removeListener('auth:status-changed', handler)
    }
  },

  developer: {
    createApp: (appInfo: Record<string, unknown>) =>
      ipcRenderer.invoke('developer:create-app', appInfo),
    updateApp: (appId: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('developer:update-app', appId, updates),
    deleteApp: (appId: string) => ipcRenderer.invoke('developer:delete-app', appId),
    publishApp: (appPath: string) => ipcRenderer.invoke('developer:publish-app', appPath),
    packageApp: (appId: string) => ipcRenderer.invoke('developer:package-app', appId),
    listMyApps: () => ipcRenderer.invoke('developer:list-my-apps'),
    getAppPath: (appId: string) => ipcRenderer.invoke('developer:get-app-path', appId),
    listAppFiles: (appId: string) => ipcRenderer.invoke('developer:list-app-files', appId),
    readFile: (filePath: string) => ipcRenderer.invoke('developer:read-file', filePath),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('developer:write-file', filePath, content),
    createFile: (filePath: string) => ipcRenderer.invoke('developer:create-file', filePath),
    createFolder: (folderPath: string) =>
      ipcRenderer.invoke('developer:create-folder', folderPath),
    renameFile: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke('developer:rename-file', oldPath, newPath),
    deleteFile: (filePath: string) => ipcRenderer.invoke('developer:delete-file', filePath),
    moveFile: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke('developer:move-file', oldPath, newPath),
    detectIde: () => ipcRenderer.invoke('developer:detect-ide'),
    detectTerminal: () => ipcRenderer.invoke('developer:detect-terminal'),
    openInIde: (appPath: string) => ipcRenderer.invoke('developer:open-in-ide', appPath),
    openFileInEditor: (filePath: string) => ipcRenderer.invoke('developer:open-file-in-editor', filePath),
    openSSHConfig: () => ipcRenderer.invoke('developer:open-ssh-config'),
    openAppDirectory: (appPath: string) =>
      ipcRenderer.invoke('developer:open-app-directory', appPath)
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    validatePython: (pythonPath: string) =>
      ipcRenderer.invoke('settings:validate-python', pythonPath),
    detectPython: () => ipcRenderer.invoke('settings:detect-python') as Promise<string | null>,
    getEnvConfig: () => ipcRenderer.invoke('settings:get-env-config'),
    getAiModels: () => ipcRenderer.invoke('settings:get-ai-models'),
    saveAiModel: (config: Record<string, unknown>) =>
      ipcRenderer.invoke('settings:save-ai-model', config),
    deleteAiModel: (id: string) => ipcRenderer.invoke('settings:delete-ai-model', id),
    testAiModel: (config: Record<string, unknown>) =>
      ipcRenderer.invoke('settings:test-ai-model', config),
    getImageGenConfigs: () => ipcRenderer.invoke('settings:get-image-gen-configs'),
    saveImageGenConfig: (config: Record<string, unknown>) =>
      ipcRenderer.invoke('settings:save-image-gen-config', config),
    deleteImageGenConfig: (id: string) =>
      ipcRenderer.invoke('settings:delete-image-gen-config', id),
    setLastChatModel: (configId: string, modelId: string) =>
      ipcRenderer.invoke('settings:set-last-chat-model', configId, modelId),
    getLastChatModel: () => ipcRenderer.invoke('settings:get-last-chat-model'),
    setLastBuiltinChatModel: (modelId: string) =>
      ipcRenderer.invoke('settings:set-last-builtin-chat-model', modelId),
    getLastBuiltinChatModel: () => ipcRenderer.invoke('settings:get-last-builtin-chat-model'),
    getLastChatModelSource: () => ipcRenderer.invoke('settings:get-last-chat-model-source') as Promise<string>,
    getChatPreferences: () => ipcRenderer.invoke('settings:get-chat-preferences'),
    setChatPreferences: (prefs: { chatMode?: string; toolsEnabled?: boolean; webSearchEnabled?: boolean; feishuKitsEnabled?: boolean }) =>
      ipcRenderer.invoke('settings:set-chat-preferences', prefs),
    detectFeishuCli: () => ipcRenderer.invoke('settings:detect-feishu-cli'),
    installFeishuCli: () => ipcRenderer.invoke('settings:install-feishu-cli'),
    writeFeishuCliConfig: () => ipcRenderer.invoke('settings:write-feishu-cli-config') as Promise<{ success: boolean; error: string; path?: string }>,
    checkFeishuCliConfig: () => ipcRenderer.invoke('settings:check-feishu-cli-config') as Promise<{ exists: boolean; hasCredentials: boolean }>,
    onFeishuCliInstallProgress: (callback: (data: { percent: number; downloadedMB: string; totalMB: string; stage: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('settings:feishu-cli-install-progress', handler)
      return () => ipcRenderer.removeListener('settings:feishu-cli-install-progress', handler)
    },
    getAiToolsConfig: () => ipcRenderer.invoke('settings:get-ai-tools-config'),
    setAiToolsConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('settings:set-ai-tools-config', config),
    testBraveApiKey: (apiKey: string) => ipcRenderer.invoke('settings:test-brave-api-key', apiKey),
    detectLightpanda: () => ipcRenderer.invoke('settings:detect-lightpanda'),
    installLightpanda: () => ipcRenderer.invoke('settings:install-lightpanda'),
    onLightpandaInstallProgress: (callback: (data: { percent: number; downloadedMB: string; totalMB: string; stage: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('settings:lightpanda-install-progress', handler)
      return () => ipcRenderer.removeListener('settings:lightpanda-install-progress', handler)
    },
    getAgentSettings: () => ipcRenderer.invoke('settings:get-agent-settings'),
    setAgentSettings: (settings: { customSystemPrompt?: string; defaultToolApprovalMode?: string; maxAgentToolSteps?: number }) =>
      ipcRenderer.invoke('settings:set-agent-settings', settings),
  },

  git: {
    listBranches: (workspacePath: string) =>
      ipcRenderer.invoke('git:list-branches', workspacePath),
    checkout: (workspacePath: string, branchName: string) =>
      ipcRenderer.invoke('git:checkout', workspacePath, branchName),
    diffStat: (workspacePath: string) =>
      ipcRenderer.invoke('git:diff-stat', workspacePath),
    changedFiles: (workspacePath: string) =>
      ipcRenderer.invoke('git:changed-files', workspacePath),
    commit: (workspacePath: string, message: string) =>
      ipcRenderer.invoke('git:commit', workspacePath, message),
    push: (workspacePath: string) =>
      ipcRenderer.invoke('git:push', workspacePath),
    pull: (workspacePath: string) =>
      ipcRenderer.invoke('git:pull', workspacePath),
    discardFile: (workspacePath: string, filePath: string, isUntracked: boolean) =>
      ipcRenderer.invoke('git:discard-file', workspacePath, filePath, isUntracked)
  },

  dialog: {
    selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
    selectApp: () => ipcRenderer.invoke('dialog:select-app') as Promise<string | null>,
    selectFiles: () => ipcRenderer.invoke('dialog:select-files'),
    saveImage: (base64Data: string) => ipcRenderer.invoke('dialog:save-image', base64Data)
  },

  ai: {
    streamChat: (
      modelConfigId: string,
      messages: Array<{ role: string; content: string; toolCallId?: string; toolCalls?: any[] }>,
      modelId?: string,
      attachments?: Array<{ filePath: string; mimeType: string; fileName: string }>,
      tools?: Array<{ name: string; description: string; inputSchema: Record<string, any> }>,
      enableThinking?: boolean,
      webSearchEnabled?: boolean
    ) => ipcRenderer.invoke('ai:stream-chat', { modelConfigId, messages, modelId, attachments, tools, enableThinking, webSearchEnabled }),
    cancelChat: (taskId: string) => ipcRenderer.invoke('ai:cancel-chat', taskId),
    submitToolResult: (taskId: string, toolCallId: string, result: string, isError: boolean) =>
      ipcRenderer.invoke('ai:tool-result', { taskId, toolCallId, result, isError }),
    generateTitle: (
      modelConfigId: string,
      messages: Array<{ role: string; content: string }>,
      modelId?: string
    ) => ipcRenderer.invoke('ai:generate-title', { modelConfigId, messages, modelId }),
    onChatDelta: (callback: (data: { taskId: string; content: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('ai:chat-delta', handler)
      return () => ipcRenderer.removeListener('ai:chat-delta', handler)
    },
    onChatDone: (callback: (data: { taskId: string; usage: any }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('ai:chat-done', handler)
      return () => ipcRenderer.removeListener('ai:chat-done', handler)
    },
    onChatError: (callback: (data: { taskId: string; error: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('ai:chat-error', handler)
      return () => ipcRenderer.removeListener('ai:chat-error', handler)
    },
    onChatToolUse: (callback: (data: { taskId: string; toolCallId: string; toolName: string; input: Record<string, any> }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('ai:chat-tool-use', handler)
      return () => ipcRenderer.removeListener('ai:chat-tool-use', handler)
    },
    onChatThinkingDelta: (callback: (data: { taskId: string; content: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('ai:chat-thinking-delta', handler)
      return () => ipcRenderer.removeListener('ai:chat-thinking-delta', handler)
    },
    onChatSearchGrounding: (callback: (data: { taskId: string; queries: string[]; sources: Array<{ title: string; url: string }> }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('ai:chat-search-grounding', handler)
      return () => ipcRenderer.removeListener('ai:chat-search-grounding', handler)
    }
  },

  mcp: {
    getServers: () => ipcRenderer.invoke('mcp:get-servers'),
    saveServer: (config: Record<string, unknown>) => ipcRenderer.invoke('mcp:save-server', config),
    deleteServer: (id: string) => ipcRenderer.invoke('mcp:delete-server', id),
    connect: (id: string) => ipcRenderer.invoke('mcp:connect', id),
    disconnect: (id: string) => ipcRenderer.invoke('mcp:disconnect', id),
    listTools: () => ipcRenderer.invoke('mcp:list-tools'),
    callTool: (serverId: string, toolName: string, args: Record<string, unknown>) =>
      ipcRenderer.invoke('mcp:call-tool', { serverId, toolName, args }),
    getStatus: () => ipcRenderer.invoke('mcp:get-status'),
    connectAllEnabled: () => ipcRenderer.invoke('mcp:connect-all-enabled'),
  },

  notification: {
    onPush: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('notification:push', handler)
      return () => ipcRenderer.removeListener('notification:push', handler)
    }
  },

  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onChecking: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('updater:checking', handler)
      return () => ipcRenderer.removeListener('updater:checking', handler)
    },
    onAvailable: (callback: (data: { version: string; releaseDate: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('updater:available', handler)
      return () => ipcRenderer.removeListener('updater:available', handler)
    },
    onNotAvailable: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('updater:not-available', handler)
      return () => ipcRenderer.removeListener('updater:not-available', handler)
    },
    onProgress: (callback: (data: { percent: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('updater:progress', handler)
      return () => ipcRenderer.removeListener('updater:progress', handler)
    },
    onDownloaded: (callback: (data: { version: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('updater:downloaded', handler)
      return () => ipcRenderer.removeListener('updater:downloaded', handler)
    },
    onError: (callback: (data: { message: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('updater:error', handler)
      return () => ipcRenderer.removeListener('updater:error', handler)
    }
  },

  openclaw: {
    checkInstalled: () => ipcRenderer.invoke('openclaw:check-installed'),
    install: () => ipcRenderer.invoke('openclaw:install'),
    uninstall: (removeConfig: boolean) => ipcRenderer.invoke('openclaw:uninstall', removeConfig),
    getStatus: () => ipcRenderer.invoke('openclaw:get-status'),
    start: () => ipcRenderer.invoke('openclaw:start'),
    stop: () => ipcRenderer.invoke('openclaw:stop'),
    getConfig: () => ipcRenderer.invoke('openclaw:get-config'),
    saveConfig: (config: Record<string, unknown>) =>
      ipcRenderer.invoke('openclaw:save-config', config),
    applyConfig: (config: Record<string, unknown>) =>
      ipcRenderer.invoke('openclaw:apply-config', config),
    listCommunitySkills: () => ipcRenderer.invoke('openclaw:list-community-skills'),
    installSkill: (id: string) => ipcRenderer.invoke('openclaw:install-skill', id),
    getCronJobs: () => ipcRenderer.invoke('openclaw:get-cron-jobs'),
    toggleCronJob: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('openclaw:toggle-cron-job', id, enabled),
    checkLatestVersion: () => ipcRenderer.invoke('openclaw:check-latest-version'),
    pairingApprove: (channel: string, code: string) =>
      ipcRenderer.invoke('openclaw:pairing-approve', channel, code),
    getGatewayUrl: () => ipcRenderer.invoke('openclaw:get-gateway-url'),
    startGoogleOAuth: () => ipcRenderer.invoke('openclaw:start-google-oauth'),
    startLogWatcher: () => ipcRenderer.invoke('openclaw:start-log-watcher'),
    stopLogWatcher: () => ipcRenderer.invoke('openclaw:stop-log-watcher'),
    onActivityState: (callback: (state: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: string) => callback(state)
      ipcRenderer.on('openclaw:activity-state', handler)
      return () => ipcRenderer.removeListener('openclaw:activity-state', handler)
    },
    onActiveSubagents: (callback: (subagents: Array<{ id: string; label: string; model?: string }>) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, subagents: Array<{ id: string; label: string; model?: string }>) => callback(subagents)
      ipcRenderer.on('openclaw:active-subagents', handler)
      return () => ipcRenderer.removeListener('openclaw:active-subagents', handler)
    }
  },

  credentials: {
    saveApiToken: (token: string) => ipcRenderer.invoke('credentials:save-api-token', token),
    clearApiToken: () => ipcRenderer.invoke('credentials:clear-api-token')
  },

  localEnv: {
    detectAll: () => ipcRenderer.invoke('local-env:detect-all'),
    detectOne: (toolId: string) => ipcRenderer.invoke('local-env:detect-one', toolId),
    install: (toolId: string) => ipcRenderer.invoke('local-env:install', toolId)
  },

  copiper: {
    listDatabases: (workspacePath: string) =>
      ipcRenderer.invoke('copiper:list-databases', workspacePath),
    loadDatabase: (filePath: string) =>
      ipcRenderer.invoke('copiper:load-database', filePath),
    saveDatabase: (filePath: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('copiper:save-database', filePath, data),
    createDatabase: (filePath: string, tableName: string) =>
      ipcRenderer.invoke('copiper:create-database', filePath, tableName),
    deleteDatabase: (filePath: string) =>
      ipcRenderer.invoke('copiper:delete-database', filePath),
    addTable: (filePath: string, tableName: string) =>
      ipcRenderer.invoke('copiper:add-table', filePath, tableName),
    removeTable: (filePath: string, tableName: string) =>
      ipcRenderer.invoke('copiper:remove-table', filePath, tableName),
    renameTable: (filePath: string, oldName: string, newName: string) =>
      ipcRenderer.invoke('copiper:rename-table', filePath, oldName, newName),
    addColumn: (filePath: string, tableName: string, column: Record<string, unknown>) =>
      ipcRenderer.invoke('copiper:add-column', filePath, tableName, column),
    updateColumn: (
      filePath: string,
      tableName: string,
      columnId: string,
      updates: Record<string, unknown>
    ) => ipcRenderer.invoke('copiper:update-column', filePath, tableName, columnId, updates),
    removeColumn: (filePath: string, tableName: string, columnId: string) =>
      ipcRenderer.invoke('copiper:remove-column', filePath, tableName, columnId),
    addRow: (filePath: string, tableName: string, row: Record<string, unknown>) =>
      ipcRenderer.invoke('copiper:add-row', filePath, tableName, row),
    updateRow: (
      filePath: string,
      tableName: string,
      rowIndex: number,
      updates: Record<string, unknown>
    ) => ipcRenderer.invoke('copiper:update-row', filePath, tableName, rowIndex, updates),
    deleteRows: (filePath: string, tableName: string, rowIndices: number[]) =>
      ipcRenderer.invoke('copiper:delete-rows', filePath, tableName, rowIndices),
    validateTable: (filePath: string, tableName: string, allTables?: Record<string, unknown>) =>
      ipcRenderer.invoke('copiper:validate-table', filePath, tableName, allTables),
    exportTable: (
      filePath: string,
      tableName: string,
      config: Record<string, unknown>,
      workspacePath: string,
      allTables?: Record<string, unknown>
    ) =>
      ipcRenderer.invoke('copiper:export-table', filePath, tableName, config, workspacePath, allTables),
    exportAll: (filePath: string, config: Record<string, unknown>, workspacePath: string) =>
      ipcRenderer.invoke('copiper:export-all', filePath, config, workspacePath),
    getTableInfos: (workspacePath: string) =>
      ipcRenderer.invoke('copiper:get-table-infos', workspacePath),
    saveTableInfos: (workspacePath: string, infos: unknown[]) =>
      ipcRenderer.invoke('copiper:save-table-infos', workspacePath, infos),
    getSettings: () => ipcRenderer.invoke('copiper:get-settings'),
    saveSettings: (settings: Record<string, unknown>) =>
      ipcRenderer.invoke('copiper:save-settings', settings),
    loadReferenceData: (workspacePath: string, tableNames: string[]) =>
      ipcRenderer.invoke('copiper:load-reference-data', workspacePath, tableNames)
  },

  aiWorkbench: {
    getWorkspaces: () => ipcRenderer.invoke('ai-workbench:get-workspaces'),
    createWorkspace: (workingDir: string, groupId: string) =>
      ipcRenderer.invoke('ai-workbench:create-workspace', workingDir, groupId),
    updateWorkspace: (id: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('ai-workbench:update-workspace', id, updates),
    deleteWorkspace: (id: string) => ipcRenderer.invoke('ai-workbench:delete-workspace', id),
    getWorkspaceSessions: (workspaceId: string) =>
      ipcRenderer.invoke('ai-workbench:get-workspace-sessions', workspaceId),
    getSessions: () => ipcRenderer.invoke('ai-workbench:get-sessions'),
    createSession: (workspaceId: string, toolType: string, source?: string) =>
      ipcRenderer.invoke('ai-workbench:create-session', workspaceId, toolType, source),
    updateSession: (id: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('ai-workbench:update-session', id, updates),
    deleteSession: (id: string) => ipcRenderer.invoke('ai-workbench:delete-session', id),
    stopSession: (id: string) => ipcRenderer.invoke('ai-workbench:stop-session', id),
    launchSession: (id: string, opts?: { forcePty?: boolean }) => ipcRenderer.invoke('ai-workbench:launch-session', id, opts),
    writeToSession: (sessionId: string, text: string) =>
      ipcRenderer.invoke('ai-workbench:write-to-session', sessionId, text),
    interruptSession: (sessionId: string) =>
      ipcRenderer.invoke('ai-workbench:interrupt-session', sessionId),
    executeSlashCommand: (sessionId: string, command: string) =>
      ipcRenderer.invoke('ai-workbench:execute-slash-command', sessionId, command),
    setPermissionMode: (sessionId: string, mode: string) =>
      ipcRenderer.invoke('ai-workbench:set-permission-mode', sessionId, mode),

    // Pipe event stream (structured events from CLI tools)
    onPipeEvent: (callback: (data: { sessionId: string; event: any }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('ai-workbench:pipe-event', handler)
      return () => ipcRenderer.removeListener('ai-workbench:pipe-event', handler)
    },

    // PTY management (legacy)
    createPty: (sessionId: string) => ipcRenderer.invoke('pty:create', sessionId),
    writePty: (sessionId: string, data: string) => ipcRenderer.invoke('pty:write', sessionId, data),
    resizePty: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('pty:resize', sessionId, cols, rows),
    killPty: (sessionId: string) => ipcRenderer.invoke('pty:kill', sessionId),
    onPtyData: (callback: (data: { sessionId: string; data: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('pty:data', handler)
      return () => ipcRenderer.removeListener('pty:data', handler)
    },
    onPtyExit: (callback: (data: { sessionId: string; exitCode: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('pty:exit', handler)
      return () => ipcRenderer.removeListener('pty:exit', handler)
    },

    // CLI detection
    detectTools: () => ipcRenderer.invoke('ai-workbench:detect-tools'),

    // Native session listing (reads CLI tool session history from filesystem/CLI)
    listNativeSessions: (workingDir: string, toolType: string) =>
      ipcRenderer.invoke('ai-workbench:list-native-sessions', workingDir, toolType),

    // Session output
    getSessionOutput: (sessionId: string) =>
      ipcRenderer.invoke('ai-workbench:get-session-output', sessionId),

    getGroups: () => ipcRenderer.invoke('ai-workbench:get-groups'),
    createGroup: (name: string) => ipcRenderer.invoke('ai-workbench:create-group', name),
    renameGroup: (id: string, name: string) =>
      ipcRenderer.invoke('ai-workbench:rename-group', id, name),
    deleteGroup: (id: string) => ipcRenderer.invoke('ai-workbench:delete-group', id),
    getIMConfig: () => ipcRenderer.invoke('ai-workbench:get-im-config'),
    saveIMConfig: (config: Record<string, unknown>) =>
      ipcRenderer.invoke('ai-workbench:save-im-config', config),
    openDirectory: (dirPath: string) => ipcRenderer.invoke('ai-workbench:open-directory', dirPath),
    openTerminal: (dirPath: string, toolCommand?: string) => ipcRenderer.invoke('ai-workbench:open-terminal', dirPath, toolCommand),
    imConnect: () => ipcRenderer.invoke('ai-workbench:im-connect'),
    imDisconnect: () => ipcRenderer.invoke('ai-workbench:im-disconnect'),
    imGetStatus: () => ipcRenderer.invoke('ai-workbench:im-get-status'),
    imTest: () => ipcRenderer.invoke('ai-workbench:im-test'),
    onIMStatusChanged: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('ai-workbench:im-status-changed', handler)
      return () => ipcRenderer.removeListener('ai-workbench:im-status-changed', handler)
    },
    onDataChanged: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('ai-workbench:data-changed', handler)
      return () => ipcRenderer.removeListener('ai-workbench:data-changed', handler)
    }
  },

  skill: {
    detectWorkspaceType: (workspacePath: string) =>
      ipcRenderer.invoke('skill:detect-workspace-type', workspacePath),
    activate: (skillId: string, workspacePath: string, targetType?: string) =>
      ipcRenderer.invoke('skill:activate', skillId, workspacePath, targetType),
    deactivate: (skillId: string, workspacePath: string) =>
      ipcRenderer.invoke('skill:deactivate', skillId, workspacePath)
  },

  aiTerminal: {
    // Connections
    getConnections: () => ipcRenderer.invoke('ai-terminal:get-connections'),
    createConnection: (data: Record<string, unknown>) =>
      ipcRenderer.invoke('ai-terminal:create-connection', data),
    updateConnection: (id: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('ai-terminal:update-connection', id, updates),
    deleteConnection: (id: string) => ipcRenderer.invoke('ai-terminal:delete-connection', id),
    syncSSHConfig: () => ipcRenderer.invoke('ai-terminal:sync-ssh-config'),

    // Terminal sessions (reuses pty:data events)
    openTerminal: (connectionId: string, sessionId: string) =>
      ipcRenderer.invoke('ai-terminal:open-terminal', connectionId, sessionId),
    closeTerminal: (sessionId: string) =>
      ipcRenderer.invoke('ai-terminal:close-terminal', sessionId),
    writeTerminal: (sessionId: string, data: string) =>
      ipcRenderer.invoke('ai-terminal:write-terminal', sessionId, data),
    resizeTerminal: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('ai-terminal:resize-terminal', sessionId, cols, rows),
    getTerminalOutput: (sessionId: string) =>
      ipcRenderer.invoke('ai-terminal:get-terminal-output', sessionId),
    getRawTerminalOutput: (sessionId: string) =>
      ipcRenderer.invoke('ai-terminal:get-raw-terminal-output', sessionId),

    // PTY events (shared channel with ai-workbench)
    onPtyData: (callback: (data: { sessionId: string; data: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('pty:data', handler)
      return () => ipcRenderer.removeListener('pty:data', handler)
    },
    onPtyExit: (callback: (data: { sessionId: string; exitCode: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('pty:exit', handler)
      return () => ipcRenderer.removeListener('pty:exit', handler)
    },
    onTerminalExit: (callback: (data: { sessionId: string; exitCode: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('ai-terminal:exit', handler)
      return () => ipcRenderer.removeListener('ai-terminal:exit', handler)
    },

    // Quick commands
    getQuickCommands: () => ipcRenderer.invoke('ai-terminal:get-quick-commands'),
    saveQuickCommand: (data: Record<string, unknown>) =>
      ipcRenderer.invoke('ai-terminal:save-quick-command', data),
    deleteQuickCommand: (id: string) =>
      ipcRenderer.invoke('ai-terminal:delete-quick-command', id),
    executeQuickCommand: (sessionId: string, commands: string) =>
      ipcRenderer.invoke('ai-terminal:execute-quick-command', sessionId, commands),

    // AI execution
    aiExecuteCommand: (sessionId: string, command: string) =>
      ipcRenderer.invoke('ai-terminal:ai-execute-command', sessionId, command),

    // ── DB Mode ──
    getDBConnections: () => ipcRenderer.invoke('ai-terminal:get-db-connections'),
    createDBConnection: (data: Record<string, unknown>) =>
      ipcRenderer.invoke('ai-terminal:create-db-connection', data),
    updateDBConnection: (id: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('ai-terminal:update-db-connection', id, updates),
    deleteDBConnection: (id: string) =>
      ipcRenderer.invoke('ai-terminal:delete-db-connection', id),
    testDBConnection: (config: Record<string, unknown>) =>
      ipcRenderer.invoke('ai-terminal:test-db-connection', config),
    connectDB: (id: string) =>
      ipcRenderer.invoke('ai-terminal:connect-db', id),
    disconnectDB: (id: string) =>
      ipcRenderer.invoke('ai-terminal:disconnect-db', id),
    isDBConnected: (id: string) =>
      ipcRenderer.invoke('ai-terminal:is-db-connected', id),
    getDBTables: (id: string) =>
      ipcRenderer.invoke('ai-terminal:get-db-tables', id),
    getDBDatabases: (id: string) =>
      ipcRenderer.invoke('ai-terminal:get-db-databases', id),
    useDBDatabase: (id: string, database: string) =>
      ipcRenderer.invoke('ai-terminal:use-db-database', id, database),
    getDBTableSchema: (id: string, tableName: string) =>
      ipcRenderer.invoke('ai-terminal:get-db-table-schema', id, tableName),
    queryDB: (id: string, sql: string) =>
      ipcRenderer.invoke('ai-terminal:query-db', id, sql),
    executeDB: (id: string, sql: string) =>
      ipcRenderer.invoke('ai-terminal:execute-db', id, sql),
    updateDBTableData: (id: string, tableName: string, changes: any[]) =>
      ipcRenderer.invoke('ai-terminal:update-db-table-data', id, tableName, changes),
    queryMongoCollection: (id: string, collection: string, filter: any, projection: any, limit: number) =>
      ipcRenderer.invoke('ai-terminal:query-mongo-collection', id, collection, filter, projection, limit),
    updateMongoDocument: (id: string, collection: string, filter: any, update: any) =>
      ipcRenderer.invoke('ai-terminal:update-mongo-document', id, collection, filter, update),
    insertMongoDocument: (id: string, collection: string, doc: any) =>
      ipcRenderer.invoke('ai-terminal:insert-mongo-document', id, collection, doc),
    deleteMongoDocuments: (id: string, collection: string, filter: any) =>
      ipcRenderer.invoke('ai-terminal:delete-mongo-documents', id, collection, filter),
    addDBColumn: (id: string, tableName: string, columnName: string, columnType: string, nullable: boolean, defaultValue?: string) =>
      ipcRenderer.invoke('ai-terminal:add-db-column', id, tableName, columnName, columnType, nullable, defaultValue),
    dropDBColumn: (id: string, tableName: string, columnName: string) =>
      ipcRenderer.invoke('ai-terminal:drop-db-column', id, tableName, columnName),
    renameDBColumn: (id: string, tableName: string, oldName: string, newName: string) =>
      ipcRenderer.invoke('ai-terminal:rename-db-column', id, tableName, oldName, newName)
  },

  internalTools: {
    list: () => ipcRenderer.invoke('internal-tools:list') as Promise<Array<{ name: string; description: string; inputSchema: Record<string, any> }>>,
    execute: (toolName: string, input: Record<string, any>) => ipcRenderer.invoke('internal-tools:execute', toolName, input) as Promise<{ content: string; isError: boolean }>,
  },

  feishuTools: {
    list: () => ipcRenderer.invoke('feishu-tools:list') as Promise<Array<{ name: string; description: string; inputSchema: Record<string, any> }>>,
    execute: (toolName: string, input: Record<string, any>) => ipcRenderer.invoke('feishu-tools:execute', toolName, input) as Promise<{ content: string; isError: boolean }>,
    checkAvailability: () => ipcRenderer.invoke('feishu-tools:check-availability') as Promise<{ available: boolean; reason: string; mode: string }>,
  },

  agent: {
    readMemory: (filename: string) => ipcRenderer.invoke('agent:read-memory', filename) as Promise<string>,
    writeMemory: (filename: string, content: string) => ipcRenderer.invoke('agent:write-memory', filename, content) as Promise<void>,
    readAllMemories: () => ipcRenderer.invoke('agent:read-all-memories') as Promise<Record<string, string>>,
    readStats: () => ipcRenderer.invoke('agent:read-stats'),
    statsSnippet: () => ipcRenderer.invoke('agent:stats-snippet') as Promise<string>,
    processFeedback: (data: { messageId: string; type: 'up' | 'down'; reason?: string; snippet: string }) =>
      ipcRenderer.invoke('agent:process-feedback', data),
    restoreSoulDefault: () => ipcRenderer.invoke('agent:restore-soul-default') as Promise<void>,
    getMemoryDir: () => ipcRenderer.invoke('agent:get-memory-dir') as Promise<string>,
  },

  scheduledTask: {
    list: () => ipcRenderer.invoke('scheduled-task:list'),
    get: (id: string) => ipcRenderer.invoke('scheduled-task:get', id),
    create: (data: Record<string, unknown>) => ipcRenderer.invoke('scheduled-task:create', data),
    update: (id: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('scheduled-task:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('scheduled-task:delete', id),
    setEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('scheduled-task:set-enabled', id, enabled),
    runNow: (id: string) => ipcRenderer.invoke('scheduled-task:run-now', id),
    getImStatus: () => ipcRenderer.invoke('scheduled-task:im-status') as Promise<{ connected: boolean }>,
    onExecuted: (callback: (data: { taskId: string; taskName: string; status: string; result: string; prompt: string; keepInOneChat: boolean; conversationId?: string; timestamp: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('scheduled-task:executed', handler)
      return () => ipcRenderer.removeListener('scheduled-task:executed', handler)
    }
  },

  windowControl: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>
  },

  system: {
    onLog: (callback: (data: { level: string; message: string; timestamp: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('system:log', handler)
      return () => ipcRenderer.removeListener('system:log', handler)
    }
  },

  platform: process.platform
}
