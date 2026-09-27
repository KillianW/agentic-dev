# Architecture

The design decisions behind `kw-ad`, and the reasons for them. Read
this before changing the hook, adding a workflow, or wondering why
something is shaped the way it is.

## Origin

The TDD workflow is extracted from a pipeline built and used across
real feature-delivery cycles in a private Go repository
(`KillianW/rkg`). That pipeline proved the *process*:
Red/Green/Refactor with structural per-stage scope enforcement, two
human sign-off gates, and an audit-driven self-review loop. But it
was welded to that repo's specifics: Go/`make` commands hardcoded in
a Go hook binary, the repo's name in every prompt, and GitHub Issues
as the only tracker. This plugin keeps the process and generalizes
the content.

## One plugin, many workflows

The repo is a marketplace (`kw-agentic-dev`) with one plugin,
`kw-ad`. Each workflow is a skill inside it (`/kw-ad:tdd`, later
`/kw-ad:<next>`), and agents are prefixed by workflow (`tdd-red`),
except shared ones (`scribe`).

One plugin rather than one per workflow, because a plugin can't
reference files outside its own directory. Separate plugins would
each need a copy of the hook, config loader, and runtime selection.
One plugin means one hook, one `scope-rules.json` keyed by agent, one
runtime choice, and one install.

The plugin name has no `.` because MCP tool names only allow
`[A-Za-z0-9_-]`, and a future workflow might bundle an MCP server
(`mcp__plugin_kw-ad_<server>__<tool>`).

## The scope hook

### Two layers of enforcement

1. **Coarse, platform-level**: each agent's frontmatter `tools:` list.
   `tdd-architect` and `tdd-auditor` have no Edit/Write/Bash at all.
   `scribe` has no Bash, and `tdd-refactor` has no Write.
2. **Fine-grained, per path and command**: the `PreToolUse` hook
   (`plugins/kw-ad/hooks/agentscope/`), driven by the installing
   repo's `.claude/kw-ad/scope-rules.json`, decides *which* files and
   commands the granted tools may touch.

Layer 1 depends on frontmatter that parses. **If an agent's YAML
frontmatter fails to parse, Claude Code silently drops every field,
`tools:` included, and the agent gets all tools.** This happened to
two agents in the first port (an unquoted `: ` in a description).
Descriptions now use `>-` block scalars, and CI runs
`claude plugin validate`, which catches it.

### Runtime: Node or Python, chosen at install

The hook needs an interpreter. Claude Code's native build bundles its
own runtime, but hooks can't use it: they run as separate processes,
and the `claude` binary doesn't act as a script runner. So nothing is
guaranteed to be present. The original "Node is guaranteed wherever
Claude Code runs" assumption was wrong.

The hook ships as **two implementations of one spec**: Node 18+
(`js/`) and Python 3.8+ (`py/kwad_scope/`), both standard-library only
(no `npm install`, no `pip install`). The plugin's required
`hook_runtime` option (`node` | `python3` | `python`) selects one.
`hooks.json` runs `<hook_runtime> <plugin>/hooks/agentscope/run/<hook_runtime>`
using exec-form `${user_config.hook_runtime}` substitution. Each
file in `run/` is a tiny launcher named after its interpreter
command. `python` exists alongside `python3` because `python3` is
often a stub on Windows (the Store alias) and macOS (without the
Command Line Tools).

Keeping two implementations in step is the cost. The mitigation is
`tests/hook-cases/`: language-neutral JSON cases that both suites run
end to end against their own launcher. Behavior changes start there.

The config stays JSON because neither standard library parses YAML.

### A broken runtime can't block, so it's made visible instead

Claude Code treats a hook that fails to start (runtime missing, wrong
version) as a **non-blocking error, and the tool call proceeds**. Only
exit code 2 or a JSON `deny` blocks. So a misconfigured runtime means
silently no enforcement, and no hook-internal logic can prevent that.
Two things cover it:

- `hooks/check-runtime.sh`, a POSIX-sh `SessionStart` hook, runs the
  launcher's `--self-test`. On failure it emits a `systemMessage`
  shown to the user, plus context telling Claude.
- `/kw-ad:doctor`'s live probe has each scope-managed agent attempt
  an out-of-scope write and checks that a `deny` lands in the audit
  log. That is the only end-to-end proof.

### Decision semantics

For each Edit/Write/MultiEdit/NotebookEdit/Bash/PowerShell call:

1. **The main session is never managed.** No `agent_type` means the
   hook prints nothing and exits 0, so Claude Code's normal permission
   flow applies. The first port returned `"allow"` here, which
   auto-approved every main-session command.
2. **Agent identity**: plugin subagents report `agent_type` as
   `kw-ad:tdd-red`. The hook strips only its own `kw-ad:` prefix and
   looks up the bare name, so vendored installs with bare names work
   too. The first port compared the namespaced value against bare
   config keys, so nothing ever matched.
3. **Scope-managed agents** are the four in `RESTRICTED_AGENTS`
   (`tdd-red`, `tdd-green`, `tdd-refactor`, `scribe`) plus any other
   agent the config lists. For them, the hook **fails closed**. A
   missing or invalid config, a missing agent entry, a missing
   `edit`/`bash` section, a path outside the project, or no matching
   rule without a `default` all produce a `deny` with a reason that
   tells the agent (and the human reading the transcript) what to fix.
   Unparseable hook input exits 2. An internal error exits 2 for
   subagents and 0 for the main session.
4. **Other subagents** (Explore, general-purpose, other plugins'
   agents): silent, unless the config sets
   `"unknown_agent_decision": "deny"`.
