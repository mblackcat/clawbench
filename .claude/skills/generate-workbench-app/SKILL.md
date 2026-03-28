---
name: generate-clawbench-app
description: Generate a ClawBench Python sub-app from a description or manifest spec
---

# Generate ClawBench App

Generate complete Python sub-applications for the ClawBench desktop application. This skill produces all required files (manifest, entry point, helpers, UI definitions) following the project's established patterns and SDK conventions.

## Instructions

When this skill is invoked, gather the following from the user (or derive them from a natural language description):

1. **App ID** -- reverse-domain format, e.g. `com.company.app-name`
2. **Display name** -- human-readable name shown in the UI
3. **Description** -- what the app does
4. **Supported workspace types** -- subset of `["git", "svn", "perforce"]`, or empty for workspace-agnostic apps
5. **Parameters** -- list of user-configurable inputs (name, type, label, required, default, etc.)
6. **UI interaction** -- whether the app needs interactive dialogs (conflict pickers, status displays, etc.)
7. **Target directory** -- default `builtin-apps/<app-name>/`, or a user-specified path

If the user provides only a brief description, infer reasonable defaults for all of the above and confirm before generating.

## Files to Read Before Generating

Always read these SDK source files to understand the latest API surface:

- `python-sdk/clawbench_sdk/base_app.py` -- ClawBenchApp abstract base class
- `python-sdk/clawbench_sdk/output.py` -- JSON-line output protocol
- `python-sdk/clawbench_sdk/params.py` -- ParamType, ParamDef, WorkspaceInfo
- `python-sdk/clawbench_sdk/ui.py` -- UI component classes and emit functions

For reference implementations, read:

- `builtin-apps/vcs_update_with_conflicts/` -- full-featured app with UI, VCS factory pattern, conflict resolution
- `builtin-apps/vcs_status_check/` -- simpler app with status display

## Generated File Structure

Every generated app produces at minimum:

```
<app-directory>/
  manifest.json     # App metadata, parameters, entry point
  main.py           # Entry point inheriting ClawBenchApp
  README.md         # Brief description and usage
```

If the app needs interactive UI:

```
<app-directory>/
  manifest.json
  main.py
  ui.json           # Declarative UI dialog definitions
  ui_manager.py     # UIManager class for showing/updating dialogs
  README.md
```

If the app supports multiple VCS types, add the factory pattern:

```
<app-directory>/
  manifest.json
  main.py
  vcs_factory.py    # VCSFactory with _vcs_map registry
  vcs/
    __init__.py     # Exports VCSBase and implementations
    base.py         # Abstract VCSBase with operation interfaces
    git.py          # Git implementation
    svn.py          # SVN implementation (if needed)
  ui.json           # (if UI needed)
  ui_manager.py     # (if UI needed)
  README.md
```

## Manifest Schema Reference

```json
{
  "id": "com.company.app-name",
  "name": "Display Name",
  "version": "1.0.0",
  "description": "What this app does",
  "author": { "name": "Author Name" },
  "icon": "icon.png",
  "entry": "main.py",
  "supported_workspace_types": ["git", "svn", "perforce"],
  "confirm_before_run": false,
  "published": false,
  "params": [],
  "min_sdk_version": "1.0.0"
}
```

### Parameter Definition

Each entry in `params` follows this shape:

```json
{
  "name": "param_key",
  "type": "<type>",
  "label": "Human Label",
  "description": "Help text for the parameter",
  "required": false,
  "default": "",
  "options": ["a", "b", "c"]
}
```

**Supported param types:**

| Type | JSON value type | Notes |
|------|----------------|-------|
| `string` | string | Single-line text input |
| `boolean` | boolean | Toggle / checkbox |
| `number` | number | Numeric input |
| `enum` | string | Dropdown; requires `options` array |
| `path` | string | File/directory path picker |
| `text` | string | Multi-line text area |

## ClawBenchApp API Reference

### Base Class

