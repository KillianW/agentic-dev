# Roadmap

This is a **hardening** roadmap, not a porting one — every agent,
skill, and the hook itself already exist as real, working files (see
`PORTING-NOTES.md` for exactly how rough each one still is). What's
left is proving it, not writing it.

## Phase 0 — this push (done)

Full first-draft port: plugin scaffold, the Node.js config-driven hook
with its own test suite (never executed — no Node.js in the
environment that wrote it), all seven pipeline agents, all three
orchestrating skills, templates for an installing repo's project-local
config, and this documentation set.

## Phase 1 — first real verification

Nothing shipped in Phase 0 has ever actually run. Before trusting any
of it:

- Run `node --test hooks/agentscope/agentscope.test.mjs` for the first
  time. Fix whatever it finds — the hand-traced reasoning in the test
  file's own comments is a best-effort substitute for real execution,
  not a substitute for it.
- Dogfood-install this plugin into the origin project itself
  (`KillianW/rkg`), pointed at a real `.claude/agentic-dev/scope-rules.json`
  built from `templates/scope-rules.json`. Confirm the ported agents
  and skills actually work against their own origin repo through the
  new config layer, not just that they read plausibly.
- Specifically verify: does `hooks/hooks.json`'s `"hooks":
  "./hooks/hooks.json"` plugin.json key work as written? Is
  `${CLAUDE_PLUGIN_ROOT}` actually available where the hook process
  needs it? (Both flagged as open items in `docs/ARCHITECTURE.md`.)
- Confirm a denial actually fires for `doc-scribe` under its own name
  before trusting anything else — this is the cheapest possible check
  against the "reserved agent name" failure mode `ARCHITECTURE.md`
  documents, and costs one deliberately-wrong test edit to confirm.

## Phase 2 — prove generalization for real

Phase 1 only proves the port works against its own origin repo — that
doesn't yet prove the *config-driven* design actually generalizes to a
different language/toolchain, which is the entire point of this
rewrite.

- Write a second, real `scope-rules.json` example for a non-Go/Make
  repo (e.g. a Python or TypeScript project) and add it alongside
  `templates/scope-rules.json`.
- Install this plugin into a real second repo (not rkg) using that
  second example, and run at least one real Red→Green→Refactor cycle
  end to end.
- Fold whatever breaks or reads wrong back into the agent prompts and
  `ARCHITECTURE.md` — this is exactly the kind of thing a first draft
  gets subtly wrong (a hardcoded assumption that slipped through
  generalization, a prose reference that still implicitly assumes Go).

## Phase 3 — `/agentic-dev:init` setup skill

Automate what `templates/README.md` currently describes as a manual
copy-and-edit process: a skill that scaffolds `.claude/agentic-dev/*`
into an installing repo, prompts for the languages/build commands it
needs to fill `scope-rules.json` with, and adds
`.claude/agentic-dev/audit.log` to `.gitignore`. A skill runs in the
main session with real tool access (unlike a subagent), so this is
genuinely buildable once Phase 2 has validated the underlying config
shape is actually right.

## Phase 4 — a real second tracker adapter

GitHub Issues (via the `github` MCP server) is the only working
tracker binding today. The abstraction in `tracker.yaml` exists so a
second one (Linear, Jira, plain local files, ...) is addable without
rewriting every agent's prose — but nothing beyond that design exists
yet. No committed timeline; this is real, deferred follow-on work, not
scoped or sized.

## Phase 5 — marketplace polish

Once Phases 1-2 have actually validated the plugin against two real
repos: fill out `.claude-plugin/marketplace.json` properly, consider
what a public listing needs (screenshots, a clearer install flow,
versioning discipline), and decide whether this repo's visibility
should change from private.

## `github-issue-manager`'s status

Ported in Phase 0 like every other agent, but it's the single most
convention-heavy file in the whole set — almost everything in it is
either GitHub-Issues-specific (unavoidable, it's a GitHub Issues
manager) or gated behind the optional `issue-conventions.yaml`
numbering scheme. It isn't one of the six delivery-pipeline stages
(`deliver`'s own Step 13 explicitly doesn't spawn it), so it's lower
priority for Phase 1/2 verification than the six stages actually in
the critical path — flagged here so that's a deliberate
prioritization, not a silent gap.
