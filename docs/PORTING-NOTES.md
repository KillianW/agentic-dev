# Porting notes

What changed in each file ported from `KillianW/rkg`, and what's still
rough. Written so a later session doesn't have to re-derive this by
diffing against the origin repo.

## Bugs found in the first port (fixed in v0.2.0)

The first draft (v0.1.0) was never run. Checking it against current
Claude Code behavior found these problems. Each item marked **zero
enforcement** meant, on its own, no enforcement at all:

1. **Namespaced agent names (zero enforcement).** Plugin subagents
   report `agent_type` as `<plugin>:<agent>`. The hook compared that
   with bare config keys, so every agent fell through to "allow".
2. **Fail-open runtime (zero enforcement where Node is absent).** The
   hook needed `node`, which Claude Code doesn't provide. A missing
   interpreter is a non-blocking hook error, so the call proceeds.
3. **Invisible degradation.** "No config → allow + loud stderr
   warning" wasn't loud at all: stderr from an exit-0 hook isn't shown
   to the user.
4. **Main-session auto-approval.** Callers not in the config got
   `permissionDecision: "allow"`, including every main-session Bash
   call.
5. **Double registration.** `plugin.json`'s `"hooks"` key is merged
   with the auto-loaded `hooks/hooks.json`.
6. **Unparseable frontmatter.** An unquoted `: ` in the architect and
   auditor descriptions made their YAML fail to parse. Claude Code
   then drops every field, `tools:` included, so the two "read-only by
   construction" agents had every tool.
7. **Unmatched MCP grants.** Plugin-bundled MCP tools are named
   `mcp__plugin_<plugin>_<server>__*`, so the `mcp__github__*`
   frontmatter grants never matched. Separately, a bundled GitHub
   server was wrong for non-GitHub trackers, and `.env` isn't loaded
   by Claude Code.
8. **Path handling.** Paths outside the project could match `**`
   globs (`../x.go`). Config and audit-log lookup followed the
   payload's `cwd` rather than the project root. `?` in a glob wasn't
   escaped.

## Cross-cutting changes from the origin

- `KillianW/rkg` → `${user_config.repo_owner}/${user_config.repo_name}`;
  hardcoded `main` → `${user_config.default_branch}`.
- No agent names a tracker tool in its prose or frontmatter. The main
  session fetches work-item and PR content and pastes it into prompts
  (see ARCHITECTURE.md, "Trackers").
- Agents renamed by workflow: `architect` → `tdd-architect`,
  `test-writer-red` → `tdd-red`, `implementer-green` → `tdd-green`,
  `refactor` → `tdd-refactor`, `process-auditor` → `tdd-auditor`.
  The documentation agent is `scribe`, shared across workflows. The
  skill `deliver` → `tdd`.
- Config lives in `.claude/kw-ad/`, not `.claude/agentic-dev/`.

## Per-file notes

| File | What changed from the origin | Known gaps / untested edges |
|---|---|---|
| `agents/tdd-architect.md` | Repo-identity substitution. Works from pasted work-item content, with no tracker tools. The paragraph about the origin's product-specific MCP server was dropped. `(scribe)` tagging generalized to "whatever scope-rules.json doesn't cover." | Untested in a real plan-then-implement cycle. |
| `agents/tdd-red.md` | Scope restrictions reworded from hardcoded `*_test.go`/`make test` to "whatever `scope-rules.json` configures," keeping the origin's examples in parentheses. Fail-closed setup behavior described. | Never run against a non-Go repo's test layout. |
| `agents/tdd-green.md` | Same generalization pattern as tdd-red. The README-edit-denial incident is kept as an example, attributed to the origin repo. | Same as tdd-red. |
| `agents/tdd-refactor.md` | The heaviest rewrite: the origin's hardcoded benchmark packages and thresholds became an optional, config-gated step (`perf-policy.yaml`). The two-gate *pattern* is kept; none of the numbers are asserted for other repos. | The perf-policy path has never been exercised. |
| `agents/scribe.md` | Frozen-decision-tier examples (`docs/specifications/`, `docs/adr/`) kept as defaults that `/kw-ad:init` asks about. History-file convention `docs/planning/history/<ITEM>.md` is this plugin's proposal. | The history-file default may clash with a repo's own convention. |
| `agents/tdd-auditor.md` | Audit-log path updated. Works from a pasted PR and commit list instead of PR tools. The audit log now holds only scope-managed agents' decisions, so no main-session noise. | Never run against a real completed cycle. |
| `agents/github-issue-manager.md` | Origin's mandatory `EPIC-N`/`FEATURE-N.M` scheme made optional (`issue-conventions.yaml`); ADR citations dropped. Now explicitly optional and GitHub-only, needing the user's own `github` MCP server. | The most origin-shaped file. Not in the pipeline. |
| `skills/tdd/SKILL.md` (was `deliver`) | Added a preconditions step (config present, doctor suggested, tracker.yaml read). Every subagent invocation pastes content. `kw-ad:` subagent types. Tracker housekeeping depends on the tracker mode. The auditor gets the commit list from `ship`. | The longest orchestration file; highest risk of a subtle broken step. |
| `skills/new-branch/SKILL.md` | Resolves the title through `tracker.yaml`; refs can be any tracker's keys. | Untested. |
| `skills/ship/SKILL.md` | Local verification uses `tdd-green`'s configured command set. PR/CI/merge now run through `code_host.mode` (gh, az, glab, or manual). Captures the commit list before cleanup. | No real CI-poll-then-merge cycle yet. |

## A deliberate behavior difference from the origin Go hook

The origin's `isStandardsYAML`/`isMarkdown` checks were prefix/suffix
matches with no path-depth awareness (`standards/sub/foo.yaml`
matched), and `.md` matching was case-insensitive. The glob schema's
`standards/*.yaml` only matches direct children, and `**/*.md` is
case-sensitive (it won't match `FOO.MD`). This is deliberate: globs
are more predictable for a human author than reverse-engineered
prefix checks.
