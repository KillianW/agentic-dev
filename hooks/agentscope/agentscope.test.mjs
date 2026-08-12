// Tests for config.mjs's pure decision logic, using Node's built-in test
// runner (node:test) -- zero npm dependencies, matching the reasoning in
// docs/ARCHITECTURE.md for why this hook is Node instead of Go: an
// installing repo of unknown language shouldn't need `npm install` just
// to get the hook's own test suite running.
//
// IMPORTANT: this file has never actually been executed. The container
// that wrote this plugin had no Node.js installed at all (confirmed via
// `which node`/`apt list --installed`). Run `node --test
// hooks/agentscope/agentscope.test.mjs` as the very first thing to do
// with this repo -- see docs/ROADMAP.md Phase 1. Treat every assertion
// below as "should be true by careful hand-tracing," not "has been
// proven true."

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  globToRegExp,
  matchGlob,
  resolveEditDecision,
  resolveBashDecision,
  loadConfig,
  formatAuditLine,
} from "./config.mjs";

// A config shaped like templates/scope-rules.json (rkg's own ruleset),
// used across most tests below so each test only needs to state the
// specific path/command it's checking.
const RKG_SHAPED_CONFIG = {
  version: 1,
  unknown_agent_decision: "allow",
  agents: {
    "test-writer-red": {
      edit: {
        rules: [{ match: ["**/*_test.go", "**/testdata/**"], decision: "allow" }],
        default: { decision: "deny", reason: "test-writer-red may only edit *_test.go files or paths under testdata/" },
      },
      bash: {
        rules: [{ match_exact: ["make test"], decision: "allow" }],
        default: { decision: "deny", reason: "test-writer-red may only run \"make test\"" },
      },
    },
    "implementer-green": {
      edit: {
        rules: [
          { match: ["**/*_test.go"], decision: "deny", reason: "implementer-green may not edit test files" },
          { match: ["**/*.go"], decision: "allow" },
        ],
        default: { decision: "deny", reason: "implementer-green may only edit non-test .go files" },
      },
      bash: {
        rules: [{ match_exact: ["make build", "make vet", "make test", "make check"], decision: "allow" }],
        default: { decision: "deny", reason: "implementer-green may only run make build/vet/test/check" },
      },
    },
    refactor: {
      edit: {
        rules: [
          { match: ["**/*_test.go", "Makefile"], decision: "deny", reason: "refactor may not edit test files or the Makefile" },
          { match: ["**/*.go"], decision: "allow" },
        ],
        default: { decision: "deny", reason: "refactor may only edit non-test .go files" },
      },
      bash: {
        rules: [{ match_exact: ["make build", "make vet", "make test", "make check", "make bench"], decision: "allow" }],
        default: { decision: "deny", reason: "refactor may only run make build/vet/test/check/bench" },
      },
    },
    "doc-scribe": {
      edit: {
        rules: [
          { match: ["docs/specifications/**", "docs/adr/**"], decision: "deny", reason: "doc-scribe may not edit specs or recorded decisions" },
          { match: ["**/*.md", "standards/*.yaml", "standards/*.yml"], decision: "allow" },
        ],
        default: { decision: "deny", reason: "doc-scribe may only edit markdown files (anywhere) or standards/*.yaml" },
      },
    },
  },
};

