"""UI interaction protocol for ClawBench apps.

This module provides a declarative way to create interactive UI components
such as dialogs, buttons, lists, and dropdowns. Apps emit UI definitions
and receive user interaction events.
"""

import json
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Dict, List, Optional, Callable
from clawbench_sdk.output import _emit


class UIComponentType(Enum):
    """Types of UI components."""
    DIALOG = "dialog"
    BUTTON = "button"
    CHECKBOX_LIST = "checkbox_list"
    RADIO_LIST = "radio_list"
    DISPLAY_LIST = "display_list"
    DROPDOWN = "dropdown"
    TEXT_INPUT = "text_input"
    TEXT_AREA = "text_area"
    LABEL = "label"


class UIEventType(Enum):
    """Types of UI events."""
    BUTTON_CLICK = "button_click"
    SELECTION_CHANGE = "selection_change"
    INPUT_CHANGE = "input_change"
    DIALOG_CLOSE = "dialog_close"


@dataclass
class UIComponent:
    """Base class for UI components."""
    id: str
    type: UIComponentType
    visible: bool = True
    enabled: bool = True
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert component to dictionary for JSON serialization."""
        result = asdict(self)
        result['type'] = self.type.value
        return result


@dataclass
class Button(UIComponent):
    """Button component."""
    label: str = ""
    variant: str = "default"  # default, primary, danger
    
    def __init__(self, id: str, label: str, variant: str = "default", 
                 enabled: bool = True, visible: bool = True):
        super().__init__(id, UIComponentType.BUTTON, visible, enabled)
        self.label = label
        self.variant = variant


@dataclass
class CheckboxList(UIComponent):
    """Multi-select checkbox list component."""
    items: List[Dict[str, Any]] = field(default_factory=list)
    selected_ids: List[str] = field(default_factory=list)
    max_height: Optional[int] = None
    
    def __init__(self, id: str, items: List[Dict[str, Any]] = None,
                 selected_ids: List[str] = None, max_height: Optional[int] = None,
                 visible: bool = True, enabled: bool = True):
        super().__init__(id, UIComponentType.CHECKBOX_LIST, visible, enabled)
        self.items = items or []
        self.selected_ids = selected_ids or []
        self.max_height = max_height


@dataclass
class RadioList(UIComponent):
    """Single-select radio list component."""
    items: List[Dict[str, Any]] = field(default_factory=list)
    selected_id: Optional[str] = None
    
    def __init__(self, id: str, items: List[Dict[str, Any]] = None,
                 selected_id: Optional[str] = None,
                 visible: bool = True, enabled: bool = True):
        super().__init__(id, UIComponentType.RADIO_LIST, visible, enabled)
        self.items = items or []
        self.selected_id = selected_id


@dataclass
class DisplayList(UIComponent):
    """Read-only display list component."""
    items: List[Dict[str, Any]] = field(default_factory=list)
    max_height: Optional[int] = None
    
    def __init__(self, id: str, items: List[Dict[str, Any]] = None,
                 max_height: Optional[int] = None,
                 visible: bool = True, enabled: bool = True):
        super().__init__(id, UIComponentType.DISPLAY_LIST, visible, enabled)
        self.items = items or []
        self.max_height = max_height


@dataclass
class Dropdown(UIComponent):
    """Dropdown select component."""
    options: List[Dict[str, str]] = field(default_factory=list)
    selected_value: Optional[str] = None
    placeholder: str = ""
    
    def __init__(self, id: str, options: List[Dict[str, str]] = None,
                 selected_value: Optional[str] = None, placeholder: str = "",
                 visible: bool = True, enabled: bool = True):
        super().__init__(id, UIComponentType.DROPDOWN, visible, enabled)
        self.options = options or []
        self.selected_value = selected_value
        self.placeholder = placeholder


@dataclass
class TextInput(UIComponent):
    """Single-line text input component."""
    value: str = ""
    placeholder: str = ""
    
    def __init__(self, id: str, value: str = "", placeholder: str = "",
                 visible: bool = True, enabled: bool = True):
        super().__init__(id, UIComponentType.TEXT_INPUT, visible, enabled)
        self.value = value
        self.placeholder = placeholder


@dataclass
class TextArea(UIComponent):
    """Multi-line text area component."""
    value: str = ""
    placeholder: str = ""
    rows: int = 4
    
    def __init__(self, id: str, value: str = "", placeholder: str = "",
                 rows: int = 4, visible: bool = True, enabled: bool = True):
        super().__init__(id, UIComponentType.TEXT_AREA, visible, enabled)
        self.value = value
        self.placeholder = placeholder
        self.rows = rows


@dataclass
class Label(UIComponent):
    """Text label component."""
    text: str = ""
    style: str = "normal"  # normal, bold, italic, error, warning, success
    
    def __init__(self, id: str, text: str = "", style: str = "normal",
                 visible: bool = True):
        super().__init__(id, UIComponentType.LABEL, visible, True)
        self.text = text
        self.style = style


@dataclass
class Dialog:
    """Dialog container with title, content, and footer buttons."""
    id: str
    title: str
    components: List[UIComponent] = field(default_factory=list)
    footer_buttons: List[Button] = field(default_factory=list)
    closable: bool = True
    width: Optional[int] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert dialog to dictionary for JSON serialization."""
        return {
            'id': self.id,
            'title': self.title,
            'components': [c.to_dict() for c in self.components],
            'footer_buttons': [b.to_dict() for b in self.footer_buttons],
            'closable': self.closable,
            'width': self.width,
        }


