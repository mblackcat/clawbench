import io
import json
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from clawbench_sdk import ClawBenchApp, version as sdk_version


class RecordingApp(ClawBenchApp):
    run_calls = 0
    slot_calls: list[str] = []

    def run(self) -> None:
        type(self).run_calls += 1

    def resolve_slot(self, slot: str) -> object:
        type(self).slot_calls.append(slot)
        if slot == "models":
            return {"options": ["a", "b"], "default": "a"}
        return super().resolve_slot(slot)


class SlotProtocolTests(unittest.TestCase):
    def setUp(self) -> None:
        RecordingApp.run_calls = 0
        RecordingApp.slot_calls = []
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        self.params = root / "params.json"
        self.workspace = root / "workspace.json"
        self.params.write_text('{"url":"http://proxy"}', encoding="utf-8")
        self.workspace.write_text(
            '{"path":"D:/repo","name":"repo","vcs_type":"git"}',
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def argv(self, *extra: str) -> list[str]:
        return [
            "main.py",
            "--params",
            str(self.params),
            "--workspace",
            str(self.workspace),
            *extra,
        ]

    def test_normal_execution_still_calls_run(self) -> None:
        with patch.object(sys, "argv", self.argv()):
            RecordingApp.execute()

        self.assertEqual(RecordingApp.run_calls, 1)
        self.assertEqual(RecordingApp.slot_calls, [])

    def test_slot_execution_emits_result_without_calling_run(self) -> None:
        stream = io.StringIO()
        with patch.object(sys, "argv", self.argv("--slot", "models")):
            with redirect_stdout(stream):
                RecordingApp.execute()

        payload = json.loads(stream.getvalue())
        self.assertEqual(
            payload,
            {
                "type": "slot_result",
                "slot": "models",
                "data": {"options": ["a", "b"], "default": "a"},
            },
        )
        self.assertEqual(RecordingApp.run_calls, 0)
        self.assertEqual(RecordingApp.slot_calls, ["models"])

    def test_slot_execution_loads_current_params_and_workspace(self) -> None:
        class ContextApp(ClawBenchApp):
            def run(self) -> None:
                raise AssertionError("run must not be called in slot mode")

            def resolve_slot(self, slot: str) -> object:
                return {
                    "slot": slot,
                    "url": self.params["url"],
                    "workspace": self.workspace.path,
                }

        stream = io.StringIO()
        with patch.object(sys, "argv", self.argv("--slot", "context")):
            with redirect_stdout(stream):
                ContextApp.execute()

        self.assertEqual(
            json.loads(stream.getvalue())["data"],
            {
                "slot": "context",
                "url": "http://proxy",
                "workspace": "D:/repo",
            },
        )

    def test_unknown_slot_exits_with_structured_error(self) -> None:
        stream = io.StringIO()
        with patch.object(sys, "argv", self.argv("--slot", "missing")):
            with redirect_stdout(stream):
                with self.assertRaises(SystemExit) as raised:
                    RecordingApp.execute()

        self.assertEqual(raised.exception.code, 1)
        messages = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertEqual(messages[-1]["type"], "error")
        self.assertIn("Unknown slot: missing", messages[-1]["details"])

    def test_package_metadata_matches_runtime_version(self) -> None:
        pyproject = Path(__file__).parents[1] / "pyproject.toml"
        match = re.search(
            r'^version = "([^"]+)"$',
            pyproject.read_text(encoding="utf-8"),
            re.MULTILINE,
        )

        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), sdk_version)


if __name__ == "__main__":
    unittest.main()
