"""Tests for hooks/check-runtime.sh, the SessionStart runtime check.

Needs a POSIX `sh` (Git Bash on Windows); skipped when none is available.
"""

import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

import helpers  # noqa: F401
from helpers import PLUGIN_ROOT

SCRIPT = os.path.join(PLUGIN_ROOT, "hooks", "check-runtime.sh")
SH = shutil.which("sh")


def _fake_runtime(directory, name, body):
    """Put an executable shell script called `name` in `directory`."""
    path = os.path.join(directory, name)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("#!/bin/sh\n" + body + "\n")
    os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return path


@unittest.skipIf(SH is None, "no POSIX sh available")
class CheckRuntimeTest(unittest.TestCase):
    def run_check(self, runtime, extra_path=None):
        env = dict(os.environ)
        env["CLAUDE_PLUGIN_ROOT"] = PLUGIN_ROOT
        if runtime is None:
            env.pop("CLAUDE_PLUGIN_OPTION_HOOK_RUNTIME", None)
        else:
            env["CLAUDE_PLUGIN_OPTION_HOOK_RUNTIME"] = runtime
        if extra_path:
            env["PATH"] = extra_path + os.pathsep + env.get("PATH", "")
        res = subprocess.run([SH, SCRIPT], input=b"{}", env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(res.returncode, 0, res.stderr)
        return res.stdout.decode("utf-8").strip()

    def assert_warning(self, out, fragment):
        self.assertTrue(out, "expected a warning")
        parsed = json.loads(out)
        self.assertIn(fragment, parsed["systemMessage"])
        self.assertEqual(parsed["hookSpecificOutput"]["hookEventName"], "SessionStart")
        self.assertIn(fragment, parsed["hookSpecificOutput"]["additionalContext"])

    def test_unset_runtime_warns(self):
        self.assert_warning(self.run_check(None), "not set")

    def test_unsupported_runtime_warns(self):
        self.assert_warning(self.run_check("ruby"), "not supported")

    def test_quotes_in_value_do_not_break_json(self):
        self.assert_warning(self.run_check('no"de\\'), "not supported")

    @unittest.skipIf(sys.platform == "win32", "fake PATH executables are unreliable under Git Bash")
    def test_broken_runtime_warns_with_its_output(self):
        d = tempfile.mkdtemp()
        try:
            _fake_runtime(d, "python3", 'echo "install the command line developer tools" >&2; exit 1')
            self.assert_warning(self.run_check("python3", extra_path=d), "failed its self-test")
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_working_runtime_is_silent(self):
        d = tempfile.mkdtemp()
        try:
            if sys.platform == "win32":
                # Git Bash resolves `python` to the interpreter running these tests.
                runtime, extra = "python", os.path.dirname(sys.executable)
            else:
                _fake_runtime(d, "python3", 'exec "%s" "$@"' % sys.executable)
                runtime, extra = "python3", d
            self.assertEqual(self.run_check(runtime, extra_path=extra), "")
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
