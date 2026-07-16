export type ToolId =
  | 'python' | 'nodejs' | 'go' | 'java' | 'docker'
  | 'mysql' | 'postgresql' | 'mongodb' | 'redis'
  | 'git' | 'svn' | 'perforce'
  | 'claude-code' | 'codex-cli' | 'gemini-cli' | 'grok-cli'
  | 'opencode' | 'traecli' | 'qoder-cli'
  | 'kimi-code' | 'zcode' | 'mimo-code'
  | 'homebrew'

/** AI Coding CLI tools shown in Local Env — display order */
export const AI_CODING_TOOL_IDS: ToolId[] = [
  'claude-code',
  'codex-cli',
  'gemini-cli',
  'grok-cli',
  'opencode',
  'traecli',
  'qoder-cli',
  'kimi-code',
  'zcode',
  'mimo-code'
]

export const AI_CODING_TOOL_ID_SET = new Set<string>(AI_CODING_TOOL_IDS)

/**
 * Default ON when the user has not toggled the switch yet.
 * Matches main-process `DEFAULT_ENABLED_CODING_TOOL_IDS` in settings.store.ts.
 */
export const DEFAULT_ENABLED_CODING_TOOL_IDS = new Set<string>(['claude-code', 'codex-cli'])

/** Resolve enablement from a stored map (missing key → default) */
export function isCodingToolEnabledInMap(map: Record<string, boolean>, toolId: string): boolean {
  if (Object.prototype.hasOwnProperty.call(map, toolId)) {
    return map[toolId] === true
  }
  return DEFAULT_ENABLED_CODING_TOOL_IDS.has(toolId)
}

/** Map Local Env toolId → AI Coding toolType */
export const TOOL_ID_TO_AI_TYPE: Record<string, string> = {
  'claude-code': 'claude',
  'codex-cli': 'codex',
  'gemini-cli': 'gemini',
  'grok-cli': 'grok',
  opencode: 'opencode',
  traecli: 'trae',
  'qoder-cli': 'qoder',
  'kimi-code': 'kimi',
  zcode: 'zcode',
  'mimo-code': 'mimo'
}

export interface ToolInstallation {
  path: string
  version: string
  extras?: Record<string, string>
  managedBy?: string
}

export interface ToolDetectionResult {
  toolId: ToolId
  name: string
  installed: boolean
  installations: ToolInstallation[]
}

export interface PackageManagerInfo {
  brew: boolean
  winget: boolean
  xcodeSelect: boolean
}

export interface ToolInstallResult {
  success: boolean
  error?: string
  openedBrowser?: boolean
  /** Windows only: a post-install GUI setup wizard (e.g. MySQL Installer) was auto-launched */
  launchedSetup?: boolean
}

export interface LocalEnvDetectionResult {
  tools: ToolDetectionResult[]
  packageManagers: PackageManagerInfo
  platform: string
}

export interface PackageInfo {
  name: string
  version: string
}

export interface PackageListResult {
  success: boolean
  packages?: PackageInfo[]
  error?: string
}
