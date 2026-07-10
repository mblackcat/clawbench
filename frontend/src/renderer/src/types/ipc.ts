// Type the window.api object exposed by preload

export interface AIModelConfig {
  id: string
  name: string
  provider:
    | 'openai'
    | 'openai-compatible'
    | 'openai-responses'
    | 'azure-openai'
    | 'google'
    | 'anthropic'
    | 'anthropic-compatible'
    | 'qwen'
    | 'doubao'
    | 'deepseek'
    | 'kimi'
  endpoint: string
  apiKey: string
  models: string[]
  enabled: boolean
  apiVersion?: string
  capabilities?: ('image-gen' | 'tool-use' | 'vision')[]
}

export interface ImageGenConfig {
  id: string
  name: string
  provider: 'dall-e' | 'stable-diffusion' | 'custom'
  endpoint: string
  apiKey: string
  defaultModel?: string
  defaultSize?: string
  enabled: boolean
}

export interface AiToolsConfig {
  webSearch: { provider: 'duckduckgo' | 'brave'; braveApiKey: string }
  webBrowse: { engine: 'http' | 'lightpanda'; lightpandaPath: string }
  feishuKits: { enabled: boolean; cliPath: string }
  toolBehavior: { maxToolSteps: number; maxSearchRounds: number; toolTimeoutMs: number; enableThinking?: boolean }
}

type VcsType = 'git' | 'svn' | 'none'

interface VcsChangedFile {
  path: string
  status: string
  staged: boolean
  additions: number
  deletions: number
}

interface VcsExecResult {
  success: boolean
  output?: string
  error?: string
}

