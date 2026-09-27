# Trying kw-ad on an external repository

A checklist for the first real trial, e.g. on a work machine where
this repo's GitHub URL can't be used as a plugin source. Expect about
an hour, most of it the pipeline run itself.

## 0. Before you start

- **Pick a target repo** whose test suite passes locally and runs with
  one command.
- **Pick a small, well-understood work item.** One behavior change,
  with clear acceptance criteria. The first run is about the process,
  not the feature.
- **Check the hook runtime** in the shell where you run `claude`:

  ```sh
  command -v node && node --version       # needs 18+
  command -v python3 && python3 --version # needs 3.8+
  ```

  On macOS, `/usr/bin/python3` can be a stub that asks to install the
  Command Line Tools. If `python3 --version` pops up a dialog, don't
  use it as the runtime.

## 1. Get the files onto the machine

Any of these works. Nothing later needs network access to GitHub.

- `git clone` from wherever you're allowed to clone from, or
- `git archive -o kw-ad.zip HEAD` on another machine, copy the zip
  across, and unzip it.

Below, `$KWAD` is the path to that copy.

## 2. Install: try each option in order until one works

**A. Session-only plugin (quickest check):**

```sh
cd /path/to/target-repo
printf '{"pluginConfigs":{"kw-ad@inline":{"options":{"hook_runtime":"python3"}}}}' > /tmp/kw-ad-settings.json
claude --plugin-dir "$KWAD/plugins/kw-ad" --settings /tmp/kw-ad-settings.json
```

The `--settings` file sets the `hook_runtime` option for the
`--plugin-dir` copy, whose plugin id is `kw-ad@inline`. Use `node`
instead of `python3` if that's what you have. Without it, the session
starts with a warning and **nothing is enforced**: a hook that can't
start doesn't block anything.

**B. Local marketplace (persistent):**

```sh
claude plugin marketplace add "$KWAD"
claude plugin install kw-ad@kw-agentic-dev
```

If either is refused (an error about managed settings, allowed
marketplaces, or plugins being disabled), your organization blocks
local plugins. Go to C.

**C. Vendor into the repo (no plugin system involved):**

```sh
sh "$KWAD/scripts/vendor.sh" /path/to/target-repo --runtime python3 \
   --owner <org> --repo <name> --branch main
```

Skill names become `/kw-ad-init`, `/kw-ad-doctor`, `/kw-ad-tdd`
instead of `/kw-ad:…`. To avoid committing the vendored files, add
`.claude/agents/`, `.claude/skills/kw-ad-*`, and `.claude/kw-ad/` to
`.git/info/exclude`. Note that `.claude/settings.json` is shared.

**Set `hook_runtime`** (A and B only): Claude Code asks for the
plugin's options when it's enabled. If the session starts with a
"kw-ad: … hook_runtime …" warning, set it via `/plugin` → kw-ad →
configure (or the kw-ad row in `/config`), then restart the session.

Record which option worked. It's the most important thing this trial
tells us.

## 3. Set up the repo

Run `/kw-ad:init`. Check what it proposes:

- Test-file globs that match where this repo's tests actually live.
- Exact test/build/lint commands, the ones you'd type yourself.
- `tracker.mode: none` and `code_host.mode: manual` are fine for a
  first run.

## 4. Prove enforcement

Run `/kw-ad:doctor`. **Every row must be PASS before going further.**
A FAIL on a probe row means the pipeline would run without
enforcement. Note what failed and the doctor's diagnosis.

## 5. One real cycle

```
/kw-ad:tdd <paste the ticket's title, description and acceptance criteria>
```

Go through both sign-off gates properly. At Gate 2, look at the diffs
yourself, not just the summaries.

## 6. What to bring back

Don't copy proprietary code or ticket content out. Bring
observations:

- Which install option worked, and any errors from the ones that
  didn't.
- The `/kw-ad:doctor` table.
- The `tdd-auditor` report's Friction Found and Proposed Changes
  sections, paraphrased.
- Deny lines from `.claude/kw-ad/audit.log`: agent, tool, and reason
  (redact paths if needed). Include the ones you'd expect, too; they
  show the boundaries working.
- Anything where an agent got stuck, looped, or ignored its
  instructions, and roughly where in the pipeline.
- Whether pasting the ticket text by hand was fine, or a real
  Jira/ADO binding would be worth building.

## 7. Clean up

- Plugin: `claude plugin uninstall kw-ad@kw-agentic-dev` and
  `claude plugin marketplace remove kw-agentic-dev`.
- Vendored: delete `.claude/agents/{tdd-*,scribe,github-issue-manager}.md`,
  `.claude/skills/kw-ad-*`, and `.claude/kw-ad/`, and remove the two
  kw-ad hook entries from `.claude/settings.json`.