5. **Matching**: rules are checked top to bottom and the first match
   wins. Edit globs match the project-relative, `/`-separated path.
   Bash rules are exact string equality after trimming, which is a
   deliberate security property: `make test; rm -rf /` simply isn't
   equal to `make test`.
6. Every decision about a managed agent is appended to
   `.claude/kw-ad/audit.log` (one JSON line) for `tdd-auditor`.

The project root is `$CLAUDE_PROJECT_DIR`, falling back to the
payload's `cwd`. `$KW_AD_SCOPE_CONFIG` overrides the config path.

The schema and glob syntax are documented in
[`plugins/kw-ad/templates/README.md`](../plugins/kw-ad/templates/README.md).
Each launcher's `--check-config <file>` validates a config.

### `"ask"` is not a legal decision

A live test in the origin repo found that `permissionDecision: "ask"`
**does not pause a spawned subagent**. It resolves unattended after
about two minutes under `acceptEdits`, with nothing shown to the
parent session. Offering it would invite a config author to rely on a
human checkpoint that doesn't exist. Frozen-decision docs use a hard
`deny` for `scribe`, and a human edits them directly.

## Trackers: the main session is the broker

Subagent tool grants are literal tool names in frontmatter, and
plugin-bundled MCP servers get namespaced tool names
(`mcp__plugin_kw-ad_github__*`). The first port's `mcp__github__*`
grants therefore never matched. Worse, any grant bakes one tracker
into the agents.

So **no pipeline agent has a tracker tool**. The orchestrating skill,
running in the main session with whatever the user has configured
(an Atlassian or Azure DevOps MCP server, `gh`, `az`, `glab`), fetches
work-item and PR content and pastes it into each subagent's prompt.
`.claude/kw-ad/tracker.yaml` tells the main session how:

- `tracker.mode`: `none` | `github` | `jira` | `azure-devops` |
  `custom`, plus free-text `instructions`.
- `code_host.mode`: `manual` | `github` | `azure-devops` | `gitlab` |
  `custom`, plus `instructions`.

`none` + `manual` always works.

kw-ad bundles no MCP servers. `github-issue-manager` is an optional,
GitHub-only agent outside the pipeline, and it works only if the user
has a `github` MCP server of their own.

## Parameterization

| What | Where | Why |
|---|---|---|
| `hook_runtime` (required), `repo_owner`, `repo_name`, `default_branch` | `plugin.json` `userConfig` | Scalar, install-time. `${user_config.*}` is substituted into agent/skill prose and hook `command`/`args` |
| Scope rules | `.claude/kw-ad/scope-rules.json` | Structured, per-repo, machine-read by the hook |
| Tracker / code host | `.claude/kw-ad/tracker.yaml` | Per-repo guidance for the main session |
| Perf-regression gates (optional) | `.claude/kw-ad/perf-policy.yaml` | Per-repo, read by `tdd-refactor` |
| Issue numbering (optional) | `.claude/kw-ad/issue-conventions.yaml` | Per-repo, read by `github-issue-manager` |

A plugin can't write files into the repo that installs it, so
`/kw-ad:init` (a main-session skill) scaffolds `.claude/kw-ad/` from
`templates/`.

## Distribution without a git URL

Everything installs from a local copy: `claude --plugin-dir
<copy>/plugins/kw-ad` for one session, or `claude plugin marketplace
add <copy>` for a persistent install. Where managed settings block
local plugins, `scripts/vendor.sh` exports the plugin as plain
project config under `<repo>/.claude/`. It resolves plugin-only
syntax at export time (userConfig values, `${CLAUDE_PLUGIN_ROOT}`,
`kw-ad:` prefixes) and merges the hook entries into
`.claude/settings.json`, using `$CLAUDE_PROJECT_DIR` paths.

## Platform facts this design depends on

Observed live with Claude Code 2.1.263 (headless `claude -p` runs in
scratch repos, Windows + Git Bash):

- **Plugin install** (`--plugin-dir`, runtime `python`): `agent_type`
  arrives as `kw-ad:tdd-red`, and exec-form `${user_config.hook_runtime}`
  substitution works. Out-of-scope writes are denied, and the reason
  reaches the agent.
- **Vendored install**: `agent_type` arrives bare (`tdd-red`). Allow and
  deny both work, and audit targets are project-relative.
- **`hook_runtime` unset**: `SessionStart` shows the kw-ad warning.
  PreToolUse logs `Hook failed to run` and **the write goes through**
  (fail open, as documented).
- **`--plugin-dir` config**: `pluginConfigs["kw-ad@inline"].options.hook_runtime`
  in a `--settings` file configures a `--plugin-dir` copy.

From the Claude Code docs at v2.1.263. Re-check these when upgrading:

- `hooks/hooks.json` is auto-loaded. A `"hooks"` key in `plugin.json`
  is **merged** with it, so declaring both registers hooks twice.
- Exec-form hooks (`command` + `args`) spawn without a shell and
  substitute `${user_config.*}`. Shell-form hooks reject
  `${user_config.*}`. Hook processes get `CLAUDE_PLUGIN_ROOT`,
  `CLAUDE_PROJECT_DIR`, and `CLAUDE_PLUGIN_OPTION_<KEY>`.
- Plugin subagents ignore the `hooks`, `mcpServers`, and
  `permissionMode` frontmatter fields, which is why enforcement is one
  plugin-level hook dispatching on `agent_type`, not per-agent hooks.
- `userConfig` `options` (fixed choice lists) need v2.1.271+, so
  `hook_runtime` is a free string validated by `check-runtime.sh`.
- Hook exit codes: 2 blocks, and other non-zero codes are non-blocking
  errors (fail open). JSON `permissionDecision: "deny"` blocks with a
  reason shown to the model.
