# Implementation Plan: CC-GUI Refined Redesign

Reference brief: `docs/ui-refactor/design_handoff_cc_gui_refined/` (README + `CC-GUI Audit.dc.html` prototype).

This is a **sharpening pass**, not a rewrite: same layout skeleton, same theme system, the
Refined column of the audit implemented in the existing imperative-DOM + `style.css` stack.
The handoff's own sequencing applies: **Console first, then Board, then Review**, with the
shared status chip and first-run onboarding built alongside the Console pass. Each phase is
independently mergeable (branch + PR per phase, per repo convention).

---

## 1. Corrections to the brief (codebase reality)

The handoff was written against inferred token names and some imagined chrome. Three
corrections before any work starts:

### 1a. Token names don't match — map values, keep our names

The brief's short names (`--base`, `--tx`, `--acc`…) don't exist. Our tokens are long-form
and the brief itself says "keeps every variable name and only shifts values" — so we shift
values on **our** names:

| Brief | Ours | Current | Refined |
|---|---|---|---|
| `--base` | `--bg-base` | `#1e1e2e` | `#1e1e2e` (unchanged) |
| `--panel` | `--bg-elevated` | `#181825` | `#191926` |
| `--inset` | `--bg-inset` | `#11111b` | `#11111b` (unchanged) |
| `--bd` | `--border` | `#313244` | `#343650` |
| `--bds` | `--border-strong` | `#45475a` | `#4a4c68` |
| `--s2` | `--surface2` | `#585b70` | `#5c5f78` |
| `--tx` | `--text` | `#cdd6f4` | `#e4e8fb` |
| `--txm` | `--text-muted` | `#a6adc8` | `#b7bedd` |
| `--txd` | `--text-dim` | `#6c7086` | `#8a90ad` |
| `--acc` | `--accent` | `#89b4fa` | `#8fb8ff` |
| `--ok` | `--success` | `#a6e3a1` | `#a9e6a4` |
| `--dng` | `--danger` | `#f38ba8` | `#f58fab` |
| `--warn` | `--warning` | `#f9e2af` | `#f6dd9c` |
| `--info` | `--info` | `#cba6f7` | `#cba6f7` (unchanged) |
| `--cyan` | `--cyan` | `#89dceb` | `#8fe0ee` |
| `--peach` | `--proj-6` | `#fab387` | `#fab387` (unchanged) |
| `--maroon` | `--proj-7` | `#eba0ac` | `#f0a7b2` |

These are **Mocha-only** value changes. They must land in two places in lockstep:
`src/style.css` `:root` (static boot defaults, lines ~23–81) and the `MOCHA` const in
`src/theme.ts` (~33–85). The other 9 built-in themes are untouched.

`--ui`/`--mono` font tokens don't exist either — fonts are hardcoded per rule today.
We introduce them as **new** tokens (`--font-ui`, `--font-mono`) in Phase 0; this also
fixes audit issue 14 ("mono font drift in the chrome").

### 1b. The terminal "traffic-light title bar" doesn't exist

Verified: `#terminal-pane` (`index.html:36-41`) contains only the tab strip (`#tabs`) and
`#terminals`. There is no fake macOS chrome to remove. The actionable reading of the brief:
**add no chrome** — the terminal keeps filling its pane edge-to-edge below the tab strip.
The tab strip stays: it is functional navigation (tabs, close ×, new +, status glyphs), not
decoration. Nothing to remove; the constraint just carries forward.

### 1c. Terminal font stays MesloLGS NF

The README assigns IBM Plex Mono to "terminal, code, counters", but the audit document
itself (issue 14) says "terminal keeps MesloLGS for glyphs" — and it must: the bundled
MesloLGS NF is a Nerd Font carrying the powerline/agent glyphs xterm renders. Resolution:
**terminal = MesloLGS NF Embedded (unchanged); `--font-mono` = IBM Plex Mono** for all
chrome/code/counter uses (diff view, diffstat, badges, palette shortcuts, etc.).

---

## 2. Current vs. target — the deltas

