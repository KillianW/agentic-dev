---
name: ship
description: >-
  Land the current branch: verify locally, commit, push, open or update the
  PR, wait for CI, merge once green, and clean up, using whatever code host
  .claude/kw-ad/tracker.yaml names (GitHub, Azure DevOps, GitLab, or manual).
  Used by /kw-ad:tdd; also usable on its own. Idempotent.
---

Finish and land the current branch. Idempotent: safe to re-run after
pushing more commits to an already-open PR — it won't open a
duplicate.

Read `.claude/kw-ad/tracker.yaml` first. Its `code_host.mode` decides
how Steps 5-7 work; `code_host.instructions` adds this repo's
specifics (merge method, reviewers, PR template, how to check CI). If
the file is missing, use `code_host.mode: manual`.

# Steps

1. **Refuse to run on `${user_config.default_branch}`.** If the
   current branch is the default branch, stop — there's nothing to
   ship; use `/kw-ad:new-branch` first.

2. **Local verification.** Run the same commands this repo's
   `.claude/kw-ad/scope-rules.json` allows for `tdd-green` (its
   `bash` rules' `match_exact` lists — typically build, lint, test,
   format-check), in that order. If the file is missing, ask the human
   for this repo's verification commands rather than guessing. Stop and
   report on the first failure. Do not push broken code just to get a
   CI answer.

3. **Commit** any uncommitted changes using Conventional Commits
   format (type + a scope meaningful to this repo + description). Skip
   this if everything is already committed.

4. **Push**: `git push -u origin <branch>` (or a plain `git push` if
   the branch already has an upstream).

5. **Open a PR if one doesn't already exist** for this branch.
   - `github`: `gh pr view` / `gh pr create` (or a GitHub MCP server's
     equivalent tools, if that's what `instructions` names).
   - `azure-devops`: `az repos pr list --source-branch <branch>` /
     `az repos pr create`.
   - `gitlab`: `glab mr view` / `glab mr create`.
   - `custom`: follow `instructions`.
   - `manual`: tell the human the branch is pushed and ask them to open
     the PR, then wait for them to confirm (and give you its link).

   Build the body from this repo's PR template if it has one (e.g.
   `.github/pull_request_template.md`), and reference the work item
   (from the branch name's ref segment) the way this repo links PRs to
   items.

   **If the body includes literal angle brackets** (a placeholder like
   `<value>`, an HTML comment in a code example), check that they
   survived after creating the PR. At least one PR write path (a GitHub
   MCP server, in the repo this pipeline came from) was confirmed to
   silently strip bracketed content. HTML-escape them (`&lt;`/`&gt;`)
   if they didn't survive.

6. **Wait for CI.** Poll the PR's checks every ~20-30s, up to ~10
   attempts (~5 minutes): `gh pr checks`, `az repos pr show` +
   policy evaluations, `glab ci status`, or whatever `instructions`
   says. For `manual`, ask the human to tell you when CI is green.
   - If you can't read CI status (permissions, missing CLI), stop,
     report the PR's state, and ask the human to confirm rather than
     guessing or merging blind.
   - If checks are readable but none ever appear, CI may never have
     triggered. Report that plainly rather than polling forever; one
     retrigger attempt (`git commit --allow-empty` and push) is
     reasonable before escalating.

7. **On green**:
   - **Capture the commit list first**, for `tdd-auditor`:
     `git log --format='%h %s' origin/${user_config.default_branch}..HEAD`.
     Include it in your report.
   - **Merge** with this repo's merge method (`instructions` says;
     default to squash where the host supports it and nothing says
     otherwise). For `manual`, ask the human to merge and confirm.
   - **Clean up**:
     `git checkout ${user_config.default_branch} && git pull origin ${user_config.default_branch}`,
     `git branch -d <branch>`, and delete the remote branch if the host
     didn't (`git push origin --delete <branch>`).

8. **On red**: stop, report which check failed and a summary of why,
   and do **not** merge. Fix the issue, then re-run `/kw-ad:ship` — it
   pushes the new commit and re-polls rather than opening a second PR.
