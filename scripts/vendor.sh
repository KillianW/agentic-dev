#!/bin/sh
# Vendor the kw-ad plugin into a repository's .claude/ directory.
#
# For environments where Claude Code plugins can't be installed (e.g. managed
# settings that block local marketplaces). The result is plain project-level
# Claude Code config:
#
#   <target>/.claude/agents/<agent>.md          tdd-architect, tdd-red, ... (bare names)
#   <target>/.claude/skills/kw-ad-<skill>/      /kw-ad-tdd, /kw-ad-init, /kw-ad-doctor, ...
#   <target>/.claude/kw-ad/vendor/              hook code + templates (replaced on every run)
#   <target>/.claude/settings.json              PreToolUse + SessionStart hook entries merged in
#
# Plugin-only syntax is resolved at export time: ${user_config.*} values are
# substituted, ${CLAUDE_PLUGIN_ROOT} becomes .claude/kw-ad/vendor, "/kw-ad:x"
# skill references become "/kw-ad-x", and "kw-ad:" agent prefixes are dropped
# (the scope hook accepts bare agent names).
#
# Usage:
#   scripts/vendor.sh <target-repo> --runtime node|python3|python
#                     [--owner <o>] [--repo <r>] [--branch <b>] [--force]
#
# --runtime must be a working interpreter on PATH; it is also used here to
# merge settings.json. Existing agent/skill files are only overwritten with
# --force. POSIX sh.

set -eu

die() {
  printf 'vendor.sh: %s\n' "$1" >&2
  exit 1
}

here=$(cd "$(dirname "$0")" && pwd)
plugin="$here/../plugins/kw-ad"
[ -f "$plugin/.claude-plugin/plugin.json" ] || die "can't find the plugin at $plugin"

target=""
runtime=""
owner=""
repo=""
branch="main"
force=0
while [ $# -gt 0 ]; do
  case "$1" in
    --runtime) runtime="${2:-}"; shift 2 ;;
    --owner) owner="${2:-}"; shift 2 ;;
    --repo) repo="${2:-}"; shift 2 ;;
    --branch) branch="${2:-}"; shift 2 ;;
    --force) force=1; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$target" ] || die "only one target directory"; target="$1"; shift ;;
  esac
done

[ -n "$target" ] || die "missing <target-repo> (see --help)"
[ -d "$target" ] || die "target $target is not a directory"
case "$runtime" in
  node|python3|python) ;;
  "") die "--runtime is required (node, python3, or python)" ;;
  *) die "--runtime must be node, python3, or python" ;;
esac
command -v "$runtime" >/dev/null 2>&1 || die "$runtime is not on PATH"
"$runtime" "$plugin/hooks/agentscope/run/$runtime" --self-test >/dev/null 2>&1 ||
  die "$runtime failed the hook self-test; choose another runtime"

[ -n "$repo" ] || repo=$(basename "$(cd "$target" && pwd)")
claude="$target/.claude"
vendor="$claude/kw-ad/vendor"

# Escape a value for use on the right-hand side of a sed s### command.
sed_escape() {
  printf '%s' "$1" | sed -e 's/[\\&#]/\\&/g'
}

# render <src> <dest>: copy a markdown file, resolving plugin-only syntax.
render() {
  sed \
    -e "s#\${user_config\.repo_owner}#$(sed_escape "$owner")#g" \
    -e "s#\${user_config\.repo_name}#$(sed_escape "$repo")#g" \
    -e "s#\${user_config\.default_branch}#$(sed_escape "$branch")#g" \
    -e "s#\${user_config\.hook_runtime}#$runtime#g" \
    -e "s#\${CLAUDE_PLUGIN_ROOT}#.claude/kw-ad/vendor#g" \
    -e 's#/kw-ad:#/kw-ad-#g' \
    -e 's#kw-ad:##g' \
    "$1" > "$2"
}

check_writable() {
  if [ -e "$1" ] && [ "$force" -ne 1 ]; then
    die "$1 already exists; re-run with --force to overwrite kw-ad's files"
  fi
}

mkdir -p "$claude/agents" "$claude/skills" "$claude/kw-ad"

for f in "$plugin"/agents/*.md; do
  check_writable "$claude/agents/$(basename "$f")"
done
for d in "$plugin"/skills/*/; do
  check_writable "$claude/skills/kw-ad-$(basename "$d")/SKILL.md"
