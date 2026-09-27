"""Unit tests for the Python implementation's pure logic (core.py) and config
loading (main.py). The glob and path cases are shared with the Node suite via
tests/hook-cases/."""

import json
import ntpath
import os
import posixpath
import shutil
import tempfile
import unittest

import helpers  # noqa: F401 -- sets sys.path
from helpers import load_cases
from kwad_scope import core, main


class MatchGlobTest(unittest.TestCase):
    def test_shared_cases(self):
        for c in load_cases("glob.json")["cases"]:
            with self.subTest(pattern=c["pattern"], path=c["path"]):
                self.assertEqual(core.match_glob(c["pattern"], c["path"]), c["match"])

    def test_whole_path_is_anchored(self):
        self.assertFalse(core.match_glob("a.md", "xa.md"))
        self.assertFalse(core.match_glob("a.md", "a.mdx"))


class ToProjectRelativeTest(unittest.TestCase):
    def test_shared_cases(self):
        for c in load_cases("paths.json")["cases"]:
            api = ntpath if c["style"] == "win32" else posixpath
            with self.subTest(style=c["style"], root=c["root"], path=c["path"]):
                self.assertEqual(core.to_project_relative(c["root"], c["path"], api), c["expected"])


class NormalizeAgentTypeTest(unittest.TestCase):
    def test_strips_only_this_plugins_prefix(self):
        self.assertEqual(core.normalize_agent_type("kw-ad:tdd-red"), "tdd-red")
        self.assertEqual(core.normalize_agent_type("tdd-red"), "tdd-red")
        self.assertEqual(core.normalize_agent_type("other:tdd-red"), "other:tdd-red")
        self.assertEqual(core.normalize_agent_type(None), "")
        self.assertEqual(core.normalize_agent_type(42), "")


def _minimal():
    return {
        "version": 1,
        "agents": {a: {"edit": {"default": {"decision": "deny"}}} for a in ("tdd-red", "tdd-green", "tdd-refactor", "scribe")},
    }


class ValidateConfigTest(unittest.TestCase):
    def test_minimal_complete_config_is_clean(self):
        self.assertEqual(core.validate_config(_minimal()), ([], []))

    def test_rejects_non_objects(self):
        self.assertEqual(core.validate_config([])[0], ["config must be a JSON object"])
        self.assertEqual(core.validate_config(None)[0], ["config must be a JSON object"])

    def test_boolean_true_is_not_version_1(self):
        cfg = _minimal()
        cfg["version"] = True
        self.assertIn("version must be 1", core.validate_config(cfg)[0])

    def test_rejects_ask_bad_match_lists_and_bad_reasons(self):
        cfg = _minimal()
        cfg["agents"]["tdd-red"]["edit"]["rules"] = [
            {"match": ["a"], "decision": "ask"},
            {"match": [], "decision": "allow"},
            {"match": "a", "decision": "allow"},
            {"match": ["a"], "decision": "allow", "reason": 5},
        ]
        errors = core.validate_config(cfg)[0]
        self.assertEqual(len(errors), 4)
        self.assertIn("rules[0].decision", errors[0])
        self.assertIn("rules[1].match", errors[1])
        self.assertIn("rules[2].match", errors[2])
        self.assertIn("rules[3].reason", errors[3])

    def test_bash_rules_need_match_exact(self):
        cfg = _minimal()
        cfg["agents"]["tdd-red"]["bash"] = {"rules": [{"match": ["make test"], "decision": "allow"}], "default": {"decision": "deny"}}
        self.assertIn("match_exact", core.validate_config(cfg)[0][0])

    def test_warnings(self):
        errors, warnings = core.validate_config({"version": 1, "agents": {"scribe": {"edit": {"rules": []}, "write": {}}}})
        self.assertEqual(errors, [])
        self.assertTrue(any("agents.tdd-red is missing" in w for w in warnings))
        self.assertTrue(any("agents.scribe.edit has no default" in w for w in warnings))
        self.assertTrue(any("agents.scribe.write is not a recognized section" in w for w in warnings))


class DecideTest(unittest.TestCase):
    LOADED = {
        "config": {
            "version": 1,
            "agents": {"tdd-red": {"edit": {"rules": [{"match": ["tests/**"], "decision": "allow"}], "default": {"decision": "deny"}}}},
        },
        "error": None,
    }

    def test_audits_project_relative_target(self):
        r = core.decide("kw-ad:tdd-red", "Edit", {"file_path": "/repo/tests/a.py"}, "/repo", self.LOADED, posixpath)
        self.assertEqual(r, {"managed": True, "target": "tests/a.py", "decision": "allow", "reason": ""})

    def test_win32_semantics(self):
        r = core.decide("kw-ad:tdd-red", "Write", {"file_path": "C:\\repo\\tests\\a.py"}, "C:\\repo", self.LOADED, ntpath)
        self.assertEqual(r["decision"], "allow")
        self.assertEqual(r["target"], "tests/a.py")

    def test_non_object_tool_input_is_empty(self):
        r = core.decide("kw-ad:tdd-red", "Edit", "nope", "/repo", self.LOADED, posixpath)
        self.assertEqual(r["decision"], "deny")
        self.assertIn("no file path", r["reason"])

    def test_empty_section_object_is_present_not_missing(self):
        loaded = {"config": {"version": 1, "agents": {"tdd-red": {"bash": {}}}}, "error": None}
        r = core.decide("kw-ad:tdd-red", "Bash", {"command": "x"}, "/repo", loaded, posixpath)
        self.assertIn("no default is configured", r["reason"])


class FormatTest(unittest.TestCase):
    def test_audit_line(self):
        parsed = json.loads(core.format_audit_line("2026-08-12T10:00:00.000Z", "kw-ad:tdd-red", "Edit", "src/a.go", "deny", "nope"))
        self.assertEqual(
            parsed,
            {
                "timestamp": "2026-08-12T10:00:00.000Z",
                "agent_type": "kw-ad:tdd-red",
                "tool_name": "Edit",
                "target": "src/a.go",
                "decision": "deny",
                "reason": "nope",
            },
        )

    def test_omits_empty_reason(self):
        self.assertNotIn("reason", json.loads(core.format_audit_line("t", "", "Bash", "x", "allow", "")))
        self.assertEqual(
            core.hook_output("allow", ""),
            {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}},
        )


class MainConfigResolutionTest(unittest.TestCase):
    def test_precedence(self):
        self.assertEqual(main.project_root({"CLAUDE_PROJECT_DIR": "/a"}, "/b"), "/a")
        self.assertEqual(main.project_root({}, "/b"), "/b")
        self.assertEqual(main.config_path({"KW_AD_SCOPE_CONFIG": "/x.json"}, "/a"), "/x.json")
        self.assertEqual(main.config_path({}, "/a"), os.path.join("/a", ".claude", "kw-ad", "scope-rules.json"))

    def test_load_config(self):
        d = tempfile.mkdtemp(prefix="kw-ad-load-")
        try:
            path = os.path.join(d, "scope-rules.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"version": 1, "agents": {"scribe": {"edit": {"rules": []}}}}, f)
            ok = main.load_config(path)
            self.assertIsNone(ok["error"])
            self.assertTrue(ok["warnings"])

            with open(path, "w", encoding="utf-8") as f:
                json.dump({"version": 1}, f)
            bad = main.load_config(path)
            self.assertIsNone(bad["config"])
            self.assertIn("agents must be an object", bad["error"])
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
