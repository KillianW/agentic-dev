# Architecture

This document records the real design decisions behind `agentic-dev`,
not just what shipped. Read this before changing the hook, adding a
tracker, or wondering why something is shaped the way it is.

## Origin

Everything here is extracted from a working TDD pipeline built and
dogfooded across real feature-delivery cycles in a private Go
repository (`KillianW/rkg`). That pipeline proved the *process* —
Red/Green/Refactor with structural per-stage scope enforcement, two
human sign-off gates, an audit-driven self-review loop — but welded it
tightly to one repo's specifics: Go/`make` commands hardcoded into a
Go hook binary's `switch` statements, the repo's own name hardcoded
into seven agent files and three skill files, and GitHub Issues
assumed as the only possible tracker throughout. This plugin exists to
keep the process, generalize the content.

## The hook: why Node.js, not Go

The plugin installs into repos of unknown language and toolchain. A
compiled Go binary means either a multi-arch build+dispatch matrix, or
requiring Go installed in every installing repo (the origin project
got this for free only because it happened to be a Go project itself
— not a property of the *plugin*), or `go run` from source, still
requiring a Go toolchain nobody but a Go repo has. A POSIX shell script
avoids compilation but is a poor bet on Windows without WSL/Git Bash.

**Node.js is the one interpreter guaranteed present everywhere Claude
Code itself runs** — it ships as an npm package and requires Node ≥18
to run, independent of what language the *installing* repo is written
in. That converts "compiled-binary-per-arch problem" into an
already-satisfied precondition.

