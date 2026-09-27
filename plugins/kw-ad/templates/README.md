# kw-ad templates

`/kw-ad:init` copies and adapts these into `<repo>/.claude/kw-ad/`. You
can also do it by hand; run `/kw-ad:doctor` afterwards either way.

| Template | Becomes | Required? |
|---|---|---|
| `presets/<lang>.json` (go, python, typescript, jvm) | `.claude/kw-ad/scope-rules.json` | **Yes.** Without it, the scope hook denies every Edit/Write/Bash call from `tdd-red`, `tdd-green`, `tdd-refactor`, and `scribe`. |
| `tracker.yaml` | `.claude/kw-ad/tracker.yaml` | No. Missing means `tracker.mode: none`, `code_host.mode: manual`. |
| `perf-policy.yaml` | `.claude/kw-ad/perf-policy.yaml` | No. Enables `tdd-refactor`'s benchmark-regression gates. |
| `issue-conventions.yaml` | `.claude/kw-ad/issue-conventions.yaml` | No. Only used by the optional `github-issue-manager` agent. |

Also git-ignore `.claude/kw-ad/audit.log`: the hook writes it, and it's
local runtime state.

## scope-rules.json

```json
{
  "version": 1,
  "unknown_agent_decision": "allow",
  "agents": {
    "<bare agent name, e.g. tdd-red>": {
      "edit": {
        "rules": [{ "match": ["<glob>"], "decision": "allow|deny", "reason": "optional" }],
        "default": { "decision": "allow|deny", "reason": "optional" }
      },
      "bash": {
        "rules": [{ "match_exact": ["<exact command>"], "decision": "allow|deny" }],
        "default": { "decision": "deny" }
      }
    }
  }
}
```

- `edit` covers Edit, Write, MultiEdit and NotebookEdit. `bash` covers
  Bash and PowerShell.
- Rules are checked in order and the **first match wins**, so put a
  narrow `deny` (tests) before a broad `allow` (all source files).
- Globs are matched against the project-relative path with `/`
  separators. `*` stays within one path segment, `**/` matches any
  number of segments, a bare `**` matches anything, and everything else
  is literal. Paths outside the project are always denied.
- `match_exact` is exact string equality after trimming whitespace,
  with no prefixes, patterns, or argument handling. `make test extra` and
  `make test && rm -rf /` don't match `make test`.
- There is no `"ask"` decision: it doesn't pause a subagent (it
  resolves unattended), so it isn't offered.
- **Fail closed:** for the four scope-managed agents, a missing or
  invalid config, a missing agent entry, a missing `edit`/`bash`
  section, or no matching rule without a `default` all mean **deny**.
- `unknown_agent_decision` applies to other subagents only (never to
  the main session). `"allow"` means the hook stays silent and Claude
  Code's normal permission flow applies. `"deny"` blocks their
  Edit/Write/Bash calls.
- Use bare agent names (`tdd-red`), not `kw-ad:tdd-red`. The hook
  strips the plugin prefix itself.

Validate with:

```sh
<node|python3|python> "<plugin>/hooks/agentscope/run/<same runtime>" --check-config .claude/kw-ad/scope-rules.json
```
