"""JSON-line output protocol for communicating with the ClawBench Desktop App."""

import json
import sys
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Optional


class OutputType(Enum):
    """Types of messages emitted over the JSON-line protocol."""

    OUTPUT = "output"
    PROGRESS = "progress"
    RESULT = "result"
    ERROR = "error"


def _emit(data: Dict[str, Any]) -> None:
    """Print a JSON-encoded line to stdout and flush immediately."""
    print(json.dumps(data), flush=True)


def emit_output(message: str, level: str = "info") -> None:
    """Emit a log-style output message.

    Args:
        message: The message text to emit.
        level: Severity level (e.g. "info", "warn", "error", "debug").
    """
    _emit({
        "type": OutputType.OUTPUT.value,
        "message": message,
        "level": level,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


def emit_progress(percent: float, message: str = "") -> None:
    """Emit a progress update.

    Args:
        percent: Completion percentage (0.0 to 100.0).
        message: Optional description of current work.
    """
    _emit({
        "type": OutputType.PROGRESS.value,
        "percent": percent,
        "message": message,
    })


def emit_result(success: bool, summary: str, data: Optional[Dict[str, Any]] = None) -> None:
    """Emit the final result of the app execution.

    Args:
        success: Whether the app completed successfully.
        summary: Short human-readable summary of the outcome.
        data: Optional dictionary of structured result data.
    """
    payload: Dict[str, Any] = {
        "type": OutputType.RESULT.value,
        "success": success,
        "summary": summary,
    }
    if data is not None:
        payload["data"] = data
    _emit(payload)


def emit_error(message: str, details: str = "") -> None:
    """Emit an error message.

    Args:
        message: Short error description.
        details: Optional extended details such as a traceback.
    """
    _emit({
        "type": OutputType.ERROR.value,
        "message": message,
        "details": details,
    })
