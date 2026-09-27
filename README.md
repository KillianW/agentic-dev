# agentic-dev

A Claude Code plugin marketplace for agentic development workflows. The
one plugin, **`kw-ad`**, holds every workflow as a skill, and every
workflow shares one scope-enforcement hook that limits what each
subagent may edit or run.

| Workflow | Skill | Status |
|---|---|---|
| TDD feature delivery | `/kw-ad:tdd` | First external trial pending. The hook is unit-tested; the agents and skills haven't been run end to end outside the repo they came from. See [docs/workflows/tdd.md](docs/workflows/tdd.md). |

Supporting skills: `/kw-ad:init` (set up a repo), `/kw-ad:doctor`
(prove enforcement works), `/kw-ad:new-branch`, `/kw-ad:ship`.

## How enforcement works

Some pipeline agents (`tdd-red`, `tdd-green`, `tdd-refactor`,
`scribe`) have their Edit/Write/Bash calls checked by a `PreToolUse`
hook against the repo's `.claude/kw-ad/scope-rules.json`. For example,
Red may only touch test files and run the one test command, while
Green may not touch tests at all. The hook fails closed: a missing
config, broken config, or crashed hook denies those agents rather
than letting them through. Other agents, and your own session, are
never affected.

The hook ships in **Node.js (18+)** and **Python (3.8+)**, standard
library only. You choose the runtime when you enable the plugin
(`hook_runtime`: `node`, `python3`, or `python`). Claude Code's own
bundled runtime isn't available to hooks, so one of these must be on
PATH. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Install

You need a local copy of this repo (clone it or unzip an archive).
Nothing below fetches from GitHub.

**Try it for one session:**

```sh
claude --plugin-dir /path/to/agentic-dev/plugins/kw-ad
```

**Install it (persists across sessions):**

```sh
claude plugin marketplace add /path/to/agentic-dev
claude plugin install kw-ad@kw-agentic-dev
```

Claude Code asks for the plugin's options on enable. `hook_runtime` is
required.

**If your organization blocks local plugins**, vendor it into the
target repo as plain project config instead:

```sh
sh /path/to/agentic-dev/scripts/vendor.sh /path/to/target-repo --runtime python3
```

Vendored skills are named `/kw-ad-tdd`, `/kw-ad-init`, and so on.

Then, in the target repo: `/kw-ad:init` → `/kw-ad:doctor` →
`/kw-ad:tdd <work item or description>`. The full checklist for a
first trial is in [docs/TRYING-IT.md](docs/TRYING-IT.md).

## Repository layout

```
.claude-plugin/marketplace.json   marketplace "kw-agentic-dev"
plugins/kw-ad/                    the plugin (the only part that ships)
  agents/  skills/  hooks/  templates/
tests/                            hook conformance cases + Node and Python suites
scripts/vendor.sh                 plugin -> .claude/ exporter
docs/                             architecture, roadmap, porting notes, trial runbook
```

## Development

Work on this repo from a normal Claude Code session. It does not run
its own pipeline on itself. Every script has tests:

```sh
node --test tests/node/*.test.mjs
python -m unittest discover -s tests/python
claude plugin validate . && claude plugin validate plugins/kw-ad
```

CI runs these on Linux, macOS, and Windows, from the oldest supported
runtimes to current ones. See [CLAUDE.md](CLAUDE.md) for conventions,
especially the rule that hook behavior changes start in
`tests/hook-cases/`.

## License

MIT — see [LICENSE](LICENSE).
