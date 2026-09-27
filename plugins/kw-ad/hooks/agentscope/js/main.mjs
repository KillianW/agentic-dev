// Process plumbing for the kw-ad PreToolUse scope hook (Node implementation):
// read the hook payload from stdin, load scope-rules.json, ask core.mjs for a
// decision, print it, and append an audit line. Launched by ../run/node.
//
// Modes:
//   (no args)                 hook mode -- payload on stdin
//   --self-test               print a one-line OK (used by check-runtime.sh / doctor)
//   --check-config [path]     validate a scope-rules.json and print problems

import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { decide, formatAuditLine, hookOutput, normalizeAgentType, validateConfig } from "./core.mjs";

const MIN_NODE_MAJOR = 18;

export function projectRoot(env, payloadCwd) {
  return env.CLAUDE_PROJECT_DIR || payloadCwd || process.cwd();
}

export function configPath(env, root) {
  return env.KW_AD_SCOPE_CONFIG || path.join(root, ".claude", "kw-ad", "scope-rules.json");
}

// Returns { config, error, warnings }. config is null whenever error is set.
export function loadConfig(file) {
  if (!existsSync(file)) return { config: null, error: `no scope-rules.json at ${file}`, warnings: [] };
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    return { config: null, error: `cannot read ${file}: ${err.message}`, warnings: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^﻿/, ""));
  } catch (err) {
    return { config: null, error: `invalid JSON in ${file}: ${err.message}`, warnings: [] };
  }
  const { errors, warnings } = validateConfig(parsed);
  if (errors.length) return { config: null, error: `${file}: ${errors.join("; ")}`, warnings };
  return { config: parsed, error: null, warnings };
}

function appendAudit(root, line) {
  const dir = path.join(root, ".claude", "kw-ad");
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "audit.log"), line + "\n");
  } catch (err) {
    process.stderr.write(`kw-ad: could not append audit log: ${err.message}\n`);
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function selfTest() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < MIN_NODE_MAJOR) {
    process.stderr.write(`kw-ad: Node ${process.versions.node} is too old; ${MIN_NODE_MAJOR}+ is required\n`);
    return 1;
  }
  process.stdout.write(`kw-ad hook ok (node ${process.versions.node})\n`);
  return 0;
}

function checkConfig(file) {
  const target = file || configPath(process.env, projectRoot(process.env, ""));
  const { error, warnings } = loadConfig(target);
  for (const w of warnings) process.stdout.write(`warning: ${w}\n`);
  if (error) {
    process.stdout.write(`error: ${error}\n`);
    return 1;
  }
  process.stdout.write(`ok: ${target}\n`);
  return 0;
}

async function hook() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new Error("payload is not an object");
  } catch (err) {
    process.stderr.write(`kw-ad: could not parse hook input: ${err.message}\n`);
    return 2;
  }

  const agentType = typeof payload.agent_type === "string" ? payload.agent_type : "";
  try {
    const root = projectRoot(process.env, payload.cwd);
    const loaded = loadConfig(configPath(process.env, root));
    const result = decide({
      agentType,
      toolName: payload.tool_name ?? "",
      toolInput: payload.tool_input,
      projectRoot: root,
      loaded,
    });
    if (!result.managed) return 0;

    appendAudit(
      root,
      formatAuditLine(new Date().toISOString(), agentType, payload.tool_name ?? "", result.target, result.decision, result.reason)
    );
    process.stdout.write(JSON.stringify(hookOutput(result.decision, result.reason)) + "\n");
    return 0;
  } catch (err) {
    process.stderr.write(`kw-ad: scope hook failed: ${err && err.stack ? err.stack : err}\n`);
    // Fail closed for subagents; the main session is never scope-restricted.
    return normalizeAgentType(agentType) === "" ? 0 : 2;
  }
}

export async function main(argv) {
  if (argv[0] === "--self-test") return selfTest();
  if (argv[0] === "--check-config") return checkConfig(argv[1]);
  return hook();
}
