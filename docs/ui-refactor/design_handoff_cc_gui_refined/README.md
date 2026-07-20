# Handoff: CC-GUI Refined Redesign

## Overview
CC-GUI is a Tauri desktop app — mission control for running parallel Claude Code agents. This handoff covers the **Refined** redesign: a sharpening of the existing Catppuccin-Mocha interface (not a rewrite). It fixes 14 audited usability issues across four screens plus two net-new flows, keeping the same tokens, layout skeleton, and the 10-theme system intact.

The redesign was chosen as a single direction. An earlier "Bold" alternative was explored and discarded — do not implement it.

## About the Design Files
The file in this bundle (`CC-GUI Audit.dc.html`) is a **design reference created in HTML** — an interactive prototype showing the intended look and behavior. It is **not** production code to copy directly. Your task is to **recreate these designs in the existing CC-GUI codebase** (Tauri + the app's current imperative DOM/`style.css` render) using its established patterns, tokens, and theme system.

The prototype is a pan-and-zoom audit document: each screen shows **Current** (today) beside **Refined** (target). Implement the **Refined** column. Where a screen shows only one mockup (onboarding, status vocabulary), that is the target.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and copy are final. Recreate the Refined UI pixel-faithfully using the codebase's existing CSS variables and theme reskin — but note the Refined mockup uses slightly brightened token values (below) intended to *replace* the current ones, not sit alongside them.

## Design Tokens

The app is driven entirely by CSS custom properties (see `src/style.css`). Refined keeps every variable name and only shifts values — brighter dim-text for contrast, roomier type. These are the **default (Mocha) theme** values; the other 9 themes reskin the same variables.

### Current (today) — for reference
```
--base:#1e1e2e; --panel:#181825; --inset:#11111b; --bd:#313244; --bds:#45475a; --s2:#585b70;
--tx:#cdd6f4; --txm:#a6adc8; --txd:#6c7086;
--acc:#89b4fa; --ok:#a6e3a1; --dng:#f38ba8; --warn:#f9e2af; --info:#cba6f7;
--cyan:#89dceb; --peach:#fab387; --maroon:#eba0ac;
--ui:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; --mono:Menlo,Monaco,monospace;
```

### Refined (target) — apply these
```
--base:#1e1e2e; --panel:#191926; --inset:#11111b; --bd:#343650; --bds:#4a4c68; --s2:#5c5f78;
--tx:#e4e8fb; --txm:#b7bedd; --txd:#8a90ad;      /* brighter mid/dim text for legibility */
--acc:#8fb8ff; --ok:#a9e6a4; --dng:#f58fab; --warn:#f6dd9c; --info:#cba6f7;
--cyan:#8fe0ee; --peach:#fab387; --maroon:#f0a7b2;
--ui:"IBM Plex Sans",sans-serif; --mono:"IBM Plex Mono",monospace;
```

Token roles: `--base` app bg · `--panel` raised surfaces/cards · `--inset` wells (terminal, inputs) · `--bd` hairline borders · `--bds` stronger borders · `--tx`/`--txm`/`--txd` text primary/mid/dim · `--acc` primary accent · `--ok`/`--dng`/`--warn`/`--info` semantic states.

Key change from current: **accent buttons use `color: var(--inset)` for their label** (dark text on light-blue), not `#fff`.

### Spacing & shape
- Radii: 6–7px (chips, small buttons), 10px (cards, composer), 12px (panels/wells).
- Border: `1px solid var(--bd)` hairlines; `var(--bds)` for interactive/secondary button outlines.
- Elevation: raised/staged elements use `box-shadow: 0 8px 24px rgba(0,0,0,.28)`.
- Type scale seen in mockups: 10–11px uppercase section labels (letter-spacing .06em), 11.5–12.5px body/controls, larger for headings.

### Typography
- UI: **IBM Plex Sans**. Mono: **IBM Plex Mono** (terminal, code, counters).
- Uppercase micro-labels: `font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--txd)`.

## Screens / Views

### 03 · Console — three-column workspace
- **Purpose:** default view where triage, work and review begin. Project rail + grouped session list · live terminal · detail pane.
- **Layout:** three columns. Left: project rail + session list grouped by project. Center: live terminal. Right: session detail pane.
- **Refined changes:**
  - **Terminal pane has NO header.** Remove the old fake macOS traffic-light title bar (red/amber/green dots + session title). The terminal fills its pane edge-to-edge. This was explicitly called out as odd — do not add any window chrome to the terminal.
  - Session states are labeled (shape + color + **word**), not color-only dots.
  - Inline row actions; larger hit targets; roomier list density.

### 04 · Board — spatial mission control
- **Purpose:** agent sessions as live cards in project columns, over a docked terminal.
- **Layout:** horizontal project columns of session cards; docked terminal along the bottom.
- **Refined changes:** cards no longer truncate their own content or clip; per-card actions are visible rather than hidden; labeled status chips reused from Console.

### 05 · Code review & inline comments
- **Purpose:** the read-diff → stage-comments → Apply-to-agent loop.
- **Layout:** file list (left) + diff with inline comment threads (center/right); sticky action bar pinned to the bottom.
- **Refined changes (merged from the discarded Bold exploration — implement all):**
  - **Circular progress ring** for files reviewed. 34px outer circle, `conic-gradient(var(--ok) <pct>%, var(--bd) 0)`, with a 25px `var(--panel)` inner disc holding a mono `1/3` count. Beside it an uppercase "Files reviewed" label.
  - **File list tick boxes:** reviewed files show a checkmark; unreviewed show an open ring.
  - **Inline comment composer:** a staged comment renders as a real composer card — `1px solid var(--info)`, radius 10px, `box-shadow:0 8px 24px rgba(0,0,0,.28)`. Header: 20px rounded `y` avatar (`var(--info)` bg, `var(--inset)` text) + "you" + a `staged · line 10` pill (`color:var(--info)`, bg `color-mix(in srgb,var(--info) 15%,transparent)`, radius 5px). Below the comment text, two buttons: **Save ⌘↵** (`var(--info)` bg, `var(--inset)` text) and **Cancel** (`1px solid var(--bds)` outline, `var(--txm)` text). Both `padding:6px 12px; radius:7px; font-weight:600`.
  - **Sticky bottom apply bar:** shows count + consequence — "2 comments ready to send back to the agent" — with a primary **Apply 2 comments →** button (`var(--info)` bg, `var(--inset)` text).

### 06 · Lifecycle & overlays
- **Purpose:** context menu, delete guard, ⌘K palette, Settings.
- **Refined changes:** disambiguate the "Kill vs Delete" trap with explicit labeled destructive actions; replace cryptic glyphs with shape + color + word; overlays use `var(--panel)` surfaces with the standard elevation shadow.

### 07 · New flow — first run & empty states
- **Purpose:** the missing onramp. Today, zero projects = empty sidebar with no guidance.
- **Layout:** centered welcome hero on a radial-gradient backdrop; teaches the three entry actions — add a project, start a session, open a project shell.
- **Style:** fully in the Refined system (IBM Plex Sans, Refined tokens). Primary CTA uses `var(--acc)` bg with `var(--inset)` label. Cards/pills/accent/type all match the Refined Console.

### 08 · Status vocabulary, decoded
- **Purpose:** the highest-leverage fix. Every cryptic glyph becomes **shape + color + word**.
- **Layout:** a two-column reference grid (`grid-template-columns:1fr 1fr; gap:16px`) mapping each state to its glyph, color token, and label.
- **Implementation:** build this as a **shared status-chip component** reused on every surface (Console, Board, Review). It replaces the footer legend, the two ambiguous warnings, and the color-only dots.

## Interactions & Behavior
- **Terminal:** fills its pane, no header/title bar.
- **Review composer:** clicking the gutter/adding a comment opens the inline composer tied to the exact line. Save (⌘↵) stages it; Cancel discards. Staged count updates the bottom apply bar and the progress ring.
- **Progress ring:** fills proportionally to reviewed-file count.
- **Apply bar:** stays pinned/sticky at the bottom, always in reach; label reflects live staged count.
- **Overlays:** destructive actions (Kill / Delete) are explicitly labeled and separated to prevent mis-clicks.

## State Management
- `reviewedCount` / `totalFiles` → drives the progress ring pct and file tick boxes.
- `stagedComments[]` (each with `line`, `body`, author) → drives inline composers and the apply-bar count/label.
- Session `status` enum → drives the shared status chip (shape + color + word) everywhere.
- First-run: `projects.length === 0` → render the onboarding empty state instead of the workspace.

## Assets
- **Fonts:** IBM Plex Sans + IBM Plex Mono (Google Fonts / self-hosted). No other new assets.
- No icon images — status glyphs are shape + color + text.
- `screenshots/` (optional, ask to include) contains captures of the *current* app for before/after reference.

## Files
- `CC-GUI Audit.dc.html` — the full audit + Refined mockups (this is the primary reference; open in a browser, pan/zoom).
- Target codebase references: `src/style.css` (token definitions + themes), `index.html`, and the existing `docs/ui-overhaul` handoff.
