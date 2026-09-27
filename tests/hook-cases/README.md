# Hook conformance cases

The behavior spec for the kw-ad scope hook. Both implementations
(`plugins/kw-ad/hooks/agentscope/js` and `.../py`) are tested against every
file here, by `tests/node/*.test.mjs` and `tests/python/test_*.py`
respectively. When hook behavior changes, change the cases first; both
suites should then fail until both implementations are updated.

## `decisions-*.json`: end-to-end cases

Each case spawns the real launcher (`run/node`, `run/python`) with a
payload on stdin, in a fresh temporary project directory.

```jsonc
{
  "config": { ... },            // default scope-rules.json for cases in this file
  "cases": [
    {
      "name": "unique, descriptive",
      "config": { ... },        // optional override; null = no config file;
                                // {"$raw": "text"} = write text verbatim
      "payload": { ... },       // hook input; "{project}" in any string is
                                // replaced with the temp project dir
      "stdin_raw": "...",       // optional: send this instead of payload
      "env": { "K": "v" },      // optional; null value = unset. "{project}" substituted.
      "expect": {
        "exit": 0,
        "decision": "allow",    // "allow" | "deny" | null (= no stdout at all)
        "reason_includes": "…", // optional substring of permissionDecisionReason
        "audit": true           // optional; default = decision != null
      }
    }
  ]
}
```

The harness always sets `CLAUDE_PROJECT_DIR={project}` and unsets
`KW_AD_SCOPE_CONFIG` unless the case's `env` says otherwise.

## `glob.json`: glob matcher cases

`{"cases": [{"pattern", "path", "match": bool}]}`, checked against each
implementation's glob function directly.

## `paths.json`: project-relative path cases

`{"cases": [{"style": "posix"|"win32", "root", "path", "expected": "rel/path" | null}]}`,
checked against each implementation's path-relativizing function with the
given platform's path semantics (so win32 cases run on every OS).
