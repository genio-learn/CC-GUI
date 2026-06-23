# Implementation Plan: CC-GUI UI Re-imagining (Console + Board)

Reference brief: `docs/ui-overhaul/design_handoff_cc_gui_reimagining/` (README + HTML prototype + 6 screenshots).

This plan recreates the design in the **existing** stack — Tauri 2, plain TypeScript + Vite,
no UI framework, imperative DOM — reusing the codebase's established patterns. It does **not**
adopt the prototype's class-based component runtime or its hardcoded Mocha hex.

---

## 1. Guiding constraints (from the brief + the codebase)

- **Match existing idioms.** Build DOM with `document.createElement` + `.append`; no `el()` helper
  exists and we won't add a framework. Re-render via the existing strategy: full rebuild on
  structural change, targeted patch (`rowRefs` map + `*Signature` hash) on data change.
- **Tokens, not hex.** Every prototype literal becomes a semantic CSS custom property that the three
  themed surfaces consume together: app chrome (`style.css`), xterm `ITheme` (`theme.ts` → `main.ts`),
  Shiki diff (`theme.ts` → `review.ts`). All 10 built-ins + custom JSON + light/dark/follow-system
  must reskin in lockstep.
- **Real PTYs / real diffs.** Terminals stay xterm.js with the bundled `MesloLGS NF`; diffs stay Shiki.
  Only the *frame/chrome* (terminal title bar, powerline status line, composer border) is re-skinnable.
- **Surgical.** Each change traces to the brief. We evolve the current Console rather than rewrite it;
  Board is the one genuinely new view.

---

## 2. Current vs. target — the structural deltas

| Area | Today | Target |
|---|---|---|
| **Title bar** | None. App is a bare 3-pane flex row; sidebar has its own header. | New 46px title bar: app mark + `N sessions · M live` pill, centered `[Console \| Board]` segmented control, right-side `⌘K` / `◐` / `?` buttons. Implies custom window decorations. |
| **Top-level layout** | Single fixed layout (`#sidebar` · `#terminal-pane` · `#review`/`#detail`). | `layout: 'console' \| 'board'` switch. Console = refined version of today; Board = new. |
| **Sidebar** | Header + sessions list; project/section grouping via `viewMode`. | Adds a persistent **projects rail** (incl. empty projects, `+`/`$` actions, click-to-filter), a **GROUP BY [Sections\|Projects]** toggle, a **filter banner**, **bordered stack groups**, an **empty-project state**, and a **footer** (status legend + commander chip). |
| **Center pane** | Tab strip + raw xterm container. | Adds a rounded **terminal frame** (title bar with traffic dots) and a **powerline status line**; composer/hint chrome around the (still xterm-rendered) surface. |
| **Detail pane** | Meta rows + diffstat + AI summary + review button. | Restyled to the brief (collapse affordance, diffstat bar, summary tags, `± Review diff` primary + `Open PR`). Largely a reskin. |
| **Board** | — | New: filter bar + horizontally-scrolling project columns of **agent cards** + a bottom **dock** with a compact live terminal. |
| **Status vocabulary** | `statusGlyph()` + PR/comment/unread badges. | Reworked glyph system: pulsing liveness dot, `✎ n` mauve comment chip, `⚠` maroon blocked, `⌗` mauve stack, project-color squares + tags. |
| **Overlays** | palette, review, context menu, help, theme **modal**, confirm/prompt, settings. | Palette restyle; review gains inline comment **bubbles** + `Apply (n)`; context menu gains **Kill vs Delete** distinction; new **delete-confirm** dialog; theme picker becomes an anchored **popover**; help two-column grid. |

---

## 3. State model

The brief's variables map cleanly onto module-level state in `main.ts`, reusing what exists:

| Brief variable | Plan |
|---|---|
| `layout: 'console' \| 'board'` | **New** module var; persisted to localStorage (`cc-layout`). Drives which root subtree renders. |
| `activeSessionId`, `openTabs`, `activeTabId` | Exists as `activeTerm` + `terminals` map. Keep; add an explicit `activeSessionId` if Board needs selection independent of an open tab. |
| `groupBy: 'section' \| 'project'` | Exists as `viewMode` (`"project" \| "sections" \| "section_stacks"`). Reuse; map the toggle onto it. |
| `projectFilter: id \| null` | **New** module var. Composes on top of `viewMode`; drives the filter banner + list filtering. Client-side only. |
| `paletteOpen / reviewOpen / helpOpen / themeOpen` | Exist implicitly via `.hidden` classes + `overlayOpen()`. Keep that pattern. |
| `stagedComments: number` | Derive from `review.ts` snapshot (count of staged comments) for the `Apply (n)` label. |
| `removedSessionIds` | Exists as the optimistic-overlay mechanism (`applyPendingOverlays`). Reuse for delete. |
| `contextMenu`, `confirmDeleteId` | `menu.ts` already positions at pointer; delete-confirm via a new dialog (see §7). |

No new global state framework — all plain module vars + the existing snapshot/event flow
(`listen("sessions-updated") → applySnapshot → render*`).

---

## 4. Backend: zero work this pass (frontend-only)

**Decision:** no Rust/backend changes in this overhaul. The list-view data is already rich (liveness
`status`, `agent_state`, branch, PR fields, `has_pending_comments`, `unread`, `project_id/name`,
`current_section`, `pull_blocked`, `stacked_child`). We fill the three gaps client-side:

| Gap | Client-side approach this pass |
|---|---|
| **Project color** | Derive a stable color by hashing `project_id` into a fixed palette (the brief's example colors as the seed set). Deterministic per project, no backend. |
| **Comment count** | Backend exposes only `has_pending_comments: bool`. Render the `✎` chip **without a number** (or `✎` alone) until a count exists upstream. |
| **Stack identity/order** | **Infer client-side**: a stack = a parent row followed by its consecutive `stacked_child` rows; stack name = parent title. Backend already returns rows in stack order, so this is reliable. |

### Wishlist for `claude-commander` (future, to improve all its frontends)
Note these as upstream feature requests — they'd let GUI **and** TUI drop client-side workarounds:
- **`pending_comment_count: usize`** on the session row (replaces the boolean) → enables `✎ n`.
- **Per-project `color`** as first-class project identity (one source of truth across frontends), rather
  than each frontend hashing its own.
- **Explicit stack model** (`stack_id` / `stack_name` / `stack_order`) so stacks aren't inferred from
  row adjacency.
- (Lower priority) **`created_at` on the list-view `SessionRow`**, not just `SessionDetail`, if the
  card/list ever wants session age without a detail fetch.

---

## 5. The token layer (foundation — do first)

The existing 15 tokens already cover ~12 of the brief's roles. Strategy: **keep the current CSS
variable names** (avoids a destructive rename across 10 themes + the custom-theme JSON schema +
`docs/theming.md` + the no-flash boot in `vite.config.ts`) and **add the missing roles additively**.

### 5a. Role → existing token mapping (no new token needed)
| Brief role | Existing `--var` |
|---|---|
| `bg.crust` | `--bg-inset` |
| `surface.mantle` | `--bg-elevated` |
| `surface.base` | `--bg-base` |
| `surface0` | `--border` |
| `surface1` | `--border-strong` |
| `overlay0` / `state.stopped` | `--text-dim` |
| `subtext0` | `--text-muted` |
| `text` | `--text` |
| `accent.primary` | `--accent` |
| `accent.review` | `--info` (mauve) |
| `state.running` | `--success` |
| `state.finished` | `--warning` |
| `state.idle` | `--cyan` |
| `danger` | `--danger` |
| `welcome` / `tag.warm` | `--attention` (peach) |

### 5b. New tokens to add to every theme + custom schema
- `--surface2` (card-hover border / muted-icon hover) — Mocha `#585b70`
- `--overlay1` (secondary muted, faint icons) — Mocha `#7f849c`
- `--subtext1` (body paragraphs) — Mocha `#bac2de`
- `--accent-tool` (terminal tool-call lines, lavender) — Mocha `#b4befe`
- `--attn-blocked` (maroon `⚠`, distinct from peach `--attention`) — Mocha `#eba0ac`
- `--tag-cool` (teal) — Mocha `#94e2d5`
- **Project colors:** derived client-side by hashing `project_id` into a fixed palette (§4); not theme tokens.
- **Alpha utilities** (selection `rgba(137,180,250,.12)`, row hover `rgba(205,214,244,.045)`, faint chip
  `rgba(255,255,255,.05)`, state-chip @ ~13%): define as CSS vars derived from the base tokens where
  practical, else as documented constants. Also tokenize the currently-hardcoded `--scrim` / `--shadow`
  (add `backdrop-filter: blur(3px)` to scrims).

### 5c. Touchpoints for the new tokens
- `src/theme.ts` — add the 6 new keys to every built-in theme's `cssVars`; extend the `Theme` type doc
  and custom-theme validation so missing new keys fall back to the base theme.
- `src/style.css` `:root` — add the 6 new `--vars` with Mocha defaults.
- `docs/theming.md` + `docs/example-theme.json` — document the expanded token set.
- `vite.config.ts` no-flash boot — include new keys in the injected `:root` defaults + cached-vars replay.
- `themeModal.ts` swatch keys — unchanged unless we want richer previews.

> **Verify:** switch through all 10 themes + a custom theme + light/dark/follow-system and confirm chrome,
> xterm, and Shiki all reskin with no orphaned hardcoded color.

---

## 6. Phased delivery

Each phase is independently shippable and ends in a `npm run typecheck` + manual-verify gate.

### Phase 0 — Token layer (foundation)
- Implement §5 in full. No visual redesign yet beyond wiring the new tokens.
- **Verify:** all themes reskin; typecheck clean; existing app visually unchanged.

### Phase 1 — Navigation shell (title bar + layout switch)
- Add the **title bar** (app mark, sessions/live pill, `[Console|Board]` segmented control, `⌘K`/`◐`/`?`)
  as a 46px bar **below the native OS title bar** — native window decorations are kept (no
  `decorations: false`, no custom drag region). Move the existing theme/help/palette entry points into it.
- Introduce `layout` state + a root container that swaps Console ↔ Board subtrees. Board is a stub
  placeholder this phase. Switching layout closes any open review.
- **Verify:** toggle Console/Board; title-bar buttons open palette/theme/help; window still drags/resizes.

### Phase 2 — Console refinement
The bulk of the work; Console becomes the brief's three-column workspace.
- **Sidebar:** projects rail (all projects incl. empty, color square, count, `+`/`$` actions,
  click-to-filter toggle); `GROUP BY [Sections|Projects]` toggle bound to `viewMode`; filter banner;
  bordered **stack groups** (client-side inferred) with merge/push/resume actions; **empty-project state**;
  **footer** (status legend + commander chip). Reuse `renderSessionRow`/`updateRow`/`rowRefs` + extend
  `sidebarSignature` to include `projectFilter` and `groupBy`.
- **Status glyphs:** rework `statusGlyph()` + badges → pulsing liveness dot, `✎ n` mauve chip, `⚠` maroon,
  `⌗` mauve stack, project-color square + tag chip.
- **Center pane:** wrap the xterm container in the rounded **terminal frame** (title bar w/ traffic dots)
  and add the **powerline status line** (project / branch / edits / elapsed / state). Composer + hint line
  are chrome around the xterm-rendered surface. Tab strip restyle (active top-border accent, per-tab dot).
- **Detail pane:** reskin to the brief (collapse, metadata rows, diffstat bar, AI-summary tags,
  `± Review diff` primary + `Open PR`).
- **Verify:** project filter composes with both groupings; stacks render + actions fire; empty project shows
  CTA; powerline reflects live data; detail diffstat/summary correct.

### Phase 3 — Shared overlays
- **Command palette:** restyle to spec (blurred scrim, `⌘`+placeholder+`esc` header, Sessions + Commands
  sections). Keep `palette.ts` provider model + fuzzy `score()`.
- **Code-review overlay:** inline comment **bubbles** ("you" + "staged", mauve border), `Apply (n)` count
  driven by staged comments, click-line/shift-range staging. Keep `review.ts` invoke flow
  (`open_review`/`create_comment`/`delete_comment`/`apply_comments`).
- **Context menu:** rebuild the session menu items to the brief (Attach · Open shell · Review diff ·
  Rename… · Restart · Restart fresh · **Kill — stop process** (yellow) · **Delete session…** (red)).
  Reuse `menu.ts` positioning. Make Kill (stop, keep) and Delete (remove entirely) distinct actions.
- **Delete confirmation:** new centered dialog (red `⌦`, session name, branch-deletion warning,
  Cancel / `Delete session`). Build on the `toast.ts` confirm primitive or a dedicated dialog; on confirm,
  route through the optimistic-overlay removal so it disappears from **both** Console and Board.
- **Theme picker:** convert `themeModal.ts` from centered modal to a **top-right anchored popover** with
  swatch rows + follow-system toggle + live preview.
- **Help overlay:** two-column keyboard grid; keep `help.ts` + update `HELP_SECTIONS` and `README.md`
  per repo convention.
- **Verify:** each overlay opens/closes via scrim+Esc; review Apply round-trips; delete removes everywhere
  and advances the active tab; Kill ≠ Delete.

### Phase 4 — Board layout
- **Filter bar:** `All / Needs review / Running / Blocked` pills + search + `＋ New session`.
- **Columns:** one per project (incl. empty), header (color square + name + count + `+`/`$`).
- **Agent cards:** top accent bar in state color, header (dot + name + state pill + `⋯`), 2-line mini
  terminal preview, diffstat bar + counts, footer chips (`✎ n`, `⚠`) + quick actions (attach / review).
- **Dock:** bottom compact live terminal of the attached session (reuse a terminal entry; expand/close).
- Board shares the session/project data + selection + context menu + review/delete flows with Console.
- **Verify:** cards reflect live state; filters work; attach docks a real terminal; delete recounts columns.

### Phase 5 — Motion & polish
- Pulsing running dots (~1.8s), blinking cursor chrome (~1.1s), overlay fade/slide-in (~0.12–0.14s),
  scrim blur, shadow tiers (terminal/popover/dialog). Spacing/radii audit against §Design Tokens.
- **Verify:** animations match the brief; no layout shift; respects reduced-motion if present.

---

## 7. Decisions (confirmed)

1. **Native window decorations kept.** The title bar is a 46px bar *below* the OS title bar — no
   `decorations: false`, no custom drag region. Avoids cross-platform window-control complexity.
2. **Token names kept + extended.** Reuse existing `--var` names, add the 6 new roles additively (§5).
   No churn to the 10 themes, custom-theme schema, docs, or no-flash boot.
3. **Zero backend work.** Client-side color hashing, `✎` without a count, client-side stack inference (§4).
   Upstream `claude-commander` wishlist captured for a future pass.
4. **Board is in scope now.** Both layouts ship in this effort (Phases 0–5).

### Remaining watch-items (not blockers)
- **Stack inference fragility** — if row-adjacency inference produces wrong groupings in edge cases
  (e.g. interleaved sections), revisit and consider the upstream explicit stack model.
- **Powerline data** — `branch`/`status` exist; `edits`/`elapsed` may need deriving from `diff_stat` +
  `created_at` (detail-only today). Confirm what's renderable before committing the powerline spec.

---

## 8. Definition of done

- Both layouts match the brief at high fidelity, expressed entirely through semantic tokens.
- All 10 themes + custom + light/dark/follow-system reskin chrome, xterm, and Shiki together.
- Every existing capability preserved (real PTYs, real diffs, review apply, grouping, cascade, commander).
- `npm run typecheck` + `cargo fmt`/`cargo clippy` clean; `HELP_SECTIONS` + `README.md` keyboard table updated.
- No remaining hardcoded Mocha hex in chrome/xterm/Shiki.