Consequence: the hook's own scope-rules config is **JSON, not YAML**.
Node has no built-in YAML parser, and adding an npm dependency would
reintroduce exactly the "does this installing repo even have `npm
install` available" problem Node was chosen to avoid. `JSON.parse` is
dependency-free — the hook needs zero `node_modules`.

`hooks/agentscope/config.mjs` and `agentscope.mjs` port
`tools/agentscopehook/main.go`'s function shape directly, for
continuity with the origin implementation: `resolveEditDecision`/
`resolveBashDecision` mirror `decide`/`decideBash`, `matchGlob` is a
small hand-written, unit-tested glob-to-regex matcher (no npm
dependency — see the implementation's own comments for why it's a
single-pass character scan, not a chain of global string replacements:
the emitted regex snippets contain `*` characters that a second blind
replace pass would corrupt), and `formatAuditLine` stays pure and
separate from file I/O for the same testability reason the Go version
kept it separate.

## The two-layer enforcement model

A pipeline agent's scope is enforced at two independent layers:

1. **Coarse, platform-level**: an agent's frontmatter `tools:` list.
   `architect` and `process-auditor` simply have no `Edit`/`Write`/
   `Bash` grant at all — the hook is never even consulted for a tool
   call that doesn't exist. `doc-scribe` has no `Bash` grant, so its
   Bash behavior is never a hook concern either.
2. **Fine-grained, per-path/per-command**: `.claude/agentic-dev/scope-rules.json`,
   read by the hook at runtime, for whichever tools an agent *was*
   granted. This is what decides *which* files `implementer-green` can
   edit, not *whether* it can edit at all.

`templates/scope-rules.json`'s `refactor` entry needs no explicit
"deny Write" rule, for example — there's nothing to deny, since
`refactor.md`'s own frontmatter never grants `Write` in the first
place.

## The scope-rules config schema

```json
{
  "version": 1,
  "unknown_agent_decision": "allow",
  "agents": {
    "<agent-name>": {
      "edit": {
        "rules": [
          { "match": ["<glob>", "..."], "decision": "allow|deny", "reason": "..." }
        ],
        "default": { "decision": "allow|deny", "reason": "..." }
      },
      "bash": {
        "rules": [
          { "match_exact": ["<exact command string>", "..."], "decision": "allow|deny", "reason": "..." }
        ],
        "default": { "decision": "allow|deny", "reason": "..." }
      }
    }
  }
}
```

- **Rules evaluate top-to-bottom, first match wins** — this is what
  lets a narrow `deny` (e.g. "deny `*_test.go`") precede a broad
  `allow` (e.g. "allow `*.go`") for the same agent.
- **`match` is glob**: `*` matches within one path segment, `**`
  matches zero or more whole segments (crosses `/`). A plain string
  with no `*` is an exact relative-path match.
- **`match_exact` for Bash is deliberately exact-string-only** — never
  a glob, never a prefix match. This is a security property carried
  forward verbatim from the origin project: a command like `make test;
  rm -rf /` or `make test extra` simply isn't equal to any allowed
  string, so it's denied by construction rather than by trying to
  parse or sanitize an arbitrary shell string.
- **`unknown_agent_decision`** governs any agent type the config
  doesn't mention at all — including the main/orchestrating session,
  which never carries an `agent_type`. Default `"allow"`: this hook is
  an opt-in allow-list over specific pipeline agent names, not a
  default-deny sandbox over every possible caller.

### `"ask"` is not a legal `decision` value, anywhere

This is deliberate, not an oversight. A live test in the origin
project found that `permissionDecision: "ask"` **does not actually
pause for a spawned subagent** — it resolves itself unattended after
roughly two minutes under `acceptEdits` permission mode, with nothing
shown to the parent session. There is currently no real mechanism for
human sign-off on a subagent-originated `"ask"`. Until that changes,
offering `"ask"` as a schema option would let a future config author
reach for something that silently doesn't behave the way its name
implies. `templates/scope-rules.json`'s `doc-scribe` entry uses a hard
`deny` for frozen-decision-tier paths for exactly this reason — a
human can still make that edit directly themselves.

### No bundled Go/Make default

The hook **never** falls back to a language-specific ruleset when an
installing repo hasn't configured its own `scope-rules.json`. `**/*.go`,
`Makefile`, `make build`/`make test` are meaningless — or actively
wrong — for a Python, TypeScript, or Rust repo. There is no safe
universal default for `test-writer-red`/`implementer-green`/
`refactor`'s file-scope and Bash-command rules, because those are
inherently language/build-tool specific; no repo-agnostic guess is
honest. When nothing resolves, `hooks/agentscope/config.mjs`'s
`loadConfig` returns an **empty ruleset** with `unknown_agent_decision:
"allow"`, plus a loud stderr warning and a matching audit-log entry —
this degrades to exactly the origin project's own pre-hook baseline
(prompt-level restrictions only, no structural guarantee), never a
hard failure and never a wrongly-shaped guess standing in for real
configuration.

`templates/scope-rules.json` ships a real, working example — the
origin project's own Go/Make-shaped ruleset, generalized into this
schema — purely as a copy-and-adapt starting point.

### Config resolution order

1. `$AGENTIC_DEV_SCOPE_CONFIG` env var, if set (explicit override).
2. `<cwd>/.claude/agentic-dev/scope-rules.json`, if present.
3. Empty ruleset + warning (see above).

A present-but-unparseable config also falls back to the empty ruleset
with a warning — a broken config must never brick every Edit/Write/
Bash call in the installing repo, but a real authoring error should
say so loudly, distinctly from "not configured yet."

### Open verification items (not yet confirmed against current Claude Code docs at implementation time)

- Whether `plugin.json`'s `"hooks": "./hooks/hooks.json"` key is
  required, or whether `hooks/hooks.json` auto-loads by convention if
  present.
- Whether `${CLAUDE_PLUGIN_ROOT}` is available as an actual environment
  variable inside the spawned hook process itself (needed if a future
  fallback path wants to reference the plugin's own bundled files), or
  only usable for `${...}` string substitution inside `hooks.json`'s
  own `command`/`args` fields.

## Two hard-won platform facts, carried forward

Both discovered building the origin project's hook, both load-bearing
for anyone extending this one:

1. **An agent name can be silently reserved by Claude Code itself.**
   The name `scribe` was found to **silently defeat `PreToolUse` hook
   dispatch entirely — no error, zero enforcement** — when used as an
   agent name. This is why the documentation agent here is
   `doc-scribe`, not `scribe`. If you ever rename or add a pipeline
   agent, **verify a denial actually fires** for an intentionally-wrong
   test edit under the new name before trusting it — there is no error
   message that will tell you otherwise.
2. **`"ask"` doesn't block a spawned subagent** — covered above, and
   why the schema doesn't offer it as an option at all.

## Tracker abstraction

No Claude Code platform mechanism exists for "pluggable work-item
tracker" — this is a project-local binding file
(`.claude/agentic-dev/tracker.yaml`, shipped as
`templates/tracker.yaml`) plus a prose convention every ported agent
follows: refer to "your configured tracker's `<operation>`" rather
than naming an MCP tool directly in prose.

**Real, stated limitation**: subagent tool access is still granted by
literal tool name in an agent's YAML frontmatter — a Claude Code
platform constraint this abstraction cannot route around. Adding a
second tracker means a mechanical frontmatter edit per agent
(unavoidable) plus a new `tracker.yaml` binding — but **not**
rewriting each agent's operational prose, which never hardcodes an MCP
tool name outside its own frontmatter `tools:` list. GitHub Issues
(via the `github` MCP server, see `.mcp.json`) is the only *working*
binding today; the abstraction's value is bounded to "addable later
without a full prose rewrite," not "usable with a second tracker
today."

`userConfig.tracker_id` (a plain string, default `"github-issues"`) is
a readability complement only, substituted into agent prose — the real
operation mapping lives in `tracker.yaml` since `userConfig` fields
can't express nested maps.

## Issue-numbering convention (github-issue-manager)

The origin project's `EPIC-N:`/`FEATURE-N.M:`/`TASK-N.M.P:`/
`DESIGN-N.M:`/`BUG-N.M:` title-prefix scheme is that repo's own
convention, not universal. `github-issue-manager.md` treats it as
**optional config**: if `.claude/agentic-dev/issue-conventions.yaml`
exists and `enabled: true`, follow its declared scheme (see
`templates/issue-conventions.yaml`, which mirrors the origin project's
own scheme as a real working example); if the file is absent, fall
back to plain issue titles with no enforced prefix or numbering at
all. This keeps the file genuinely portable rather than silently
rkg-shaped underneath a thin rename.

## Parameterization

| What | Where | Why |
|---|---|---|
| `repo_owner`, `repo_name`, `default_branch` | `plugin.json` `userConfig` | Scalar, install-time, substituted into prose as `${user_config.repo_owner}/${user_config.repo_name}` |
| `tracker_id` | `userConfig` (default `"github-issues"`) | Scalar label; real mapping lives in `tracker.yaml` |
| Hook scope rules | `.claude/agentic-dev/scope-rules.json` (installing repo) | Structured, nested, hand-edited post-install, machine-parsed at runtime — not a `userConfig` scalar's job |
| Tracker operation bindings | `.claude/agentic-dev/tracker.yaml` (installing repo) | Same reasoning |
| Optional issue-numbering convention | `.claude/agentic-dev/issue-conventions.yaml` (installing repo) | Same reasoning; absent by default |
| Optional performance-regression policy | `.claude/agentic-dev/perf-policy.yaml` (installing repo) | Same reasoning; absent by default |
| Commit-scope list, or any other repo-specific file `templates/` only proposes | Left as installing-repo content | A plugin has no install hook that writes files into the target repo's tree — see `docs/ROADMAP.md` Phase 3 |

## Why the plugin ships no install-time file-writing mechanism

Claude Code plugins don't get a hook into "files get copied into the
installing repo at enable time" — a plugin can bundle files, declare
agents/skills/hooks, and read `userConfig`, but it can't reach out and
write `.claude/agentic-dev/scope-rules.json` into the host repo purely
by being installed. `templates/` plus `templates/README.md`'s manual
copy-and-edit instructions are the honest current answer; a future
`/agentic-dev:init` skill (a skill runs in the main session with real
tool access, unlike a subagent) is the natural way to automate this —
deferred, see `docs/ROADMAP.md` Phase 3, not built in this first pass.
