# Handoff: CC-GUI UI Re-imagining (Console + Board)

## Overview
A re-imagining of **CC-GUI** — the desktop GUI front-end for `claude-commander`
(mission control for parallel Claude Code agent sessions). It preserves every
capability of the current app but rethinks layout, navigation, and the
status-glyph vocabulary. Two top-level layouts are provided, switchable from a
segmented control in the title bar:

- **Console** — refined three-column workspace (session sidebar · live terminal · detail pane).
- **Board** — spatial mission-control: sessions as live agent cards in project columns, with a docked terminal.

Shared across both: a **unified session sidebar model**, **command palette (⌘K)**, **code-review overlay with inline comments**, **help overlay (?)**, **live-preview theme picker**, **right-click/⋯ session context menu**, and a **delete-with-confirmation** flow.

---

## About the Design Files
The file in this bundle (`CC-GUI Reimagined.dc.html`) is a **design reference
created in HTML** — an interactive prototype showing intended look and behavior.
**It is not production code to copy.**

Your task is to **recreate these designs in the existing CC-GUI codebase**:
**Tauri 2, plain TypeScript + Vite, no UI framework, DOM built imperatively.**
Use the codebase's established patterns (the same DOM-builder helpers, event
wiring, and module structure already in use). Do **not** introduce React/Vue or
copy the prototype's class-based component runtime — that was just the prototyping
tool. Terminals remain **real PTYs in xterm.js**; diffs remain **Shiki**.

> The prototype was authored with inline styles and **hardcoded Catppuccin-Mocha
> hex values**. In the real app, every one of those literals must be replaced by
> a **semantic theme token** (see _Design Tokens_) so app chrome, the xterm
> terminal, and the diff highlighting all reskin together across the 10 built-in
> themes + custom JSON themes + light/dark/follow-system.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and interactions are final
and intended to be matched closely — but expressed through your semantic tokens,
not the raw Mocha hex. Treat the layout, hierarchy, status vocabulary, and
interaction model as the spec; treat exact pixel values as strong defaults.

---

## Layouts / Views

### Title bar (always present) — height 46px, bg `surface.mantle`, 1px bottom border `bg.crust`
- **Left:** 18px rounded app mark (blue→mauve gradient), "claude-commander" (600/13px), a mono pill showing `N sessions · M live` (border `surface0`).
- **Center:** segmented control `[ Console | Board ]` — pill group on `bg.crust`, active segment bg `surface0`, active text `text`, inactive `overlay0`.
- **Right:** "Jump to… ⌘K" button (border `surface0`), theme button `◐`, help button `?`. All 32px, border `surface0`, hover brightens text + border.

### A. Console
Three columns under the title bar: **Sidebar (312px) · Center (flex) · Detail (290px)**.

**Sidebar** (bg `surface.mantle`, right border `bg.crust`), top→bottom:
1. **Header** (40px): "SESSIONS" label (uppercase, 11px, `subtext0`) + `⋯` projects menu button.
2. **Projects rail** (the persistent *project axis*; bg slightly darker `#161623`):
   - "PROJECTS" label + "＋ add" (add/scan projects).
   - One row per project — **including projects with zero sessions** (dimmed): colored 9px square (project color), project name (mono 12.5px), session count, then `+` (new session) and `$` (project shell) icon-buttons (21px, border `surface0`; `+` hovers green, `$` hovers blue).
   - Clicking a project row **filters** the session list to that project (toggle). `+`/`$` stop propagation.
3. **Group-by toggle:** "GROUP BY" + segmented `[ Sections | Projects ]`.
4. **Session list** (scrolls):
   - Optional **filter banner** when a project filter is active: colored square + "filtered to `<project>`" + `✕` clear.
   - **Groups** by Section (Needs review / Running / Done / Stopped) OR by Project, per toggle. Group header = optional project-color accent square (project mode) + uppercase mono label + session count + hairline rule.
   - **Session row:** state dot (see Status System) · name (mono 13px) + small **project tag** chip (project-color text on `rgba(255,255,255,.05)`, hidden in Project-grouping mode) · sub-line `+adds −dels · state` (`overlay0`) · right side: `✎ n` comments chip (mauve), `⚠` blocked (maroon), `⋯` actions button. Selected row: bg `rgba(137,180,250,.12)`, 2px left border `accent.primary`. Hover: bg `rgba(205,214,244,.045)`.
   - **Stack (cascade):** a bordered group (`surface0` border, faint mauve tint). Header: `⌗` mauve + stack name + project tag + actions `⛙` merge (green) / `↑` push (blue) / `⋯` resume·abandon. Children = indented session rows (left border = project color).
   - **Empty-project state** (when filtered to a project with no sessions): dashed `＋` tile + "No sessions in `<project>` yet" + `＋ New session` / `$ Shell` buttons.