def emit_ui_show(dialog: Dialog) -> None:
    """Show a dialog with UI components.
    
    Args:
        dialog: Dialog definition to display.
    """
    _emit({
        'type': 'ui_show',
        'dialog': dialog.to_dict(),
    })


def emit_ui_update(dialog_id: str, updates: Dict[str, Any]) -> None:
    """Update specific components in an existing dialog.
    
    Args:
        dialog_id: ID of the dialog to update.
        updates: Dictionary mapping component IDs to their new properties.
    """
    _emit({
        'type': 'ui_update',
        'dialog_id': dialog_id,
        'updates': updates,
    })


def emit_ui_close(dialog_id: str) -> None:
    """Close a dialog.
    
    Args:
        dialog_id: ID of the dialog to close.
    """
    _emit({
        'type': 'ui_close',
        'dialog_id': dialog_id,
    })


def load_ui_from_json(json_path: str) -> Dialog:
    """Load UI definition from a ui.json file.
    
    Args:
        json_path: Path to the ui.json file.
        
    Returns:
        Dialog object constructed from the JSON definition.
    """
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    return _parse_dialog(data)


def _parse_dialog(data: Dict[str, Any]) -> Dialog:
    """Parse dialog from dictionary."""
    components = [_parse_component(c) for c in data.get('components', [])]
    footer_buttons = [_parse_button(b) for b in data.get('footer_buttons', [])]
    
    return Dialog(
        id=data['id'],
        title=data['title'],
        components=components,
        footer_buttons=footer_buttons,
        closable=data.get('closable', True),
        width=data.get('width'),
    )


def _parse_component(data: Dict[str, Any]) -> UIComponent:
    """Parse component from dictionary."""
    comp_type = data['type']
    comp_id = data['id']
    visible = data.get('visible', True)
    enabled = data.get('enabled', True)
    
    if comp_type == 'button':
        return _parse_button(data)
    elif comp_type == 'checkbox_list':
        return CheckboxList(
            comp_id,
            items=data.get('items', []),
            selected_ids=data.get('selected_ids', []),
            max_height=data.get('max_height'),
            visible=visible,
            enabled=enabled,
        )
    elif comp_type == 'radio_list':
        return RadioList(
            comp_id,
            items=data.get('items', []),
            selected_id=data.get('selected_id'),
            visible=visible,
            enabled=enabled,
        )
    elif comp_type == 'display_list':
        return DisplayList(
            comp_id,
            items=data.get('items', []),
            max_height=data.get('max_height'),
            visible=visible,
            enabled=enabled,
        )
    elif comp_type == 'dropdown':
        return Dropdown(
            comp_id,
            options=data.get('options', []),
            selected_value=data.get('selected_value'),
            placeholder=data.get('placeholder', ''),
            visible=visible,
            enabled=enabled,
        )
    elif comp_type == 'text_input':
        return TextInput(
            comp_id,
            value=data.get('value', ''),
            placeholder=data.get('placeholder', ''),
            visible=visible,
            enabled=enabled,
        )
    elif comp_type == 'text_area':
        return TextArea(
            comp_id,
            value=data.get('value', ''),
            placeholder=data.get('placeholder', ''),
            rows=data.get('rows', 4),
            visible=visible,
            enabled=enabled,
        )
    elif comp_type == 'label':
        return Label(
            comp_id,
            text=data.get('text', ''),
            style=data.get('style', 'normal'),
            visible=visible,
        )
    else:
        raise ValueError(f"Unknown component type: {comp_type}")


def _parse_button(data: Dict[str, Any]) -> Button:
    """Parse button from dictionary."""
    return Button(
        data['id'],
        label=data.get('label', ''),
        variant=data.get('variant', 'default'),
        enabled=data.get('enabled', True),
        visible=data.get('visible', True),
    )
