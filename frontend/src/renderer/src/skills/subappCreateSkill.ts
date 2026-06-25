/**
 * Built-in "Create Sub-App" skill — ClawBench client knowledge base.
 *
 * This is the product client's built-in capability for generating and editing
 * ClawBench Python sub-apps. The SDK reference below is verified against the
 * actual SDK source (frontend/python-sdk/clawbench_sdk/*), including the full
 * UI component surface. It is embedded as a constant (rather than a packaged
 * file) so it ships with the renderer bundle and has no runtime path/packaging
 * dependency.
 *
 * Two consumers:
 *  - AIGenerateModal  → SUBAPP_CODEGEN_SYSTEM_PROMPT (one-shot file generation)
 *  - EditorChatPanel  → SUBAPP_CHAT_SYSTEM_PROMPT     (agentic editing via tools)
 */

/**
 * Core SDK knowledge shared by both codegen and chat. Describes the full
 * ClawBenchApp lifecycle, manifest schema, parameter types, the JSON-line
 * output protocol, and the interactive UI SDK (Dialog + components).
 */
export const SUBAPP_SDK_REFERENCE = `# ClawBench Python Sub-App SDK

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

/**
 * System prompt for one-shot AI code generation (AIGenerateModal).
 * Emits files using the `### FILE:` block format the modal parses.
 */
export const SUBAPP_CODEGEN_SYSTEM_PROMPT = `You are a code generator for ClawBench Python sub-apps. Generate complete, working code based on a given manifest.

${SUBAPP_SDK_REFERENCE}

## Output Format

Output each file using this EXACT format (one block per file, no JSON):

### FILE: main.py
\`\`\`python
<complete python source code here>
\`\`\`

### FILE: README.md
\`\`\`markdown
<brief usage documentation in Chinese>
\`\`\`

Rules for output:
- Use exactly \`### FILE: <filename>\` as the header for each file (subdirectories allowed, e.g. \`### FILE: vcs/git.py\`)
- Put content inside a fenced code block with the correct language tag
- Add additional \`### FILE:\` blocks for helper modules / ui.json if needed
- Do NOT include manifest.json
- Do NOT add any explanation text outside the file blocks`

/**
 * System prompt for the agentic editor chat (EditorChatPanel). The model has
 * file tools to read/list/write/create within the current app directory.
 */
export const SUBAPP_CHAT_SYSTEM_PROMPT = `You are an expert AI coding assistant embedded in the ClawBench sub-app code editor. You help the user build and edit a ClawBench Python sub-app by reading and writing files directly via tools.

${SUBAPP_SDK_REFERENCE}

## How you work

- You are editing the files of ONE sub-app. All file paths you pass to tools are RELATIVE to the app root (e.g. \`main.py\`, \`vcs/git.py\`, \`ui.json\`).
- Before editing an existing file, read it first with \`read_file\` so you preserve unrelated code.
- Use \`list_files\` to discover the current structure when unsure.
- When you write code, write the COMPLETE file content with \`write_file\` — it overwrites the whole file. Never emit partial diffs or "// ... unchanged" placeholders.
- Make focused, correct edits. Explain briefly what you changed after applying it.
- Follow every SDK rule above. The app's entry point is \`main.py\`.
- Do not edit \`manifest.json\` unless the user explicitly asks.`

/** Tool definitions for the agentic editor chat (passed to window.api.ai.streamChat). */
export const SUBAPP_CHAT_TOOLS = [
  {
    name: 'list_files',
    description:
      "List files and folders in the current sub-app directory. Optionally pass a relative subdirectory path; defaults to the app root.",
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative subdirectory to list (optional, defaults to app root).'
        }
      }
    }
  },
  {
    name: 'read_file',
    description: 'Read the full text content of a file in the sub-app, by path relative to the app root.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the app root, e.g. "main.py".' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description:
      'Create or overwrite a file in the sub-app with the given complete content. Parent folders are created automatically. Path is relative to the app root.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the app root, e.g. "vcs/git.py".' },
        content: { type: 'string', description: 'The complete new file content.' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'create_folder',
    description: 'Create a folder (and any missing parents) in the sub-app, by path relative to the app root.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder path relative to the app root.' }
      },
      required: ['path']
    }
  }
] as const
