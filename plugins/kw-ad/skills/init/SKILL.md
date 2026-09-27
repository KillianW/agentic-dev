---
name: init
description: >-
  Set up kw-ad in this repository: detect the stack, write
  .claude/kw-ad/scope-rules.json from a preset with this repo's real test and
  build commands, write .claude/kw-ad/tracker.yaml, and git-ignore the audit
  log. Run once per repo before /kw-ad:tdd, then run /kw-ad:doctor.
---

Set up `.claude/kw-ad/` in the current repository. Work in the main
session, ask the human wherever a choice is theirs, and never
overwrite an existing file without showing what would change and
getting a yes.

Plugin files referenced below live under `${CLAUDE_PLUGIN_ROOT}`.

# Steps

1. **Confirm the location.** You should be at the repository root
   (`git rev-parse --show-toplevel`). If `.claude/kw-ad/` already
   exists, say what's there and ask whether to update it or stop.

2. **Detect the stack** with `Glob`: `go.mod` → go;
   `pyproject.toml` / `setup.cfg` / `requirements*.txt` → python;
   `package.json` / `tsconfig.json` → typescript;
   `build.gradle*` / `pom.xml` → jvm. Presets live in
   `${CLAUDE_PLUGIN_ROOT}/templates/presets/` (`go.json`,
   `python.json`, `typescript.json`, `jvm.json`). If several match
   (a monorepo) or none do, ask which preset to start from. If none
   fits, start from the closest one and adapt it with the human.

3. **Check the preset against the repo's real conventions.**
   - *Test files*: `Glob` for existing tests and compare their paths
     with `tdd-red`'s `edit` allow globs. Propose changes if the repo's
     tests live elsewhere (e.g. `spec/`, `src/**/__tests__/`).
   - *Source files*: likewise for `tdd-green`/`tdd-refactor`.
   - *Frozen docs*: ask whether the repo has documents that record
     already-made decisions (ADRs, specs) that `scribe` must never
     edit. Replace or remove the preset's `docs/adr/**` and
     `docs/specifications/**` deny rule accordingly.
   - Globs: `*` stays within one path segment, `**/` spans any number
     of segments, and the first matching rule wins.

4. **Ask for the exact commands.** Bash rules are exact-string matches
   (no prefixes, no arguments), so they must be exactly what the agents
   will type. Look at the repo's `Makefile`, `package.json` scripts,
   `pyproject.toml`, CI workflow, and README first, and propose
   commands from what you find. Then confirm with `AskUserQuestion`:
   - `tdd-red`: the **one** command that runs the test suite.
   - `tdd-green` / `tdd-refactor`: the full local verification set
     (build, lint/vet, test, format-check), which should mirror CI.
     `/kw-ad:ship` also runs this set before pushing.
   - `tdd-refactor` only: a benchmark command, if the repo has one.

5. **Write `.claude/kw-ad/scope-rules.json`.** Keep `version: 1` and
   entries for all four scope-managed agents (`tdd-red`, `tdd-green`,
   `tdd-refactor`, `scribe`). Drop the preset's `$comment`, or rewrite
   it to describe this repo. Then validate it:

   `${user_config.hook_runtime} "${CLAUDE_PLUGIN_ROOT}/hooks/agentscope/run/${user_config.hook_runtime}" --check-config .claude/kw-ad/scope-rules.json`

   Fix every `error:` line. Treat every `warning:` as a question for the
   human, not something to silence.

6. **Write `.claude/kw-ad/tracker.yaml`** from
   `${CLAUDE_PLUGIN_ROOT}/templates/tracker.yaml`. Ask:
   - where work items live (`tracker.mode`: none, github, jira,
     azure-devops, custom) and, unless it's `none`, which tool or
     command reads an item and what "done" means
     (`tracker.instructions`);
   - where PRs live (`code_host.mode`: manual, github, azure-devops,
     gitlab, custom) and the merge method and CI check
     (`code_host.instructions`).

   If there's any doubt, `tracker.mode: none` and
   `code_host.mode: manual` always work.

7. **Optional files**, only if the human wants them:
   `${CLAUDE_PLUGIN_ROOT}/templates/perf-policy.yaml` → benchmark
   regression gates for `tdd-refactor`;
   `${CLAUDE_PLUGIN_ROOT}/templates/issue-conventions.yaml` → an issue
   numbering scheme for the optional `github-issue-manager` agent.

8. **Git-ignore the audit log**: add `.claude/kw-ad/audit.log` to
   `.gitignore` if no existing pattern covers it.

9. **Finish.** List the files written. Suggest committing
   `scope-rules.json` and `tracker.yaml` (they're team configuration),
   then running `/kw-ad:doctor` to prove enforcement works before the
   first `/kw-ad:tdd`.