5. **Footer:** status legend (running/finished/idle + ✎ comments + ⚠ blocked + ⌗ stack) and the **commander chip** (full-width, mauve square + "commander" + "attach ⏎").

**Center pane** (bg `surface.base`):
- **Tab strip** (40px, bg `surface.mantle`): draggable tabs — per-tab state dot + name (mono) + `×` close; active tab bg `surface.base` with 2px top border `accent.primary`; `+` new terminal. (`Cmd+W` close, `Cmd+1–9` jump.)
- **Terminal frame** (rounded 10px, bg `bg.crust`, border `surface0`): 30px title bar (3 traffic dots + `session — claude · project`), then the **xterm.js surface**, then a **powerline status line** (27px): green `⚡ project` segment, `surface0 branch` segment, `✔ N edits`, `◷ elapsed`, right-aligned state. Below the terminal sit the **composer** (rounded `surface1` border, `❯` prompt + placeholder + blinking cursor) and a **hint line** (`⏵⏵ accept edits on · shift+tab to cycle · ? for shortcuts`). _In the real app the composer/cursor/output are all rendered by xterm.js + claude-code itself; the frame, title bar, and powerline are the re-skinnable chrome._
- **Empty state:** "Select a session to attach."

**Detail pane** (right, bg `surface.mantle`): header (`◀` collapse · session name · `×`); metadata rows (branch, worktree, PR, status); diffstat (`+adds` green / `−dels` red + proportional bar); AI summary block with `↻ Generate` and tag chips; footer actions `± Review diff` (primary) and `Open PR`.

### B. Board
Under the title bar: **filter bar (48px)** + **columns (horizontal scroll)** + **dock (194px)**.
- **Filter bar:** pill filters `All / Needs review / Running / Blocked` (active = `surface0` bg) + a search field + `＋ New session` (primary).
- **Columns:** one per project (306px, bg `surface.base`, border `surface0`, radius 14px). Header: project-color square + name + count + `+`/`$`. Body = stacked **agent cards**.
- **Agent card** (radius 11px, bg `surface.mantle`): a 3px top accent bar in the state color; header = state dot + name + state pill + `⋯`; a 2-line **mini terminal preview** (mono, on `bg.crust`); a diffstat bar + `+/−` counts; footer chips (`✎ n`, `⚠ pull`) + quick actions `▸` attach (green) / `±` review (mauve). Selected card border `surface2`.
- **Dock** (bottom): header (`▸ attached` + session + branch + `⤢`/`×`) over a compact live terminal of the attached session.

### Shared overlays
- **Command palette (⌘K):** centered modal over a blurred scrim; search header (`⌘` + placeholder + `esc`); "Sessions" list (state dot + name + project + state) and "Commands" list (icon + label + shortcut). Fuzzy session jump + command runner.
- **Code-review overlay:** replaces the center/detail area (absolute inset). Header: `±` + session + `base: main` + files/diffstat pill + **`Apply (n) →`** (mauve) + refresh `↻` + close `×`. Body: left **file list** (name + `+/−`, active file highlighted) and right **Shiki diff** — add lines tinted green, del lines tinted red, context neutral. **Click a line to attach an inline comment, shift-click for a range**; staged comments render as mauve-bordered bubbles ("you" + "staged"). **Apply** sends the staged comments back to the agent.
- **Help overlay (?):** two-column keyboard-shortcut grid.
- **Theme popover:** anchored top-right; rows of theme swatches (3-color preview + name + active check) + "follow system" toggle. Live preview.
- **Session context menu** (right-click a row/card, or click `⋯`): anchored at pointer. Items: Attach · Open shell · Review diff · Rename… · (rule) · Restart · Restart fresh · Kill — stop process (yellow) · (rule) · **Delete session…** (red). `Kill` and `Delete` are distinct: kill stops the process and keeps the session; delete removes it entirely.
- **Delete confirmation:** centered dialog over scrim. Red `⌦` icon + "Delete this session?" + session name (mono, red) + body: "This kills the agent, removes its worktree + tmux session, and deletes the branch `<branch>`. This can't be undone." + `Cancel` (neutral) / `Delete session` (red). Confirming removes the session from the shared list → it disappears from **both** Console and Board, counts/sections recount, and the active tab advances if it was the deleted one.

