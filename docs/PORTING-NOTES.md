# Porting Notes

What changed in each file ported from `KillianW/rkg`, and what's still
genuinely rough about the result. Written so a later session doesn't
have to re-derive this by diffing against the origin repo itself.

## Cross-cutting gotchas (apply to the whole pipeline)

1. **A Claude Code agent name can be silently reserved.** `scribe` was
   found to silently defeat `PreToolUse` hook dispatch entirely — no
   error, zero enforcement. This is why the documentation agent here
   is `doc-scribe`, not `scribe`. Verify a denial actually fires for
   any new/renamed agent before trusting it.
2. **`permissionDecision: "ask"` does not block a spawned subagent.**
   It resolves itself unattended after roughly two minutes under
   `acceptEdits` mode, with nothing shown to the parent session. The
   scope-rules schema doesn't offer `"ask"` as a legal `decision` value
   anywhere, specifically because of this.
3. **Every ported file replaces hardcoded `KillianW/rkg`** with
   `${user_config.repo_owner}/${user_config.repo_name}`, and hardcoded
   `main` with `${user_config.default_branch}` where the origin
   assumed that specific branch name.
4. **Every ported file replaces hardcoded `mcp__github__*` prose
   references** with "your configured tracker's `<operation>`"
   language, pointing at `.claude/agentic-dev/tracker.yaml`. Frontmatter
   `tools:` lists still name concrete `mcp__github__*` tools directly
   — that's an unavoidable Claude Code platform constraint (subagent
   tool grants are literal tool names), not something prose can route
   around. See `docs/ARCHITECTURE.md`'s tracker-abstraction section.

## Per-file notes

| File | What changed from the origin | Known gaps / untested edges |
|---|---|---|
| `agents/architect.md` | Repo-identity substitution; tracker-operation prose; RKG-product-specific MCP-tool paragraph (about a future `rkg mcp` server) dropped entirely — not relevant outside the origin project; Critical-Files `(doc-scribe)` tagging generalized from Go-specific framing to "whatever this repo's scope-rules.json doesn't cover." | Untested against a real plan-then-implement cycle in any repo. |
| `agents/test-writer-red.md` | File-scope and Bash-scope restrictions reworded from hardcoded `*_test.go`/`make test` to "whatever `scope-rules.json` configures," with the origin's concrete example kept parenthetically for illustration. | Never run against a non-Go repo's actual test-file convention — the prose is genuinely generic, but that's asserted, not proven. |
| `agents/implementer-green.md` | Same restriction-generalization pattern as test-writer-red; the cited README-edit-denial incident kept as a named example but attributed to "the repo this pipeline was extracted from" rather than a specific Feature number (that number means nothing outside rkg's own issue tracker). | Same as test-writer-red — untested outside the origin repo. |
| `agents/refactor.md` | The heaviest rewrite of the seven: the origin's hardcoded benchmark package list and exact numeric thresholds (5%/10%, 50ms/500ms, etc.) became a fully optional, config-gated step (`.claude/agentic-dev/perf-policy.yaml`) that most repos simply won't have. The two-gate *pattern* itself is kept as reusable reasoning; none of the origin's specific numbers are asserted as correct for any other repo. | The optional-perf-policy path has never been exercised — no repo has actually configured `perf-policy.yaml` and triggered a real classification through this prose yet. |
| `agents/doc-scribe.md` | Hard-denied path examples (`docs/specifications/`, `docs/adr/`) kept as illustrative defaults but reframed as "whatever this repo's config marks as frozen-decision tier — adjust to what this repo actually calls it, if it has such a tier at all." History-file path convention (`docs/planning/history/FEATURE-N.M.md`) kept as this plugin's own proposed default. | Untested whether the history-file convention is a good default for a repo that already has its own documentation-history location — likely to need adjustment per-installing-repo in practice. |
| `agents/process-auditor.md` | Audit-log path updated (`tools/agentscopehook/audit.log` → `.claude/agentic-dev/audit.log`); otherwise a light port — this agent was already fairly generic in the origin (its methodology barely referenced Go/rkg specifics beyond the log path and tracker calls). | Never run against a real completed cycle in this plugin's own delivery of itself, or any installing repo. |
| `agents/github-issue-manager.md` | The largest content change of any file: the origin's mandatory `EPIC-N:`/`FEATURE-N.M:`/etc. numbering scheme (ADR-0003/ADR-0014-specific) became fully optional, gated on `.claude/agentic-dev/issue-conventions.yaml`'s presence, defaulting to plain titles otherwise. Every ADR citation dropped (those ADRs don't exist outside rkg) while the underlying mechanics they justified (native sub-issue linking, angle-bracket-stripping workaround, PATCH-semantics safety, narrative-vs-body separation) were kept as generically-true GitHub API behavior. | The single most rkg-shaped file even after this rewrite — not one of the six delivery-pipeline stages (`deliver` never spawns it), so it's explicitly lower priority for Phase 1/2 verification, see `ROADMAP.md`. Genuinely unclear whether the optional-numbering-scheme design is the right shape until a second repo actually tries configuring `issue-conventions.yaml` for real. |
| `skills/new-branch/SKILL.md` | Repo-identity and default-branch substitution; ADR-0016 citation dropped. Otherwise close to a direct port — this skill was already fairly mechanism-generic in the origin. | Untested. |
| `skills/ship/SKILL.md` | Local-verification step now points at whatever `implementer-green`'s configured command set is, rather than hardcoding `go build`/`go vet`/`go test`/`gofmt -l .`. PAT-scope citation to a specific origin-repo history file dropped, replaced with the general Checks/Commit-statuses permission fact (which is genuinely tracker-generic, not rkg-specific). | Never actually run a real CI-poll-then-squash-merge cycle through this ported version. |
| `skills/deliver/SKILL.md` | The file-type guard's file-list is genuinely generic already (this plugin's own artifact types), so it changed least; every reference to `make`/Go-specific commands, `standards/testing.yaml`'s exact ADR-0018 thresholds, and specific origin Feature-number incident citations (FEATURE-11.2, FEATURE-12.1, FEATURE-12.2) were generalized to "a real cycle in the repo this pipeline was extracted from" or pointed at the optional `perf-policy.yaml`. | The longest, most orchestration-heavy file — highest risk of a subtle broken cross-reference (e.g. a step that still implicitly assumes something Phase 1's dogfood run needs to catch). |

## A known, deliberate behavior difference worth flagging explicitly

The origin Go hook's `isStandardsYAML`/`isMarkdown` checks were
prefix/suffix string matches with no path-depth awareness (e.g.
`standards/sub/foo.yaml` would have matched `isStandardsYAML` in the
Go version) and case-insensitive for `.md`/`.MD`. The new glob-based
schema's `standards/*.yaml` pattern (single `*`) only matches direct
children of `standards/`, not nested paths, and `**/*.md` is
case-sensitive (won't match `FOO.MD`). This is a deliberate schema
design choice, not an oversight — `templates/scope-rules.json`'s glob
patterns are more predictable to a human author than reverse-engineering
what a prefix/suffix check actually covers — but it means the ported
default ruleset isn't byte-for-byte behaviorally identical to the
origin Go hook. Worth confirming this is actually the desired behavior
during Phase 1's dogfood run against rkg itself, not just asserting it
here.
