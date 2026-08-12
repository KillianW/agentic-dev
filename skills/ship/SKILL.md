---
name: ship
description: Land the current branch on ${user_config.repo_owner}/${user_config.repo_name} — verify, push, open (or update) a PR, wait for CI, squash-merge once green, and clean up. The GitHub Flow convention's landing mechanism.
---

Finish and land the current branch. Idempotent: safe to re-run after
pushing more commits to an already-open PR — it won't open a
duplicate.

# Steps

1. **Refuse to run on `${user_config.default_branch}`.** If the
   current branch is the default branch, stop — there's nothing to
   ship; use `/new-branch` first.

2. **Local verification**, in this repo's own configured order,
   matching its CI workflow so a broken push is caught here, not on
   GitHub. Run the same command set this repo's
   `.claude/agentic-dev/scope-rules.json` configures for
   `implementer-green` (typically build, vet/lint-equivalent, test,
   format-check — see `templates/scope-rules.json` for the shape; if
   this repo hasn't configured that file yet, ask what its own local
   verification commands are rather than guessing).

   Stop and report on the first failure. Do not push broken code just
   to get a CI answer.

3. **Commit** any uncommitted changes, if there are any, using
   Conventional Commits format (type + a scope meaningful to this
   repo + description). If everything is already committed, skip this.

4. **Push**: `git push -u origin <branch>` (or a plain `git push` if
   the branch already has an upstream).

5. **Open a PR if one doesn't already exist** for this branch (your
   configured tracker's PR-inspection operation —
   `mcp__github__pull_request_read` or `list_pull_requests`, as
   shipped — to check first). If opening: build the body from
   `.github/pull_request_template.md`'s structure if this repo has
   one, filling "Closes #N" from the branch's issue reference if
   `/new-branch` recorded one (branch name contains an issue number
   segment).

   **If the body text includes literal angle brackets** (a code
   example containing an HTML-comment-style block, a placeholder like
   `<value>`, etc.): HTML-entity-escape them (`&lt;`/`&gt;`) rather
   than writing them literally — this write path has been confirmed,
   in the repo this pipeline was extracted from, to silently strip
   bracketed content entirely, not just render it differently (a real
   PR shipped with a code example reduced to nothing between two
   backticks). After creating the PR, do one follow-up
   `mcp__github__pull_request_read` (`method: get`) to confirm any
   escaped content actually survived before moving on.

6. **Poll CI status.** Try, in order:
   - `mcp__github__pull_request_read`, `method: get_check_runs`
   - `mcp__github__pull_request_read`, `method: get_status`

   Either one succeeding is enough — use whichever the current token's
   scope actually grants (needs **Checks** or **Commit statuses**
   permission, beyond the Issues/Pull-requests/Contents already
   required for everything else `/ship` does). Poll every ~20-30s, up
   to ~10 attempts (~5 minutes). If both methods 403 (permission not
   granted): stop, report the PR's current state, and ask the user to
   confirm CI status rather than guessing or merging blind.

   **If both methods succeed but return zero check runs** (distinct
   from a 403 — the calls work, there's just nothing there), that's a
   different failure mode: CI genuinely never triggered, not a
   permissions gap. Before escalating, rule out the cheap explanations
   directly:
   - `actions/workflows` — confirm the relevant workflow's `state` is
     `active`, not disabled.
   - `actions/permissions` — confirm Actions is enabled for the repo/branch.
   - `rate_limit` — rule out throttling.
   - A repo-wide `actions/runs` query — confirm Actions is running at
     all for *other* recent activity, not just silent for this PR.
   - One retrigger attempt: an empty commit (`git commit --allow-empty`)
     pushed to the branch, in case of a one-off missed webhook delivery.

   If all of that comes back clean and CI still never appears, this is
   outside what's fixable from here — stop and report plainly (which
   checks were run, that they were clean, and that the cause is
   unexplained) rather than continuing to poll or guess. If the user
   then chooses to merge manually via GitHub's UI: that merge will be a
   **regular merge, not squash** (no MCP tool distinguishes "merge
   commit" from "squash" for a human clicking through the UI) — a real,
   visible deviation from this repo's squash-only convention, worth
   naming explicitly rather than letting it happen as a silent side
   effect. Still run the normal post-merge branch cleanup
   (`git checkout ${user_config.default_branch} && git pull`, delete
   local + remote branch) once confirmed merged.

7. **On green**: merge via `mcp__github__merge_pull_request` with
   `merge_method: "squash"` (the PR title becomes the default branch's
   commit subject under squash — branch-internal commit hygiene
   matters less than PR-title quality as a result). Then clean up:
   - `git checkout ${user_config.default_branch} && git pull origin ${user_config.default_branch}`
   - `git branch -d <branch>` (local)
   - `git push origin --delete <branch>` (remote — no MCP tool deletes
     branches; this is a manual step every time)

8. **On red**: stop, report which check failed and a summary of why,
   do **not** merge. Fix the issue, then re-run `/ship` — it will push
   the new commit and re-poll rather than opening a second PR.
