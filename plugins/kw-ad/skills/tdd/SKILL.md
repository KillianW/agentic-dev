---
name: tdd
description: >-
  Run the kw-ad TDD feature-delivery pipeline for one Feature/Task:
  tdd-architect plans, two human sign-off gates, tdd-red/tdd-green/
  tdd-refactor/scribe execute under hook-enforced scope, /kw-ad:ship lands it,
  tdd-auditor closes the loop. Size/risk-gated: suggests direct work instead
  for trivially small changes or ones no pipeline stage can make (agent/skill
  prompts, CI workflows, Claude Code settings).
effort: high
---

Run the whole TDD feature-delivery pipeline for one Feature/Task, end
to end: tdd-architect plans → sign-off → `/kw-ad:new-branch` → scribe
records the plan → Red → Green → Refactor → scribe appends the outcome
→ sign-off → `/kw-ad:ship` → tdd-auditor closes the loop. Six subagents
and two skills get sequenced here — this skill is the orchestration,
not any of the work itself.

**You, the orchestrating session, are the only participant with
tracker and code-host access.** No pipeline subagent has a tracker
tool. Every time you invoke a subagent, paste the work-item content it
needs (title, body, acceptance criteria, parent/design items where
relevant) directly into its prompt; never tell it to "read the issue".
Pointing it at a real file it can `Read` (like the history file scribe
writes in Step 6) is fine.

All subagents are this plugin's, so their `subagent_type` is always
`kw-ad:<name>` (e.g. `kw-ad:tdd-red`).

# Arguments

A work-item reference (a Jira key, an Azure Boards id, a GitHub issue
number, ...) or a plain description of the work.

# Steps

## 0. Preconditions

- `.claude/kw-ad/scope-rules.json` must exist. If it doesn't, stop and
  tell the human to run `/kw-ad:init`. Without it the scope hook
  denies every Edit/Write/Bash call from the code-writing stages, so
  the pipeline can't make progress.
- If `.claude/kw-ad/audit.log` has no entries yet, suggest running
  `/kw-ad:doctor` once first. It proves the scope hook is actually
  enforcing in this environment. Don't block on this.
- Read `.claude/kw-ad/tracker.yaml` (if it's missing, treat it as
  `tracker.mode: none` and `code_host.mode: manual`). Its `tracker` and
  `code_host` sections tell you which tools or commands to use for
  work items and PRs in this repo.

## 1. Size/risk gate

**1a. File-type guard.** If the change is knowably confined to files
no pipeline stage's scope covers — agent or skill prompts
(`**/agents/*.md`, `**/SKILL.md`), CI workflows (e.g.
`.github/workflows/*`), or Claude Code config (`.claude/**`) — skip
straight to direct implementation. Red/Green/Refactor can only ever
touch what `.claude/kw-ad/scope-rules.json` allows for them, which is
this repo's test and source files, so routing this kind of change
through them would just produce denials. Optionally still consult
`kw-ad:tdd-architect` for a plan on non-trivial direct work, and
`kw-ad:scribe` to document it afterward. Stop here.

**1b. Size/risk check**, for everything else: is this roughly ≤1-2
files, ≤30-50 lines, unambiguous (a typo, a stale comment, a one-line
bug fix — not something needing an approach decision), and clear of
any frozen-decision-tier docs this repo has, the enforcement config,
and CI config? If yes to all: ask via `AskUserQuestion` — implement
directly, or run the full pipeline anyway? Follow whichever the human
picks. If no to any: proceed to Step 2 without asking — don't nag for
obviously-substantial work.

## 2. Resolve the target

- **A reference was given** and `tracker.mode` isn't `none`: read the
  work item (and its parent / linked design item, if any) using the
  tools `tracker.instructions` names. If you can't reach the tracker,
  ask the human to paste the item's content instead of guessing.
- **A plain description was given**, or `tracker.mode` is `none`: use
  the description as the work item. If it has no clear acceptance
  criteria, ask the human for them now. Every later stage depends on
  them.

Keep the resolved content (title, body, acceptance criteria, reference)
at hand; you'll paste it into several prompts below.

## 3. Invoke `kw-ad:tdd-architect`

Agent tool, `subagent_type: kw-ad:tdd-architect`, with the resolved
work-item content from Step 2 pasted into the prompt.

## 4. Sign-off Gate 1 — post-Architect

Present the returned plan via `ExitPlanMode`. If the session isn't in
plan mode for some reason, fall back to `AskUserQuestion` presenting
the plan with Approve/Reject options — same effect either way, no
auto-proceeding.

- **Rejected** → capture the feedback text, re-invoke
  `kw-ad:tdd-architect` (Step 3) with the original content plus the
  feedback attached, and return to the top of this step.
- **Approved** → Step 5.

## 5. `/kw-ad:new-branch`

Same target as Step 2 — creates the branch before any code-writing
stage runs.

## 6. Invoke `kw-ad:scribe` to record the plan

Its Process step 1: write the approved plan into
`docs/planning/history/<ITEM>.md` (use the work-item reference, e.g.
`PAY-123.md`, or a short slug when there is none), or wherever this
repo's own documentation-history convention puts it. Paste the
approved plan and the work-item content into its prompt. It runs on
the new branch, so the record lands in the same PR as the
implementation.

## 7. Invoke `kw-ad:tdd-red`

