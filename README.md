# agentic-dev

A Claude Code plugin: a six-agent TDD feature-delivery pipeline with
structural, hook-enforced per-stage scope — extracted and generalized
from a working system built and dogfooded end-to-end in a private Go
project (`KillianW/rkg`).

**This is a complete first-draft port, not a proven one.** Every
agent, skill, and the hook itself are real, working files — not stubs
— but nothing here has been dogfood-tested against a second repository
yet, and the hook's own test suite has never been executed (the
environment that wrote it had no Node.js installed). See
[`docs/ROADMAP.md`](docs/ROADMAP.md) for the hardening plan and
[`docs/PORTING-NOTES.md`](docs/PORTING-NOTES.md) for exactly what's
known-rough about each file before you rely on this for real work.

## The pipeline

```
architect (plan)
   -> human sign-off
-> new-branch
-> doc-scribe (record the plan)
-> test-writer-red   (write failing tests)
-> implementer-green (make them pass, minimally)
-> refactor           (quality pass on green code)
-> doc-scribe (record the outcome)
   -> human sign-off
-> ship (PR, CI, squash-merge, cleanup)
-> process-auditor (review the cycle, propose process changes)
```

Orchestrated end-to-end by the `deliver` skill
([`skills/deliver/SKILL.md`](skills/deliver/SKILL.md)). Two skills it
calls, `new-branch` and `ship`, are also usable standalone.

Every `Edit`/`Write`/`Bash` call from `test-writer-red`,
`implementer-green`, `refactor`, and `doc-scribe` is checked against a
`PreToolUse` hook ([`hooks/agentscope/`](hooks/agentscope/)) — not just
prompt-level restriction. The hook reads its rules from
`.claude/agentic-dev/scope-rules.json` in the installing repo, so
what's "in scope" for each stage is real config, not something baked
into this plugin's own code.

## Setup

See [`templates/README.md`](templates/README.md) for the manual setup
steps (there's no automated installer yet — that's
[`docs/ROADMAP.md`](docs/ROADMAP.md) Phase 3). At minimum, you need to
copy `templates/scope-rules.json` into
`.claude/agentic-dev/scope-rules.json` in your repo and adapt it for
your own languages and build commands — without that, the hook runs
with no enforcement at all (a safe, loud-warning degradation, not a
silent guess).

## Why this exists

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the real design
reasoning: why the hook is Node.js and not Go, the config schema, the
tracker-abstraction approach, and two hard-won platform facts about
Claude Code's own hook/permission behavior that this whole design
depends on getting right.

## License

MIT — see [`LICENSE`](LICENSE).
