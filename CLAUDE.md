# Working on agentic-dev

This repo is a Claude Code plugin marketplace. `plugins/kw-ad/` is the
plugin (the only part that ships); everything else is development
support. Read `docs/ARCHITECTURE.md` before changing the hook.

## Ground rules

- **Don't run the kw-ad pipeline on this repo.** Changes are made from
  the main session and verified with unit tests. There is no
  `.claude/kw-ad/` here on purpose.
- **Keep the two hook implementations in lockstep.**
  `plugins/kw-ad/hooks/agentscope/js/` (Node 18+) and `py/kwad_scope/`
  (Python 3.8+) implement one spec: standard library only, same
  function shapes, same messages. To change hook behavior:
  1. Add or change cases in `tests/hook-cases/` first.
  2. Update both implementations until both suites pass.
- **Keep the Python launchers identical.** `run/python3` and
  `run/python` must match byte for byte (a test checks this).
- **Everything must run on stock macOS/Linux/Git Bash.** Shell scripts
  are POSIX `sh` (no bashisms), and `sed`/`find` usage must work on
  both GNU and BSD. Files are LF (`.gitattributes`).
- **Agent frontmatter must parse.** Write descriptions as `>-` block
  scalars. A YAML error silently drops `tools:` and grants every tool.
  `claude plugin validate plugins/kw-ad` catches it.
- **Reference plugin files as `${CLAUDE_PLUGIN_ROOT}/...`** in agent
  and skill prose, and subagents as `kw-ad:<name>`. `scripts/vendor.sh`
  rewrites both for vendored installs; its tests check nothing
  unresolved remains.
- **No bundled MCP servers, no tracker tools in agent frontmatter.**
  The main session brokers tracker access (see ARCHITECTURE.md).

## Checks

```sh
node --test tests/node/*.test.mjs
python -m unittest discover -s tests/python
claude plugin validate . && claude plugin validate plugins/kw-ad
```

On Windows, `python3` may be the Store stub; use `python`.

## Adding a workflow

Add a skill at `plugins/kw-ad/skills/<workflow>/SKILL.md` and agents
prefixed `<workflow>-`. If new agents need scope enforcement, add them
to `RESTRICTED_AGENTS` in both hook implementations (with cases), and
to every preset in `templates/presets/`. Add
`docs/workflows/<workflow>.md` and a row in README's workflow table.
