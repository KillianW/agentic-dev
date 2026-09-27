"""End-to-end conformance: spawn the real Python launcher (run/python) for
every case in tests/hook-cases/decisions-*.json. tests/node/conformance.test.mjs
runs the same cases against the Node launcher."""

import filecmp
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import helpers  # noqa: F401 -- sets sys.path
from helpers import HOOK_DIR, PLUGIN_ROOT, decision_case_files, load_cases, substitute

LAUNCHER = os.path.join(HOOK_DIR, "run", "python")


def run_launcher(args, stdin="", env=None):
    full_env = dict(os.environ)
    full_env.pop("KW_AD_SCOPE_CONFIG", None)
    full_env.pop("CLAUDE_PROJECT_DIR", None)
    for k, v in (env or {}).items():
        if v is None:
            full_env.pop(k, None)
        else:
            full_env[k] = v
    return subprocess.run(
        [sys.executable, LAUNCHER] + list(args),
        input=stdin.encode("utf-8"),
        env=full_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


class ConformanceTest(unittest.TestCase):
    def test_decision_cases(self):
        for file in decision_case_files():
            suite = load_cases(file)
            for case in suite["cases"]:
                with self.subTest(file=file, case=case["name"]):
                    self._run_case(suite, case)

    def _run_case(self, suite, case):
        project = tempfile.mkdtemp(prefix="kw-ad-case-")
        try:
            config = case["config"] if "config" in case else suite["config"]
            if config is not None:
                directory = os.path.join(project, ".claude", "kw-ad")
                os.makedirs(directory)
                if isinstance(config, dict) and "$raw" in config:
                    text = config["$raw"]
                else:
                    text = json.dumps(config)
                with open(os.path.join(directory, "scope-rules.json"), "w", encoding="utf-8", newline="") as f:
                    f.write(text)
            if "stdin_raw" in case:
                stdin = case["stdin_raw"]
            else:
                stdin = json.dumps(substitute(case["payload"], project))
            env = {"CLAUDE_PROJECT_DIR": project}
            env.update(substitute(case.get("env", {}), project))
            res = run_launcher([], stdin, env)
            stdout = res.stdout.decode("utf-8")
            stderr = res.stderr.decode("utf-8", "replace")

            exp = case["expect"]
            self.assertEqual(res.returncode, exp["exit"], "exit code (stderr: %s)" % stderr)
            if exp["decision"] is None:
                self.assertEqual(stdout, "", "expected no stdout")
            else:
                out = json.loads(stdout)["hookSpecificOutput"]
                self.assertEqual(out["hookEventName"], "PreToolUse")
                self.assertEqual(out["permissionDecision"], exp["decision"])
                if exp["decision"] == "deny":
                    self.assertTrue(out.get("permissionDecisionReason"), "deny must carry a reason")
                if exp.get("reason_includes"):
                    self.assertIn(exp["reason_includes"], out.get("permissionDecisionReason", ""))

            audit_path = os.path.join(project, ".claude", "kw-ad", "audit.log")
            expect_audit = exp.get("audit", exp["decision"] is not None)
            if expect_audit:
                with open(audit_path, encoding="utf-8") as f:
                    lines = f.read().strip().split("\n")
                self.assertEqual(len(lines), 1)
                entry = json.loads(lines[0])
                self.assertEqual(entry["decision"], exp["decision"])
                self.assertEqual(entry["agent_type"], case["payload"].get("agent_type", ""))
            else:
                self.assertFalse(os.path.exists(audit_path), "expected no audit log")
        finally:
            shutil.rmtree(project, ignore_errors=True)


class LauncherModesTest(unittest.TestCase):
    def test_self_test(self):
        res = run_launcher(["--self-test"])
        self.assertEqual(res.returncode, 0)
        self.assertTrue(res.stdout.decode("utf-8").startswith("kw-ad hook ok (python "))

    def test_check_config(self):
        d = tempfile.mkdtemp(prefix="kw-ad-check-")
        try:
            path = os.path.join(d, "scope-rules.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(load_cases("decisions-edit.json")["config"], f)
            ok = run_launcher(["--check-config", path])
            self.assertEqual(ok.returncode, 0, ok.stdout)
            self.assertIn("ok: ", ok.stdout.decode("utf-8"))

            with open(path, "w", encoding="utf-8") as f:
                f.write('{"version": 1, "agents": {"scribe": {"edit": {"rules": [{"match": ["x"], "decision": "ask"}]}}}}')
            bad = run_launcher(["--check-config", path])
            self.assertEqual(bad.returncode, 1)
            self.assertRegex(bad.stdout.decode("utf-8"), r'(?m)^error: .*decision must be "allow" or "deny"')
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_shipped_presets_pass_check_config_cleanly(self):
        presets = os.path.join(PLUGIN_ROOT, "templates", "presets")
        paths = [os.path.join(presets, f) for f in sorted(os.listdir(presets)) if f.endswith(".json")]
        self.assertTrue(paths)
        for path in paths:
            with self.subTest(path=path):
                res = run_launcher(["--check-config", path])
                self.assertEqual(res.returncode, 0, res.stdout)
                self.assertNotIn("warning:", res.stdout.decode("utf-8"))

    def test_python_launchers_are_identical(self):
        # hooks.json picks run/<hook_runtime>; both Python names must behave the same.
        self.assertTrue(
            filecmp.cmp(os.path.join(HOOK_DIR, "run", "python"), os.path.join(HOOK_DIR, "run", "python3"), shallow=False)
        )


if __name__ == "__main__":
    unittest.main()