export interface ClawBenchAPI {
  workspace: {
    list: () => Promise<import('./workspace').Workspace[]>
    create: (name: string, path: string, vcsType?: string) => Promise<import('./workspace').Workspace>
    update: (id: string, updates: Partial<import('./workspace').Workspace>) => Promise<void>
    delete: (id: string) => Promise<void>
    setActive: (id: string) => Promise<void>
    getActive: () => Promise<import('./workspace').Workspace | null>
  }
  subapp: {
    list: () => Promise<Array<{
      id: string
      manifest: import('./subapp').SubAppManifest
      path: string
      source: 'user'
    }>>
    getManifest: (appId: string) => Promise<import('./subapp').SubAppManifest>
    resolveSlot: (
      appId: string,
      slot: string,
      params?: Record<string, unknown>
    ) => Promise<unknown>
    execute: (
      appId: string,
      params?: Record<string, unknown>
    ) => Promise<string> // returns taskId
    cancel: (taskId: string) => Promise<void>
    sendUiEvent: (taskId: string, uiEvent: Record<string, unknown>) => Promise<boolean>
    uninstall: (appId: string) => Promise<{ success: boolean; error?: string }>
    installFromMarket: (appId: string, downloadUrl: string, token?: string) => Promise<{
      success: boolean
      manifest?: Record<string, any>
    }>
    updateFromMarket: (appId: string, downloadUrl: string, token?: string) => Promise<{
      success: boolean
      manifest?: Record<string, any>
    }>
    installSkillFromMarket: (
      appId: string,
      downloadUrl: string,
      opts: {
        mode: import('./skill').SkillInstallMode
        tools: import('./skill').SkillTool[]
        workspacePath?: string
      },
      token?: string
    ) => Promise<{ success: boolean; installedTo: string[]; error?: string }>
    onOutput: (callback: (data: import('./subapp').SubAppOutput) => void) => () => void
    onProgress: (callback: (data: import('./subapp').SubAppOutput) => void) => () => void
    onTaskStatus: (
      callback: (data: {
        taskId: string
        status: string
        success?: boolean
        summary?: string
        summaryI18nKey?: string
        summaryI18nArgs?: string[]
      }) => void
    ) => () => void
    onTaskStarted: (
      callback: (data: { taskId: string; appId: string; appName: string }) => void
    ) => () => void
    onUi: (callback: (data: any) => void) => () => void
  }
  auth: {
    getStatus: () => Promise<import('./auth').AuthStatus & { token?: string }>
    startLogin: () => Promise<import('./auth').AuthStatus & { token?: string }>
    logout: () => Promise<void>
    onStatusChanged: (
      callback: (status: import('./auth').AuthStatus) => void
    ) => () => void
  }
  developer: {
    createApp: (appInfo: Record<string, unknown>) => Promise<string> // returns path
    updateApp: (appId: string, updates: Record<string, unknown>) => Promise<void>
    deleteApp: (appId: string) => Promise<void>
    publishApp: (appId: string) => Promise<{
      success: boolean
      appId: string
      appPath: string
      manifest: Record<string, any>
      error?: string
    }>
    packageApp: (appId: string) => Promise<{
      buffer: ArrayBuffer
      fileName: string
      fileSize: number
    }>
    packageDir: (sourceDir: string) => Promise<{
      buffer: ArrayBuffer
      fileName: string
      fileSize: number
      manifest: Record<string, any>
    }>
    listMyApps: () => Promise<import('./subapp').SubAppManifest[]>
    getAppPath: (appId: string) => Promise<string>
    listAppFiles: (appId: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean }>>
    readFile: (filePath: string) => Promise<string>
    writeFile: (filePath: string, content: string) => Promise<void>
    createFile: (filePath: string) => Promise<void>
    createFolder: (folderPath: string) => Promise<void>
    renameFile: (oldPath: string, newPath: string) => Promise<void>
    deleteFile: (filePath: string) => Promise<void>
    moveFile: (oldPath: string, newPath: string) => Promise<void>
    detectIde: () => Promise<string | null>
    detectTerminal: () => Promise<string | null>
    openInIde: (appPath: string) => Promise<void>
    openFileInEditor: (filePath: string) => Promise<void>
    openSSHConfig: () => Promise<void>
    openAppDirectory: (appPath: string) => Promise<void>

    // Path-based operations (relaxed guard — for workspace skill directories)
    listDir: (dirPath: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean }>>
    readPathFile: (filePath: string) => Promise<string>
    writePathFile: (filePath: string, content: string) => Promise<void>
    createPathFile: (filePath: string) => Promise<void>
    createPathDir: (dirPath: string) => Promise<void>
    renamePath: (oldPath: string, newPath: string) => Promise<void>
    deletePath: (filePath: string) => Promise<void>
    movePath: (oldPath: string, newPath: string) => Promise<void>
  }
  git: {
    listBranches: (workspacePath: string) => Promise<{
      current: string
      local: string[]
      remote: string[]
    }>
    checkout: (workspacePath: string, branchName: string) => Promise<{
      success: boolean
      error?: string
    }>
    diffStat: (workspacePath: string) => Promise<{
      additions: number
      deletions: number
    }>
    changedFiles: (workspacePath: string) => Promise<Array<{
      path: string
      status: string
      staged: boolean
      additions: number
      deletions: number
    }>>
    commit: (workspacePath: string, message: string) => Promise<{
      success: boolean
      output?: string
      error?: string
    }>
    push: (workspacePath: string) => Promise<{
      success: boolean
      output?: string
      error?: string
    }>
    pull: (workspacePath: string) => Promise<{
      success: boolean
      output?: string
      error?: string
    }>
    discardFile: (workspacePath: string, filePath: string, isUntracked: boolean) => Promise<{
      success: boolean
      output?: string
      error?: string
    }>
  }
  vcs: {
    detect: (workspacePath: string) => Promise<VcsType>
    diffStat: (workspacePath: string) => Promise<{
      type: VcsType
      additions: number
      deletions: number
    }>
    changedFiles: (workspacePath: string) => Promise<{
      type: VcsType
      files: VcsChangedFile[]
    }>
    commit: (workspacePath: string, message: string) => Promise<VcsExecResult>
    push: (workspacePath: string) => Promise<VcsExecResult>
    pull: (workspacePath: string) => Promise<VcsExecResult>
    discardFile: (workspacePath: string, filePath: string, isUntracked: boolean) => Promise<VcsExecResult>
  }
  settings: {
    get: () => Promise<Record<string, unknown>>
    set: (key: string, value: unknown) => Promise<void>
    validatePython: (pythonPath: string) => Promise<{ valid: boolean; version: string }>
    detectPython: () => Promise<string | null>
    getEnvConfig: () => Promise<{ enableAccountLogin: boolean; enableLocalMode: boolean }>
    getAiModels: () => Promise<AIModelConfig[]>
    saveAiModel: (config: Partial<AIModelConfig>) => Promise<AIModelConfig>
    deleteAiModel: (id: string) => Promise<boolean>
    testAiModel: (config: {
      provider: string
      endpoint: string
      apiKey: string
      configId?: string
    }) => Promise<{ success: boolean; message: string }>
    getImageGenConfigs: () => Promise<ImageGenConfig[]>
    saveImageGenConfig: (config: Partial<ImageGenConfig>) => Promise<ImageGenConfig>
    deleteImageGenConfig: (id: string) => Promise<boolean>
    setLastChatModel: (configId: string, modelId: string) => Promise<void>
    getLastChatModel: () => Promise<{ configId: string; modelId: string }>
    setLastBuiltinChatModel: (modelId: string) => Promise<void>
    getLastBuiltinChatModel: () => Promise<string>
    getLastChatModelSource: () => Promise<string>
    getChatPreferences: () => Promise<{ chatMode: string; toolsEnabled: boolean; webSearchEnabled: boolean; feishuKitsEnabled: boolean }>
    setChatPreferences: (prefs: { chatMode?: string; toolsEnabled?: boolean; webSearchEnabled?: boolean; feishuKitsEnabled?: boolean }) => Promise<void>
    detectFeishuCli: () => Promise<{ found: boolean; path: string }>
    installFeishuCli: () => Promise<{ success: boolean; error: string; path: string }>
    writeFeishuCliConfig: () => Promise<{ success: boolean; error: string; path?: string }>
    checkFeishuCliConfig: () => Promise<{ exists: boolean; hasCredentials: boolean }>
    onFeishuCliInstallProgress: (callback: (data: { percent: number; downloadedMB: string; totalMB: string; stage: string }) => void) => () => void
    getAiToolsConfig: () => Promise<AiToolsConfig>
    setAiToolsConfig: (config: AiToolsConfig) => Promise<void>
    testBraveApiKey: (apiKey: string) => Promise<{ success: boolean; message: string }>
    detectLightpanda: () => Promise<{ found: boolean; path: string }>
    installLightpanda: () => Promise<{ success: boolean; error: string; path: string }>
    onLightpandaInstallProgress: (callback: (data: { percent: number; downloadedMB: string; totalMB: string; stage: string }) => void) => () => void
    getAgentSettings: () => Promise<{ customSystemPrompt: string; defaultToolApprovalMode: string; maxAgentToolSteps: number }>
    setAgentSettings: (settings: { customSystemPrompt?: string; defaultToolApprovalMode?: string; maxAgentToolSteps?: number }) => Promise<void>
  }
  ai: {
    streamChat: (
      modelConfigId: string,
      messages: Array<{ role: string; content: string; toolCallId?: string; toolCalls?: any[] }>,
      modelId?: string,
      attachments?: Array<{ filePath: string; mimeType: string; fileName: string }>,
      tools?: Array<{ name: string; description: string; inputSchema: Record<string, any> }>,
      enableThinking?: boolean,
      webSearchEnabled?: boolean
    ) => Promise<string>
    cancelChat: (taskId: string) => Promise<boolean>
    submitToolResult: (taskId: string, toolCallId: string, result: string, isError: boolean) => Promise<void>
    generateTitle: (
      modelConfigId: string,
      messages: Array<{ role: string; content: string }>,
      modelId?: string
    ) => Promise<string>
    onChatDelta: (callback: (data: { taskId: string; content: string }) => void) => () => void
    onChatDone: (callback: (data: { taskId: string; usage: any }) => void) => () => void
    onChatError: (callback: (data: { taskId: string; error: string }) => void) => () => void
    onChatToolUse: (callback: (data: { taskId: string; toolCallId: string; toolName: string; input: Record<string, any> }) => void) => () => void
    onChatThinkingDelta: (callback: (data: { taskId: string; content: string }) => void) => () => void
    onChatSearchGrounding: (callback: (data: { taskId: string; queries: string[]; sources: Array<{ title: string; url: string }> }) => void) => () => void
  }
  mcp: {
    getServers: () => Promise<any[]>
    saveServer: (config: Record<string, unknown>) => Promise<{ success: boolean }>
    deleteServer: (id: string) => Promise<{ success: boolean }>
    connect: (id: string) => Promise<{ tools: any[] }>
    disconnect: (id: string) => Promise<{ success: boolean }>
    listTools: () => Promise<any[]>
    callTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<{ content: string; isError: boolean }>
    callToolWithAttachments: (
      serverId: string,
      toolName: string,
      args: Record<string, unknown>,
      attachmentPaths: string[]
    ) => Promise<{ content: string; isError: boolean }>
    getStatus: () => Promise<Array<{ id: string; name: string; connected: boolean; toolCount: number }>>
    connectAllEnabled: () => Promise<Array<{ id: string; success: boolean; error?: string }>>
  }
  feishuTools: {
    list: () => Promise<Array<{ name: string; description: string; inputSchema: Record<string, any> }>>
    execute: (toolName: string, input: Record<string, any>) => Promise<{ content: string; isError: boolean }>
    checkAvailability: () => Promise<{ available: boolean; reason: string; mode: string }>
  }
  dialog: {
    selectDirectory: () => Promise<string | null>
    selectApp: () => Promise<string | null>
    selectFiles: () => Promise<string[]>
    saveImage: (base64Data: string) => Promise<boolean>
  }
  updater: {
    check: () => Promise<{ success: boolean; error?: string }>
    install: () => void
    onChecking: (callback: () => void) => () => void
    onAvailable: (callback: (data: { version: string; releaseDate: string }) => void) => () => void
    onNotAvailable: (callback: () => void) => () => void
    onProgress: (callback: (data: { percent: number }) => void) => () => void
    onDownloaded: (callback: (data: { version: string }) => void) => () => void
    onError: (callback: (data: { message: string }) => void) => () => void
  }
  notification: {
    onPush: (
      callback: (data: {
        id: string
        type: string
        title: string
        body: string
        timestamp: number
      }) => void
    ) => () => void
  }
  localEnv: {
    detectAll: () => Promise<import('./local-env').LocalEnvDetectionResult>
    detectOne: (toolId: string) => Promise<import('./local-env').ToolDetectionResult>
    install: (toolId: string) => Promise<import('./local-env').ToolInstallResult>
    uninstall: (toolId: string) => Promise<import('./local-env').ToolInstallResult>
    upgrade: (toolId: string) => Promise<import('./local-env').ToolInstallResult>
    checkLatestVersions: (toolIds: string[]) => Promise<Record<string, string | null>>
    listPipPackages: (pythonPath?: string) => Promise<import('./local-env').PackageListResult>
    uninstallPipPackage: (
      packageName: string,
      pythonPath?: string
    ) => Promise<import('./local-env').ToolInstallResult>
    listNpmPackages: () => Promise<import('./local-env').PackageListResult>
    uninstallNpmPackage: (packageName: string) => Promise<import('./local-env').ToolInstallResult>
  }
  openclaw: {
    checkInstalled: () => Promise<import('./openclaw').OpenClawInstallCheck>
    install: () => Promise<{ success: boolean; error?: string }>
    uninstall: (removeConfig: boolean) => Promise<{ success: boolean; error?: string }>
    getStatus: () => Promise<import('./openclaw').OpenClawServiceStatus>
    start: () => Promise<{ success: boolean; error?: string }>
    stop: () => Promise<{ success: boolean; error?: string }>
    getConfig: () => Promise<import('./openclaw').OpenClawConfig>
    saveConfig: (config: Partial<import('./openclaw').OpenClawConfig>) => Promise<void>
    applyConfig: (config: Partial<import('./openclaw').OpenClawConfig>) => Promise<{ success: boolean; error?: string }>
    listCommunitySkills: () => Promise<import('./openclaw').CommunitySkill[]>
    installSkill: (id: string) => Promise<{ success: boolean; output: string }>
    getCronJobs: () => Promise<import('./openclaw').CronJob[]>
    toggleCronJob: (id: string, enabled: boolean) => Promise<void>
    checkLatestVersion: () => Promise<{ latestVersion: string | null }>
    pairingApprove: (channel: string, code: string) => Promise<{ success: boolean; error?: string }>
    getGatewayUrl: () => Promise<{ url: string | null }>
    startGoogleOAuth: () => Promise<{ success: boolean; url?: string; error?: string }>
    startLogWatcher: () => Promise<void>
    stopLogWatcher: () => Promise<void>
    onActivityState: (callback: (state: string) => void) => () => void
    onActiveSubagents: (callback: (subagents: Array<{ id: string; label: string; model?: string }>) => void) => () => void
  }
  hermes: {
    checkInstalled: () => Promise<{ installed: boolean; version?: string }>
    install: () => Promise<{ success: boolean; error?: string }>
    uninstall: () => Promise<{ success: boolean; error?: string }>
    getStatus: () => Promise<'running' | 'stopped' | 'unknown'>
    start: () => Promise<{ success: boolean; error?: string }>
    stop: () => Promise<{ success: boolean; error?: string }>
    getConfig: () => Promise<import('./hermes').HermesConfig>
    saveConfig: (config: import('./hermes').HermesConfig) => Promise<{ success: boolean; error?: string }>
    upgrade: () => Promise<{ success: boolean; error?: string }>
    onInstallProgress: (callback: (line: string) => void) => () => void
    getCronJobs: () => Promise<string[]>
    getDashboardUrl: () => Promise<string | null>
  }
  copiper: {
    listDatabases: (workspacePath: string) => Promise<import('./copiper').JDBFileInfo[]>
    loadDatabase: (filePath: string) => Promise<import('./copiper').JDBDatabase>
    saveDatabase: (filePath: string, data: import('./copiper').JDBDatabase) => Promise<void>
    createDatabase: (filePath: string, tableName: string) => Promise<void>
    deleteDatabase: (filePath: string) => Promise<void>
    addTable: (filePath: string, tableName: string) => Promise<import('./copiper').JDBDatabase>
    removeTable: (filePath: string, tableName: string) => Promise<import('./copiper').JDBDatabase>
    renameTable: (filePath: string, oldName: string, newName: string) => Promise<import('./copiper').JDBDatabase>
    addColumn: (
      filePath: string,
      tableName: string,
      column: import('./copiper').ColDef
    ) => Promise<import('./copiper').JDBDatabase>
    updateColumn: (
      filePath: string,
      tableName: string,
      columnId: string,
      updates: Partial<import('./copiper').ColDef>
    ) => Promise<import('./copiper').JDBDatabase>
    removeColumn: (
      filePath: string,
      tableName: string,
      columnId: string
    ) => Promise<import('./copiper').JDBDatabase>
    addRow: (
      filePath: string,
      tableName: string,
      row: import('./copiper').RowData
    ) => Promise<import('./copiper').JDBDatabase>
    updateRow: (
      filePath: string,
      tableName: string,
      rowIndex: number,
      updates: Partial<import('./copiper').RowData>
    ) => Promise<import('./copiper').JDBDatabase>
    deleteRows: (
      filePath: string,
      tableName: string,
      rowIndices: number[]
    ) => Promise<import('./copiper').JDBDatabase>
    validateTable: (
      filePath: string,
      tableName: string,
      allTables?: import('./copiper').JDBDatabase
    ) => Promise<import('./copiper').ValidationIssue[]>
    exportTable: (
      filePath: string,
      tableName: string,
      config: import('./copiper').ExportConfig,
      workspacePath: string,
      allTables?: import('./copiper').JDBDatabase
    ) => Promise<import('./copiper').ExportResult[]>
    exportAll: (
      filePath: string,
      config: import('./copiper').ExportConfig,
      workspacePath: string
    ) => Promise<import('./copiper').ExportResult[]>
    getTableInfos: (workspacePath: string) => Promise<import('./copiper').TableInfo[]>
    saveTableInfos: (workspacePath: string, infos: import('./copiper').TableInfo[]) => Promise<void>
    getSettings: () => Promise<import('./copiper').CopiperSettings>
    saveSettings: (settings: Partial<import('./copiper').CopiperSettings>) => Promise<void>
    loadReferenceData: (
      workspacePath: string,
      tableNames: string[]
    ) => Promise<Record<string, Array<{ id: number | string; idx_name?: string }>>>
  }
  aiCoding: {
    getWorkspaces: () => Promise<import('./ai-coding').AICodingWorkspace[]>
    createWorkspace: (
      workingDir: string,
      groupId: string
    ) => Promise<import('./ai-coding').AICodingWorkspace>
    updateWorkspace: (
      id: string,
      updates: Partial<import('./ai-coding').AICodingWorkspace>
    ) => Promise<import('./ai-coding').AICodingWorkspace | null>
    deleteWorkspace: (id: string) => Promise<void>
    getWorkspaceSessions: (workspaceId: string) => Promise<import('./ai-coding').AICodingSession[]>
    getSessions: () => Promise<import('./ai-coding').AICodingSession[]>
    createSession: (
      workspaceId: string,
      toolType: string,
      source?: string
    ) => Promise<import('./ai-coding').AICodingSession>
    updateSession: (
      id: string,
      updates: Partial<import('./ai-coding').AICodingSession>
    ) => Promise<import('./ai-coding').AICodingSession | null>
    deleteSession: (id: string) => Promise<void>
    stopSession: (id: string) => Promise<import('./ai-coding').AICodingSession | null>
    launchSession: (id: string, opts?: { forcePty?: boolean; cols?: number; rows?: number; effort?: string }) => Promise<{ success: boolean; error?: string }>
    writeToSession: (sessionId: string, text: string, images?: { data: string; mediaType: string }[]) => Promise<{ success: boolean; error?: string }>
    readFileBase64: (filePath: string) => Promise<{ data: string; mediaType: string } | null>
    interruptSession: (sessionId: string) => Promise<{ success: boolean }>
    executeSlashCommand: (sessionId: string, command: string) => Promise<{ success: boolean; error?: string }>
    setPermissionMode: (sessionId: string, mode: string) => Promise<{ success: boolean; error?: string }>
    resolvePermission: (
      sessionId: string,
      requestId: string,
      decision: { behavior: 'allow' | 'deny'; message?: string; updatedInput?: Record<string, unknown> }
    ) => Promise<{ success: boolean; error?: string }>
    answerQuestion: (
      sessionId: string,
      questionId: string,
      answers: Record<string, string>
    ) => Promise<{ success: boolean; error?: string }>
    setEffort: (sessionId: string, effort: string) => Promise<{ success: boolean; error?: string }>
    onPipeEvent: (callback: (data: { sessionId: string; event: any }) => void) => () => void
    createPty: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    writePty: (sessionId: string, data: string) => Promise<void>
    resizePty: (sessionId: string, cols: number, rows: number) => Promise<void>
    killPty: (sessionId: string) => Promise<void>
    onPtyData: (callback: (data: { sessionId: string; data: string }) => void) => () => void
    onPtyExit: (callback: (data: { sessionId: string; exitCode: number }) => void) => () => void
    detectTools: () => Promise<any[]>
    listNativeSessions: (workingDir: string, toolType: string) => Promise<Array<{
      sessionId: string
      title: string
      modifiedAt: number
      sizeBytes?: number
    }>>
    loadNativeSessionTranscript: (workingDir: string, toolType: string, sessionId: string) => Promise<Array<{
      role: 'user' | 'assistant' | 'system'
      blocks: import('./ai-coding').CodingContentBlock[]
      timestamp: number
    }>>
    getSessionOutput: (sessionId: string) => Promise<string>
    getRawSessionOutput: (sessionId: string) => Promise<string>
    getGroups: () => Promise<import('./ai-coding').AICodingGroup[]>
    createGroup: (name: string) => Promise<import('./ai-coding').AICodingGroup>
    renameGroup: (
      id: string,
      name: string
    ) => Promise<import('./ai-coding').AICodingGroup | null>
    deleteGroup: (id: string) => Promise<{ success: boolean; error?: string }>
    getIMConfig: () => Promise<import('./ai-coding').AICodingIMConfig>
    saveIMConfig: (config: import('./ai-coding').AICodingIMConfig) => Promise<void>
    openDirectory: (dirPath: string) => Promise<string>
    openTerminal: (dirPath: string, toolCommand?: string) => Promise<{ success: boolean }>
    imConnect: () => Promise<{ success: boolean }>
    imDisconnect: () => Promise<{ success: boolean }>
    imGetStatus: () => Promise<import('./ai-coding').AICodingIMConnectionStatus>
    imTest: () => Promise<{ success: boolean; error?: string }>
    onIMStatusChanged: (
      callback: (status: import('./ai-coding').AICodingIMConnectionStatus) => void
    ) => () => void
    onDataChanged: (callback: () => void) => () => void
  }
  skill: {
    detectWorkspaceType: (workspacePath: string) => Promise<{
      success: boolean
      types: Array<'claude' | 'codex' | 'gemini'>
      error?: string
    }>
    activate: (skillId: string, workspacePath: string, targetType?: string) => Promise<{
      success: boolean
      deployedTo: string[]
      error?: string
    }>
    deactivate: (skillId: string, workspacePath: string) => Promise<{
      success: boolean
      removedFrom: string[]
      error?: string
    }>
    install: (opts: {
      sourceDir: string
      mode: import('./skill').SkillInstallMode
      tools: import('./skill').SkillTool[]
      workspacePath?: string
      skillId?: string
    }) => Promise<{ success: boolean; installedTo: string[]; error?: string }>
    uninstall: (
      skillName: string,
      tools: import('./skill').SkillTool[],
      scope: 'project' | 'global',
      workspacePath?: string
    ) => Promise<{ success: boolean; removedFrom: string[]; error?: string }>
    scanGlobal: (
      tools?: import('./skill').SkillTool[]
    ) => Promise<{ success: boolean; skills: import('./skill').ScannedSkill[]; error?: string }>
    scanProject: (
      workspacePath: string,
      tools?: import('./skill').SkillTool[]
    ) => Promise<{ success: boolean; skills: import('./skill').ScannedSkill[]; error?: string }>
    loadLocal: (inputPath: string) => Promise<{
      success: boolean
      source?: import('./skill').SkillSource
      meta?: import('./skill').SkillMeta
      error?: string
    }>
    listLocalSources: () => Promise<{
      success: boolean
      sources: import('./skill').SkillSource[]
      error?: string
    }>
    removeLocalSource: (id: string) => Promise<{ success: boolean; error?: string }>
  }
  link: {
    fetchFavicon: (url: string) => Promise<string | null>
  }
  aiTerminal: {
    getConnections: () => Promise<import('./ai-terminal').TerminalConnection[]>
    createConnection: (
      data: Omit<import('./ai-terminal').TerminalConnection, 'id' | 'createdAt' | 'updatedAt'>
    ) => Promise<import('./ai-terminal').TerminalConnection>
    updateConnection: (
      id: string,
      updates: Partial<import('./ai-terminal').TerminalConnection>
    ) => Promise<import('./ai-terminal').TerminalConnection | null>
    deleteConnection: (id: string) => Promise<boolean>
    syncSSHConfig: () => Promise<import('./ai-terminal').TerminalConnection[]>
    openTerminal: (connectionId: string, sessionId: string) => Promise<{ success: boolean; error?: string }>
    closeTerminal: (sessionId: string) => Promise<void>
    writeTerminal: (sessionId: string, data: string) => Promise<void>
    resizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<void>
    getTerminalOutput: (sessionId: string) => Promise<string>
    getRawTerminalOutput: (sessionId: string) => Promise<string>
    onPtyData: (callback: (data: { sessionId: string; data: string }) => void) => () => void
    onPtyExit: (callback: (data: { sessionId: string; exitCode: number }) => void) => () => void
    onTerminalExit: (callback: (data: { sessionId: string; exitCode: number }) => void) => () => void
    getQuickCommands: () => Promise<import('./ai-terminal').QuickCommand[]>
    saveQuickCommand: (data: Partial<import('./ai-terminal').QuickCommand>) => Promise<import('./ai-terminal').QuickCommand>
    deleteQuickCommand: (id: string) => Promise<boolean>
    executeQuickCommand: (sessionId: string, commands: string) => Promise<void>
    aiExecuteCommand: (sessionId: string, command: string) => Promise<{ success: boolean; output?: string; error?: string }>
    // ── DB Mode ──
    getDBConnections: () => Promise<import('./ai-terminal').DBConnection[]>
    createDBConnection: (
      data: Omit<import('./ai-terminal').DBConnection, 'id' | 'createdAt' | 'updatedAt'>
    ) => Promise<import('./ai-terminal').DBConnection>
    updateDBConnection: (
      id: string,
      updates: Partial<import('./ai-terminal').DBConnection>
    ) => Promise<import('./ai-terminal').DBConnection | null>
    deleteDBConnection: (id: string) => Promise<boolean>
    testDBConnection: (
      config: Omit<import('./ai-terminal').DBConnection, 'id' | 'createdAt' | 'updatedAt'>
    ) => Promise<{ success: boolean; error?: string }>
    connectDB: (id: string) => Promise<{ success: boolean; error?: string }>
    disconnectDB: (id: string) => Promise<void>
    isDBConnected: (id: string) => Promise<boolean>
    getDBTables: (id: string) => Promise<string[]>
    getDBDatabases: (id: string) => Promise<string[]>
    useDBDatabase: (id: string, database: string) => Promise<void>
    getDBTableSchema: (id: string, tableName: string) => Promise<import('./ai-terminal').DBTableColumn[]>
    queryDB: (id: string, sql: string) => Promise<import('./ai-terminal').DBQueryResult>
    executeDB: (id: string, sql: string) => Promise<{ affectedRows: number; executionTimeMs: number }>
    updateDBTableData: (
      id: string,
      tableName: string,
      changes: Array<{ row: Record<string, any>; column: string; oldValue: any; newValue: any; primaryKeys: Record<string, any> }>
    ) => Promise<{ affectedRows: number }>
    queryMongoCollection: (
      id: string,
      collection: string,
      filter: Record<string, any>,
      projection: Record<string, any>,
      limit: number
    ) => Promise<import('./ai-terminal').DBQueryResult>
    updateMongoDocument: (
      id: string,
      collection: string,
      filter: Record<string, any>,
      update: Record<string, any>
    ) => Promise<{ modifiedCount: number }>
    insertMongoDocument: (
      id: string,
      collection: string,
      doc: Record<string, any>
    ) => Promise<{ insertedId: string }>
    deleteMongoDocuments: (
      id: string,
      collection: string,
      filter: Record<string, any>
    ) => Promise<{ deletedCount: number }>
    addDBColumn: (id: string, tableName: string, columnName: string, columnType: string, nullable: boolean, defaultValue?: string) => Promise<void>
    dropDBColumn: (id: string, tableName: string, columnName: string) => Promise<void>
    renameDBColumn: (id: string, tableName: string, oldName: string, newName: string) => Promise<void>
  }
  credentials: {
    saveApiToken: (token: string) => Promise<void>
    clearApiToken: () => Promise<void>
  }
  internalTools: {
    list: () => Promise<Array<{ name: string; description: string; inputSchema: Record<string, any> }>>
    execute: (toolName: string, input: Record<string, any>) => Promise<{ content: string; isError: boolean }>
  }
  agent: {
    readMemory: (filename: string) => Promise<string>
    writeMemory: (filename: string, content: string) => Promise<void>
    readAllMemories: () => Promise<Record<string, string>>
    readStats: () => Promise<{
      totalFeedback: { up: number; down: number }
      byTopic: Record<string, { up: number; down: number }>
      recentTrend: { date: string; up: number; down: number }[]
      soulSuggestions: { suggestion: string; reason: string; feedbackCount: number }[]
    }>
    statsSnippet: () => Promise<string>
    processFeedback: (data: { messageId: string; type: 'up' | 'down'; reason?: string; snippet: string }) => Promise<{ ok: boolean }>
    restoreSoulDefault: () => Promise<void>
    getMemoryDir: () => Promise<string>
  }
  scheduledTask: {
    list: () => Promise<import('./scheduled-task').ScheduledTask[]>
    get: (id: string) => Promise<import('./scheduled-task').ScheduledTask | undefined>
    create: (data: Record<string, unknown>) => Promise<import('./scheduled-task').ScheduledTask>
    update: (id: string, updates: Record<string, unknown>) => Promise<import('./scheduled-task').ScheduledTask | undefined>
    delete: (id: string) => Promise<boolean>
    setEnabled: (id: string, enabled: boolean) => Promise<import('./scheduled-task').ScheduledTask | undefined>
    runNow: (id: string) => Promise<{ success: boolean; error?: string }>
    getImStatus: () => Promise<{ connected: boolean }>
    onExecuted: (
      callback: (data: {
        taskId: string
        taskName: string
        status: string
        result: string
        prompt: string
        keepInOneChat: boolean
        conversationId?: string
        timestamp: number
      }) => void
    ) => () => void
  }
  windowControl: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
  }
  system: {
    onLog: (callback: (data: { level: string; message: string; timestamp: number }) => void) => () => void
  }
  platform: string
}

declare global {
  interface Window {
    api: ClawBenchAPI
  }
}
