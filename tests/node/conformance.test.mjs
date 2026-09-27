// End-to-end conformance: spawn the real Node launcher (run/node) for every
// case in tests/hook-cases/decisions-*.json. tests/python/test_conformance.py
// runs the same cases against the Python launcher.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { HOOK_DIR, PLUGIN_ROOT, loadCases, decisionCaseFiles, substitute } from "./helpers.mjs";

const LAUNCHER = path.join(HOOK_DIR, "run", "node");

export function runLauncher(args, { input = "", env = {} } = {}) {
  const fullEnv = { ...process.env };
  delete fullEnv.KW_AD_SCOPE_CONFIG;
  delete fullEnv.CLAUDE_PROJECT_DIR;
  for (const [k, v] of Object.entries(env)) {
    if (v === null) delete fullEnv[k];
    else fullEnv[k] = v;
  }
  return spawnSync(process.execPath, [LAUNCHER, ...args], { input, env: fullEnv, encoding: "utf8" });
}

for (const file of decisionCaseFiles()) {
  const suite = loadCases(file);
  describe(file, () => {
    for (const c of suite.cases) {
      test(c.name, () => {
        const project = mkdtempSync(path.join(tmpdir(), "kw-ad-case-"));
        try {
          const config = "config" in c ? c.config : suite.config;
          if (config !== null) {
            const dir = path.join(project, ".claude", "kw-ad");
            mkdirSync(dir, { recursive: true });
            const text = config && typeof config === "object" && "$raw" in config ? config.$raw : JSON.stringify(config);
            writeFileSync(path.join(dir, "scope-rules.json"), text);
          }
          const input = "stdin_raw" in c ? c.stdin_raw : JSON.stringify(substitute(c.payload, project));
          const env = { CLAUDE_PROJECT_DIR: project, ...substitute(c.env ?? {}, project) };
          const res = runLauncher([], { input, env });

          const exp = c.expect;
          assert.equal(res.status, exp.exit, `exit code (stderr: ${res.stderr})`);
          if (exp.decision === null) {
            assert.equal(res.stdout, "", "expected no stdout");
          } else {
            const out = JSON.parse(res.stdout);
            assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
            assert.equal(out.hookSpecificOutput.permissionDecision, exp.decision);
            if (exp.decision === "deny") assert.ok(out.hookSpecificOutput.permissionDecisionReason, "deny must carry a reason");
            if (exp.reason_includes) {
              assert.ok(
                (out.hookSpecificOutput.permissionDecisionReason ?? "").includes(exp.reason_includes),
                `reason ${JSON.stringify(out.hookSpecificOutput.permissionDecisionReason)} should include ${JSON.stringify(exp.reason_includes)}`
              );
            }
          }

          const auditPath = path.join(project, ".claude", "kw-ad", "audit.log");
          const expectAudit = exp.audit ?? exp.decision !== null;
          if (expectAudit) {
            const lines = readFileSync(auditPath, "utf8").trim().split("\n");
            assert.equal(lines.length, 1);
            const entry = JSON.parse(lines[0]);
            assert.equal(entry.decision, exp.decision);
            assert.equal(entry.agent_type, c.payload.agent_type ?? "");
          } else {
            assert.equal(existsSync(auditPath), false, "expected no audit log");
          }
        } finally {
          rmSync(project, { recursive: true, force: true });
        }
      });
    }
  });
}

describe("launcher modes", () => {
  test("--self-test reports ok", () => {
    const res = runLauncher(["--self-test"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^kw-ad hook ok \(node /);
  });

  test("--check-config passes a valid config and fails an invalid one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kw-ad-check-"));
    try {
      const file = path.join(dir, "scope-rules.json");
      writeFileSync(file, JSON.stringify(loadCases("decisions-edit.json").config));
      const ok = runLauncher(["--check-config", file]);
      assert.equal(ok.status, 0, ok.stdout);
      assert.match(ok.stdout, /^ok: /m);

      writeFileSync(file, '{"version": 1, "agents": {"scribe": {"edit": {"rules": [{"match": ["x"], "decision": "ask"}]}}}}');
      const bad = runLauncher(["--check-config", file]);
      assert.equal(bad.status, 1);
      assert.match(bad.stdout, /^error: .*decision must be "allow" or "deny"/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("every shipped preset passes --check-config with no warnings", () => {
    const presets = path.join(PLUGIN_ROOT, "templates", "presets");
    const files = readdirSync(presets).filter((f) => f.endsWith(".json"));
    assert.ok(files.length > 0);
    for (const f of files) {
      const res = runLauncher(["--check-config", path.join(presets, f)]);
      assert.equal(res.status, 0, `${f}: ${res.stdout}`);
      assert.doesNotMatch(res.stdout, /warning:/, `${f}: ${res.stdout}`);
    }
  });
});
