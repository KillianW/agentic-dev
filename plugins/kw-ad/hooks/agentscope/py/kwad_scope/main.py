"""Process plumbing for the kw-ad PreToolUse scope hook (Python).

Reads the hook payload from stdin, loads scope-rules.json, asks core.py for a
decision, prints it, and appends an audit line. Mirrors ../../js/main.mjs.
Launched by ../../run/python3 or ../../run/python.

Modes:
  (no args)                 hook mode -- payload on stdin
  --self-test               print a one-line OK (used by check-runtime.sh / doctor)
  --check-config [path]     validate a scope-rules.json and print problems
"""

import datetime
import json
import os
import sys
import traceback

from .core import decide, format_audit_line, hook_output, normalize_agent_type, validate_config

MIN_PYTHON = (3, 8)


def project_root(env, payload_cwd):
    return env.get("CLAUDE_PROJECT_DIR") or payload_cwd or os.getcwd()


def config_path(env, root):
    return env.get("KW_AD_SCOPE_CONFIG") or os.path.join(root, ".claude", "kw-ad", "scope-rules.json")


def load_config(path):
    """Return {"config", "error", "warnings"}; config is None whenever error is set."""
    if not os.path.exists(path):
        return {"config": None, "error": "no scope-rules.json at %s" % path, "warnings": []}
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            raw = f.read()
    except (OSError, UnicodeDecodeError) as err:
        return {"config": None, "error": "cannot read %s: %s" % (path, err), "warnings": []}
    try:
        parsed = json.loads(raw)
    except ValueError as err:
        return {"config": None, "error": "invalid JSON in %s: %s" % (path, err), "warnings": []}
    errors, warnings = validate_config(parsed)
    if errors:
        return {"config": None, "error": "%s: %s" % (path, "; ".join(errors)), "warnings": warnings}
    return {"config": parsed, "error": None, "warnings": warnings}


def _append_audit(root, line):
    directory = os.path.join(root, ".claude", "kw-ad")
    try:
        os.makedirs(directory, exist_ok=True)
        with open(os.path.join(directory, "audit.log"), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError as err:
        sys.stderr.write("kw-ad: could not append audit log: %s\n" % err)


def _now_iso():
    now = datetime.datetime.now(datetime.timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (now.microsecond // 1000)


def _write_stdout(text):
    # Write UTF-8 bytes regardless of the platform's default stdout encoding.
    sys.stdout.buffer.write(text.encode("utf-8"))
    sys.stdout.flush()


def _self_test():
    if sys.version_info < MIN_PYTHON:
        sys.stderr.write("kw-ad: Python %s is too old; 3.8+ is required\n" % sys.version.split()[0])
        return 1
    _write_stdout("kw-ad hook ok (python %s)\n" % sys.version.split()[0])
    return 0


def _check_config(path):
    target = path or config_path(os.environ, project_root(os.environ, ""))
    loaded = load_config(target)
    for w in loaded["warnings"]:
        _write_stdout("warning: %s\n" % w)
    if loaded["error"]:
        _write_stdout("error: %s\n" % loaded["error"])
        return 1
    _write_stdout("ok: %s\n" % target)
    return 0


def _hook():
    try:
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("payload is not an object")
    except Exception as err:  # noqa: BLE001 -- any parse failure blocks
        sys.stderr.write("kw-ad: could not parse hook input: %s\n" % err)
        return 2

    agent_type = payload.get("agent_type") if isinstance(payload.get("agent_type"), str) else ""
    tool_name = payload.get("tool_name") or ""
    try:
        root = project_root(os.environ, payload.get("cwd"))
        loaded = load_config(config_path(os.environ, root))
        result = decide(agent_type, tool_name, payload.get("tool_input"), root, loaded)
        if not result["managed"]:
            return 0
        _append_audit(
            root,
            format_audit_line(_now_iso(), agent_type, tool_name, result["target"], result["decision"], result["reason"]),
        )
        _write_stdout(json.dumps(hook_output(result["decision"], result["reason"]), ensure_ascii=False, separators=(",", ":")) + "\n")
        return 0
    except Exception:  # noqa: BLE001
        sys.stderr.write("kw-ad: scope hook failed: %s\n" % traceback.format_exc())
        # Fail closed for subagents; the main session is never scope-restricted.
        return 0 if normalize_agent_type(agent_type) == "" else 2


def main(argv):
    if argv[:1] == ["--self-test"]:
        return _self_test()
    if argv[:1] == ["--check-config"]:
        return _check_config(argv[1] if len(argv) > 1 else None)
    return _hook()
