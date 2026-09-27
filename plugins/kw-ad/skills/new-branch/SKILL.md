---
name: new-branch
description: >-
  Start work on a work item by creating a correctly named branch off an
  up-to-date default branch (${user_config.default_branch}). Used by
  /kw-ad:tdd; also usable on its own.
---

Create a feature branch to start work in
`${user_config.repo_owner}/${user_config.repo_name}`, following the
naming scheme `<type>/<ref>-<short-slug>` (adjust if this repo has its
own branching convention documented somewhere, e.g. a CONTRIBUTING
file).

# Arguments

A work-item reference (Jira key, Azure Boards id, GitHub issue
number, ...), or a plain description if there's no tracked item.

# Steps

1. **Check for a dirty working tree.** Run `git status --short`. If
   there are uncommitted changes that don't obviously belong to
   whatever you're about to start, stop and show them to the user
   rather than silently proceeding, stashing, or discarding anything.

2. **Sync the default branch.**
   `git checkout ${user_config.default_branch} && git pull origin ${user_config.default_branch}`
   — always branch from a fresh trunk, never from a stale local copy
   or from whatever branch happened to be checked out.

3. **Resolve the work-item title**, if a reference was given: read
   `.claude/kw-ad/tracker.yaml` and use the tool or command its
   `tracker.instructions` names. If `tracker.mode` is `none`, the file
   is missing, or the tracker can't be reached, use the description (or
   ask the human for a one-line title) instead.

4. **Pick a Conventional Commit type** (`feat|fix|docs|test|refactor|
   chore|perf|ci`) based on the dominant nature of the work about to
   happen. This is your own judgment call each time — not something to
   ask the user for.

5. **Build the slug**: a short, kebab-case summary of the item's title
   or description — a handful of words, not the whole title.

6. **Create the branch**:
   `git checkout -b <type>/<ref>-<slug>`, e.g. `feat/PAY-123-retry-webhooks`
   or `fix/158-null-config`. Omit the ref segment if there isn't one
   (e.g. `docs/tidy-readme`).

7. Confirm the branch name to the user in one line. This skill's job
   ends once the branch exists.
