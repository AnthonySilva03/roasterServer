"""Syntax-check the frontend scripts and run the node unit tests for the
pure roast-math helpers. Skipped when node is not installed (e.g. on the Pi)."""

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
JS_DIR = ROOT / "app" / "static" / "js"

node = shutil.which("node")
pytestmark = pytest.mark.skipif(node is None, reason="node is not installed")


@pytest.mark.parametrize("script", sorted(p.name for p in JS_DIR.glob("*.js")))
def test_frontend_script_parses(script):
    result = subprocess.run(
        [node, "--check", str(JS_DIR / script)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_frontend_unit_tests_pass():
    test_files = sorted(str(p) for p in (ROOT / "tests" / "js").glob("*.test.js"))
    assert test_files, "no node test files found"
    result = subprocess.run(
        [node, "--test", *test_files],
        capture_output=True,
        text=True,
        check=False,
        cwd=ROOT,
    )
    assert result.returncode == 0, result.stdout + result.stderr
