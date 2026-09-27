// Shared paths and fixtures for the Node test suites.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PLUGIN_ROOT = path.join(REPO_ROOT, "plugins", "kw-ad");
export const HOOK_DIR = path.join(PLUGIN_ROOT, "hooks", "agentscope");
export const CASES_DIR = path.join(REPO_ROOT, "tests", "hook-cases");

export function loadCases(name) {
  return JSON.parse(readFileSync(path.join(CASES_DIR, name), "utf8"));
}

export function decisionCaseFiles() {
  return readdirSync(CASES_DIR)
    .filter((f) => f.startsWith("decisions-") && f.endsWith(".json"))
    .sort();
}

// Replace "{project}" in every string inside value.
export function substitute(value, project) {
  if (typeof value === "string") return value.split("{project}").join(project);
  if (Array.isArray(value)) return value.map((v) => substitute(v, project));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, project)]));
  }
  return value;
}
