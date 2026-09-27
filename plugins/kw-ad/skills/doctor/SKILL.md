---
name: doctor
description: >-
  Verify that kw-ad scope enforcement actually works in this repo and
  environment: the hook runtime runs, scope-rules.json is valid, and a live
  probe shows each scope-managed agent (tdd-red, tdd-green, tdd-refactor,
  scribe) being denied an out-of-scope edit. Run after /kw-ad:init, after
  changing the runtime or rules, and whenever enforcement seems off.
---

Check kw-ad's enforcement end to end and report a PASS/FAIL table. A
hook that fails to run does **not** block anything (Claude Code treats
it as a non-blocking error), so the live probe in Step 4 is the only
real proof that enforcement works. Don't skip it.

Plugin files referenced below live under `${CLAUDE_PLUGIN_ROOT}`. The
configured hook runtime is `${user_config.hook_runtime}`.

# Steps

1. **Runtime.** If the configured runtime above is empty or isn't one
   of `node`, `python3`, `python`, that's a FAIL: tell the human to set
   the kw-ad `hook_runtime` option (`/plugin` → kw-ad → configure) and
   restart the session. Otherwise run:

   `${user_config.hook_runtime} "${CLAUDE_PLUGIN_ROOT}/hooks/agentscope/run/${user_config.hook_runtime}" --self-test`

   PASS if it prints `kw-ad hook ok (...)`. If it fails, show the
   output. Common causes: the runtime isn't installed or is too old
   (Node 18+ / Python 3.8+), or `python3` is an OS stub (macOS
   `/usr/bin/python3` without the Command Line Tools; Windows' Store
   alias). Suggest another runtime that `command -v` finds.

2. **Config.** Run the same command with
   `--check-config .claude/kw-ad/scope-rules.json`. PASS on `ok:` with
   no `error:` lines. Report every `warning:` line. A missing file is a
   FAIL: suggest `/kw-ad:init`.

3. **Audit log hygiene.** Check that `.claude/kw-ad/audit.log` is
   git-ignored (`git check-ignore -q .claude/kw-ad/audit.log`). WARN if
   not.

4. **Live denial probe.** Skip this and report FAIL for Step 4 if Step
   1 or 2 failed, since the result would be meaningless.
   - Note the current line count of `.claude/kw-ad/audit.log` (0 if the
     file doesn't exist).
   - In **one message**, spawn these four subagents in parallel. The
     probe target is `kw-ad-scope-probe.txt` at the repo root, a path
     no sensible scope rules allow:
     - `kw-ad:tdd-red`, `kw-ad:tdd-green`, `kw-ad:scribe`: "This is a
       kw-ad enforcement self-test. Call the Write tool exactly once to
       create `kw-ad-scope-probe.txt` in the repository root with the
       content `probe`. Do not retry, do not use any other tool, and
       report exactly what the tool returned."
     - `kw-ad:tdd-refactor` (it has no Write tool): the same, but
       "Call the Edit tool exactly once on `kw-ad-scope-probe.txt`,
       replacing `probe` with `probed`."
   - Read the audit-log lines added since the count you noted. For each
     of the four agents, PASS if there is a `deny` entry with
     `agent_type` `kw-ad:<agent>` and a target of
     `kw-ad-scope-probe.txt`.
   - Diagnose failures:
     - **No entry at all**: the hook didn't run for that agent. Check
       whether the plugin is enabled and its hooks are loaded
       (`/hooks`), and whether the runtime passed Step 1. For a
       vendored install, check the hook entry in
       `.claude/settings.json` instead.
     - **`allow` entry**: the rules for that agent allow the probe path.
       Their allow globs are too broad (e.g. `**`); show the matching
       rule.
   - If `kw-ad-scope-probe.txt` now exists, delete it and say which
     agent created it.

5. **Report** a table: Runtime / Config / Audit log ignored / Probe:
   tdd-red / Probe: tdd-green / Probe: tdd-refactor / Probe: scribe,
   each with PASS, WARN, or FAIL and a one-line reason. End with the
   single most important fix, if anything failed. Mention that the
   probe's deny lines stay in `audit.log` until the next `/kw-ad:tdd`
   cycle clears it.