describe("globToRegExp / matchGlob", () => {
  test("**/*_test.go matches nested and root-level test files", () => {
    assert.equal(matchGlob("**/*_test.go", "internal/mcp/accept_test.go"), true);
    assert.equal(matchGlob("**/*_test.go", "accept_test.go"), true);
    assert.equal(matchGlob("**/*_test.go", "internal/mcp/accept.go"), false);
  });

  test("**/testdata/** matches anything under a testdata/ dir at any depth", () => {
    assert.equal(matchGlob("**/testdata/**", "internal/compiler/testdata/fixture.go"), true);
    assert.equal(matchGlob("**/testdata/**", "testdata/fixture.go"), true);
    assert.equal(matchGlob("**/testdata/**", "internal/compiler/fixture.go"), false);
  });

  test("**/*.go matches any .go file at any depth, not just root", () => {
    assert.equal(matchGlob("**/*.go", "main.go"), true);
    assert.equal(matchGlob("**/*.go", "internal/mcp/accept.go"), true);
    assert.equal(matchGlob("**/*.go", "internal/mcp/accept.js"), false);
  });

  test("a plain string with no '*' is an exact match only", () => {
    assert.equal(matchGlob("Makefile", "Makefile"), true);
    assert.equal(matchGlob("Makefile", "sub/Makefile"), false);
    assert.equal(matchGlob("Makefile", "Makefile.bak"), false);
  });

  test("docs/specifications/** matches nested paths under that exact prefix", () => {
    assert.equal(matchGlob("docs/specifications/**", "docs/specifications/v1/SPEC-0004.md"), true);
    assert.equal(matchGlob("docs/specifications/**", "docs/adr/ADR-0001.md"), false);
  });

  test("standards/*.yaml matches only direct children, not nested (single '*' never crosses '/')", () => {
    assert.equal(matchGlob("standards/*.yaml", "standards/commits.yaml"), true);
    assert.equal(matchGlob("standards/*.yaml", "standards/sub/commits.yaml"), false);
  });

  test("globToRegExp escapes regex metacharacters in literal segments", () => {
    // '.' in a literal segment must be a literal dot, not "any character".
    assert.equal(matchGlob("**/*.go", "internal/mcpXgo"), false);
  });
});

describe("resolveEditDecision", () => {
  test("test-writer-red: allow *_test.go, deny non-test .go", () => {
    const allow = resolveEditDecision(RKG_SHAPED_CONFIG, "test-writer-red", "internal/mcp/accept_test.go");
    assert.equal(allow.decision, "allow");

    const deny = resolveEditDecision(RKG_SHAPED_CONFIG, "test-writer-red", "internal/mcp/accept.go");
    assert.equal(deny.decision, "deny");
    assert.match(deny.reason, /only edit \*_test\.go/);
  });

  test("implementer-green: first-match-wins denies *_test.go even though it also matches *.go", () => {
    const result = resolveEditDecision(RKG_SHAPED_CONFIG, "implementer-green", "internal/mcp/accept_test.go");
    assert.equal(result.decision, "deny");
    assert.match(result.reason, /may not edit test files/);
  });

  test("implementer-green: allows a non-test .go file", () => {
    const result = resolveEditDecision(RKG_SHAPED_CONFIG, "implementer-green", "internal/mcp/accept.go");
    assert.equal(result.decision, "allow");
  });

  test("refactor: denies the Makefile explicitly", () => {
    const result = resolveEditDecision(RKG_SHAPED_CONFIG, "refactor", "Makefile");
    assert.equal(result.decision, "deny");
  });

  test("doc-scribe: hard-denies docs/specifications and docs/adr, allows other markdown", () => {
    const spec = resolveEditDecision(RKG_SHAPED_CONFIG, "doc-scribe", "docs/specifications/v1/SPEC-0004.md");
    assert.equal(spec.decision, "deny");

    const readme = resolveEditDecision(RKG_SHAPED_CONFIG, "doc-scribe", "README.md");
    assert.equal(readme.decision, "allow");

    const goFile = resolveEditDecision(RKG_SHAPED_CONFIG, "doc-scribe", "main.go");
    assert.equal(goFile.decision, "deny");
  });

  test("an agent type not present in config.agents defaults to unknown_agent_decision (allow)", () => {
    const result = resolveEditDecision(RKG_SHAPED_CONFIG, "architect", "anything.md");
    assert.equal(result.decision, "allow");
  });

  test("the main session (empty agent_type) also defaults to allow", () => {
    const result = resolveEditDecision(RKG_SHAPED_CONFIG, "", "anything.go");
    assert.equal(result.decision, "allow");
  });

  test("an empty ruleset (no config found) allows everything", () => {
    const empty = { version: 1, unknown_agent_decision: "allow", agents: {} };
    const result = resolveEditDecision(empty, "test-writer-red", "internal/main.go");
    assert.equal(result.decision, "allow");
  });
});

