"""Tests for scripts/vendor.sh. Needs a POSIX `sh`; each runtime-specific
test is skipped when that runtime isn't usable on this machine."""

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

import helpers  # noqa: F401
from helpers import PLUGIN_ROOT, REPO_ROOT

SCRIPT = os.path.join(REPO_ROOT, "scripts", "vendor.sh")
SH = shutil.which("sh")


def _usable(runtime):
    """True if `runtime` is on PATH and passes the hook self-test."""
    if shutil.which(runtime) is None:
        return False
    launcher = os.path.join(PLUGIN_ROOT, "hooks", "agentscope", "run", runtime)
    try:
        res = subprocess.run([runtime, launcher, "--self-test"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return res.returncode == 0


PYTHON_RUNTIME = next((r for r in ("python3", "python") if _usable(r)), None)
NODE_OK = _usable("node")


def _sh_path(p):
    return p.replace("\\", "/")


@unittest.skipIf(SH is None, "no POSIX sh available")
class VendorTest(unittest.TestCase):
    def setUp(self):
        self.target = tempfile.mkdtemp(prefix="kw-ad-vendor-")
        self.addCleanup(shutil.rmtree, self.target, True)

    def vendor(self, *args, expect_ok=True):
        res = subprocess.run(
            [SH, _sh_path(SCRIPT), _sh_path(self.target)] + list(args),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if expect_ok:
            self.assertEqual(res.returncode, 0, res.stderr.decode("utf-8", "replace"))
        return res

    def read(self, *parts):
        with open(os.path.join(self.target, ".claude", *parts), encoding="utf-8") as f:
            return f.read()

    def check_layout(self, runtime):
        agents = sorted(os.listdir(os.path.join(PLUGIN_ROOT, "agents")))
        self.assertEqual(sorted(os.listdir(os.path.join(self.target, ".claude", "agents"))), agents)
        skills = sorted("kw-ad-" + s for s in os.listdir(os.path.join(PLUGIN_ROOT, "skills")))
        self.assertEqual(sorted(os.listdir(os.path.join(self.target, ".claude", "skills"))), skills)

        for skill in skills:
            text = self.read("skills", skill, "SKILL.md")
            self.assertRegex(text, r"(?m)^name: %s$" % re.escape(skill))
        for rendered in [self.read("agents", a) for a in agents] + [self.read("skills", s, "SKILL.md") for s in skills]:
            self.assertNotIn("${user_config.", rendered)
            self.assertNotIn("${CLAUDE_PLUGIN_ROOT}", rendered)
            self.assertNotIn("kw-ad:", rendered)

        tdd = self.read("skills", "kw-ad-tdd", "SKILL.md")
        self.assertIn("subagent_type: tdd-architect", tdd)
        self.assertIn("/kw-ad-ship", tdd)
        doctor = self.read("skills", "kw-ad-doctor", "SKILL.md")
        self.assertIn("%s \".claude/kw-ad/vendor/hooks/agentscope/run/%s\" --self-test" % (runtime, runtime), doctor)
        self.assertIn("acme/widgets", self.read("agents", "tdd-architect.md"))

        vendor = os.path.join(self.target, ".claude", "kw-ad", "vendor")
        self.assertTrue(os.path.isfile(os.path.join(vendor, "hooks", "agentscope", "run", runtime)))
        self.assertTrue(os.path.isfile(os.path.join(vendor, "hooks", "check-runtime.sh")))
        self.assertTrue(os.path.isfile(os.path.join(vendor, "templates", "presets", "go.json")))
        with open(os.path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), encoding="utf-8") as f:
            version = json.load(f)["version"]
        with open(os.path.join(vendor, "VERSION"), encoding="utf-8") as f:
            self.assertEqual(f.read().strip(), version)

        settings = json.loads(self.read("settings.json"))
        pre = settings["hooks"]["PreToolUse"]
        self.assertEqual(len(pre), 1)
        self.assertEqual(pre[0]["hooks"][0]["command"], runtime)
        self.assertEqual(
            pre[0]["hooks"][0]["args"], ["${CLAUDE_PROJECT_DIR}/.claude/kw-ad/vendor/hooks/agentscope/run/" + runtime]
        )
        start = settings["hooks"]["SessionStart"]
        self.assertEqual(len(start), 1)
        self.assertEqual(start[0]["hooks"][0]["args"][1], runtime)
        return settings

    def check_vendored_hook_denies_bare_agent(self, runtime):
        launcher = os.path.join(self.target, ".claude", "kw-ad", "vendor", "hooks", "agentscope", "run", runtime)
        payload = {"agent_type": "tdd-red", "tool_name": "Edit", "tool_input": {"file_path": os.path.join(self.target, "a.go")}}
        env = dict(os.environ, CLAUDE_PROJECT_DIR=self.target)
        env.pop("KW_AD_SCOPE_CONFIG", None)
        res = subprocess.run([runtime, launcher], input=json.dumps(payload).encode("utf-8"), env=env, stdout=subprocess.PIPE)
        self.assertEqual(res.returncode, 0)
        out = json.loads(res.stdout.decode("utf-8"))["hookSpecificOutput"]
        self.assertEqual(out["permissionDecision"], "deny")  # no scope-rules.json yet -> fail closed

    def run_full(self, runtime):
        self.vendor("--runtime", runtime, "--owner", "acme", "--repo", "widgets")
        self.check_layout(runtime)
        self.check_vendored_hook_denies_bare_agent(runtime)

    @unittest.skipUnless(NODE_OK, "node not usable")
    def test_node(self):
        self.run_full("node")

    @unittest.skipUnless(PYTHON_RUNTIME, "no usable python3/python")
    def test_python(self):
        self.run_full(PYTHON_RUNTIME)

    @unittest.skipUnless(PYTHON_RUNTIME, "no usable python3/python")
    def test_merge_preserves_existing_settings_and_is_idempotent(self):
        os.makedirs(os.path.join(self.target, ".claude"))
        existing = {
            "permissions": {"allow": ["Bash(ls)"]},
            "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "mine.sh"}]}]},
        }
        with open(os.path.join(self.target, ".claude", "settings.json"), "w", encoding="utf-8") as f:
            json.dump(existing, f)

        self.vendor("--runtime", PYTHON_RUNTIME, "--owner", "acme", "--repo", "widgets")
        self.vendor("--runtime", PYTHON_RUNTIME, "--owner", "acme", "--repo", "widgets", "--force")

        settings = json.loads(self.read("settings.json"))
        self.assertEqual(settings["permissions"], {"allow": ["Bash(ls)"]})
        commands = [g["hooks"][0]["command"] for g in settings["hooks"]["PreToolUse"]]
        self.assertEqual(commands, ["mine.sh", PYTHON_RUNTIME])
        self.assertEqual(len(settings["hooks"]["SessionStart"]), 1)

    @unittest.skipUnless(PYTHON_RUNTIME, "no usable python3/python")
    def test_refuses_to_overwrite_without_force(self):
        self.vendor("--runtime", PYTHON_RUNTIME)
        res = self.vendor("--runtime", PYTHON_RUNTIME, expect_ok=False)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn(b"--force", res.stderr)

    def test_rejects_bad_arguments(self):
        self.assertIn(b"--runtime is required", self.vendor(expect_ok=False).stderr)
        self.assertIn(b"must be node, python3, or python", self.vendor("--runtime", "ruby", expect_ok=False).stderr)


if __name__ == "__main__":
    unittest.main()