| Area | Today | Refined target |
|---|---|---|
| **Tokens** | Mocha values in `:root` + `theme.ts` | Brightened values per table above; accent buttons get `color: var(--bg-inset)` (dark label on light accent), not white |
| **Fonts** | System UI stack; 3 different mono stacks in chrome; MesloLGS terminal-only | IBM Plex Sans (`--font-ui`) + IBM Plex Mono (`--font-mono`), self-hosted like MesloLGS; terminal unchanged |
| **Status** | 8px color-only dots (`applyStatusGlyph`, `main.ts:1678`); waiting "?" and finished dot are both `--warning`; ✎/⚠/☾/⇣! glyphs unlabeled | Shared **status chip** component: shape + color + word (Running / Done / Idle / Stopped / ✎ 3 comments / ⚠ Pull blocked / ⌗ Stack of 3 / ❯ Shell); one warning color; reused on Console, Board, Review |
| **Console** | ~30px rows, 10–11px labels, 21px icon buttons; actions partly in context menu | Roomier density, ≥28px hit targets, lifted type scale, inline row actions, labeled states |
| **Board** | `.card-title`/diffstat ellipsis-clip at column edge; actions visible (▸ ± ⋯) | Cards get a real content budget — no clipping, diffstat wraps; labeled status chips; actions stay visible |
| **Review** | Reviewed-file tracking exists (`reviewed` Set, `review.ts:207`) but no summary; plain textarea composer; `Apply (N) →` header button | 34px conic-gradient **progress ring** + "Files reviewed" label; tick ✓ / open-ring per file; composer becomes an elevated card (`--info` border, avatar, `staged · line N` pill, Save ⌘↵ / Cancel); **sticky bottom apply bar** with consequence copy |
| **Overlays** | Kill (warning) directly above Delete (danger) in context menu; inline "sure?" guard | Kill and Delete visually separated, consequence labeled on each; typed/confirmed guard kept on Delete; overlays on `--bg-elevated` with the standard `0 8px 24px rgba(0,0,0,.28)` shadow |
| **First run** | Zero projects → empty sidebar, no guidance | Centered welcome hero on radial-gradient backdrop teaching add-project / new-session / project-shell; primary CTA `--accent` bg + `--bg-inset` label |
| **Shape scale** | Radii sprawl 4/5/6/7/8/10/11/14px | 4-step scale: 6–7px chips/small buttons · 10px cards/composer · 12px panels/wells |

Explicitly **out of scope** (the discarded "Bold" direction): everything not in the Refined
column. Also out of scope: the "attention summary in the title bar" and "detail pane goes
deeper" audit items — flagged Low priority in the audit and not part of the Refined mockups'
handoff sections; revisit after the six phases land.

---

## 3. Phases

Each phase = one branch/PR. Gate for every phase: `npm run typecheck`, unit tests, the
listed `.iwft` scenarios pass (page objects updated where selectors change), and a visual
pass in `npm run tauri dev`.

### Phase 0 — Foundations: tokens + fonts + primitives

1. **Bundle IBM Plex** — add Sans (Regular/Medium/SemiBold/Bold) + Mono (Regular/Bold)
   woff2 to `src/assets/fonts/` with OFL license text, `@font-face` in `style.css`
   following the MesloLGS pattern (`style.css:8-21`).
2. **Introduce `--font-ui` / `--font-mono`** in `:root`; replace `body`'s hardcoded stack
   and the three divergent mono stacks (`style.css:94, 568, 957, 2536`, …) with the tokens.
   Terminal `fontFamily` in `main.ts:532` untouched.
3. **Shift Mocha values** per the §1a table — `style.css` `:root` and `theme.ts` `MOCHA`
   cssVars together. Also brighten the Mocha xterm `ITheme.foreground` to the new `--text`
   value so the terminal doesn't read duller than the chrome around it.
4. **Accent-label rule** — audit every `--accent`-filled control; label color becomes
   `var(--bg-inset)`.
5. **Radius + elevation scale** — define `--radius-1/-2/-3` (7/10/12px) and a
   `--shadow-raised` (`0 8px 24px rgba(0,0,0,.28)`); adopt them opportunistically in later
   phases rather than a big-bang sweep.
   - Verify: `theme.test.ts`, `theme/theme.iwft.ts` (all 10 themes still reskin cleanly —
     the 9 non-Mocha themes must look identical to before).

### Phase 1 — Shared status chip (screen 08)

1. New `statusChip(state)` helper (likely `src/status.ts`): shape + color + word, driven by
   the existing `SessionStatus` × `AgentState` → glyph mapping in `applyStatusGlyph`
   (`main.ts:1678-1719`). Vocabulary: **Running** (`--success`), **Done** (`--warning`),
   **Idle** (`--cyan`), **Stopped** (`--text-dim`), plus labeled badges **✎ N comments**,
   **⚠ Pull blocked**, **⌗ Stack of N**, **❯ Shell**, and the hibernated ☾ state gains a
   word.
2. Replace color-only dots and bare glyph badges in: sidebar rows (`fillRowMain`
   `main.ts:1965`), board cards (`renderAgentCard` `main.ts:3191`), project-header `⇣!`
   (`main.ts:2807`). Tab glyphs (`updateTabGlyphs`) stay compact dots — a word per tab
   doesn't fit; the chip appears where there's room.
3. **One warning color**: kill the waiting-"?" vs finished-dot ambiguity — distinct
   shape+word, single `--warning` hue.
   - Verify: `sidebar/sidebar.iwft.ts`, `sidebar/hibernation.iwft.ts`, `board/board.iwft.ts`
     (+ SidebarPageObject/BoardPageObject selector updates).