describe("resolveBashDecision", () => {
  test("test-writer-red: allows exactly 'make test'", () => {
    const result = resolveBashDecision(RKG_SHAPED_CONFIG, "test-writer-red", "make test");
    assert.equal(result.decision, "allow");
  });

  test("exact-match-only: denies command chaining and extra arguments, never parses them", () => {
    const chained = resolveBashDecision(RKG_SHAPED_CONFIG, "test-writer-red", "make test && rm -rf /");
    assert.equal(chained.decision, "deny");

    const extraArgs = resolveBashDecision(RKG_SHAPED_CONFIG, "test-writer-red", "make test extra");
    assert.equal(extraArgs.decision, "deny");
  });

  test("trims surrounding whitespace before comparing", () => {
    const result = resolveBashDecision(RKG_SHAPED_CONFIG, "test-writer-red", "  make test  ");
    assert.equal(result.decision, "allow");
  });

  test("refactor allows make bench, implementer-green does not", () => {
    const refactorBench = resolveBashDecision(RKG_SHAPED_CONFIG, "refactor", "make bench");
    assert.equal(refactorBench.decision, "allow");

    const greenBench = resolveBashDecision(RKG_SHAPED_CONFIG, "implementer-green", "make bench");
    assert.equal(greenBench.decision, "deny");
  });

  test("an agent with no bash rules configured (doc-scribe) defaults to unknown_agent_decision", () => {
    const result = resolveBashDecision(RKG_SHAPED_CONFIG, "doc-scribe", "rm -rf /");
    assert.equal(result.decision, "allow");
  });
});

describe("loadConfig", () => {
  test("returns an empty ruleset with a warning when nothing is found", () => {
    const emptyDir = mkdtempSync(path.join(tmpdir(), "agentic-dev-loadconfig-"));
    try {
      const { config, source, warning } = loadConfig(emptyDir);
      assert.equal(source, null);
      assert.match(warning, /no scope-rules\.json found/);
      assert.deepEqual(config.agents, {});
      assert.equal(config.unknown_agent_decision, "allow");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test("loads <cwd>/.claude/agentic-dev/scope-rules.json when present", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agentic-dev-loadconfig-"));
    try {
      const configDir = path.join(dir, ".claude", "agentic-dev");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(path.join(configDir, "scope-rules.json"), JSON.stringify(RKG_SHAPED_CONFIG));

      const { config, source, warning } = loadConfig(dir);
      assert.equal(warning, null);
      assert.ok(source.endsWith(path.join(".claude", "agentic-dev", "scope-rules.json")));
      assert.ok(config.agents["test-writer-red"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a present-but-broken config falls back to the empty ruleset with a warning, not a crash", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agentic-dev-loadconfig-"));
    try {
      const configDir = path.join(dir, ".claude", "agentic-dev");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(path.join(configDir, "scope-rules.json"), "{ not valid json");

      const { config, warning } = loadConfig(dir);
      assert.match(warning, /failed to parse/);
      assert.deepEqual(config.agents, {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("$AGENTIC_DEV_SCOPE_CONFIG takes precedence over the repo-local file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agentic-dev-loadconfig-"));
    const overridePath = path.join(dir, "override.json");
    try {
      const overrideConfig = { version: 1, unknown_agent_decision: "deny", agents: {} };
      writeFileSync(overridePath, JSON.stringify(overrideConfig));

      const configDir = path.join(dir, ".claude", "agentic-dev");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(path.join(configDir, "scope-rules.json"), JSON.stringify(RKG_SHAPED_CONFIG));

      process.env.AGENTIC_DEV_SCOPE_CONFIG = overridePath;
      const { config } = loadConfig(dir);
      assert.equal(config.unknown_agent_decision, "deny");
    } finally {
      delete process.env.AGENTIC_DEV_SCOPE_CONFIG;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("formatAuditLine", () => {
  test("renders a single-line JSON object with the given fields", () => {
    const line = formatAuditLine("2026-08-12T10:00:00.000Z", "test-writer-red", "Edit", "internal/main.go", "deny", "not a test file");
    const parsed = JSON.parse(line);
    assert.equal(parsed.timestamp, "2026-08-12T10:00:00.000Z");
    assert.equal(parsed.agent_type, "test-writer-red");
    assert.equal(parsed.tool_name, "Edit");
    assert.equal(parsed.target, "internal/main.go");
    assert.equal(parsed.decision, "deny");
    assert.equal(parsed.reason, "not a test file");
  });

  test("omits the reason field entirely when reason is empty (matches main.go's omitempty)", () => {
    const line = formatAuditLine("2026-08-12T10:00:00.000Z", "", "Bash", "make test", "allow", "");
    const parsed = JSON.parse(line);
    assert.equal("reason" in parsed, false);
  });
});
