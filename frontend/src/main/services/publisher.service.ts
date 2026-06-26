import fs from 'fs'
import { join, basename } from 'path'
import { getUserAppsPath } from '../utils/paths'
import { zipDirectory, unzipArchive } from '../utils/zip'
import * as logger from '../utils/logger'

// SDK reference written to each generated app so external AI coding tools
// (Claude Code, Codex, Gemini CLI, etc.) can understand the SDK when opening
// the app directory in VSCode or any editor.
const SDK_REFERENCE_MD = `# ClawBench Python Sub-App SDK

A ClawBench sub-app is a Python program driven by the \`clawbench_sdk\` package.
The ClawBench desktop client spawns it, feeds it parameters + workspace info,
and renders its JSON-line output (and optional interactive dialogs) in the UI.

## Entry point

\`\`\`python
from clawbench_sdk import ClawBenchApp

class MyApp(ClawBenchApp):
    def run(self) -> None:
        # self.workspace.path      -> str: absolute path to the workspace root
        # self.workspace.vcs_type  -> str: "git" | "svn" | "perforce" | ""
        # self.workspace.name      -> str: workspace display name
        # self.params              -> dict: parameter values from the manifest

        self.emit_output("Starting...", "info")   # levels: info|warn|error|debug
        self.emit_progress(50.0, "Halfway")        # 0.0 - 100.0
        self.emit_result(True, "Done!")            # MUST be called to finish run()

if __name__ == "__main__":
    MyApp.execute()
\`\`\`

## Output methods (ClawBenchApp)

| Method | Purpose |
|--------|---------|
| \`emit_output(message: str, level: str = "info")\` | Log line. level ∈ info/warn/error/debug |
| \`emit_progress(percent: float, message: str = "")\` | Progress 0.0–100.0 |
| \`emit_result(success: bool, summary: str, data: Optional[dict] = None)\` | Final result. Call exactly once at the end of run() |
| \`emit_error(message: str, details: str = "")\` | Error with optional traceback |

## manifest.json schema

\`\`\`json
{
  "id": "uuid-slug-or-com.company.app-name",
  "name": "Display Name",
  "version": "1.0.0",
  "description": "What this app does",
  "author": { "name": "Author Name" },
  "entry": "main.py",
  "supported_workspace_types": ["git", "svn", "perforce"],
  "confirm_before_run": false,
  "published": false,
  "min_sdk_version": "1.0.0",
  "params": [
    {
      "name": "param_key",
      "type": "string",
      "label": "Human Label",
      "description": "Help text",
      "required": false,
      "default": "",
      "options": ["a", "b"]
    }
  ]
}
\`\`\`

Param types: \`string\` | \`boolean\` | \`number\` | \`enum\` (needs \`options\`) | \`path\` | \`text\` (multi-line).
\`supported_workspace_types\` empty = workspace-agnostic.

## JSON-line output protocol

Each method prints exactly one JSON object per line to stdout (auto-flushed):

\`\`\`json
{"type": "output",   "message": "...", "level": "info"}
{"type": "progress", "percent": 50.0, "message": "..."}
{"type": "result",   "success": true, "summary": "...", "data": {}}
{"type": "error",    "message": "...", "details": "..."}
\`\`\`

## Interactive UI SDK (optional)

For apps that need dialogs (file pickers, conflict resolvers, confirmations),
import components from \`clawbench_sdk\` and drive them with emit/read helpers.

\`\`\`python
from clawbench_sdk import (
    Dialog, Button, CheckboxList, RadioList, DisplayList,
    Dropdown, TextInput, TextArea, Label,
    emit_ui_show, emit_ui_update, emit_ui_close, read_ui_event,
    load_ui_from_json,
)
\`\`\`

### Components

| Component | Constructor | Notes |
|-----------|-------------|-------|
| \`Dialog\` | \`Dialog(id, title, components=[], footer_buttons=[], closable=True, width=None)\` | Top-level container |
| \`Button\` | \`Button(id, label, variant="default", enabled=True, visible=True)\` | variant: default/primary/danger |
| \`CheckboxList\` | \`CheckboxList(id, items=[], selected_ids=[], max_height=None)\` | Multi-select |
| \`RadioList\` | \`RadioList(id, items=[], selected_id=None)\` | Single-select |
| \`DisplayList\` | \`DisplayList(id, items=[], max_height=None)\` | Read-only |
| \`Dropdown\` | \`Dropdown(id, options=[], selected_value=None, placeholder="")\` | options: [{label,value}] |
| \`TextInput\` | \`TextInput(id, value="", placeholder="")\` | Single-line |
| \`TextArea\` | \`TextArea(id, value="", placeholder="", rows=4)\` | Multi-line |
| \`Label\` | \`Label(id, text="", style="normal")\` | style: normal/bold/italic/error/warning/success |

List items use the shape: \`{"id": "...", "label": "...", "description": "..."}\`.

### UI functions

| Function | Purpose |
|----------|---------|
| \`emit_ui_show(dialog)\` | Render a dialog |
| \`emit_ui_update(dialog_id, updates)\` | Patch component props in an open dialog. \`updates\` maps component_id -> {prop: value} |
| \`emit_ui_close(dialog_id)\` | Close a dialog |
| \`read_ui_event()\` | Block on stdin for the next UI event, returns a dict or None |
| \`load_ui_from_json(path)\` | Build a Dialog from a ui.json file |

### UI event shape (from renderer, via read_ui_event)

\`\`\`json
{"type": "button_click",     "dialog_id": "...", "component_id": "ok_btn"}
{"type": "selection_change", "dialog_id": "...", "component_id": "file_list", "value": ["id1","id2"]}
{"type": "input_change",     "dialog_id": "...", "component_id": "name_input", "value": "text"}
{"type": "dialog_close",     "dialog_id": "..."}
\`\`\`

Typical interactive loop: build a Dialog → \`emit_ui_show(dialog)\` → loop on
\`read_ui_event()\` reacting to events (and calling \`emit_ui_update\` to reflect
changes) until a terminal button click → \`emit_ui_close(dialog_id)\` → \`emit_result\`.

## Quality rules

- Import \`from clawbench_sdk import ClawBenchApp\` (the runner sets PYTHONPATH; do NOT add sys.path hacks).
- Always end \`run()\` with \`self.emit_result(...)\`.
- Wrap logic in try/except; on exception call \`self.emit_error(str(e), traceback.format_exc())\` then \`self.emit_result(False, "Failed: ...")\` (\`import traceback\`).
- Use type hints on function signatures.
- Report meaningful progress with \`emit_progress\`.
- Write real, working code — never stubs or placeholders.`

