# ClawBench UI System Reference

## Architecture Overview

```
+-------------------------------------------------------------+
|                     Electron Frontend                        |
|  +--------------+  +--------------+  +--------------+       |
|  |   Dialog     |  |   Button     |  | CheckboxList |  ...  |
|  |  Component   |  |  Component   |  |  Component   |       |
|  +--------------+  +--------------+  +--------------+       |
|  +-------------------------------------------------------------+
                         | JSON-line Protocol
+-------------------------------------------------------------+
|                     Python Backend                           |
|  +------------------------------------------------------+   |
|  |              ClawBench SDK (Python)                  |   |
|  |  +------------+  +------------+  +------------+      |   |
|  |  |  UI Module |  |Output Mod. |  | Base App   |      |   |
|  |  |            |  |            |  |            |      |   |
|  |  | - Dialog   |  | - emit_*   |  | - run()    |      |   |
|  |  | - Button   |  | - progress |  | - params   |      |   |
|  |  | - List     |  | - result   |  | - workspace|      |   |
|  |  +------------+  +------------+  +------------+      |   |
|  +------------------------------------------------------+   |
|                         |                                    |
|  +------------------------------------------------------+   |
|  |                  Your App Code                        |   |
|  |  - Business Logic                                     |   |
|  |  - UI Definition (Code or JSON)                       |   |
|  |  - Event Handlers                                     |   |
|  +------------------------------------------------------+   |
+-------------------------------------------------------------+
```

The system has four layers:

1. **UI SDK** (`frontend/python-sdk/clawbench_sdk/ui.py`) -- Python classes for UI components and interaction APIs.
2. **JSON-line Protocol** -- Standardized messages between Python apps and the Electron frontend.
3. **Scaffold Tool** (`frontend/tools/create_ui_app.py`) -- CLI tool that generates app boilerplate.
4. **Electron Frontend** -- Renders UI components and captures user interactions.

## Component Catalog

All UI components inherit from `UIComponent` and share these common properties:

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique component identifier |
| `type` | string | Component type |
| `visible` | bool | Whether the component is visible |
| `enabled` | bool | Whether the component is enabled |

### Dialog

Container for UI components. Not a component itself but the top-level structure.

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Dialog identifier |
| `title` | string | Dialog title |
| `components` | array | Content area components |
| `footer_buttons` | array | Bottom button list |
| `closable` | bool | Whether the dialog can be closed |
| `width` | number | Dialog width in pixels (optional) |

### Button

```python
from clawbench_sdk import Button

button = Button(
    id="my_button",
    label="Click Me",
    variant="primary",  # "default" | "primary" | "danger"
    enabled=True
)
```

Variants:

- `default` -- Standard style (gray)
- `primary` -- Primary action (blue)
- `danger` -- Destructive action (red)

### CheckboxList

Multi-select list.

```python
from clawbench_sdk import CheckboxList

checkbox_list = CheckboxList(
    id="file_list",
    items=[
        {"id": "file1", "label": "src/main.py", "description": "Modified"},
        {"id": "file2", "label": "src/utils.py", "description": "Conflict"},
    ],
    selected_ids=["file1"],
    max_height=300  # Scrollable when exceeding this height
)
```

### RadioList

Single-select list.

```python
from clawbench_sdk import RadioList

radio_list = RadioList(
    id="strategy",
    items=[
        {"id": "ours", "label": "Keep local"},
        {"id": "theirs", "label": "Use remote"},
        {"id": "merge", "label": "Try merge"},
    ],
    selected_id="ours"
)
```

### DisplayList

Read-only display list.

```python
from clawbench_sdk import DisplayList

display_list = DisplayList(
    id="results",
    items=[
        {"label": "File A", "description": "Resolved"},
        {"label": "File B", "description": "Resolved"},
    ],
    max_height=200
)
```

### Dropdown

```python
from clawbench_sdk import Dropdown

dropdown = Dropdown(
    id="branch_selector",
    options=[
        {"value": "main", "label": "Main branch"},
        {"value": "dev", "label": "Dev branch"},
    ],
    selected_value="main",
    placeholder="Select a branch"
)
```

### TextInput

Single-line text input.

```python
from clawbench_sdk import TextInput

text_input = TextInput(
    id="commit_message",
    value="",
    placeholder="Enter commit message"
)
```