```python
from clawbench_sdk import ClawBenchApp

class MyApp(ClawBenchApp):
    def run(self) -> None:
        ...

if __name__ == "__main__":
    MyApp.execute()
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `self.workspace` | `WorkspaceInfo` | Current workspace context |
| `self.workspace.path` | `str` | Absolute path to workspace root |
| `self.workspace.vcs_type` | `str` | VCS type: `"git"`, `"svn"`, `"perforce"`, or `""` |
| `self.workspace.name` | `str` | Human-readable workspace name |
| `self.params` | `Dict[str, Any]` | Parameter values from the UI form |

### Output Methods

All output methods are static and can be called as `self.emit_*()` or `ClawBenchApp.emit_*()`.

| Method | Description |
|--------|-------------|
| `emit_output(message: str, level: str = "info")` | Emit a log message. Levels: `"info"`, `"warn"`, `"error"`, `"debug"` |
| `emit_progress(percent: float, message: str = "")` | Emit progress update (0.0 -- 100.0) |
| `emit_result(success: bool, summary: str, data: Optional[Dict] = None)` | Emit final result. Must be called at end of `run()` |
| `emit_error(message: str, details: str = "")` | Emit an error message with optional traceback |

### Execution Lifecycle

1. Electron writes params and workspace info to temp JSON files.
2. Electron spawns: `python main.py --params /tmp/params-{taskId}.json --workspace /tmp/ws-{taskId}.json`
3. `PYTHONPATH` includes the SDK directory; `PYTHONUNBUFFERED=1` is set.
4. The app prints JSON lines to stdout; Electron parses and routes them.
5. On process exit, temp files are cleaned up.

The `ClawBenchApp.__init__` handles argument parsing and JSON loading automatically. The `execute()` classmethod wraps `__init__` + `run()` in a try/except that emits error results on unhandled exceptions.

## UI SDK Reference

For apps that need interactive dialogs, import from `clawbench_sdk`:

```python
from clawbench_sdk import (
    Dialog, Button, CheckboxList, RadioList,
    DisplayList, Dropdown, TextInput, TextArea, Label,
    emit_ui_show, emit_ui_update, emit_ui_close,
    load_ui_from_json,
)
```

### UI Components

| Component | Key Properties |
|-----------|---------------|
| `Dialog(id, title, components, footer_buttons, closable, width)` | Top-level container |
| `Button(id, label, variant, enabled, visible)` | Variants: `"default"`, `"primary"`, `"danger"` |
| `CheckboxList(id, items, selected_ids, max_height)` | Multi-select list |
| `RadioList(id, items, selected_id)` | Single-select list |
| `DisplayList(id, items, max_height)` | Read-only list |
| `Dropdown(id, options, selected_value, placeholder)` | Dropdown selector |
| `TextInput(id, value, placeholder)` | Single-line input |
| `TextArea(id, value, placeholder, rows)` | Multi-line input |
| `Label(id, text, style)` | Styles: `"normal"`, `"bold"`, `"italic"`, `"error"`, `"warning"`, `"success"` |

List items follow the shape: `{"id": "...", "label": "...", "description": "..."}`

### UI Functions

| Function | Description |
|----------|-------------|
| `emit_ui_show(dialog)` | Display a dialog |
| `emit_ui_update(dialog_id, updates)` | Update component properties in an open dialog |
| `emit_ui_close(dialog_id)` | Close a dialog |
| `load_ui_from_json(json_path)` | Load a Dialog object from a `ui.json` file |

### ui.json Format

Declarative dialog definition that can be loaded with `load_ui_from_json()`:

```json
{
  "id": "my_dialog",
  "title": "Dialog Title",
  "closable": true,
  "width": 600,
  "components": [
    { "type": "label", "id": "msg", "text": "Hello", "style": "bold", "visible": true },
    { "type": "checkbox_list", "id": "file_list", "items": [], "selected_ids": [], "max_height": 300 },
    { "type": "radio_list", "id": "strategy", "items": [...], "selected_id": "option1" },
    { "type": "text_input", "id": "name_input", "value": "", "placeholder": "Enter name" }
  ],
  "footer_buttons": [
    { "type": "button", "id": "ok_btn", "label": "OK", "variant": "primary" },
    { "type": "button", "id": "cancel_btn", "label": "Cancel", "variant": "default" }
  ]
}
```

## Code Patterns and Quality Rules

### Required patterns

- Always `from clawbench_sdk import ClawBenchApp`
- Always end `run()` with `self.emit_result(True/False, summary)`
- Always use `if __name__ == "__main__": AppClass.execute()` as the entry point
- Wrap main logic in try/except; call `self.emit_error(message, traceback)` on failure, then `self.emit_result(False, summary)`
- Use type hints on all function signatures
- Use `self.emit_progress()` to report meaningful progress milestones

### Multi-VCS support (factory pattern)

When an app operates on version-controlled workspaces and needs to support multiple VCS types:

1. Create `vcs/base.py` with an abstract `VCSBase` class defining the operation interface
2. Create concrete implementations in `vcs/git.py`, `vcs/svn.py`, etc.
3. Create `vcs/__init__.py` exporting all classes
4. Create `vcs_factory.py` with a `VCSFactory` class:

```python
from typing import Optional
from vcs import VCSBase, GitVCS