export interface AppInfo {
  id: string
  name: string
  version: string
  description: string
  author: string
  entry: string
  category?: string
  targetDir?: string
  [key: string]: unknown
}

/**
 * Updates an existing sub-app's manifest.json.
 */
export function updateApp(
  appId: string,
  updates: Record<string, unknown>
): { success: boolean; error?: string } {
  try {
    const userAppsDir = getUserAppsPath()
    const appDir = join(userAppsDir, appId)

    logger.info(`Updating app ${appId} with updates:`, JSON.stringify(updates, null, 2))

    if (!fs.existsSync(appDir)) {
      return { success: false, error: `App directory not found: ${appDir}` }
    }

    const manifestPath = join(appDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      return { success: false, error: 'No manifest.json found in app directory' }
    }

    // Read existing manifest
    const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
    let manifest: Record<string, unknown>
    try {
      manifest = JSON.parse(manifestContent)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`Malformed manifest.json for app ${appId}:`, msg)
      return { success: false, error: `Invalid manifest.json: ${msg}` }
    }

    logger.info(`Existing manifest:`, JSON.stringify(manifest, null, 2))

    // Merge updates (preserve id)
    const updatedManifest = {
      ...manifest,
      ...updates,
      id: manifest.id // Ensure id doesn't change
    }

    logger.info(`Updated manifest:`, JSON.stringify(updatedManifest, null, 2))

    // Write updated manifest
    fs.writeFileSync(manifestPath, JSON.stringify(updatedManifest, null, 2), 'utf-8')

    logger.info(`App manifest updated: ${appId}`)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Failed to update app:', message)
    return { success: false, error: message }
  }
}

/**
 * Creates a scaffold for a new sub-app with manifest.json.
 * For type=app: also generates main.py and requirements.txt.
 * For type=ai-skill / prompt: only manifest.json (entry file written by the editor).
 */
