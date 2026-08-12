---
name: deliver
description: Run the full TDD feature-delivery pipeline for a Feature/Task on ${user_config.repo_owner}/${user_config.repo_name} — Architect plans, two human sign-off gates, Red/Green/Refactor/doc-scribe execute, /ship lands it, Process Auditor closes the loop. Size/risk-gated — suggests direct work instead for trivially small or structurally-unroutable (agent/skill-prompt, workflow/settings) changes.
effort: high
---

Run the whole TDD feature-delivery pipeline for one Feature/Task, end
to end: Architect plans → sign-off → `/new-branch` → doc-scribe records
the plan → Red → Green → Refactor → doc-scribe appends the outcome →
sign-off → `/ship` → Process Auditor closes the loop. Six subagents and
two existing skills (`/new-branch`, `/ship`) get sequenced here — this
skill is the orchestration, not any of the work itself.

# Arguments

An issue number, an issue reference, or a plain description of the
work — same resolution as `/new-branch` takes.

# Steps

## 1. Size/risk gate

**1a. File-type guard.** If the change is knowably confined to
`agents/*.md`, `skills/*/SKILL.md`, `.github/workflows/*`, or
`.claude/settings.json` (this plugin's own artifact types plus Claude
Code config): skip straight to direct implementation. None of these
file types can be produced by any pipeline stage — Red/Green/Refactor's
hook allow-lists are always scoped to whatever this repo's
`.claude/agentic-dev/scope-rules.json` configures as test/source
files, and an agent-prompt, skill-prompt, workflow, or settings file
categorically isn't one of those regardless of what's configured. This
isn't a policy choice, it's what the hook (`hooks/agentscope`)
actually allows. Optionally still consult `architect` for a plan on
non-trivial direct work, and `doc-scribe` to document it afterward —
just never route the core deliverable through Red/Green/Refactor. Stop
here.

**1b. Size/risk check**, for everything else: is this roughly ≤1-2
files, ≤30-50 lines, unambiguous (a typo, a stale comment, a one-line
bug fix — not something needing an approach decision), and clear of
any frozen-decision-tier docs this repo has, the enforcement hook
itself, and CI config? If yes to all: ask via `AskUserQuestion` —
implement directly, or run the full pipeline anyway? Follow whichever
the human picks. If no to any: proceed to Step 2 without asking —
don't nag for obviously-substantial work.

## 2. Resolve the target

Same resolution `/new-branch` Step 3 uses: read the work item via your
configured tracker's `get_item` operation if a number/reference was
given, or take a plain description directly.

## 3. Invoke `architect`

Agent tool, `subagent_type: architect`, with the target reference —
the one input its own "What you're given" expects.

## 4. Sign-off Gate 1 — post-Architect

Present the returned plan via `ExitPlanMode`. If the session isn't in
plan mode for some reason, fall back to `AskUserQuestion` presenting
the plan with Approve/Reject options — same effect either way, no
auto-proceeding.

- **Rejected** → capture the feedback text, re-invoke `architect`
  (Step 3) with the original request plus the feedback attached,
  return to the top of this step.
- **Approved** → Step 5.

## 5. `/new-branch`

Same target reference as Step 2 — creates the branch before any
code-writing stage runs.

## 6. Invoke `doc-scribe` to record the plan

Its Process step 1: write the approved plan into
`docs/planning/history/FEATURE-N.M.md` (or `EPIC-N.md`), or wherever
this repo's own documentation-history convention puts it. On the new
branch, so it lands in the same PR as the implementation.

## 7. Invoke `test-writer-red`

The approved plan is its input. Ends with a red confirmation from this
repo's one configured test command — every new test failing for the
right reason.

## 8. Invoke `implementer-green`

Same plan, plus Red's now-failing tests. Ends with all of this repo's
configured verify commands (build/vet/test/format-check-equivalent)
green.

## 9. Invoke `refactor`

Same plan, plus Green's code. Ends with a final green re-check and, if
this repo has an optional `.claude/agentic-dev/perf-policy.yaml`
configured and a covered package was touched, a benchmark
classification against its two gates.

**Prompting note for Steps 7-9 (and any other invocation of these
three agents)**: none of `test-writer-red`/`implementer-green`/
`refactor` carry any tracker MCP tool — they cannot fetch a work
item's content themselves. If the plan or your prompt to them
references a work item's specifics (Objective, Acceptance Criteria,
exact wording), paste that content directly into the prompt rather
than telling the agent to "read the issue first" — that instruction is
one they structurally cannot follow, and a real cycle in the repo this
pipeline was extracted from traced a tracker-CLI Bash-denial burst
directly to this mistake. Pointing them at
`docs/planning/history/FEATURE-N.M.md`'s already-recorded plan (once
doc-scribe has written it, Step 6) is fine, since that's a real file
they can `Read`.

