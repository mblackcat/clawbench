# ClawBench UI Development Guide

## Quick Start

### Create Your First UI App in 5 Minutes

#### Step 1: Use the Scaffold Tool

```bash
cd /path/to/clawbench
python frontend/tools/create_ui_app.py my_first_app --template dialog --title "My First App"
```

This generates:

```
frontend/builtin-apps/my_first_app/
├── manifest.json    # App metadata
├── main.py          # Main entry point
├── ui.json          # UI definition
└── README.md        # Documentation
```

#### Step 2: Customize the UI

Edit `ui.json`:

```json
{
  "id": "my_dialog",
  "title": "Welcome",
  "closable": true,
  "width": 500,
  "components": [
    {
      "type": "label",
      "id": "welcome_label",
      "text": "Hello from my first ClawBench UI app!",
      "style": "bold",
      "visible": true
    }
  ],
  "footer_buttons": [
    {
      "type": "button",
      "id": "start_btn",
      "label": "Start",
      "variant": "primary"
    },
    {
      "type": "button",
      "id": "cancel_btn",
      "label": "Cancel",
      "variant": "default"
    }
  ]
}
```

#### Step 3: Write Business Logic

Edit `main.py`:

```python
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "python-sdk"))

from clawbench_sdk import (
    ClawBenchApp,
    load_ui_from_json,
    emit_ui_show,
    emit_ui_update,
)


class MyFirstApp(ClawBenchApp):
    def run(self):
        self.emit_output("App starting...", "info")
        self.emit_progress(20, "Loading UI")

        # Load UI definition
        ui_path = os.path.join(os.path.dirname(__file__), "ui.json")
        dialog = load_ui_from_json(ui_path)

        # Show the dialog
        self.emit_progress(50, "Displaying UI")
        emit_ui_show(dialog)

        # Do some work
        workspace_path = self.workspace.path
        self.emit_output(f"Workspace path: {workspace_path}", "info")

        # Update UI with results
        emit_ui_update(dialog.id, {
            "welcome_label": {
                "text": f"Workspace: {workspace_path}",
                "style": "success"
            }
        })

        self.emit_progress(100, "Done")
        self.emit_result(True, "App executed successfully")


if __name__ == "__main__":
    MyFirstApp.execute()
```

#### Step 4: Test in ClawBench

1. Open ClawBench
2. Open a workspace
3. Find your app in the app list
4. Click Run
5. View the dialog

## App Structure

### Directory Layout

```
my-app/
├── manifest.json       # App metadata (required)
├── main.py             # Main entry point (required)
├── ui.json             # UI definition file (optional)
└── icon.png            # App icon (optional)
```

### manifest.json

```json
{
  "id": "com.example.my-app",
  "name": "My App",
  "version": "1.0.0",
  "description": "App description",
  "author": { "name": "Author Name" },
  "icon": "icon.png",
  "entry": "main.py",
  "supported_workspace_types": ["git"],
  "confirm_before_run": false,
  "params": [
    {
      "name": "param1",
      "type": "string",
      "label": "Parameter 1",
      "description": "Parameter description",
      "required": false,
      "default": "default_value"
    }
  ],
  "min_sdk_version": "1.0.0"
}
```

### main.py

Two approaches for creating UI:

**Option A: Load from ui.json**

```python
from clawbench_sdk import ClawBenchApp, load_ui_from_json, emit_ui_show, emit_ui_update

class MyApp(ClawBenchApp):
    def run(self):
        ui_path = os.path.join(os.path.dirname(__file__), "ui.json")
        dialog = load_ui_from_json(ui_path)

        # Dynamically populate data
        for component in dialog.components:
            if component.id == "item_list":
                component.items = [
                    {"id": "1", "label": "Item 1", "description": "Description 1"},
                ]

        emit_ui_show(dialog)
        self.emit_result(True, "Success")

if __name__ == "__main__":
    MyApp.execute()
```

**Option B: Build in code**

```python
from clawbench_sdk import (
    ClawBenchApp, Dialog, Button, CheckboxList, Label,
    emit_ui_show, emit_ui_update,
)

class MyApp(ClawBenchApp):
    def run(self):
        dialog = Dialog(
            id="my_dialog",
            title="My Dialog",
            components=[
                Label(id="header", text="Welcome", style="bold"),
                CheckboxList(
                    id="item_list",
                    items=[
                        {"id": "1", "label": "Item 1", "description": "Desc 1"},
                    ],
                    selected_ids=[],
                    max_height=300
                ),
            ],
            footer_buttons=[
                Button(id="ok_btn", label="OK", variant="primary"),
                Button(id="cancel_btn", label="Cancel", variant="default"),
            ]
        )
        emit_ui_show(dialog)
        self.emit_result(True, "Success")

if __name__ == "__main__":
    MyApp.execute()
```

## Scaffold Templates

The scaffold tool (`frontend/tools/create_ui_app.py`) provides five templates:

| Template | Use Case | Key Components | Complexity |
|----------|----------|----------------|------------|
| `basic` | Background processing, no UI | None | Low |
| `dialog` | Simple prompts, confirmations | Label, Button | Low |
| `form` | Collecting user input | TextInput, TextArea, Dropdown | Medium |
| `list` | File/item selection | CheckboxList, Button | Medium |
| `conflict` | Complex interactive workflows | CheckboxList, RadioList, Button, Label | High |

### Usage

