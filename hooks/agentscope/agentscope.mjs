#!/usr/bin/env node
// agentic-dev's PreToolUse hook entrypoint. Ports tools/agentscopehook/
// main.go's main() function-for-function: decode stdin JSON -> resolve
// a permission decision via config.mjs's pure resolvers -> append an
// audit-log line (best-effort, never blocks the decision already made)
// -> encode the decision to stdout. Wired via ../hooks.json, matcher
// "Edit|Write|Bash".
//
// Never run under Node in the environment that wrote it (no Node
// available there) -- see docs/ROADMAP.md Phase 1 for the first real
// verification pass this file needs before it's trusted.

import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  loadConfig,
  resolveEditDecision,
  resolveBashDecision,
  formatAuditLine,
} from "./config.mjs";

function readStdin() {
  try {
    // fd 0 is stdin; Claude Code invokes hooks with the payload piped in
    // and closed, so a synchronous full read is safe here (this process
    // does nothing else concurrently).
    return readFileSync(0, "utf8");
  } catch (err) {
    process.stderr.write(`agentscope: read stdin: ${err.message}\n`);
    process.exit(1);
  }
}

// effectiveCwd mirrors main.go's effectiveCwd: prefer the cwd the hook
// payload itself reports, fall back to this process's own cwd, and
// finally "" (meaning: leave any relative-path logic disabled downstream
// rather than guessing against an unknown cwd).
function effectiveCwd(payloadCwd) {
  if (payloadCwd) return payloadCwd;
  try {
    return process.cwd();
  } catch {
    return "";
  }
}

// appendAuditLog best-effort appends one line to
// <cwd>/.claude/agentic-dev/audit.log. A failure here (missing cwd,
// permissions, disk) is logged to stderr and otherwise ignored -- it
// must never change or block the permission decision already computed.
function appendAuditLog(cwd, line) {
  if (!cwd) return;
  const dir = path.join(cwd, ".claude", "agentic-dev");
  const logPath = path.join(dir, "audit.log");
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(logPath, line + "\n");
  } catch (err) {
    process.stderr.write(`agentscope: append audit log: ${err.message}\n`);
  }
}

function main() {
  const raw = readStdin();

  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`agentscope: decode stdin: ${err.message}\n`);
    process.exit(1);
  }

  const agentType = input.agent_type ?? "";
  const toolName = input.tool_name ?? "";
  const cwd = effectiveCwd(input.cwd);

  const { config, warning } = loadConfig(cwd);
  if (warning) process.stderr.write(warning + "\n");

  let decision;
  let reason;
  let target;

  if (toolName === "Bash") {
    target = input.tool_input?.command ?? "";
    ({ decision, reason } = resolveBashDecision(config, agentType, target));
  } else {
    let filePath = input.tool_input?.file_path ?? "";
    if (cwd && filePath) {
      const rel = path.relative(cwd, filePath);
      // Only rewrite to the relative form if it's actually inside cwd
      // (doesn't start with ".."); otherwise leave filePath as given,
      // mirroring main.go's behavior of only rewriting on a successful
      // filepath.Rel.
      if (!rel.startsWith("..")) filePath = rel;
    }
    target = filePath;
    ({ decision, reason } = resolveEditDecision(config, agentType, filePath));
  }

  appendAuditLog(
    cwd,
    formatAuditLine(new Date().toISOString(), agentType, toolName, target, decision, reason)
  );

  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      ...(reason ? { permissionDecisionReason: reason } : {}),
    },
  };
  process.stdout.write(JSON.stringify(out) + "\n");
}

main();
