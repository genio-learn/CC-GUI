# CC-GUI — GUI for claude-commander

A desktop GUI for managing Claude coding sessions, built **on top of** the
[claude-commander](https://github.com/sizeak/claude-commander) library (tmux +
git-worktree session manager). This repo holds the GUI; claude-commander stays
the shared engine.

This file is the working plan. Update the **Progress log** at the bottom when
stopping work so the next session can pick up cleanly.

---

## Decision record

| Decision | Choice | Why |
|---|---|---|
| Build vs from-scratch | **Build on claude-commander** | Backend reuse is ~1–2 wks of glue vs 6–12 wks rebuilding (worktree lifecycle, agent-state detection, diff/comment re-anchoring, persistence) + permanent duplicate maintenance. GUI frontend work is identical either way. |
| Platform | **Tauri 2** (xterm.js + portable-pty) | Only option with a mature embedded-terminal story; matches precedents (Claudia/opcode, Vibe Kanban). Iced 0.14 terminal widgets (iced_term/frozen_term) are immature single-maintainer projects. GPUI is a dark horse (Arbor precedent). |
| Where GUI lives | **This separate repo**, consuming claude-commander as a Rust dependency | Other claude-commander devs won't use the GUI; upstream changes must stand on their own merits. Precedent: Commander-trait extraction (#102–105) was rejected as abstraction-before-second-consumer. |
| Upstream strategy | Bypass `CommanderService` where incomplete (lib internals are `pub`), upstream small self-justifying PRs that enforce the existing layering rule | Each landed method shrinks our breakage exposure; no PR needs to mention the GUI. |

## Audit summary (claude-commander @ `22bef4b`, v0.13.0, June 2026)

- `CommanderService` (`src/api.rs`) is TUI-free; all response DTOs (`SessionInfo`,
  `SessionDetail`, `ReviewSnapshot`, `ParsedDiff` tree, `Comment`) are `Serialize`.
- No push/event mechanism — request/response only. Background refresh (agent
  states, PR status, previews, pulls) is TUI-owned in `tui/app/background.rs`.
- ~27 TUI call sites bypass the service via `.session_manager()` — that list is
  the API-completion backlog (content/diff/shell capture, `tmux.send_keys`,
  cascade ops, PR enrichment, AI summaries).
- `SessionInfo` does **not** expose `tmux_session_name`; we read
  `service.store().read().await` (the `AppState` map of `WorktreeSession`s) instead.
- Live attach in the TUI is a raw PTY bridge (`tmux/attach.rs`) — not reusable
  by a GUI; we own our own PTY running `tmux attach-session`.

## Phases

### Phase 0 — Spike (this repo, zero upstream changes)
Goal: prove the platform — Tauri window, session list via the claude-commander
lib, xterm.js terminal attached read/write to a live `cc-*` tmux session.

- [x] Tauri 2 + Vite + TypeScript scaffold
- [x] `list_sessions` command via `CommanderService::for_cli` + `store().read()`
- [x] PTY attach: portable-pty spawning `tmux attach-session -t <name>`,
      output streamed to xterm.js over a Tauri `Channel`, input + resize back
- [x] Compiles (`cargo check` + `vite build`); smoke-launch `tauri dev`
- [ ] Manual verification: click a session, see live Claude output, type into it

### Phase 1 — Minimal usable GUI
- [ ] Session tree grouped by project, live agent-state badges (poll
      `AgentStateDetector` / `get_session_detail`)
- [ ] Create / kill / restart / delete session (all already on `CommanderService`)
- [ ] Detail pane: diff stat + pane preview
- [ ] Multiple terminals (one PTY per session, keyed map instead of single slot)

### Phase 2 — Review view
- [ ] `open_review` → render `ReviewSnapshot` (already JSON-ready)
- [ ] Comment CRUD: `create_comment` / `delete_comment` / `apply_comments`
- [ ] Syntax highlighting (web-side; don't reuse TUI's syntect pipeline)

### Phase 3 — Upstream PR track (parallel, opportunistic; each PR self-justifying)
- [ ] Move `Theme` import out of `api.rs` (cosmetic decoupling)
- [ ] `CommanderService::{get_content, get_diff, get_shell_content}` + route TUI through them
- [ ] `CommanderService::send_input` wrapping `tmux.send_keys`
- [ ] Expose `tmux_session_name` (or equivalent) on `SessionInfo`
- [ ] Cascade/PR-enrichment/AI-summary methods, closing remaining bypasses
- Pitch each as enforcement of the CLAUDE.md layering rule + unit tests. **Do not**
  propose the workspace split or event-layer extraction yet.

### Phase 4 — Liveness layer (only once GUI is a live second consumer)
- [ ] Propose upstream extraction of `tui/app/background.rs` orchestration into a
      library background service emitting `CommanderEvent` on a broadcast channel
- [ ] GUI forwards events to frontend; TUI subscribes via its `EventLoop`

## Known risks / notes

- **Dependency pinning**: claude-commander has no semver guarantee on internals.
  Currently a **path dependency** on the local checkout
  (`../claude-commander` relative to repo root) for spike speed — switch to a
  pinned `git` dependency (`rev = "..."`) once the spike settles.
- tmux attach from a GUI process: `TERM` must be set explicitly on the PTY
  command (GUI apps may not inherit one).
- Attaching to a session already attached in the TUI resizes both clients
  (standard tmux behaviour); decide later whether to use `attach -d` or mirror.
- `Channel<Vec<u8>>` JSON-encodes chunks as number arrays — fine for spike,
  revisit with Tauri's binary IPC if throughput matters.

---

## Progress log

_Newest first. Record: date, what was done, what's verified vs not, next step._

### 2026-06-11 (later) — Phase 0 spike scaffolded and compiling
- Scaffolded Tauri 2 + Vite/TS app by hand (no create-tauri-app): frontend in
  `src/` (xterm.js + fit addon, session sidebar), backend in `src-tauri/src/main.rs`
  with commands `list_sessions`, `attach`, `write_pty`, `resize_pty`, `detach`.
- `list_sessions` consumes claude-commander via `CommanderService::for_cli` +
  `store().read().await` (path dep on local checkout @ `22bef4b` / v0.13.0).
- Attach = portable-pty 0.9 running `tmux attach-session -t <name>` with
  `TERM=xterm-256color`; reader thread streams `Vec<u8>` chunks over a Tauri
  `Channel`; single-PTY slot (spike limitation), replaced on re-attach.
- Placeholder icon generated (`app-icon.png` → `npx tauri icon`) — Tauri's
  `generate_context!` requires `icons/icon.png` even with bundling off.
- **Verified**: `npm run build` (tsc + vite) clean; `cargo check` clean;
  `npx tauri dev` compiled, launched, process stayed alive >10s (no startup
  panic). **Not yet verified (needs a human)**: clicking a session attaches and
  the terminal is interactive — run `npm install && npm run tauri dev` to test.
- Next: manual click-test of the spike, then Phase 1 (session create/kill,
  agent-state badges, per-session PTY map) and first Phase 3 upstream PR.

### 2026-06-11 — repo created, plan recorded
- Audit of claude-commander completed (see summary above); build-vs-scratch
  comparison done; decisions recorded.
- Next: Phase 0 spike.