### Phase 2 — Console pass (screen 03)

1. Density + type: lift row height/padding, ≥28px interactive targets, uppercase
   micro-labels (`700 / .06em / uppercase / --text-dim`), 11.5–12.5px controls.
2. Inline row actions per the mockup (today's ▶/■/✕ set, larger and labeled on hover),
   keeping the 2-click `confirmButton` guard.
3. Terminal pane: no chrome added (per §1b); tab strip restyled to the Refined scale.
   - Verify: `terminal/terminal.iwft.ts`, `sidebar/sidebar.iwft.ts`.

### Phase 3 — First-run onboarding (screen 07)

1. In `renderSidebar`/boot: `groups.length === 0` → render a centered hero over a
   radial-gradient backdrop in the main workspace area (not just the sidebar), teaching the
   three entry actions: **Add a project** (primary, `--accent` bg / `--bg-inset` label),
   **Start a session**, **Open a project shell**. Wire to the existing `topInput="add"`
   flow and shell command.
2. Reuse `.empty-project` (`main.ts:2871`) styling where it overlaps; hero dismisses itself
   the moment the first project lands (state-driven, no flag to persist).
   - Verify: new iwft scenario `onboarding/firstRun.iwft.ts` (seed zero projects via
     TauriSimulator); `sidebar/addProject.iwft.ts`.

### Phase 4 — Board pass (screen 04)

1. Content budget: diffstat wraps instead of clipping (`fillDiffstatBar`), `.card-title`
   gets room before ellipsis, cards never overflow the fold un-scrolled.
2. Status chips from Phase 1 replace the accent-bar + dot combo (accent bar can stay as
   reinforcement; the chip carries the word).
3. Card actions ▸/±/⋯ stay always-visible, resized to the ≥28px target floor.
   - Verify: `board/board.iwft.ts` + BoardPageObject.

### Phase 5 — Review pass (screen 05)

1. **Progress ring** in the review header: 34px `conic-gradient(var(--success) <pct>%, var(--border) 0)`
   ring, 25px `--bg-elevated` inner disc, mono `1/3` count, uppercase "Files reviewed"
   label. Driven by the existing `reviewed` Set / file count (`review.ts:207-244`).
2. **File ticks**: restyle `.file-reviewed-toggle` to ✓-filled vs open-ring.
3. **Composer card** (`renderCommentEditor` `review.ts:553`): `1px solid var(--info)`,
   radius 10px, raised shadow; header = 20px `--info` avatar "y" + "you" +
   `staged · line N` pill (`color-mix(in srgb, var(--info) 15%, transparent)` bg); buttons
   **Save ⌘↵** (`--info` bg, `--bg-inset` text) + **Cancel** (`--border-strong` outline).
   Existing ⌘↵/Esc behavior unchanged.
4. **Sticky bottom apply bar** replaces the header `#review-apply` button: pinned to the
   bottom of `#review`, "N comments ready to send back to the agent" + primary
   **Apply N comments →** (`--info` bg, `--bg-inset` text). Live count from
   `stagedComments`.
   - Verify: `review/review.iwft.ts` + ReviewPanePageObject (apply-button selector moves),
     `review/model.test.ts`.

### Phase 6 — Lifecycle & overlays (screen 06)

1. Context menu (`menu.ts` + `sessionMenuItems`): separate Kill from Delete — divider +
   consequence sublabel on each ("stops the process, keeps worktree" vs "removes worktree,
   branch, tmux"); Delete keeps the `deleteSessionDialog` confirm.
2. Overlay surfaces (context menu, confirm boxes, ⌘K palette, settings, help): normalize to
   `--bg-elevated` + `--shadow-raised` + the radius scale.
3. Palette: preserve the **label-as-first-`<span>`** contract (`palette.ts:133-153`) — page
   objects depend on it.
   - Verify: `dialogs/dialogs.iwft.ts`, `palette/palette.iwft.ts`, `settings/settings.iwft.ts`.

---

## 4. Risks & notes

- **Theme regression surface**: Phase 0 touches values every theme overrides at runtime.
  The 9 non-Mocha themes set their own values for every shifted variable, so they should be
  bit-identical before/after — the theme iwft screenshots are the check.
- **New tokens and custom themes**: `--font-ui`/`--font-mono`/`--radius-*`/`--shadow-raised`
  get static defaults in `:root` only — not added to the `Theme.cssVars` contract — so
  existing custom theme JSON stays valid.
- **Page-object churn**: status-chip and apply-bar selectors change; each phase's PR updates
  its page objects in the same commit as the DOM change.
- **No keyboard changes** are planned; if any phase adds one, update `HELP_SECTIONS`
  (`src/help.ts`) and the README keyboard table per CLAUDE.md.
- `docs/ui-refactor/…/screenshots/` referenced by the handoff README was **not included**
  in the zip — current-app captures can be taken locally if needed for before/after.
