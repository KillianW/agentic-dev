// Pure (or near-pure) helpers for the agentic-dev PreToolUse hook. Kept
// separate from agentscope.mjs's stdin/stdout/process-exit plumbing so
// the decision logic itself is directly unit-testable without mocking
// process I/O -- the same separation tools/agentscopehook/main.go used
// in the original Go implementation this ports (decide/decideBash/
// formatAuditLine were kept pure there for the identical reason).
//
// This file has never been run under Node in the environment that wrote
// it (no Node available in that dev container) -- see docs/ROADMAP.md
// Phase 1. Treat this as a careful first draft, not a proven one.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const EMPTY_RULESET = Object.freeze({
  version: 1,
  unknown_agent_decision: "allow",
  agents: {},
});

// Translates a small, deliberately limited glob syntax into a RegExp:
//   '**' matches zero or more whole path segments (crosses '/')
//   '*'  matches within a single path segment only (never crosses '/')
// Everything else is treated as a literal and regex-escaped.
//
// Written as a single-pass character scan, not a chain of global string
// replacements: '**' and '*' expand into regex snippets ('.*', '[^/]*')
// that themselves contain '*' characters, so a second blind
// find-and-replace pass over the already-built string would re-match
// and corrupt those emitted snippets. Single-pass with explicit index
// control avoids that whole class of bug.
export function globToRegExp(pattern) {
  let out = "";
  let i = 0;
  const n = pattern.length;
  const metachars = ".+^${}()|[]\\";
  while (i < n) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i += 2; // consume both '*' characters
        if (pattern[i] === "/") {
          // '**/' -- zero or more whole segments, each followed by '/'.
          out += "(?:[^/]+/)*";
          i += 1; // consume the '/'
        } else {
          // bare '**' with no trailing slash -- match anything at all.
          out += ".*";
        }
      } else {
        // single '*' -- within one path segment only.
        out += "[^/]*";
        i += 1;
      }
      continue;
    }
    out += metachars.includes(c) ? "\\" + c : c;
    i += 1;
  }
  return new RegExp("^" + out + "$");
}

// matchGlob(pattern, filePath) -- true if filePath (already forward-slash
// normalized, repo-root-relative) matches pattern under the glob syntax
// globToRegExp implements.
export function matchGlob(pattern, filePath) {
  return globToRegExp(pattern).test(filePath);
}

function normalizePath(filePath) {
  return String(filePath).replace(/\\/g, "/").replace(/^\.\//, "");
}

// resolveEditDecision mirrors main.go's decide(): given the loaded
// config, the calling agent's type, and a repo-root-relative file path,
// returns { decision, reason }. An agent with no "edit" rules configured
// (including an agent type the config doesn't mention at all -- e.g. the
// unrestricted architect/process-auditor stages, or the main session
// itself) falls through to config.unknown_agent_decision, exactly as
// main.go's decide() defaulted every unrecognized agentType to allow.
//
// Rules are evaluated in array order, first match wins -- this is what
// lets a narrow "deny *_test.go" rule precede a broad "allow *.go" rule
// for the same agent.
export function resolveEditDecision(config, agentType, filePath) {
  const cfg = config ?? EMPTY_RULESET;
  const agentCfg = cfg.agents?.[agentType];
  const unknownDecision = cfg.unknown_agent_decision ?? "allow";

  if (!agentCfg || !agentCfg.edit) {
    return { decision: unknownDecision, reason: "" };
  }

  const normalized = normalizePath(filePath);
  for (const rule of agentCfg.edit.rules ?? []) {
    for (const pattern of rule.match ?? []) {
      if (matchGlob(pattern, normalized)) {
        return { decision: rule.decision, reason: rule.reason ?? "" };
      }
    }
  }

  const def = agentCfg.edit.default;
  if (def) return { decision: def.decision, reason: def.reason ?? "" };
  return { decision: unknownDecision, reason: "" };
}

// resolveBashDecision mirrors main.go's decideBash(): exact-string
// equality only (after trimming surrounding whitespace), deliberately --
// never prefix or pattern matching. This is a security property, not an
// incidental detail: a command like "make test; rm -rf /" or "make test
// extra" simply isn't equal to any allowed string, so it's denied by
// construction rather than by trying to parse or sanitize an arbitrary
// shell string.
export function resolveBashDecision(config, agentType, command) {
  const cfg = config ?? EMPTY_RULESET;
  const agentCfg = cfg.agents?.[agentType];
  const unknownDecision = cfg.unknown_agent_decision ?? "allow";

  if (!agentCfg || !agentCfg.bash) {
    return { decision: unknownDecision, reason: "" };
  }

  const trimmed = String(command).trim();
  for (const rule of agentCfg.bash.rules ?? []) {
    if ((rule.match_exact ?? []).includes(trimmed)) {
      return { decision: rule.decision, reason: rule.reason ?? "" };
    }
  }

  const def = agentCfg.bash.default;
  if (def) return { decision: def.decision, reason: def.reason ?? "" };
  return { decision: unknownDecision, reason: "" };
}

// loadConfig resolves the scope-rules config for cwd, in order:
//   1. $AGENTIC_DEV_SCOPE_CONFIG, if set (explicit override)
//   2. <cwd>/.claude/agentic-dev/scope-rules.json, if present
//   3. an empty ruleset (unknown_agent_decision: "allow") with a loud
//      warning -- never a hard failure or a silently-wrong guessed
//      default. There is deliberately no bundled Go/Make fallback
//      shipped with this hook: a ruleset shaped for one language would
//      be meaningless or actively wrong for an installing repo written
//      in another. See docs/ARCHITECTURE.md's "No bundled Go/Make
//      default" section for the reasoning.
// Returns { config, source, warning } -- source is the path actually
// used (or null for the empty-ruleset case), warning is a human-readable
// string to surface on stderr (or null if none).
export function loadConfig(cwd) {
  const candidates = [];
  if (process.env.AGENTIC_DEV_SCOPE_CONFIG) {
    candidates.push(process.env.AGENTIC_DEV_SCOPE_CONFIG);
  }
  if (cwd) {
    candidates.push(path.join(cwd, ".claude", "agentic-dev", "scope-rules.json"));
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const raw = readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw);
      return { config: parsed, source: candidate, warning: null };
    } catch (err) {
      // A present-but-broken config must not brick every Edit/Write/Bash
      // call in the installing repo -- fall back to the empty ruleset,
      // but say loudly why, since this is a real authoring error, not
      // the normal "not configured yet" case below.
      return {
        config: EMPTY_RULESET,
        source: null,
        warning: `agentic-dev: failed to parse ${candidate}: ${err.message} -- falling back to no scope enforcement`,
      };
    }
  }

  return {
    config: EMPTY_RULESET,
    source: null,
    warning:
      "agentic-dev: no scope-rules.json found under .claude/agentic-dev/ -- pipeline agents are running WITHOUT structural file/command enforcement (prompt-level restrictions only). Copy templates/scope-rules.json into .claude/agentic-dev/ and adapt it for this repo's languages/build commands.",
  };
}

// formatAuditLine renders one audit entry as a single-line JSON string
// (no trailing newline) -- pure, mirroring main.go's formatAuditLine for
// the same reason: directly unit-testable, unlike the file-append side
// effect in agentscope.mjs's appendAuditLog.
export function formatAuditLine(timestampIso, agentType, toolName, target, decision, reason) {
  const entry = {
    timestamp: timestampIso,
    agent_type: agentType || "",
    tool_name: toolName,
    target,
    decision,
  };
  if (reason) entry.reason = reason;
  return JSON.stringify(entry);
}