class VCSFactory:
    _vcs_map = {
        "git": GitVCS,
        # add more as needed
    }

    @classmethod
    def create(cls, vcs_type: str, workspace_path: str) -> Optional[VCSBase]:
        vcs_class = cls._vcs_map.get(vcs_type.lower())
        if vcs_class:
            return vcs_class(workspace_path)
        return None

    @classmethod
    def supported_vcs_types(cls) -> list:
        return list(cls._vcs_map.keys())
```

### UI apps pattern

When the app needs interactive dialogs:

1. Create `ui_manager.py` with a `UIManager` class that builds and shows dialogs
2. Optionally create `ui.json` for declarative dialog definitions loaded via `load_ui_from_json()`
3. In `main.py`, instantiate `UIManager` in `__init__` and call its methods from `run()`

### SDK import path

For builtin apps, include this at the top of `main.py` to ensure the SDK is importable:

```python
import sys
import os
sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "python-sdk")
)
```

For user-installed apps, the Electron runner sets `PYTHONPATH` automatically, so this is not needed.

## Example: Minimal App

```python
"""ClawBench app: Example minimal app."""

import sys
import os

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "python-sdk")
)

from clawbench_sdk import ClawBenchApp


class HelloApp(ClawBenchApp):
    """A minimal example app."""

    def run(self) -> None:
        name = self.params.get("name", "World")

        self.emit_output(f"Running in workspace: {self.workspace.path}", "info")
        self.emit_progress(50, "Processing")

        try:
            result_message = f"Hello, {name}!"
            self.emit_output(result_message, "info")
            self.emit_progress(100, "Done")
            self.emit_result(True, result_message)
        except Exception as e:
            self.emit_error(str(e), details=str(e))
            self.emit_result(False, f"Failed: {e}")


if __name__ == "__main__":
    HelloApp.execute()
```

With manifest:

```json
{
  "id": "com.example.hello",
  "name": "Hello App",
  "version": "1.0.0",
  "description": "A minimal example app that greets the user",
  "author": { "name": "Example" },
  "entry": "main.py",
  "supported_workspace_types": [],
  "confirm_before_run": false,
  "params": [
    {
      "name": "name",
      "type": "string",
      "label": "Name",
      "description": "Name to greet",
      "required": false,
      "default": "World"
    }
  ],
  "min_sdk_version": "1.0.0"
}
```

## Example: App with UI Interaction

```python
"""ClawBench app: Example app with interactive UI."""

import sys
import os

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "python-sdk")
)

from clawbench_sdk import ClawBenchApp
from ui_manager import UIManager


class FileReviewApp(ClawBenchApp):
    """Review workspace files with an interactive dialog."""

    def __init__(self):
        super().__init__()
        self.ui_manager = UIManager()

    def run(self) -> None:
        workspace_path = self.workspace.path

        self.emit_output("Scanning workspace...", "info")
        self.emit_progress(30, "Listing files")

        try:
            files = os.listdir(workspace_path)
            file_items = [
                {"id": f, "label": f, "description": ""}
                for f in files[:50]
            ]

            self.emit_progress(70, "Preparing display")
            self.ui_manager.show_file_list_dialog(file_items)

            self.emit_progress(100, "Done")
            self.emit_result(True, f"Found {len(files)} files in workspace")
        except Exception as e:
            self.emit_error(str(e), details=str(e))
            self.emit_result(False, f"Failed to scan workspace: {e}")


if __name__ == "__main__":
    FileReviewApp.execute()
```

With `ui_manager.py`:

```python
"""UI management for the file review app."""

from typing import List, Dict, Any
from clawbench_sdk import (
    Dialog, Button, CheckboxList, Label,
    emit_ui_show,
)


class UIManager:
    """Manages UI dialogs for the app."""

    def show_file_list_dialog(self, file_items: List[Dict[str, Any]]) -> None:
        """Show a dialog listing workspace files."""
        dialog = Dialog(
            id="file_list_dialog",
            title="Workspace Files",
            closable=True,
            width=600,
            components=[
                Label(
                    id="header",
                    text=f"Found {len(file_items)} files:",
                    style="bold",
                ),
                CheckboxList(
                    id="file_list",
                    items=file_items,
                    selected_ids=[],
                    max_height=400,
                ),
            ],
            footer_buttons=[
                Button(id="close_btn", label="Close", variant="primary"),
            ],
        )
        emit_ui_show(dialog)
```

## Output Location

- **Builtin apps**: `builtin-apps/<app-name>/` (bundled with the Electron app as extraResources)
- **User apps**: User-specified directory, or `{userData}/user-apps/<app-name>/`
- Default to `builtin-apps/<app-name>/` unless the user specifies otherwise
