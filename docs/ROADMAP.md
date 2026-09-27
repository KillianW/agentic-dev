# Roadmap

## Done: hardening pass (v0.2.0)

- **Repo layout.** Restructured into a marketplace (`kw-agentic-dev`)
  with one multi-workflow plugin (`kw-ad`).
- **Hook bugs fixed.** Each of these alone meant zero enforcement:
  - `agent_type` namespacing;
  - fail-open on a missing runtime or config;
  - main-session calls auto-approved;
  - double hook registration;
  - unparseable agent frontmatter silently granting all tools.
- **Hook implementations.** Node + Python, selected by `hook_runtime`.
  Shared conformance cases, unit tests for both, and a CI matrix.
- **Trackers.** Moved to the main session (`tracker.yaml` modes: none,
  github, jira, azure-devops, custom). No bundled MCP servers.
- **Setup and distribution.** `/kw-ad:init` and `/kw-ad:doctor` (live
  denial probe), `scripts/vendor.sh` for locked-down environments, and
  the `docs/TRYING-IT.md` runbook.

## Next: first external trial

Follow [TRYING-IT.md](TRYING-IT.md) on a real work repository
(macOS/Linux/WSL, Jira or Azure DevOps). What we need to learn:

- Which install path works there: `--plugin-dir`, a local
  marketplace, or `vendor.sh`.
- Whether `/kw-ad:doctor`'s probe passes on the first try.
- Whether `/kw-ad:init`'s preset plus command questions produce
  correct rules for a non-Go stack.
- How the pipeline behaves across one real cycle. Friction goes into
  the agent prompts; the tdd-auditor report is the input.
- Whether `tracker.mode: none`, with the ticket text pasted in, is
  enough, or whether a real Jira/ADO binding is worth it.

## Later

- **A second workflow** (e.g. bug triage, or spike → ADR). It will be
  the test of the one-plugin structure and the shared `scribe`.
- **Richer tracker guidance** for Jira/ADO once the trial shows what
  the main session actually needs.
- **Marketplace polish**: versioning discipline, a changelog, and
  whether this repo should become public.
- **`userConfig.options`** for `hook_runtime` once v2.1.271+ can be
  assumed (it gives a picker instead of free text).