done

# Hook code and templates: replaced wholesale.
rm -rf "$vendor"
mkdir -p "$vendor/hooks"
cp -R "$plugin/hooks/agentscope" "$vendor/hooks/agentscope"
cp "$plugin/hooks/check-runtime.sh" "$vendor/hooks/check-runtime.sh"
cp -R "$plugin/templates" "$vendor/templates"
find "$vendor" -name '__pycache__' -type d -prune -exec rm -rf {} +
sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$plugin/.claude-plugin/plugin.json" > "$vendor/VERSION"

for f in "$plugin"/agents/*.md; do
  render "$f" "$claude/agents/$(basename "$f")"
done
for d in "$plugin"/skills/*/; do
  name=$(basename "$d")
  mkdir -p "$claude/skills/kw-ad-$name"
  render "$d/SKILL.md" "$claude/skills/kw-ad-$name/SKILL.md"
  # A vendored skill's name must match its directory.
  sed "s#^name: .*#name: kw-ad-$name#" "$claude/skills/kw-ad-$name/SKILL.md" > "$claude/skills/kw-ad-$name/SKILL.md.tmp"
  mv "$claude/skills/kw-ad-$name/SKILL.md.tmp" "$claude/skills/kw-ad-$name/SKILL.md"
done

# Merge hook entries into settings.json with the chosen runtime (no jq needed).
# Existing kw-ad entries (recognized by the vendor path in their args) are
# replaced; everything else in the file is preserved.
settings="$claude/settings.json"
case "$runtime" in
  node)
    node - "$settings" "$runtime" <<'EOF'
const fs = require("fs");
const [file, runtime] = process.argv.slice(2);
const MARK = "/.claude/kw-ad/vendor/";
const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "") || "{}") : {};
s.hooks = s.hooks || {};
const ours = (group) => (group.hooks || []).some((h) => (h.args || []).some((a) => String(a).includes(MARK)));
const add = (event, group) => { s.hooks[event] = (s.hooks[event] || []).filter((g) => !ours(g)).concat([group]); };
add("SessionStart", { hooks: [{ type: "command", command: "sh", args: ["${CLAUDE_PROJECT_DIR}/.claude/kw-ad/vendor/hooks/check-runtime.sh", runtime] }] });
add("PreToolUse", { matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell", hooks: [{ type: "command", command: runtime, args: ["${CLAUDE_PROJECT_DIR}/.claude/kw-ad/vendor/hooks/agentscope/run/" + runtime] }] });
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
EOF
    ;;
  *)
    "$runtime" - "$settings" "$runtime" <<'EOF'
import json, os, sys
path, runtime = sys.argv[1], sys.argv[2]
MARK = "/.claude/kw-ad/vendor/"
s = {}
if os.path.exists(path):
    with open(path, encoding="utf-8-sig") as f:
        text = f.read().strip()
    s = json.loads(text) if text else {}
hooks = s.setdefault("hooks", {})
def ours(group):
    return any(MARK in str(a) for h in group.get("hooks", []) for a in h.get("args", []))
def add(event, group):
    hooks[event] = [g for g in hooks.get(event, []) if not ours(g)] + [group]
add("SessionStart", {"hooks": [{"type": "command", "command": "sh", "args": ["${CLAUDE_PROJECT_DIR}/.claude/kw-ad/vendor/hooks/check-runtime.sh", runtime]}]})
add("PreToolUse", {"matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell", "hooks": [{"type": "command", "command": runtime, "args": ["${CLAUDE_PROJECT_DIR}/.claude/kw-ad/vendor/hooks/agentscope/run/" + runtime]}]})
with open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write(json.dumps(s, indent=2) + "\n")
EOF
    ;;
esac

cat <<EOF
Vendored kw-ad $(cat "$vendor/VERSION") into $claude (runtime: $runtime).
Next, in a Claude Code session in $target:
  1. /kw-ad-init    -- write .claude/kw-ad/scope-rules.json and tracker.yaml
  2. /kw-ad-doctor  -- prove the scope hook is enforcing
  3. /kw-ad-tdd     -- run the pipeline
Commit .claude/agents, .claude/skills, .claude/kw-ad (except audit.log) and
.claude/settings.json if the whole team should get it.
EOF
