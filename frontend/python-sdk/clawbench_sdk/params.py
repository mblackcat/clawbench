"""Parameter type definitions for the ClawBench SDK."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, List, Optional


class ParamType(Enum):
    """Supported parameter types for clawbench app configuration."""

    STRING = "string"
    BOOLEAN = "boolean"
    NUMBER = "number"
    ENUM = "enum"
    PATH = "path"
    TEXT = "text"


@dataclass
class ParamDef:
    """Definition of a single parameter accepted by a clawbench app.

    Attributes:
        name: The parameter identifier used as its key.
        type: The type of the parameter value.
        label: Human-readable label displayed in the UI.
        description: Longer description or help text for the parameter.
        required: Whether the parameter must be provided.
        default: Default value when the parameter is not provided.
        options: List of allowed values when type is ENUM.
    """

    name: str
    type: ParamType
    label: str = ""
    description: str = ""
    required: bool = False
    default: Any = None
    options: List[str] = field(default_factory=list)


@dataclass
class WorkspaceInfo:
    """Information about the workspace the app is running against.

    Attributes:
        path: Absolute filesystem path to the workspace root.
        vcs_type: Version control system type (e.g. "git", "svn", or empty).
        name: Human-readable name of the workspace.
    """

    path: str
    vcs_type: str = ""
    name: str = ""
