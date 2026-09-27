// Unit tests for the Node implementation's pure logic (core.mjs) and config
// loading (main.mjs). The glob and path cases are shared with the Python
// suite via tests/hook-cases/.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { HOOK_DIR, loadCases } from "./helpers.mjs";

const core = await import(pathToFileURL(path.join(HOOK_DIR, "js", "core.mjs")).href);
const main = await import(pathToFileURL(path.join(HOOK_DIR, "js", "main.mjs")).href);

const { globToRegExp, matchGlob, normalizeAgentType, toProjectRelative, validateConfig, decide, formatAuditLine, hookOutput } = core;

describe("matchGlob (shared cases)", () => {
  for (const c of loadCases("glob.json").cases) {
    test(`${JSON.stringify(c.pattern)} vs ${JSON.stringify(c.path)} -> ${c.match}`, () => {
      assert.equal(matchGlob(c.pattern, c.path), c.match);
    });
  }

  test("globToRegExp anchors the whole path", () => {
    assert.equal(globToRegExp("a.md").test("xa.md"), false);
    assert.equal(globToRegExp("a.md").test("a.mdx"), false);
  });
});

describe("toProjectRelative (shared cases)", () => {
  for (const c of loadCases("paths.json").cases) {
    const api = c.style === "win32" ? path.win32 : path.posix;
    test(`${c.style}: ${c.path} under ${c.root} -> ${c.expected}`, () => {
      assert.equal(toProjectRelative(c.root, c.path, api), c.expected);
    });
  }
});

describe("normalizeAgentType", () => {
  test("strips only this plugin's prefix", () => {
    assert.equal(normalizeAgentType("kw-ad:tdd-red"), "tdd-red");
    assert.equal(normalizeAgentType("tdd-red"), "tdd-red");
    assert.equal(normalizeAgentType("other:tdd-red"), "other:tdd-red");
    assert.equal(normalizeAgentType(undefined), "");
    assert.equal(normalizeAgentType(42), "");
  });
});

describe("validateConfig", () => {
  const minimal = () => ({
    version: 1,
    agents: Object.fromEntries(["tdd-red", "tdd-green", "tdd-refactor", "scribe"].map((a) => [a, { edit: { default: { decision: "deny" } } }])),
  });

  test("a minimal complete config has no errors or warnings", () => {
    assert.deepEqual(validateConfig(minimal()), { errors: [], warnings: [] });
  });

  test("rejects non-objects", () => {
    assert.deepEqual(validateConfig([]).errors, ["config must be a JSON object"]);
    assert.deepEqual(validateConfig(null).errors, ["config must be a JSON object"]);
  });

  test("rejects ask, bad match lists, and bad reasons", () => {
    const cfg = minimal();
    cfg.agents["tdd-red"].edit.rules = [
      { match: ["a"], decision: "ask" },
      { match: [], decision: "allow" },
      { match: "a", decision: "allow" },
      { match: ["a"], decision: "allow", reason: 5 },
    ];
    const { errors } = validateConfig(cfg);
    assert.equal(errors.length, 4);
    assert.match(errors[0], /rules\[0\]\.decision/);
    assert.match(errors[1], /rules\[1\]\.match/);
    assert.match(errors[2], /rules\[2\]\.match/);
    assert.match(errors[3], /rules\[3\]\.reason/);
  });

  test("bash rules need match_exact, not match", () => {
    const cfg = minimal();
    cfg.agents["tdd-red"].bash = { rules: [{ match: ["make test"], decision: "allow" }], default: { decision: "deny" } };
    assert.match(validateConfig(cfg).errors[0], /match_exact/);
  });

  test("warns about missing restricted agents, missing defaults, and unknown sections", () => {
    const cfg = { version: 1, agents: { scribe: { edit: { rules: [] }, write: {} } } };
    const { errors, warnings } = validateConfig(cfg);
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes("agents.tdd-red is missing")));
    assert.ok(warnings.some((w) => w.includes("agents.scribe.edit has no default")));
    assert.ok(warnings.some((w) => w.includes("agents.scribe.write is not a recognized section")));
  });
});

describe("decide", () => {
  const loaded = {
    config: {
      version: 1,
      agents: { "tdd-red": { edit: { rules: [{ match: ["tests/**"], decision: "allow" }], default: { decision: "deny" } } } },
    },
    error: null,
  };

  test("audits the project-relative target for edits", () => {
    const r = decide({
      agentType: "kw-ad:tdd-red",
      toolName: "Edit",
      toolInput: { file_path: "/repo/tests/a.py" },
      projectRoot: "/repo",
      loaded,
      pathApi: path.posix,
    });
    assert.deepEqual(r, { managed: true, target: "tests/a.py", decision: "allow", reason: "" });
  });

  test("uses win32 semantics when given path.win32", () => {
    const r = decide({
      agentType: "kw-ad:tdd-red",
      toolName: "Write",
      toolInput: { file_path: "C:\\repo\\tests\\a.py" },
      projectRoot: "C:\\repo",
      loaded,
      pathApi: path.win32,
    });
    assert.equal(r.decision, "allow");
    assert.equal(r.target, "tests/a.py");
  });

  test("a non-object tool_input is treated as empty", () => {
    const r = decide({ agentType: "kw-ad:tdd-red", toolName: "Edit", toolInput: "nope", projectRoot: "/repo", loaded, pathApi: path.posix });
    assert.equal(r.decision, "deny");
    assert.match(r.reason, /no file path/);
  });
});

describe("formatAuditLine / hookOutput", () => {
  test("renders single-line JSON with the given fields", () => {
    const parsed = JSON.parse(formatAuditLine("2026-08-12T10:00:00.000Z", "kw-ad:tdd-red", "Edit", "src/a.go", "deny", "nope"));
    assert.deepEqual(parsed, {
      timestamp: "2026-08-12T10:00:00.000Z",
      agent_type: "kw-ad:tdd-red",
      tool_name: "Edit",
      target: "src/a.go",
      decision: "deny",
      reason: "nope",
    });
  });

  test("omits an empty reason", () => {
    assert.equal("reason" in JSON.parse(formatAuditLine("t", "", "Bash", "x", "allow", "")), false);
    assert.deepEqual(hookOutput("allow", ""), { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } });
  });
});

describe("main.mjs config resolution", () => {
  test("CLAUDE_PROJECT_DIR beats the payload cwd; KW_AD_SCOPE_CONFIG beats the default path", () => {
    assert.equal(main.projectRoot({ CLAUDE_PROJECT_DIR: "/a" }, "/b"), "/a");
    assert.equal(main.projectRoot({}, "/b"), "/b");
    assert.equal(main.configPath({ KW_AD_SCOPE_CONFIG: "/x.json" }, "/a"), "/x.json");
    assert.equal(main.configPath({}, "/a"), path.join("/a", ".claude", "kw-ad", "scope-rules.json"));
  });

  test("loadConfig reports schema errors and keeps warnings", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kw-ad-load-"));
    try {
      const file = path.join(dir, "scope-rules.json");
      writeFileSync(file, JSON.stringify({ version: 1, agents: { scribe: { edit: { rules: [] } } } }));
      const ok = main.loadConfig(file);
      assert.equal(ok.error, null);
      assert.ok(ok.warnings.length > 0);

      writeFileSync(file, JSON.stringify({ version: 1 }));
      const bad = main.loadConfig(file);
      assert.equal(bad.config, null);
      assert.match(bad.error, /agents must be an object/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