---

## Interactions & Behavior
- **Layout switch:** title-bar segmented control toggles Console ↔ Board (closes any open review).
- **Select session:** click a sidebar row / board card → sets active, ensures a terminal tab exists, makes it active.
- **Tabs:** click to focus, `×` to close (active falls back to first remaining). Reorder by drag (current app behavior). `Cmd+W` close, `Cmd+1–9` jump.
- **Grouping:** `[Sections|Projects]` toggle changes only the session list grouping; stacks nest under whichever grouping is active. Project filter (rail) composes on top of either.
- **Review comments:** click/shift-click diff lines to stage; `Apply (n)` count reflects staged comments; applying clears them and returns to the workspace.
- **Context menu / delete:** described above; `Esc` closes menu and dialog (and palette/help/theme).
- **Status liveness:** "running" dots pulse (box-shadow pulse, ~1.8s ease-in-out). Terminal cursor blinks (~1.1s step-end).
- **Overlays:** open on a fade/slide-in (~0.12–0.14s ease); scrim click or `Esc` closes.

## State Management
Recreate with your imperative state (plain module state + re-render/patch). Variables in play:
- `layout`: `'console' | 'board'`
- `activeSessionId`, `openTabs: string[]`, `activeTabId`
- `groupBy`: `'section' | 'project'`
- `projectFilter`: project id | null
- `paletteOpen`, `reviewOpen`, `helpOpen`, `themeOpen`: booleans
- `stagedComments`: number (review)
- `removedSessionIds: string[]` (deleted sessions are filtered out everywhere)
- `contextMenu`: `{ sessionId, x, y } | null`
- `confirmDeleteId`: session id | null
- Real data sources (from `claude-commander` / config, hot-reloaded): sessions (id, name, project, section, stack membership/order, liveness state, unread flag, pending-comment count, blocked-auto-pull flag, diffstat, branch, PR), projects (incl. empty), commander session.

---

## Design Tokens

The prototype hardcodes **Catppuccin Mocha**. Define a **semantic token layer** and
have every theme (10 built-ins + custom JSON, light/dark/follow-system) supply
these. Three surfaces consume the same tokens: **app chrome**, the **xterm
terminal**, and the **Shiki diff**.

### Semantic roles → Mocha value (prototype defaults)
| Token | Role | Mocha |
|---|---|---|
| `bg.crust` | deepest bg — terminal body, inputs, pill groups | `#11111b` |
| `surface.mantle` | chrome panels — sidebar, title bar, detail, tab strip, headers | `#181825` |
| `surface.base` | center pane, cards, dialogs, popovers, menus | `#1e1e2e` |
| `surface0` | strong borders, segmented-active, neutral buttons | `#313244` |
| `surface1` | dialog/popover borders, menu dividers | `#45475a` |
| `surface2` | card hover border, muted-icon hover | `#585b70` |
| `overlay0` | muted/label text, "stopped" dot | `#6c7086` |
| `overlay1` | secondary muted, faint icons | `#7f849c` |
| `subtext0` | secondary text | `#a6adc8` |
| `subtext1` | body text (paragraphs) | `#bac2de` |
| `text` | primary text | `#cdd6f4` |
| `accent.primary` | primary action, selection, links/PR | `#89b4fa` (blue) |
| `accent.tool` | terminal tool-call lines | `#b4befe` (lavender) |
| `accent.review` | comments, stacks, Apply | `#cba6f7` (mauve) |
| `state.running` | running/live, additions, success | `#a6e3a1` (green) |
| `state.finished` | finished/unread, Kill, soft-warn | `#f9e2af` (yellow) |
| `state.idle` | idle | `#89dceb` (sky) |
| `state.stopped` | stopped | `#6c7086` (overlay0) |
| `attn.blocked` | blocked auto-pull `⚠` | `#eba0ac` (maroon) |
| `danger` | deletions, destructive, blocked-x | `#f38ba8` (red) |
| `welcome` / `tag.warm` | welcome glyph, warm tags | `#fab387` (peach) |
| `tag.cool` | cool tags | `#94e2d5` (teal) |
| project colors (example) | per-project identity dots | atlas `#89b4fa` · web `#f9e2af` · infra `#a6e3a1` · mobile `#f5c2e7` |

