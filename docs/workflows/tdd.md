# TDD workflow (`/kw-ad:tdd`)

A feature-delivery pipeline with structurally enforced stage
boundaries.

```
/kw-ad:tdd <work item or description>
  tdd-architect (plan, read-only)
     -> human sign-off (Gate 1)
  /kw-ad:new-branch
  scribe          record the plan in docs/planning/history/<ITEM>.md
  tdd-red         write failing tests          (test files + one test command)
  tdd-green       make them pass, minimally    (source files + verify commands; never tests)
  tdd-refactor    quality pass on green code   (source files; never tests or build config)
  scribe          append the outcome narrative (markdown only)
     -> human sign-off (Gate 2), with a reject-routing table back to any stage
  /kw-ad:ship     verify, push, PR, CI, merge, clean up
  tdd-auditor     review the cycle + audit log, propose process changes (read-only)
```

| Agent | Tools | Scope enforced by the hook |
|---|---|---|
| `tdd-architect` | Read, Grep, Glob | none needed: no write tools |
| `tdd-red` | + Edit, Write, Bash | edits: test paths only; Bash: the one test command |
| `tdd-green` | + Edit, Write, Bash | edits: source paths, never tests; Bash: the verify set |
| `tdd-refactor` | + Edit, Bash (no Write) | edits: source paths, never tests/build config; Bash: verify set (+ benchmark) |
| `scribe` | + Edit, Write (no Bash) | edits: markdown; frozen-decision docs hard-denied |
| `tdd-auditor` | Read, Grep, Glob | none needed: no write tools |

The orchestrating skill runs in your main session. It is the only
participant with tracker and code-host access, and it pastes
work-item content into every stage's prompt (see
[ARCHITECTURE.md](../ARCHITECTURE.md), "Trackers").

The skill's own file is the authoritative step-by-step:
[`plugins/kw-ad/skills/tdd/SKILL.md`](../../plugins/kw-ad/skills/tdd/SKILL.md).

## Size gate

`/kw-ad:tdd` suggests working directly, without the pipeline, when:

- the change is confined to files no stage can touch (agent/skill
  prompts, CI workflows, `.claude/**`), or
- it is tiny and unambiguous (roughly ≤2 files and ≤50 lines). In
  this case it asks first.

## Per-repo configuration

`/kw-ad:init` writes it; `/kw-ad:doctor` checks it.

- `.claude/kw-ad/scope-rules.json`: required. Presets exist for Go,
  Python, TypeScript, and JVM.
- `.claude/kw-ad/tracker.yaml`: optional. Defaults to no tracker and
  manual PRs.
- `.claude/kw-ad/perf-policy.yaml`: optional benchmark gates for
  `tdd-refactor`.