```bash
# Create with a specific template
python frontend/tools/create_ui_app.py my_app --template list --title "My App"

# View help
python frontend/tools/create_ui_app.py --help
```

## UI Templates

### Confirmation Dialog

```json
{
  "id": "confirm_dialog",
  "title": "Confirm Action",
  "closable": true,
  "width": 400,
  "components": [
    {
      "type": "label",
      "id": "message",
      "text": "Are you sure you want to proceed?",
      "style": "normal"
    }
  ],
  "footer_buttons": [
    { "type": "button", "id": "confirm_btn", "label": "Confirm", "variant": "primary" },
    { "type": "button", "id": "cancel_btn", "label": "Cancel", "variant": "default" }
  ]
}
```

### Form Dialog

```json
{
  "id": "form_dialog",
  "title": "Input Form",
  "closable": true,
  "width": 500,
  "components": [
    { "type": "label", "id": "name_label", "text": "Name:", "style": "bold" },
    { "type": "text_input", "id": "name_input", "value": "", "placeholder": "Enter name" },
    { "type": "label", "id": "desc_label", "text": "Description:", "style": "bold" },
    { "type": "text_area", "id": "desc_input", "value": "", "placeholder": "Enter description", "rows": 4 },
    { "type": "label", "id": "type_label", "text": "Type:", "style": "bold" },
    {
      "type": "dropdown",
      "id": "type_select",
      "options": [
        { "value": "type1", "label": "Type 1" },
        { "value": "type2", "label": "Type 2" }
      ],
      "selected_value": "type1",
      "placeholder": "Select type"
    }
  ],
  "footer_buttons": [
    { "type": "button", "id": "submit_btn", "label": "Submit", "variant": "primary" },
    { "type": "button", "id": "cancel_btn", "label": "Cancel", "variant": "default" }
  ]
}
```

### Selection List Dialog

```json
{
  "id": "selection_dialog",
  "title": "Select Items",
  "closable": true,
  "width": 600,
  "components": [
    { "type": "button", "id": "select_all_btn", "label": "Select All", "variant": "default" },
    { "type": "button", "id": "clear_btn", "label": "Clear", "variant": "default" },
    {
      "type": "checkbox_list",
      "id": "item_list",
      "items": [],
      "selected_ids": [],
      "max_height": 400
    }
  ],
  "footer_buttons": [
    { "type": "button", "id": "ok_btn", "label": "OK", "variant": "primary" },
    { "type": "button", "id": "cancel_btn", "label": "Cancel", "variant": "default" }
  ]
}
```

## Common Patterns

### Dynamically Update a List

```python
# After initial display
emit_ui_show(dialog)

# Update with new data
new_items = [{"id": "1", "label": "Processed", "description": "Success"}]
emit_ui_update(dialog.id, {
    "item_list": {"items": new_items}
})
```

### Show/Hide Components

```python
emit_ui_update(dialog.id, {
    "item_list": {"visible": False},
    "success_label": {
        "visible": True,
        "text": "Operation complete",
        "style": "success"
    }
})
```

### Enable/Disable Buttons

```python
# Disable
emit_ui_update(dialog.id, {"submit_btn": {"enabled": False}})

# Enable
emit_ui_update(dialog.id, {"submit_btn": {"enabled": True}})
```

### Select All / Clear Selection

```python
def handle_select_all(self, all_item_ids):
    emit_ui_update(self.dialog_id, {
        "item_list": {"selected_ids": all_item_ids}
    })

def handle_clear_selection(self):
    emit_ui_update(self.dialog_id, {
        "item_list": {"selected_ids": []}
    })
```

## Working with Parameters

### Define in manifest.json

```json
{
  "params": [
    {
      "name": "my_param",
      "type": "string",
      "label": "My Parameter",
      "description": "Parameter description",
      "required": false,
      "default": "default_value"
    }
  ]
}
```

Supported param types: `string`, `boolean`, `number`, `enum`, `path`, `text`

### Access in Code

```python
value = self.params.get("my_param", "default_value")
```

## Testing and Debugging

### Local Testing

Create test files:

```json
// test_params.json
{}

// test_workspace.json
{
  "path": "/path/to/workspace",
  "vcs_type": "git",
  "name": "test-workspace"
}
```

Run directly:

```bash
python main.py --params test_params.json --workspace test_workspace.json
```

### Debug Output

```python
self.emit_output("Debug info", "debug")
self.emit_output("Normal info", "info")
self.emit_output("Warning", "warn")
self.emit_output("Error info", "error")
```

### Progress Reporting

```python
self.emit_progress(0, "Starting")
self.emit_progress(50, "Processing")
self.emit_progress(100, "Complete")
```

### Validate JSON

```bash
python -m json.tool ui.json
```

## Best Practices

1. **Use ui.json for complex UIs** -- separates UI definition from business logic.
2. **Descriptive component IDs** -- use `conflict_file_list` instead of `list1`; suffix buttons with `_btn`, labels with `_label`.
3. **Provide user feedback** -- show progress with `emit_progress()`, update UI after operations.
4. **Error display** -- use Label components with `style: "error"` for error messages.
5. **Accessibility** -- provide clear `label` and `description` for list items.

## Example Applications

- `frontend/builtin-apps/vcs_update_with_conflicts/` -- VCS update with interactive conflict resolution
- `frontend/builtin-apps/resolve_conflicts/` -- Conflict resolution tool
- `frontend/builtin-apps/vcs_status_check/` -- VCS status checker
