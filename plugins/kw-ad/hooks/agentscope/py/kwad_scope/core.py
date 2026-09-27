"""Pure decision logic for the kw-ad PreToolUse scope hook (Python).

No process I/O here -- main.py owns stdin/stdout/filesystem -- so everything
below is directly unit-testable.

This module and ../../js/core.mjs are two implementations of one behavior
spec. tests/hook-cases/*.json is that spec; both test suites run every case,
so a change here needs the matching change there. Standard library only;
Python 3.8+.
"""

import json
import os.path
import re

PLUGIN_PREFIX = "kw-ad:"

# Agents whose Edit/Write/Bash calls are always under scope rules. If the
# config is missing, broken, or omits one of these, its calls are denied
# (fail closed) rather than silently allowed.
RESTRICTED_AGENTS = ("tdd-red", "tdd-green", "tdd-refactor", "scribe")

EDIT_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")
SHELL_TOOLS = ("Bash", "PowerShell")

DECISIONS = ("allow", "deny")

_METACHARS = ".+?^${}()|[]\\"


def glob_to_regex(pattern):
    """Translate the hook's small glob syntax into a compiled regex.

    '**/' matches zero or more whole path segments, '**' (not followed by '/')
    matches anything, '*' matches within one segment. Everything else is
    literal. Single-pass scan, mirroring globToRegExp in core.mjs.
    """
    out = []
    i = 0
    n = len(pattern)
    while i < n:
        c = pattern[i]
        if c == "*":
            if i + 1 < n and pattern[i + 1] == "*":
                i += 2
                if i < n and pattern[i] == "/":
                    out.append("(?:[^/]+/)*")
                    i += 1
                else:
                    out.append(".*")
            else:
                out.append("[^/]*")
                i += 1
            continue
        out.append("\\" + c if c in _METACHARS else c)
        i += 1
    return re.compile("".join(out))


def match_glob(pattern, file_path):
    # fullmatch, not "^...$": Python's "$" also matches before a trailing
    # newline, which JavaScript's does not.
    return glob_to_regex(pattern).fullmatch(file_path) is not None


def normalize_agent_type(agent_type):
    """'kw-ad:tdd-red' -> 'tdd-red'; bare names (vendored installs) pass through."""
    s = agent_type if isinstance(agent_type, str) else ""
    return s[len(PLUGIN_PREFIX):] if s.startswith(PLUGIN_PREFIX) else s


def to_project_relative(project_root, file_path, path_api=os.path):
    """Project-relative forward-slash path, or None if outside project_root.

    path_api is injectable (ntpath/posixpath) so tests can exercise win32
    semantics on any host.
    """
    abs_path = path_api.normpath(path_api.join(project_root, file_path))
    try:
        rel = path_api.relpath(abs_path, project_root)
    except ValueError:  # different drive on Windows
        return None
    if rel in ("", ".") or path_api.isabs(rel):
        return None
    fwd = rel.replace(path_api.sep, "/").replace("\\", "/")
    if fwd == ".." or fwd.startswith("../"):
        return None
    return fwd


def _is_object(v):
    return isinstance(v, dict)


def _is_string_list(v):
    return isinstance(v, list) and len(v) > 0 and all(isinstance(s, str) and s for s in v)


def validate_config(config):
    """Return (errors, warnings). Any error makes the config unusable."""
    errors = []
    warnings = []
    if not _is_object(config):
        return ["config must be a JSON object"], warnings
    if config.get("version") != 1 or isinstance(config.get("version"), bool):
        errors.append("version must be 1")
    if "unknown_agent_decision" in config and config["unknown_agent_decision"] not in DECISIONS:
        errors.append('unknown_agent_decision must be "allow" or "deny"')
    agents = config.get("agents")
    if not _is_object(agents):
        errors.append("agents must be an object")
        return errors, warnings
    for name, agent_cfg in agents.items():
        where = "agents.%s" % name
        if ":" in name:
            errors.append('%s: use the bare agent name (no "plugin:" prefix)' % where)
        if not _is_object(agent_cfg):
            errors.append("%s must be an object" % where)
            continue
        for key in agent_cfg:
            if key not in ("edit", "bash"):
                warnings.append("%s.%s is not a recognized section (edit, bash)" % (where, key))
        for section, match_key in (("edit", "match"), ("bash", "match_exact")):
            if section not in agent_cfg:
                continue
            sec = agent_cfg[section]
            swhere = "%s.%s" % (where, section)
            if not _is_object(sec):
                errors.append("%s must be an object" % swhere)
                continue
            if "rules" in sec:
                if not isinstance(sec["rules"], list):
                    errors.append("%s.rules must be an array" % swhere)
                else:
                    for i, rule in enumerate(sec["rules"]):
                        rwhere = "%s.rules[%d]" % (swhere, i)
                        if not _is_object(rule):
                            errors.append("%s must be an object" % rwhere)
                            continue
                        if rule.get("decision") not in DECISIONS:
                            errors.append('%s.decision must be "allow" or "deny"' % rwhere)
                        if not _is_string_list(rule.get(match_key)):
                            errors.append("%s.%s must be a non-empty list of non-empty strings" % (rwhere, match_key))
                        if "reason" in rule and not isinstance(rule["reason"], str):
                            errors.append("%s.reason must be a string" % rwhere)
            if "default" in sec:
                d = sec["default"]
                if not _is_object(d) or d.get("decision") not in DECISIONS:
                    errors.append('%s.default.decision must be "allow" or "deny"' % swhere)
                elif "reason" in d and not isinstance(d["reason"], str):
                    errors.append("%s.default.reason must be a string" % swhere)
            else:
                warnings.append("%s has no default; unmatched calls will be denied" % swhere)
    for name in RESTRICTED_AGENTS:
        if name not in agents:
            warnings.append("agents.%s is missing; every Edit/Write/Bash call from it will be denied" % name)
    return errors, warnings


