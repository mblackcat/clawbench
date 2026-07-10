export type ToolId =
  | 'python' | 'nodejs' | 'go' | 'java' | 'docker'
  | 'mysql' | 'postgresql' | 'mongodb' | 'redis'
  | 'git' | 'svn' | 'perforce'
  | 'claude-code' | 'gemini-cli' | 'codex-cli' | 'opencode' | 'traecli' | 'qwen-code' | 'qoder-cli'
  | 'homebrew'

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