### Alpha utility values
- Selection bg `rgba(137,180,250,.12)` · row hover `rgba(205,214,244,.045)`
- Faint chip bg `rgba(255,255,255,.05)`
- Scrim `rgba(17,17,27,.62–.66)` + `backdrop-filter: blur(3px)`
- State chip bg = state color @ ~13% alpha

### Spacing & radius
- Pane gutters 12–16px; row padding 7–9px; card padding 11–13px.
- Radius: pills/tags 4–6px; chrome buttons 6–8px; rows 7–8px; terminal frame 10px; cards 11–14px; dialogs/popovers 11–15px.
- Shadows: terminal `0 8px 30px rgba(0,0,0,.25)`; popovers/menus `0 20px 50px rgba(0,0,0,.5)`; dialogs `0 28px 70px rgba(0,0,0,.6)`.

### Typography
- **Chrome / UI:** the prototype used **IBM Plex Sans**. In the real app, use your existing UI font.
- **Code / terminal / status / mono accents:** the prototype used **IBM Plex Mono**. **The real xterm PTY must keep the bundled `MesloLGS NF`** (needed for agent status-line glyphs); diff (Shiki) and mono chrome labels can follow your existing mono.
- Scale used: title 15–16/700; section labels 10–11/600 uppercase (`overlay0`); body 12.5–13; mono rows 12.5–13; terminal 13–14; status/powerline 11.

### Status-glyph system (reworked — clearer icon+color)
- **Liveness dot** (8px circle): running = green **pulsing**; finished/unread = yellow; idle = sky; stopped = grey.
- **Pending review comments:** `✎ n` mauve chip (replaces the old `🗨`).
- **Blocked auto-pull:** `⚠` maroon (replaces `⇣!`).
- **Stack:** `⌗` mauve. **Project identity:** colored square + short tag.
- Per-row actions surfaced as a `⋯` button + right-click menu (replaces terse inline affordances).

## Assets
No raster/vector assets — all UI is CSS/markup + Unicode glyphs. Fonts: IBM Plex
Sans/Mono in the prototype (Google Fonts); the real app keeps **MesloLGS NF** for
the terminal. No Anthropic brand assets are used; if you add product branding,
use your codebase's existing brand system.

## Files
- `CC-GUI Reimagined.dc.html` — the full interactive design reference (both layouts + all overlays + delete flow). Open in a browser to explore; use the title-bar toggle to switch Console/Board, `⌘K` for the palette, `?` for help, right-click a session for the context menu.

## Screenshots
Reference captures in `screenshots/` (1920-class hi-fi, dark/Mocha):
- `01-console.png` — Console layout: projects rail + section-grouped session list, live terminal, detail pane.
- `02-console-projects-grouping.png` — same view with the session list toggled to **Projects** grouping (project headers, tags dropped).
- `03-board.png` — Board layout: agent cards in project columns + docked terminal.
- `04-review-inline-comments.png` — code-review overlay with file list, Shiki-style diff, and staged inline comments + `Apply (2)`.
- `05-context-menu.png` — session context menu (Attach … Kill … Delete session).
- `06-delete-confirm.png` — delete confirmation dialog.

(The `⌘K` command palette and `?` help overlay are not captured separately — see their descriptions under _Shared overlays_.)
