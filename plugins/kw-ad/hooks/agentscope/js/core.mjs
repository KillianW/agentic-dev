// Pure decision logic for the kw-ad PreToolUse scope hook. No process I/O
// here -- main.mjs owns stdin/stdout/filesystem -- so everything below is
// directly unit-testable.
//
// This file and ../py/kwad_scope/core.py are two implementations of one
// behavior spec. tests/hook-cases/*.json is that spec; both test suites run
// every case, so a change here needs the matching change there.

import path from "node:path";

export const PLUGIN_PREFIX = "kw-ad:";

// Agents whose Edit/Write/Bash calls are always under scope rules. If the
// config is missing, broken, or omits one of these, its calls are denied
// (fail closed) rather than silently allowed.
export const RESTRICTED_AGENTS = Object.freeze(["tdd-red", "tdd-green", "tdd-refactor", "scribe"]);

export const EDIT_TOOLS = Object.freeze(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
export const SHELL_TOOLS = Object.freeze(["Bash", "PowerShell"]);

const DECISIONS = ["allow", "deny"];

// Translates a deliberately small glob syntax into a RegExp:
//   '**/' matches zero or more whole path segments
//   '**'  (not followed by '/') matches anything, including '/'
//   '*'   matches within a single path segment only
// Everything else is literal. Single-pass scan: the emitted snippets contain
// '*' themselves, so chained global replaces would corrupt them.
export function globToRegExp(pattern) {
  let out = "";
  let i = 0;
  const n = pattern.length;
  const metachars = ".+?^${}()|[]\\";
  while (i < n) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i += 2;
        if (pattern[i] === "/") {
          out += "(?:[^/]+/)*";
          i += 1;
        } else {
          out += ".*";
        }
      } else {
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

export function matchGlob(pattern, filePath) {
  return globToRegExp(pattern).test(filePath);
}

// "kw-ad:tdd-red" -> "tdd-red"; bare names (vendored installs) pass through.
export function normalizeAgentType(agentType) {
  const s = typeof agentType === "string" ? agentType : "";
  return s.startsWith(PLUGIN_PREFIX) ? s.slice(PLUGIN_PREFIX.length) : s;
}

// Returns the project-relative, forward-slash path for filePath, or null if
// it resolves outside projectRoot. `pathApi` is injectable so tests can
// exercise win32 semantics on any host.
export function toProjectRelative(projectRoot, filePath, pathApi = path) {
  const abs = pathApi.resolve(projectRoot, filePath);
  const rel = pathApi.relative(projectRoot, abs);
  if (rel === "" || pathApi.isAbsolute(rel)) return null;
  const fwd = rel.split(pathApi.sep).join("/").replace(/\\/g, "/");
  if (fwd === ".." || fwd.startsWith("../")) return null;
  return fwd;
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isStringList(v) {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.length > 0);
}

// Returns { errors, warnings }. Any error makes the config unusable (and so
// denies every restricted agent); warnings are advisory (--check-config).
export function validateConfig(config) {
  const errors = [];
  const warnings = [];
  if (!isObject(config)) {
    return { errors: ["config must be a JSON object"], warnings };
  }
  if (config.version !== 1) errors.push("version must be 1");
  if ("unknown_agent_decision" in config && !DECISIONS.includes(config.unknown_agent_decision)) {
    errors.push('unknown_agent_decision must be "allow" or "deny"');
  }
  if (!isObject(config.agents)) {
    errors.push("agents must be an object");
    return { errors, warnings };
  }
  for (const [name, agentCfg] of Object.entries(config.agents)) {
    const where = `agents.${name}`;
    if (name.includes(":")) errors.push(`${where}: use the bare agent name (no "plugin:" prefix)`);
    if (!isObject(agentCfg)) {
      errors.push(`${where} must be an object`);
      continue;
    }
    for (const key of Object.keys(agentCfg)) {
      if (key !== "edit" && key !== "bash") warnings.push(`${where}.${key} is not a recognized section (edit, bash)`);
    }
    for (const [section, matchKey] of [["edit", "match"], ["bash", "match_exact"]]) {
      if (!(section in agentCfg)) continue;
      const sec = agentCfg[section];
      const swhere = `${where}.${section}`;
      if (!isObject(sec)) {
        errors.push(`${swhere} must be an object`);
        continue;
      }
      if ("rules" in sec) {
        if (!Array.isArray(sec.rules)) {
          errors.push(`${swhere}.rules must be an array`);
        } else {
          sec.rules.forEach((rule, i) => {
            const rwhere = `${swhere}.rules[${i}]`;
            if (!isObject(rule)) {
              errors.push(`${rwhere} must be an object`);
              return;
            }
            if (!DECISIONS.includes(rule.decision)) errors.push(`${rwhere}.decision must be "allow" or "deny"`);
            if (!isStringList(rule[matchKey])) errors.push(`${rwhere}.${matchKey} must be a non-empty list of non-empty strings`);
            if ("reason" in rule && typeof rule.reason !== "string") errors.push(`${rwhere}.reason must be a string`);
          });
        }
      }
      if ("default" in sec) {
        const d = sec.default;
        if (!isObject(d) || !DECISIONS.includes(d.decision)) {
          errors.push(`${swhere}.default.decision must be "allow" or "deny"`);
        } else if ("reason" in d && typeof d.reason !== "string") {
          errors.push(`${swhere}.default.reason must be a string`);
        }
      } else {
        warnings.push(`${swhere} has no default; unmatched calls will be denied`);
      }
    }
  }
  for (const name of RESTRICTED_AGENTS) {
    if (!(name in config.agents)) warnings.push(`agents.${name} is missing; every Edit/Write/Bash call from it will be denied`);
  }
  return { errors, warnings };
}

function deny(reason) {
  return { decision: "deny", reason };
}

function firstMatch(rules, test) {
  for (const rule of rules ?? []) {
    if (test(rule)) return { decision: rule.decision, reason: rule.reason ?? "" };
  }
  return null;
}

// The whole decision. Returns:
//   { managed: false }                              -- not our concern; emit nothing
//   { managed: true, decision, reason, target }     -- emit a decision and audit it
//
// `loaded` is { config, error } from loading scope-rules.json: config is the
// parsed, schema-valid object, or error is a human-readable string.
export function decide({ agentType, toolName, toolInput, projectRoot, loaded, pathApi = path }) {
  const agent = normalizeAgentType(agentType);
  const input = isObject(toolInput) ? toolInput : {};
  const isEdit = EDIT_TOOLS.includes(toolName);
  const isShell = SHELL_TOOLS.includes(toolName);
  const target = isShell
    ? String(input.command ?? "")
    : String((toolName === "NotebookEdit" ? input.notebook_path : input.file_path) ?? "");

  // The main session and unknown tools are never managed.
  if (agent === "" || (!isEdit && !isShell)) return { managed: false };

  const config = loaded.config;
  const listed = Boolean(config && Object.prototype.hasOwnProperty.call(config.agents, agent));
  const restricted = RESTRICTED_AGENTS.includes(agent);

  if (!listed && !restricted) {
    if (config && config.unknown_agent_decision === "deny") {
      return {
        managed: true,
        target,
        ...deny(`kw-ad: agent "${agent}" has no rules in scope-rules.json and unknown_agent_decision is "deny"`),
      };
    }
    return { managed: false };
  }

  if (!config) {
    return {
      managed: true,
      target,
      ...deny(`kw-ad: ${agent} is blocked because scope rules could not be loaded (${loaded.error}). Run /kw-ad:init or /kw-ad:doctor.`),
    };
  }
  if (!listed) {
    return {
      managed: true,
      target,
      ...deny(`kw-ad: ${agent} has no entry in scope-rules.json, so all of its Edit/Write/Bash calls are denied. Add one (see /kw-ad:init).`),
    };
  }

  const agentCfg = config.agents[agent];
  const sectionName = isShell ? "bash" : "edit";
  const section = agentCfg[sectionName];
  if (!section) {
    return { managed: true, target, ...deny(`kw-ad: ${agent} has no "${sectionName}" rules in scope-rules.json`) };
  }

  let matched;
  let auditTarget = target;
  if (isShell) {
    const command = target.trim();
    matched = firstMatch(section.rules, (rule) => rule.match_exact.includes(command));
  } else {
    if (target === "") return { managed: true, target, ...deny(`kw-ad: ${toolName} call has no file path`) };
    const rel = projectRoot ? toProjectRelative(projectRoot, target, pathApi) : null;
    if (rel === null) {
      return { managed: true, target, ...deny(`kw-ad: ${agent} may not edit paths outside the project (${target})`) };
    }
    auditTarget = rel;
    matched = firstMatch(section.rules, (rule) => rule.match.some((p) => matchGlob(p, rel)));
  }

  const result = matched ?? (section.default ? { decision: section.default.decision, reason: section.default.reason ?? "" } : null);
  if (!result) {
    return {
      managed: true,
      target: auditTarget,
      ...deny(`kw-ad: no ${sectionName} rule matched for ${agent} and no default is configured`),
    };
  }
  let reason = result.reason;
  if (result.decision === "deny" && !reason) reason = `kw-ad: denied by ${agent}'s ${sectionName} scope rules`;
  return { managed: true, target: auditTarget, decision: result.decision, reason };
}

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

export function hookOutput(decision, reason) {
  const out = { hookEventName: "PreToolUse", permissionDecision: decision };
  if (reason) out.permissionDecisionReason = reason;
  return { hookSpecificOutput: out };
}