export function createAppScaffold(
  appInfo: AppInfo
): { success: boolean; path?: string; error?: string } {
  try {
    const targetDir = appInfo.targetDir || getUserAppsPath()

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    const appDir = join(targetDir, appInfo.id)
    if (fs.existsSync(appDir)) {
      return { success: false, error: `Directory already exists: ${appDir}` }
    }

    fs.mkdirSync(appDir, { recursive: true })

    const appType = (appInfo.type as string) || 'app'

    // Generate manifest.json
    const manifest: Record<string, unknown> = {
      id: appInfo.id,
      name: appInfo.name,
      version: appInfo.version,
      description: appInfo.description,
      type: appType,
      author: appInfo.author,
      entry: appInfo.entry || (appType === 'ai-skill' ? 'SKILL.md' : appType === 'prompt' ? 'prompt.md' : appType === 'link' ? 'link.json' : 'main.py'),
      category: appInfo.category || 'general',
      supported_workspace_types: appInfo.supported_workspace_types || [],
      params: appInfo.params || [],
      confirm_before_run: appInfo.confirm_before_run || false,
      min_sdk_version: appInfo.min_sdk_version || '1.0.0',
      published: false // 新创建的应用默认未发布
    }
    // Link type carries url/icon/mini in the manifest
    if (appType === 'link') {
      manifest.url = appInfo.url || ''
      if (appInfo.icon) manifest.icon = appInfo.icon
      manifest.mini = appInfo.mini ?? false
    }
    fs.writeFileSync(join(appDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')

    // Only generate main.py + requirements.txt for type=app
    if (appType === 'app') {
      const params = (appInfo.params as Array<{ name: string; type?: string; default?: unknown; label?: string }>) || []

      // Build param access examples from the user-defined params
      const paramAccessLines = params.length > 0
        ? params.map((p) => {
            const defaultVal = p.default !== undefined && p.default !== '' ? JSON.stringify(p.default) : 'None'
            return `        # ${p.label || p.name}: self.params.get("${p.name}", ${defaultVal})`
          }).join('\n')
        : '        # Access params via self.params (dict)'

      const mainPy = `#!/usr/bin/env python3
"""${appInfo.name} - ${appInfo.description}"""

from clawbench_sdk import ClawBenchApp


class App(ClawBenchApp):
    def run(self) -> None:
        self.emit_output("Starting ${appInfo.name}...")
        self.emit_progress(0, "Initializing...")

${paramAccessLines}

        # TODO: Implement your app logic here
        # self.emit_output("Processing...", "info")
        # self.emit_progress(50.0, "Halfway there")

        self.emit_progress(100, "Done")
        self.emit_result(True, "Task completed successfully")


if __name__ == "__main__":
    App.execute()
`
      fs.writeFileSync(join(appDir, appInfo.entry || 'main.py'), mainPy, 'utf-8')

      const requirementsTxt = `clawbench-sdk>=1.0.0
# Add your Python dependencies here
# Example:
# requests>=2.28.0
`
      fs.writeFileSync(join(appDir, 'requirements.txt'), requirementsTxt, 'utf-8')

      // Write SDK reference so external AI coding tools (Claude Code, Codex, etc.)
      // can understand the SDK capabilities when opening the app in VSCode.
      fs.writeFileSync(join(appDir, 'SDK_REFERENCE.md'), SDK_REFERENCE_MD, 'utf-8')
    }

    logger.info(`App scaffold created at ${appDir}`)
    return { success: true, path: appDir }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Failed to create app scaffold:', message)
    return { success: false, error: message }
  }
}

/**
 * Packages a sub-app directory into a .clawbench-app archive (zip format).
 */
export async function publishApp(
  appPath: string,
  targetDir: string
): Promise<{ success: boolean; archivePath?: string; error?: string }> {
  try {
    if (!fs.existsSync(appPath)) {
      return { success: false, error: `App path does not exist: ${appPath}` }
    }

    const manifestPath = join(appPath, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      return { success: false, error: 'No manifest.json found in app directory' }
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
    let manifest: { id?: string; version?: string }
    try {
      manifest = JSON.parse(manifestContent)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Malformed manifest.json, cannot publish:', msg)
      return { success: false, error: `Invalid manifest.json: ${msg}` }
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    const archiveName = `${manifest.id}-${manifest.version}.clawbench-app`
    const archivePath = join(targetDir, archiveName)

    // Create zip archive using cross-platform utility
    zipDirectory(appPath, archivePath)

    logger.info(`App published: ${archivePath}`)
    return { success: true, archivePath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Failed to publish app:', message)
    return { success: false, error: message }
  }
}

/**
 * Scans a shared directory for .clawbench-app archive files.
 */
export function discoverSharedApps(sharedDir: string): string[] {
  const archives: string[] = []

  if (!sharedDir || !fs.existsSync(sharedDir)) {
    return archives
  }

  try {
    const entries = fs.readdirSync(sharedDir)
    for (const entry of entries) {
      if (entry.endsWith('.clawbench-app')) {
        archives.push(join(sharedDir, entry))
      }
    }
  } catch (err) {
    logger.error('Failed to scan shared directory:', err)
  }

  return archives
}

/**
 * Installs a sub-app from a .clawbench-app archive by extracting it
 * to the user apps directory.
 */
export async function installFromArchive(
  archivePath: string
): Promise<{ success: boolean; appId?: string; error?: string }> {
  try {
    if (!fs.existsSync(archivePath)) {
      return { success: false, error: `Archive not found: ${archivePath}` }
    }

    const userAppsDir = getUserAppsPath()
    if (!fs.existsSync(userAppsDir)) {
      fs.mkdirSync(userAppsDir, { recursive: true })
    }

    // Extract archive name to determine app id
    const archiveName = basename(archivePath, '.clawbench-app')
    // archiveName format: appId-version
    const appId = archiveName.replace(/-[\d.]+$/, '') || archiveName

    const extractDir = join(userAppsDir, appId)
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true })
    }
    fs.mkdirSync(extractDir, { recursive: true })

    // Extract using cross-platform utility
    unzipArchive(archivePath, extractDir)

    // Verify manifest exists
    const manifestPath = join(extractDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(extractDir, { recursive: true })
      return { success: false, error: 'Archive does not contain a valid manifest.json' }
    }

    logger.info(`App installed from archive: ${appId}`)
    return { success: true, appId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Failed to install from archive:', message)
    return { success: false, error: message }
  }
}
