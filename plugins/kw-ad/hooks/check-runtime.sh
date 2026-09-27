#!/bin/sh
# kw-ad SessionStart check: is the configured scope-hook runtime usable?
#
# The PreToolUse scope hook runs as `<hook_runtime> run/<hook_runtime>`. If
# that interpreter is missing or broken (e.g. the macOS /usr/bin/python3 or
# Windows Store python3 stubs), Claude Code treats the failure as
# non-blocking and every tool call proceeds unchecked. This script can't
# block anything itself; it makes that state visible at session start.
# Silent (no output) when everything is fine. POSIX sh only.
#
# Usage: check-runtime.sh [runtime]
# As a plugin hook the runtime comes from the hook_runtime option's env var;
# a vendored install (scripts/vendor.sh) passes it as the first argument.

rt="${1:-${CLAUDE_PLUGIN_OPTION_HOOK_RUNTIME:-}}"
root="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

# The SessionStart payload arrives on stdin; this check doesn't need it.
cat >/dev/null 2>&1

warn() {
  msg=$(printf '%s' "$1" | tr -d '"\\' | tr '\n\r\t' '   ')
  printf '{"systemMessage":"kw-ad: %s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"kw-ad warning for the user: %s"}}\n' "$msg" "$msg"
  exit 0
}

case "$rt" in
  node|python3|python) ;;
  "") warn "the hook_runtime option is not set, so pipeline scope enforcement is NOT running. Set it to node, python3, or python in /plugin (kw-ad options), then run /kw-ad:doctor." ;;
  *) warn "hook_runtime is set to '$rt', which is not supported, so pipeline scope enforcement is NOT running. Use node, python3, or python." ;;
esac

if ! command -v "$rt" >/dev/null 2>&1; then
  warn "hook_runtime is '$rt' but no '$rt' command is on PATH, so pipeline scope enforcement is NOT running. Install it or choose another runtime (node, python3, python)."
fi

if ! out=$("$rt" "$root/hooks/agentscope/run/$rt" --self-test 2>&1); then
  warn "hook_runtime '$rt' failed its self-test, so pipeline scope enforcement is NOT running. Output: $out"
fi

exit 0
