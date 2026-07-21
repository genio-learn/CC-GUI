# Idea: surface the programs list (multi-harness support)

> **Status: not implemented.** This is a captured idea, not a spec of shipped
> behaviour. Delete this file when the work lands. It supersedes the
> `codex-harness-handover.md` scratch note, which was written against CC v0.24.0
> and only covered Codex.

## What this is

`claude-commander` can run a session under any agent *harness* — Claude Code,
OpenAI Codex, OpenCode, or a bare shell — chosen by the session's `program`
command string. As of CC **v0.27.0** the library exposes a managed, config-backed
**programs list** plus a per-session **change-program** operation. CC-GUI does
not surface any of it yet: every session is created with `program: None` and
there is no way to pick, edit, or switch a harness from the GUI.

"Add Codex/OpenCode support" is not a separate feature — **the programs list is
the feature.** Registering `codex` or `opencode` as a program is what makes those
harnesses selectable.

## What CC provides (the library surface)

Harness abstraction (`claude_commander_core::agent`):

- `AgentKind { Claude, Codex, OpenCode, Unknown }` — derived from the first token
  of the program command via `AgentKind::from_program(&program)`. The harness is
  never stored separately; it is always re-derived from `program`.
- `AgentKind::is_claude()` and the flag-capability helpers gate which launch
  flags apply (`--effort` / `--mode` are Claude-only).
- OpenCode agent-state detection was added in **v0.27.0**, so idle/working
  indicators work for OpenCode sessions, not just Claude.

Config (`claude_commander_core::config`):

- `programs: Vec<ProgramEntry { label, command }>` — the managed list. `label` is
  the friendly picker name, `command` is what launches (e.g. `claude --model opus`,
  `codex`, `opencode`). Migrated in from the old scalar `default_program` in
  **v0.25.0**.
- `program_choices() -> Vec<ProgramEntry>` — the non-empty picker list; synthesises
  a single `claude` entry when `programs` is empty.
- `default_program_index() -> usize` — which entry to pre-select (currently `0`).
- `default_session_program() -> String` — command used when a create flow doesn't
  choose a program. **Now reads `programs.first()`**, falling back to the legacy
  `default_program` scalar, then to built-in `claude`.

Service API (`claude_commander_core::api::CommanderService`):

- `set_programs(Vec<ProgramEntry>) -> Result<()>` — replace the configured list.
- `change_program(&SessionId, program) -> Result<()>` (**v0.27.0**) — repoint a
  live session to a different harness. It relaunches the session **fresh** (no
  `--resume`), because the previous harness's conversation belongs to a different
  CLI and can't be resumed by the new one.
- `CreateSessionOpts.program: Option<String>` — selects the harness at create
  time; `None` falls back to `default_session_program()`.
- `validate_program_flags(opts, resolved_program)` — already enforces that
  `--effort` / `--mode` are Claude-only.

## What already works in CC-GUI

- Agent-state detection is harness-aware: the GUI derives `AgentKind` via
  `AgentKind::from_program(&s.program)` in `groups.rs` and `cascade.rs`.
- `SessionRow.program` is already carried to the frontend (`src/main.ts`).
- Settings already exposes the **legacy** `default_program` text field
  (`src/settings.ts:54`) and the `show_session_program` toggle (`:151`).

## Integration gaps

### 1. State-detection gate hard-codes `"claude"`

Two call sites only detect state for sessions whose program *contains* `"claude"`,
so a Codex or OpenCode session renders as "unknown" state and is skipped by the
cascade pre-flight:

- `src-tauri/src/groups.rs` — the `s.program.contains("claude")` guard.
- `src-tauri/src/cascade.rs` — `detect_states` filters on `s.program.contains("claude")`.

Broaden both to any known harness, e.g. `AgentKind::from_program(&s.program) != AgentKind::Unknown`.
Smallest, highest-value change — shippable alone as a tracer bullet.

### 2. No harness picker on create

`src-tauri/src/sessions.rs::create_session` takes only `project_path` + `title`
and hard-codes `program: None`. Add an optional `program: Option<String>` param
and pass it through `CreateSessionOpts`. Surface `program_choices()` to the
frontend (a thin `get_program_choices` command, or via the existing `get_config`
read) and add a picker to the two new-session flows in `src/main.ts`:

- `renderCreateInput` (`src/main.ts:2148`) — the inline "+ on project" title input.
- `createSessionInProject` (`src/main.ts:2427`) — the palette / section-view prompt.

Both currently call `invoke("create_session", { projectPath, title })`. Mirror the
TUI's New Session program dropdown. When only one harness is configured, the
picker can stay hidden.

### 3. Programs management in settings

Add a Programs section to the settings modal (`src/settings.ts`) backed by
`set_programs` — add/edit/remove `{ label, command }` rows — mirroring CC's
Programs tab (added in v0.25.0). This is what lets a user register `codex` /
`opencode` in the first place. Note the existing `default_program` text field is
now the *legacy fallback*: once a `programs` list exists, `default_program` is
ignored for session creation, so the settings UI should present the list as the
source of truth and treat the old field accordingly.

### 4. Change-program on an existing session

Expose `change_program` as a thin command and wire it to a "Change program"
entry in the session context menu (`src/menu.ts`) and/or the command palette
(`src/palette.ts`). Warn in the UI that switching relaunches the session fresh
(no resume), since that is the library's behaviour.

### 5. (Optional) Per-row harness badge

`SessionRow.program` is already available. When more than one harness is in use,
render a small badge on the session row, respecting the spirit of
`show_session_program` (defaults off for single-harness setups). Row rendering is
in `src/main.ts`.

## Suggested order

1. Broaden the two detection gates (gap 1).
2. Programs settings section (gap 3) — needed before a picker is useful.
3. Harness picker on create (gap 2).
4. Change-program (gap 4).
5. Optional badge (gap 5).

## Open questions

- A model can be baked into a `ProgramEntry.command` (`claude --model opus`),
  which overlaps with any separate per-session model field. Decide whether the
  picker offers whole program entries, a model field, or both.
- Keep command handlers thin (CLAUDE.md): harness logic stays in CC; the GUI only
  selects `program`, edits the list, and renders.

## Verification (when implemented)

- `cd src-tauri && cargo build && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings`
- `npm run typecheck && npm test && npm run test-iwft`
- iwft scenario: seed a session with `program: "codex"` (and one with
  `"opencode"`), assert a non-"unknown" state dot and presence in the picker.
  Extension points: `TauriSimulator` (`src/playwright/iwft/network/`) and
  `SidebarPageObject`.
- Real-app check via the `run-app` skill: register a Codex/OpenCode program,
  create a session under it, confirm state tracking and change-program.
