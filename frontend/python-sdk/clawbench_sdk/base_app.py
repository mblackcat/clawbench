"""Abstract base class for ClawBench apps."""

import argparse
import json
import sys
import traceback
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from clawbench_sdk.output import (
    emit_error as _emit_error,
    emit_output as _emit_output,
    emit_progress as _emit_progress,
    emit_result as _emit_result,
)
from clawbench_sdk.params import WorkspaceInfo


class ClawBenchApp(ABC):
    """Base class that all ClawBench apps should inherit from.

    Subclasses must implement the ``run`` method.  The framework handles CLI
    argument parsing, JSON loading, and top-level error handling so that app
    authors can focus on business logic.

    Typical usage::

        class MyApp(ClawBenchApp):
            def run(self) -> None:
                self.emit_output("Starting work...")
                self.emit_progress(50.0, "Halfway there")
                self.emit_result(True, "Done!")

        if __name__ == "__main__":
            MyApp.execute()
    """

    def __init__(self) -> None:
        parser = argparse.ArgumentParser(
            description="ClawBench app runner",
        )
        parser.add_argument(
            "--params",
            required=True,
            help="Path to a JSON file containing parameter values.",
        )
        parser.add_argument(
            "--workspace",
            required=True,
            help="Path to a JSON file containing workspace information.",
        )

        args = parser.parse_args()

        # Load parameter values from the JSON file.
        with open(args.params, "r", encoding="utf-8") as f:
            self.params: Dict[str, Any] = json.load(f)

        # Load workspace information from the JSON file.
        with open(args.workspace, "r", encoding="utf-8") as f:
            ws_data: Dict[str, Any] = json.load(f)

        self.workspace: WorkspaceInfo = WorkspaceInfo(
            path=ws_data.get("path", ""),
            vcs_type=ws_data.get("vcs_type", ""),
            name=ws_data.get("name", ""),
        )

    # ------------------------------------------------------------------
    # Abstract interface
    # ------------------------------------------------------------------

    @abstractmethod
    def run(self) -> None:
        """Execute the app logic.  Subclasses must implement this method."""
        ...

    # ------------------------------------------------------------------
    # Convenience wrappers that delegate to the output module
    # ------------------------------------------------------------------

    @staticmethod
    def emit_output(message: str, level: str = "info") -> None:
        """Emit a log-style output message."""
        _emit_output(message, level)

    @staticmethod
    def emit_progress(percent: float, message: str = "") -> None:
        """Emit a progress update."""
        _emit_progress(percent, message)

    @staticmethod
    def emit_result(
        success: bool, summary: str, data: Optional[Dict[str, Any]] = None
    ) -> None:
        """Emit the final result of the app execution."""
        _emit_result(success, summary, data)

    @staticmethod
    def emit_error(message: str, details: str = "") -> None:
        """Emit an error message."""
        _emit_error(message, details)

    # ------------------------------------------------------------------
    # Entry-point
    # ------------------------------------------------------------------

    @classmethod
    def execute(cls) -> None:
        """Instantiate the app, run it, and handle top-level exceptions.

        This is the recommended entry-point for scripts::

            if __name__ == "__main__":
                MyApp.execute()
        """
        try:
            app = cls()
            app.run()
        except SystemExit:
            # Re-raise so argparse errors propagate correctly.
            raise
        except Exception:
            tb = traceback.format_exc()
            _emit_result(False, "App failed with an unhandled exception.")
            _emit_error("Unhandled exception", details=tb)
            sys.exit(1)
