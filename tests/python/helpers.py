"""Shared paths and fixtures for the Python test suites."""

import json
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PLUGIN_ROOT = os.path.join(REPO_ROOT, "plugins", "kw-ad")
HOOK_DIR = os.path.join(PLUGIN_ROOT, "hooks", "agentscope")
CASES_DIR = os.path.join(REPO_ROOT, "tests", "hook-cases")

sys.dont_write_bytecode = True
if os.path.join(HOOK_DIR, "py") not in sys.path:
    sys.path.insert(0, os.path.join(HOOK_DIR, "py"))


def load_cases(name):
    with open(os.path.join(CASES_DIR, name), encoding="utf-8") as f:
        return json.load(f)


def decision_case_files():
    return sorted(f for f in os.listdir(CASES_DIR) if f.startswith("decisions-") and f.endswith(".json"))


def substitute(value, project):
    """Replace "{project}" in every string inside value."""
    if isinstance(value, str):
        return value.replace("{project}", project)
    if isinstance(value, list):
        return [substitute(v, project) for v in value]
    if isinstance(value, dict):
        return {k: substitute(v, project) for k, v in value.items()}
    return value