### TextArea

Multi-line text input.

```python
from clawbench_sdk import TextArea

text_area = TextArea(
    id="description",
    value="",
    placeholder="Enter detailed description",
    rows=6
)
```

### Label

Text display with styling.

```python
from clawbench_sdk import Label

label = Label(
    id="status",
    text="All conflicts resolved",
    style="success"  # "normal" | "bold" | "italic" | "error" | "warning" | "success"
)
```

Label styles:

| Style | Description |
|-------|-------------|
| `normal` | Default text |
| `bold` | Bold text |
| `italic` | Italic text |
| `error` | Red text |
| `warning` | Yellow text |
| `success` | Green text |

## API Functions

### emit_ui_show(dialog)

Displays a dialog in the frontend.

```python
from clawbench_sdk import emit_ui_show

emit_ui_show(dialog)
```

### emit_ui_update(dialog_id, updates)

Updates component properties within a dialog.

```python
from clawbench_sdk import emit_ui_update

emit_ui_update("my_dialog", {
    "component_id": {
        "visible": False,
        "text": "Updated text"
    }
})
```

### emit_ui_close(dialog_id)

Closes a dialog.

```python
from clawbench_sdk import emit_ui_close

emit_ui_close("my_dialog")
```

### load_ui_from_json(path)

Loads a Dialog from a JSON file.

```python
from clawbench_sdk import load_ui_from_json

dialog = load_ui_from_json("ui.json")
# Dynamically modify before showing
dialog.components[1].items = [{"id": "f1", "label": "src/main.py"}]
emit_ui_show(dialog)
```

## SDK Imports

```python
from clawbench_sdk import (
    # Component classes
    Dialog, Button, CheckboxList, RadioList,
    DisplayList, Dropdown, TextInput, TextArea, Label,

    # API functions
    emit_ui_show, emit_ui_update, emit_ui_close,
    load_ui_from_json,
)
```

## JSON-line Protocol

Python apps communicate with the Electron frontend by printing JSON objects to stdout, one per line.

### Messages Sent to Frontend

#### ui_show -- Display a Dialog

```json
{
  "type": "ui_show",
  "dialog": {
    "id": "my_dialog",
    "title": "Title",
    "components": [...],
    "footer_buttons": [...]
  }
}
```

#### ui_update -- Update Components

```json
{
  "type": "ui_update",
  "dialog_id": "my_dialog",
  "updates": {
    "component_id": {
      "visible": false,
      "items": [...]
    }
  }
}
```

#### ui_close -- Close a Dialog

```json
{
  "type": "ui_close",
  "dialog_id": "my_dialog"
}
```

### Events Received from Frontend (Planned)

```json
{
  "type": "ui_event",
  "dialog_id": "my_dialog",
  "component_id": "my_button",
  "event_type": "button_click",
  "data": {
    "selected_ids": [...],
    "value": "..."
  }
}
```

## ui.json File Format

```json
{
  "id": "dialog_id",
  "title": "Dialog Title",
  "closable": true,
  "width": 600,
  "components": [
    {
      "type": "component_type",
      "id": "component_id",
      "...": "component_specific_props"
    }
  ],
  "footer_buttons": [
    {
      "type": "button",
      "id": "button_id",
      "label": "Button Text",
      "variant": "primary"
    }
  ]
}
```

Supported component `type` values: `label`, `button`, `checkbox_list`, `radio_list`, `display_list`, `dropdown`, `text_input`, `text_area`.

## Extending the System

### Adding a New Component Type

1. Define the component class in `python-sdk/clawbench_sdk/ui.py` with a `to_dict()` method.
2. Add parsing logic in `_parse_component()` for JSON loading support.
3. Implement the corresponding renderer in the Electron frontend.

### Implementing Event Handling

The full event loop requires:

1. **Frontend**: Capture user interactions, send events via IPC.
2. **Backend**: Implement event loop to receive and dispatch events.
3. **App**: Define event handler methods.

```python
def run(self):
    emit_ui_show(dialog)

    # Event loop (pseudocode)
    while True:
        event = wait_for_event()
        if event.component_id == "ok_btn":
            self.handle_ok_click(event.data)
            break
        elif event.component_id == "select_all_btn":
            self.handle_select_all()
```