The approved plan is its input: paste it, or point at the history file
from Step 6 and paste the acceptance criteria. Ends with a red
confirmation from this repo's one configured test command — every new
test failing for the right reason.

## 8. Invoke `kw-ad:tdd-green`

Same plan, plus Red's now-failing tests (name the test files). Ends
with all of this repo's configured verify commands
(build/lint/test/format-check-equivalent) green.

## 9. Invoke `kw-ad:tdd-refactor`

Same plan, plus Green's code (name the files). Ends with a final green
re-check and, if this repo has an optional
`.claude/kw-ad/perf-policy.yaml` configured and a covered package was
touched, a benchmark classification against its two gates.

**Prompting note for Steps 7-9**: these three agents have no tracker
tools and their Bash is limited to a few exact commands, so they
cannot fetch a work item's content themselves. Paste anything they
need into the prompt. A real cycle in the repo this pipeline was
extracted from traced a burst of Bash denials directly to telling an
agent to "read the issue first".

**If `tdd-refactor`'s benchmark classification triggers both of this
repo's perf-policy gates** (relative and absolute) on any case: when
Gate 2 (post-Refactor) or the eventual history-file outcome narrative
records the accept/reject decision, give each gate its own explicit
written justification — don't let an absolute-time band's "rejected by
default" result ride silently on the relative-delta explanation alone.
The two-gate policy is designed for the gates to be judged
independently ("clearing one gate never excuses the other"); the
narrative should reflect that independence, not just the agent's own
per-case report.

**Benchmark judgment is `tdd-refactor`'s call to make and report, not
the orchestrator's to resolve independently.** If a
Gate-1-triggering result's classification (e.g. "likely
shared-environment noise") would benefit from a second data point
before Gate 2, you MAY re-run the benchmark command yourself once for
corroboration. If you do, report both runs' data explicitly at Gate 2
and in the history narrative — never silently substitute the second
run's numbers for `tdd-refactor`'s own.

## 10. Invoke `kw-ad:scribe` again to record the outcome

Its Process steps 2 and 3: append the outcome narrative to the same
history file, and write whatever other markdown the change needs (a
root state-tracking file, a "what's next" pointer, glossary, package
READMEs). Give it a summary of what each stage reported. Anything under
this repo's frozen-decision-tier docs (if it has any) is proposed
only, in its report, since `scribe` is hard-denied from editing those.

## 11. Sign-off Gate 2 — post-Refactor, pre-ship

Present a summary of Steps 7-10 — diffs, each stage's report, the
benchmark classification if one ran — via `AskUserQuestion`. This is a
go/no-go on code that already exists, not a plan proposal, so
`ExitPlanMode` doesn't fit here the way it does at Gate 1.

- **Approved** → Step 12.
- **Rejected** → capture the feedback, apply the reject-routing table
  below, re-run the targeted stage and every stage listed after it (in
  the normal Step order — later inputs may have changed), and return to
  the top of this step.

### Reject-routing table

| Feedback concerns... | Resume at | Re-run before Gate 2 again |
|---|---|---|
| The tests themselves are wrong, or the plan's intended behavior was wrong | **tdd-architect** (Step 3) — full replan | everything downstream |
| A bug, missing behavior, or build failure in production code; tests otherwise accepted | **tdd-green** (Step 8) | tdd-refactor, scribe |
| Code quality, idiom, duplication, or performance/benchmark regression on already-correct code | **tdd-refactor** (Step 9) | scribe |
| Documentation content only (history file, state-tracking file, glossary) | **scribe** (Step 10) | nothing |
| Doesn't clearly map to one of the above, or spans more than one | `AskUserQuestion` with the four stage names as options — don't guess | as answered |

"Tests wrong → tdd-architect, not directly tdd-red" isn't arbitrary:
both `tdd-red` and `tdd-green` say a wrong-test call belongs to "a
human or Architect".

**"Resume at Green" presupposes a test already pins the correct
behavior.** The production-code-bug row's "tests otherwise accepted"
qualifier means an existing test already fails (or would fail) for the
right reason once the bug is fixed — Green just has to satisfy it.
When Refactor instead finds a bug by code review, with no existing
test covering the missing behavior at all, Green cannot add that
coverage itself: its hook denies every edit to a configured test path.
Insert a **tdd-red** step first in that case — new tests pinning the
missing behavior — then proceed to Green as the table says.

## 12. `/kw-ad:ship`

Once Gate 2 passes.

## 13. Tracker housekeeping

Only if `tracker.mode` isn't `none`: update the work item as
`tracker.instructions` describes (e.g. comment with the PR link, tick
acceptance criteria, transition it). If the instructions don't say,
ask the human what they want rather than transitioning anything.

## 14. Invoke `kw-ad:tdd-auditor`

Once merged (or once the human confirms the merge, for
`code_host.mode: manual`). Paste into its prompt:
- the history file's path;
- the work-item content;
- the PR's title, link, and **individual commit list** (e.g.
  `git log --format='%h %s' <default-branch>..<branch>` captured before
  the branch was deleted, or from the code host);
- the file list the plan's Critical Files section named.

## 15. Report and clean up

Report tdd-auditor's findings to the human, then clear
`.claude/kw-ad/audit.log` yourself. `tdd-auditor` cannot do this — it
has no `Write`/`Edit`/`Bash` tools at all, by design; the audit log's
findings belong in its report, not in the raw log, and clearing it is
the orchestrating session's job every time.