def _deny(target, reason):
    return {"managed": True, "target": target, "decision": "deny", "reason": reason}


def _first_match(rules, test):
    for rule in rules or []:
        if test(rule):
            return {"decision": rule["decision"], "reason": rule.get("reason", "")}
    return None


def _js_string(v):
    """Coerce like JavaScript's String(v ?? "") for the fields we read."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return json.dumps(v)
    return str(v)


def decide(agent_type, tool_name, tool_input, project_root, loaded, path_api=os.path):
    """The whole decision.

    Returns {"managed": False} when the call isn't ours (emit nothing), or
    {"managed": True, "decision", "reason", "target"}.

    `loaded` is {"config": <dict or None>, "error": <str or None>} from
    loading scope-rules.json.
    """
    agent = normalize_agent_type(agent_type)
    inp = tool_input if _is_object(tool_input) else {}
    is_edit = tool_name in EDIT_TOOLS
    is_shell = tool_name in SHELL_TOOLS
    if is_shell:
        target = _js_string(inp.get("command"))
    else:
        key = "notebook_path" if tool_name == "NotebookEdit" else "file_path"
        target = _js_string(inp.get(key))

    # The main session and unknown tools are never managed.
    if agent == "" or not (is_edit or is_shell):
        return {"managed": False}

    config = loaded.get("config")
    listed = config is not None and agent in config["agents"]
    restricted = agent in RESTRICTED_AGENTS

    if not listed and not restricted:
        if config is not None and config.get("unknown_agent_decision") == "deny":
            return _deny(
                target,
                'kw-ad: agent "%s" has no rules in scope-rules.json and unknown_agent_decision is "deny"' % agent,
            )
        return {"managed": False}

    if config is None:
        return _deny(
            target,
            "kw-ad: %s is blocked because scope rules could not be loaded (%s). Run /kw-ad:init or /kw-ad:doctor."
            % (agent, loaded.get("error")),
        )
    if not listed:
        return _deny(
            target,
            "kw-ad: %s has no entry in scope-rules.json, so all of its Edit/Write/Bash calls are denied. "
            "Add one (see /kw-ad:init)." % agent,
        )

    agent_cfg = config["agents"][agent]
    section_name = "bash" if is_shell else "edit"
    section = agent_cfg.get(section_name)
    if section is None:
        return _deny(target, 'kw-ad: %s has no "%s" rules in scope-rules.json' % (agent, section_name))

    audit_target = target
    if is_shell:
        command = target.strip()
        matched = _first_match(section.get("rules"), lambda rule: command in rule["match_exact"])
    else:
        if target == "":
            return _deny(target, "kw-ad: %s call has no file path" % tool_name)
        rel = to_project_relative(project_root, target, path_api) if project_root else None
        if rel is None:
            return _deny(target, "kw-ad: %s may not edit paths outside the project (%s)" % (agent, target))
        audit_target = rel
        matched = _first_match(section.get("rules"), lambda rule: any(match_glob(p, rel) for p in rule["match"]))

    result = matched
    if result is None and "default" in section:
        result = {"decision": section["default"]["decision"], "reason": section["default"].get("reason", "")}
    if result is None:
        return _deny(audit_target, "kw-ad: no %s rule matched for %s and no default is configured" % (section_name, agent))
    reason = result["reason"]
    if result["decision"] == "deny" and not reason:
        reason = "kw-ad: denied by %s's %s scope rules" % (agent, section_name)
    return {"managed": True, "target": audit_target, "decision": result["decision"], "reason": reason}


def format_audit_line(timestamp_iso, agent_type, tool_name, target, decision, reason):
    entry = {
        "timestamp": timestamp_iso,
        "agent_type": agent_type or "",
        "tool_name": tool_name,
        "target": target,
        "decision": decision,
    }
    if reason:
        entry["reason"] = reason
    return json.dumps(entry, ensure_ascii=False, separators=(",", ":"))


def hook_output(decision, reason):
    out = {"hookEventName": "PreToolUse", "permissionDecision": decision}
    if reason:
        out["permissionDecisionReason"] = reason
    return {"hookSpecificOutput": out}