**If `refactor`'s benchmark classification triggers both of this
repo's perf-policy gates** (relative and absolute) on any case: when
Gate 2 (post-Refactor) or the eventual history-file outcome narrative
records the accept/reject decision, give each gate its own explicit
written justification — don't let an absolute-time band's "rejected by
default" result ride silently on the relative-delta explanation alone.
The two-gate policy is designed for the gates to be judged
independently ("clearing one gate never excuses the other"); the
narrative should reflect that independence, not just refactor's own
per-case report.

**Benchmark judgment is `refactor`'s call to make and report, not the
orchestrator's to resolve independently** — the perf-policy pattern
assigns it there deliberately. If a Gate-1-triggering result's
classification (e.g. "likely shared-environment noise") would benefit
from a second data point before Gate 2, the orchestrator MAY re-run
the benchmark command itself once for corroboration (confirmed useful
in a real cycle in the repo this pipeline was extracted from —
inconsistent per-case results across two runs, with allocation counts
staying flat, was real evidence against a genuine regression). If it
does, both runs' data must be reported explicitly at Gate 2 and in the
history narrative — never silently substitute the second run's numbers
for `refactor`'s own, and never let a corroborating re-run become a
substitute for `refactor`'s classification and write-up in the first
place.

## 10. Invoke `doc-scribe` again to record the outcome

Its Process steps 2 and 3: append the outcome narrative to the same
history file, and write/propose whatever other markdown the change
needs (a root state-tracking file, a "what's next" pointer, glossary,
package READMEs) — propose only, in its report, for anything under
this repo's frozen-decision-tier docs (if it has any), since
`doc-scribe` is hard-denied from editing those directly.

## 11. Sign-off Gate 2 — post-Refactor, pre-ship

Present a summary of Steps 7-10 — diffs, each stage's report, the
benchmark classification if one ran — via `AskUserQuestion`. This is a
go/no-go on code that already exists, not a plan proposal, so
`ExitPlanMode` doesn't fit here the way it does at Gate 1.

- **Approved** → Step 12.
- **Rejected** → capture the feedback, apply the reject-routing table
  below, re-run the targeted stage and every stage listed after it (in
  the normal Step order — later inputs may have changed), return to
  the top of this step.

### Reject-routing table

| Feedback concerns... | Resume at | Re-run before Gate 2 again |
|---|---|---|
| The tests themselves are wrong, or the plan's intended behavior was wrong | **Architect** (Step 3) — full replan | everything downstream |
| A bug, missing behavior, or build failure in production code; tests otherwise accepted | **Green** (Step 8) | Refactor, doc-scribe |
| Code quality, idiom, duplication, or performance/benchmark regression on already-correct code | **Refactor** (Step 9) | doc-scribe |
| Documentation content only (history file, state-tracking file, glossary) | **doc-scribe** (Step 10) | nothing |
| Doesn't clearly map to one of the above, or spans more than one | `AskUserQuestion` with the four stage names as options — don't guess | as answered |

"Tests wrong → Architect, not directly Red" isn't arbitrary:
`test-writer-red.md` and `implementer-green.md` both say a wrong-test
call belongs to "a human or Architect," and this pipeline's own
routing table names only Green/Refactor/Scribe as post-refactor resume
targets — Red's absence from that table is consistent with this, not
a gap to route around.

**"Resume at Green" presupposes a test already pins the correct
behavior.** The production-code-bug row's "tests otherwise accepted"
qualifier means an existing test already fails (or would fail) for the
right reason once the bug is fixed — Green just has to satisfy it.
When Refactor instead finds a bug by code review, with no existing
test covering the missing behavior at all (a real, confirmed case in
the repo this pipeline was extracted from — Refactor found a write
path skipping a fatal-diagnostic check and an unvalidated injection
risk, neither of which any test asserted on), Green cannot add that
coverage itself: its hook denies every edit to a configured test-file
path. Insert a **Red** step first in that case — new tests pinning the
missing behavior — then proceed to Green as the table already says.
This is the same "tests need to exist before Green can be pointed at
them" logic Step 7 already follows on the very first pass through the
pipeline; a Gate 2 rejection doesn't change that requirement just
because it's mid-cycle.

## 12. `/ship`

Once Gate 2 passes.

## 13. Issue-tracker housekeeping

Close/update the implementation Task item and tick the Feature's
Acceptance Criteria directly via your configured tracker's operations
— no `github-issue-manager` spawn needed for this routine housekeeping,
matching how a mature run of this pipeline closes out its own items.

## 14. Invoke `process-auditor`

Once merged, with the shipped reference (Feature reference, PR, or
history-file path) — closes the loop on the cycle just completed.

## 15. Report and clean up

Report Process Auditor's findings to the human, then clear
`.claude/agentic-dev/audit.log` yourself. `process-auditor` cannot do
this — it has no `Write`/`Edit`/`Bash` tools at all, by design; the
audit log's findings belong in its report, not in the raw log, and
clearing it is the orchestrating session's job every time.
