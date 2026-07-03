---
name: update-claude-commander
description: Update CC-GUI to a newer claude-commander release — bump the pinned git tag, refresh Cargo.lock, review what changed upstream, check whether any GUI code needs updating as a result, and propose new CC-GUI features the new capabilities could enable. Use when the user wants to update/bump/upgrade claude-commander, adopt a newer CC release, or refresh the CC dependency.
---

# Update claude-commander

CC-GUI embeds [`claude-commander`](https://github.com/sizeak/claude-commander)
(CC) as a library, pinned to a release **tag** in `src-tauri/Cargo.toml`. This
skill bumps that pin, verifies the GUI still builds against it, and reports what
the new release makes possible.

The output has three parts, in order:

1. **The bump** — `Cargo.toml` + `Cargo.lock` updated to the new tag.
2. **Impact check** — whether any CC-GUI code needs to change as a result.
3. **Feature ideas** — new CC-GUI features the new CC release could enable (or
   "none" if the release is internal/TUI-only).

Work on a branch and land via PR — never push to `main` directly.

## Step 1 — Find the current and latest release

Read the current pin:

```sh
grep 'claude-commander' src-tauri/Cargo.toml   # tag = "vX.Y.Z"
```

List upstream releases (newest first) and pick the target (latest unless the
user named a version):

```sh
gh release list --repo sizeak/claude-commander --limit 10
```

If already on the latest tag, stop and tell the user — nothing to do.

## Step 2 — Review what changed upstream

Read the release notes between the current pin and the target so you can reason
about impact and features. Cover every release in the gap, not just the target:

```sh
gh release view vX.Y.Z --repo sizeak/claude-commander   # per release in the gap
gh api repos/sizeak/claude-commander/compare/vOLD...vNEW --jq '.commits[].commit.message'
```

Note especially any changes to the library modules the GUI consumes (Step 4).
Classify the release as **GUI-relevant** (touches consumed modules / public
API) or **internal** (TUI-only, refactors, deps) — this drives Steps 4 and 6.

## Step 3 — Bump the pin and refresh the lockfile

Edit the `tag` in `src-tauri/Cargo.toml`, then refresh the exact commit in the
lockfile:

```sh
cd src-tauri && cargo update -p claude-commander
```

`Cargo.toml` and `Cargo.lock` must be committed **together** so the pinned
commit is reproducible.

## Step 4 — Check whether CC-GUI needs updating

The GUI only touches a subset of CC's library. If the release changed none of
these, the update is a clean recompile with no GUI changes. The consumed
surface (verify with `grep -rhoE "claude_commander::[a-z_:]+" src-tauri/src/`):

| CC module | Where the GUI uses it |
|-----------|-----------------------|
| `api`         | service/polling, most command modules |
| `session`     | `sessions.rs`, `groups.rs`, `cascade.rs` — sections, assignment, stack parent |
| `git`         | `review.rs`, `cascade.rs` — branch diff, PR state, branch summary |
| `config`      | `settings.rs` — config read/save |
| `comment`     | `review.rs` — review comments |
| `commander`   | `commander.rs` — persistent commander session |
| `cli_args`    | `sessions.rs` — CLI command building |
| `tmux`        | `pty.rs`, `sessions.rs` — attach/shell |

Confirm the build actually compiles against the new release — a signature
change surfaces here even if the notes were vague:

```sh
cd src-tauri && cargo build
```

Then, for any consumed module the release touched, check the call sites for
behavioural changes the compiler won't catch (renamed fields consumed via
serde, changed enum variants, new required config keys, altered defaults).

**Impact check output** — state one of:
- *No GUI changes needed* — release touched no consumed module; clean recompile.
  (This is the common case; the v0.16.0 bump was exactly this.)
- *GUI changes needed* — list each file + what changes and why, then make the
  changes surgically (match surrounding style; keep command handlers thin per
  CLAUDE.md).

## Step 5 — Verify

Run the same checks CI enforces:

```sh
npm run typecheck
cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo build
```

All must pass before committing. If keyboard interactions changed as part of a
GUI update, also update `src/help.ts` and the README keyboard table.

## Step 6 — Propose new CC-GUI features

From the Step 2 notes, list CC capabilities that are **new or newly exposed in
the library** and that the GUI does not yet surface. For each, give a one-line
feature idea and the GUI surface it would touch (e.g. a command module,
palette, sidebar, review pane). Only include capabilities reachable from the
consumed library API — TUI-only features don't count unless the underlying
library primitive is public.

If the release is internal/TUI-only with nothing new for the GUI to expose, say
so plainly: *"No new GUI-exposable features in this release."* Don't invent
features to pad the list.

## Commit

Commit `Cargo.toml` + `Cargo.lock` (and any GUI changes) together. Suggested
message, following the repo's existing bump commits:

```
Bump claude-commander to vX.Y.Z

<one-paragraph summary: what changed upstream, and whether the GUI
consumes any of it — mirror the reasoning in git log for f209dce>.
```

Then open a PR per the repo's PR workflow.
