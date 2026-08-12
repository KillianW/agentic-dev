---
name: new-branch
description: Start work on a tracked work item by creating a correctly-named branch off an up-to-date default branch, per this repo's GitHub Flow convention.
---

Create a feature branch to start work on
`${user_config.repo_owner}/${user_config.repo_name}`, following the
naming scheme `<type>/<issue-number>-<short-slug>` (adjust if this
repo's own `.claude/agentic-dev/` config, or any branching-convention
doc it already has, specifies something different).

# Arguments

An issue number, an issue reference, or a plain description if there's
no tracked work item yet.

# Steps

1. **Check for a dirty working tree.** Run `git status --short`. If
   there are uncommitted changes that don't obviously belong to
   whatever you're about to start, stop and show them to the user
   rather than silently proceeding, stashing, or discarding anything
   (general git safety protocol — never assume unrelated in-progress
   work is disposable).

2. **Sync the default branch.**
   `git checkout ${user_config.default_branch} && git pull origin ${user_config.default_branch}`
   — always branch from a fresh trunk, never from a stale local copy
   or from whatever branch happened to be checked out.

3. **Resolve the work-item reference**, if one was given: read its
   title via your configured tracker's `get_item` operation (see
   `.claude/agentic-dev/tracker.yaml` — `mcp__github__issue_read`,
   `method: get`, as shipped) to build the slug. If no reference was
   given, use the plain description directly for the slug.

4. **Pick a Conventional Commit type** (`feat|fix|docs|test|refactor|
   chore|perf|ci`) based on the dominant nature of the work about to
   happen. This is your own judgment call each time — not something to
   ask the user for.

5. **Build the slug**: a short, kebab-case, human-readable summary of
   the item's title or description — a handful of words, not a
   restatement of the whole title.

6. **Create the branch**:
   `git checkout -b <type>/<issue-number>-<slug>` — e.g.
   `feat/158-pipeline-phase1-foundations`. Omit the issue-number
   segment if there isn't one (e.g. `docs/tidy-readme`).

7. Confirm the branch name to the user in one line and proceed with
   the actual work — this skill's job ends once the branch exists.
