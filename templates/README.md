# Setting up agentic-dev in your repository

There's no automated installer yet (`/agentic-dev:init` is planned, see
`../docs/ROADMAP.md` Phase 3) — for now, set this up by hand:

1. Enable the plugin (`/plugin install <path-or-marketplace-source>`).
2. Set this repo's `userConfig` values when prompted (or via your Claude
   Code settings): `repo_owner`, `repo_name`, `default_branch`,
   `tracker_id`.
3. Create `.claude/agentic-dev/` in this repository's root if it doesn't
   exist yet.
4. Copy `scope-rules.json` from this directory into
   `.claude/agentic-dev/scope-rules.json`, then edit it for your own
   repo's languages and build commands. **This step is not optional** —
   without it, the hook runs with no file/command enforcement at all
   (see `../hooks/agentscope/config.mjs`'s `loadConfig` — it degrades
   safely to "no rules configured," never a guessed default, but that
   means the pipeline agents' scope restrictions are prompt-level
   suggestions only until you do this).
5. Copy `tracker.yaml` into `.claude/agentic-dev/tracker.yaml`. The
   version here binds to GitHub Issues via the `github` MCP server
   (already declared in `../.mcp.json`) and needs no editing if that's
   your tracker.
6. (Optional) Copy `issue-conventions.yaml` into
   `.claude/agentic-dev/issue-conventions.yaml` only if you want
   `github-issue-manager` to enforce a title-prefix/numbering scheme
   (Epic/Feature/Task-style hierarchy). Skip this file entirely for
   plain, unstructured GitHub Issues.
7. Add `.claude/agentic-dev/audit.log` to your `.gitignore` — the hook
   writes to it, it's local runtime state, not something to commit.

Once set up, read `../README.md` for how the six pipeline stages fit
together, and `../docs/PORTING-NOTES.md` for what's still rough about
this first-draft port before you rely on it for real work.
