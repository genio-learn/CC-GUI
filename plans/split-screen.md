# Multi-pane console view (split screen)

## Goal

In **console view**, let a user show up to **4 terminals at once** by dragging a
tab into one of four quadrant drop zones (top-left / top-right / bottom-left /
bottom-right). While dragging, a themed **overlay preview** highlights the
quadrant the pane will land in. The default two-pane result is a **vertical
split** (left / right). Panes are resizable via draggable dividers.

The single-pane experience (today's behaviour) is the degenerate 1-pane case and
must be unchanged when the user never splits.

## Hard constraint that shapes the whole design

**One PTY per tmux session** (`src-tauri/src/pty.rs:25-28`, `attach` at `:67-157`
evicts any prior PTY for the same session key). A session therefore has exactly
one live xterm (`terminals` Map keyed by session name, `main.ts:189`) and can be
visible in **exactly one pane at a time**. "Splitting" never duplicates a
session — it *moves/shows different sessions* in different panes. Dropping a tab
into a quadrant that already holds another session **replaces** it (the displaced
session reverts to tab-only / parked). No backend change is needed or wanted.

## Layout model: columns-of-stacks (the key decision)

The four corners are **not** a free 2×2 grid. A free grid produces unresolvable
L-shapes (e.g. TL spanning two rows while BR wants to span two columns — they
fight over the bottom-left cell). Instead the layout is **up to two columns, each
an independent stack of up to two rows**:

```
left column  = [TL, BL]     right column = [TR, BR]
```

Rendering rules (all cases resolve cleanly, no conflicts):

- **Columns present** = which of {left, right} hold ≥1 pane → 1 or 2 columns.
- **Rows within a column** = which of its two slots are filled → 1 or 2 rows.
- An empty column collapses (the other takes full width); a lone pane in a
  column takes that column's full height.

Every reachable configuration:

| Filled slots        | Result                                            |
|---------------------|---------------------------------------------------|
| TL                  | single pane, full area (today's behaviour)        |
| TL, TR              | **vertical split** (two full-height columns) ← default 2-pane |
| TL, BL              | horizontal split (one column, two rows)           |
| TL, TR, BR          | left column full height; right column split in two |
| TL, BL, TR          | left column split in two; right column full height |
| TL, TR, BL, BR      | full 2×2                                           |

Dropping into a corner picks a **(column, vertical-slot)**; empty siblings
collapse. Drop into BR with only TL present → right column has one pane (BR) →
it fills the whole right column: a vertical split. This is why "one in each
corner" and "default vertical split of 2" are consistent.

### State

```ts
type Slot = "TL" | "TR" | "BL" | "BR";
// module-level, in main.ts alongside `terminals`
const panes = new Map<Slot, string>();   // slot -> tmux session name
let focusedSlot: Slot | null = null;      // which pane has keyboard focus
// ratios (0..1), persisted:
let colRatio = 0.5;      // left column width fraction
let leftRowRatio = 0.5;  // TL height fraction within left column
let rightRowRatio = 0.5; // TR height fraction within right column
```

`panes.size === 0` (or 1) ⇒ single-pane mode; ≥2 ⇒ split mode. Single-pane keeps
using the existing active-terminal path; split mode is opt-in and additive.

## Non-goals (v1)

- More than 4 panes, or arbitrary nested/tiled trees. Two columns × two rows only.
- Splitting in **board mode** (board already has its own multi-terminal dock).
  Split is console-view-only. See "Board mode interaction".
- Per-pane tab strips. The **single shared tab bar** stays the full session list.
- Showing the same session in two panes (impossible — one PTY per session).
- Merging/moving panes by keyboard. Drag + a pane close button cover v1.

## Backend

**No changes.** All rendering, mounting and resizing is frontend. `resize_pty`
(`pty.rs:174-193`) already takes rows/cols only (pixels hardcoded to 0), so each
pane just does the existing `fit.fit()` → read `term.rows/cols` →
`invoke("resize_pty", …)` dance (as `refitActive` does at `main.ts:550-560`).

## Frontend

All work is in `src/main.ts` (terminals section `:176-621`), `src/style.css`
(terminal pane `:2196-2330`), and a small new splitter helper. No new deps; native
HTML5 drag, reusing the tab-drag pattern (`main.ts:248-326`).

### 1. Unify terminal mounting into pane cells (refactor)

Today `.term-container`s are stacked absolutely (`position:absolute; inset:4px`)
inside `#terminals` and only `.active` is shown (`style.css:2298-2312`). Board
mode already proves the re-parenting trick: it physically `appendChild`s the same
container node into `#board-dock-surface` (`dockActiveTerminal`, `main.ts:595-611`).

Generalize that into a **mount** concept — a container lives in exactly one host:

- `#terminals` holds a **grid of pane cells** (`.pane`, `position:relative`), 1–4
  of them. `.term-container` keeps `position:absolute; inset:4px` and fills
  whichever `.pane` (or the board dock) currently hosts it — identical to how it
  fills the dock today, so the CSS barely changes.
- Sessions **not** currently in a pane are **parked** in a hidden
  `#term-parking { display:none }` div (their PTY keeps streaming into the
  offscreen xterm, exactly as hidden `.term-container`s do today).
- Single-pane mode = a 1-cell grid. This replaces "stacked + toggle `.active`"
  with "grid of cells + park the rest", unifying the code path.

New helpers (mirroring `dockActiveTerminal`):

```ts
function mountInPane(name: string, slot: Slot): void  // move container into cell[slot]
function parkTerminal(name: string): void             // move container into #term-parking
function renderPanes(): void                           // rebuild grid tracks + cells, (re)mount, refit
```

`activateTerminal` (`:200-229`) becomes: in single-pane mode, park all but the
target and mount it in the sole cell (same visible result as today); in split
mode, if the session is already in a pane just focus it, else load it into the
focused pane (replace), park the displaced one.

### 2. Grid tracks (CSS, driven by ratios)

`#terminals` gains a `split` class in split mode:

```css
#terminals.split {
  display: grid;
  gap: 4px;
  /* columns/rows set inline from ratios via style.setProperty */
}
.pane { position: relative; min-width: 0; min-height: 0; }
```

`renderPanes` computes `grid-template-columns` / per-column row templates from the
present slots and the ratios (`colRatio`, `leftRowRatio`, `rightRowRatio`), placing
each `.pane` and setting `grid-column`/`grid-row`. Because columns are independent
stacks, a column with one pane just uses a single full-height row — no spanning
math, no L-shape conflicts.

### 3. Quadrant drag + themed overlay preview

Tabs are already `draggable="true"` with a live `draggingTab` module var
(`main.ts:254`, dragstart/dragend at `:491-506`). Add a drop surface over
`#terminals`:

- A `.split-drop-overlay` element absolutely covering `#terminals`,
  `pointer-events:none`, hidden by default, with four quadrant child divs
  (`.dz.tl/.tr/.bl/.br`). It only renders a highlight; it must never intercept the
  drag (the `dragover` listener lives on `#terminals`, not the overlay).
- On `#terminals` `dragover` **when `draggingTab` is set**: `preventDefault()`
  (enables drop), compute the quadrant from the cursor vs. the element's
  `getBoundingClientRect` midpoints (x<mid → left, y<mid → top), show the overlay,
  and highlight the hovered quadrant's `.dz`.
- On `drop`: read `draggingTab`, map quadrant → `Slot`, assign
  `panes.set(slot, name)` (vacating any prior slot that held `name`; replacing any
  session already in `slot` by parking it), then `renderPanes()` + focus the slot.
- On `dragleave`/`dragend`: hide the overlay.

**Overlay styling** follows the established drag idiom (`--accent` +
`color-mix`, as tab/board drop markers do at `style.css:2262-2268`, `:348-354`):

```css
.split-drop-overlay { position:absolute; inset:0; z-index:5; display:none;
  pointer-events:none; }
.split-drop-overlay.active { display:grid; grid-template:1fr 1fr / 1fr 1fr; gap:4px; }
.dz { border-radius:10px; transition:background .08s; }
.dz.hot {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
```

No conflict with the existing tab-reorder drag: that drops on the **tab bar**
(`#tabs`), this drops on **`#terminals`**. Different targets.

**Guard `dataTransfer`** exactly as the existing handlers do (`main.ts:410`;
synthetic `DragEvent`s in iwft tests have `dataTransfer === null`) —
`if (e.dataTransfer) …`, never `e.dataTransfer!`.

### 4. Focus, pane chrome, tab↔pane behaviour

- **Focused pane**: click a pane → `focusedSlot = slot`, `term.focus()`, and a
  themed focus ring on that `.pane` (`outline: 2px solid var(--accent)` /
  `inset` shadow). Keyboard input already routes to the focused xterm.
- **Pane header** (split mode only; single-pane shows no header, unchanged): a
  slim bar per pane with the session glyph+title and a **"×" that removes the pane
  from the split** (parks the session, keeps it alive and in the tab bar) — this
  is distinct from the tab-strip `.tab-close` which *kills* the session. Doubles as
  a drag handle to move a pane to another quadrant later.
- **Tab click** (`activateTerminal`): if the session is in a visible pane → focus
  that pane; else load it into the focused pane (or the sole pane in single mode) —
  replacing that pane's session. `Cmd+1..9` and `cycleTab` (`:647-658`) follow the
  same rule.
- **Un-split**: when `panes.size` drops to ≤1, leave split mode (remove
  `#terminals.split`, one full cell) — the natural result of removing panes.
- Optional tab affordance: mark tabs whose session is currently in a pane (a small
  dot or subtle outline) so it's clear what's on screen. Nice-to-have.

### 5. Resizable dividers

Between the two columns, and between the two rows *within* each 2-row column,
place draggable dividers. `src/resize.ts`'s `makeResizable` resizes a single
panel's edge in px and isn't a drop-in for a **ratio between two siblings**, so add
a small helper (either extend `resize.ts` or a new `splitDivider`):

```ts
// drag updates a 0..1 ratio, clamps to [0.15, 0.85], writes the grid track vars,
// throttles a refit, persists to localStorage. Mirrors resize.ts ergonomics:
// body.resizing cursor, accent hover tint (style.css:1863-1905).
```

Three ratios: `colRatio`, `leftRowRatio`, `rightRowRatio`. Persist keys
`cc-split-col`, `cc-split-rows-l`, `cc-split-rows-r`.

### 6. Refit every visible pane on any size change

`refitActive` (`:550-560`) only refits the active terminal. In split mode every
visible pane must refit + `resize_pty` on: entering/leaving split, divider drag,
window resize, sidebar/detail resize, and mount/park.

Cleanest mechanism: attach a **`ResizeObserver`** to each `.pane` cell that
debounced-calls `fit.fit()` → `resize_pty` for that pane's terminal. This subsumes
window/divider/panel-resize handling for panes with one code path. Keep
`refitActive` for the single-pane path (or route single-pane through the same
observer). Flag: introducing `ResizeObserver` is new; verify it plays with the
existing `window.resize` → `refitActive` call (`:623-625`) without double-fitting.

### 7. Board mode interaction

Board mode (`setLayout`, `main.ts:2328-2346`) docks the active terminal into
`#board-dock-surface`. Split is **console-only**. On entering board: park all
panes, dock the focused pane's terminal (existing dock logic). On returning to
console: `renderPanes()` restores the split (re-mount each slot's container).
Split state lives in the module vars, so it survives the toggle; `setLayout` just
parks/restores.

### 8. Persistence

Persist the slot→session mapping and ratios to localStorage (`cc-split-layout`).
On boot, after sessions load, reconcile: drop any slot whose session no longer
exists; if <1 valid slot remains, fall back to single-pane. **v1 may ship ratios-
only persistence and keep the slot mapping ephemeral** (per app run) to reduce
reconciliation risk — decide during implementation. Non-blocking either way.

## CSS summary (`src/style.css`)

- `#terminals.split` grid; `.pane` (relative, min-w/h:0); `.pane.focused` accent
  ring; slim `.pane-header` + its remove-`×`.
- `.split-drop-overlay` + `.dz` / `.dz.hot` (accent color-mix, per §3).
- `.split-divider` (reuse `.panel-resizer` look, `:1863-1905`): accent hover tint,
  `body.resizing` cursor.
- `.term-container` keeps `position:absolute; inset:4px` — now fills a `.pane`
  instead of only the stacked context; `.term-container.active` display toggle is
  superseded by park/mount (audit its remaining users).

## Discoverability (per CLAUDE.md convention)

- `src/help.ts` `HELP_SECTIONS`: add "Drag a tab into a corner of the terminal
  area to split; drag out or ✕ the pane header to un-split."
- `README.md` keyboard/interaction table: same note.

## Testing (Vitest units + `.iwft`, per `plans/testing.md`)

`TauriSimulator` already handles `attach`/`write_pty`/`resize_pty`/`detach` for
the terminal iwft (`terminal.iwft.ts`). Synthetic `DragEvent`s carry
`dataTransfer === null` (see `terminal.iwft.ts:133-143`) — the guarded handlers
must tolerate that.

- **Unit** (pure, no DOM): the layout resolver — given a set of filled slots,
  assert the computed columns/rows/placement (the table above). This is the
  highest-value test and needs no Tauri.
- **iwft (whole-frontend):**
  - Attach two sessions → drag tab B into the right half of `#terminals` → assert
    two `.pane`s render, B in the right column, both terminals attached, and
    `resize_pty` invoked for both.
  - Drag a third into a bottom quadrant → assert the columns-of-stacks placement.
  - Drop a tab onto a quadrant already holding a session → assert replace (old
    session parked, still alive — no `detach`).
  - Remove a pane via its header ✕ → assert the session is parked (no `detach`/no
    kill) and, when one remains, split mode exits.
  - Drag preview: on `dragover` assert the overlay shows and the correct `.dz` is
    `.hot` for cursor positions in each quadrant.
- **Fake-over-mock**: assert resulting pane **state** (which session is in which
  slot, alive vs parked), not invoke call counts.

## Verification checklist

1. `npm run typecheck` + `cargo fmt`/`clippy` pass (backend untouched, so clippy is
   a no-op sanity check).
2. `npm run tauri dev`: never splitting behaves exactly as today (single pane,
   tab switching, Cmd+W, board toggle).
3. Drag a tab right → vertical split of 2; both terminals live and correctly sized;
   type in each.
4. Fill all four corners; drag dividers; resize the window → every pane refits, no
   stale grid, no PTY size drift (`ls`/`clear` reflow correctly).
5. Overlay preview shows the themed accent highlight in the right quadrant and
   reskins with the theme (switch theme mid-drag concept: check a couple themes).
6. Remove panes back to one → returns to single view; sessions removed from split
   are still running (visible again when clicked).
7. Enter board mode with a split active → returns cleanly; back to console restores
   the split.
8. iwft + unit suites green.

## Suggested phasing (each independently shippable / reviewable)

0. **Mount refactor** — unify container mounting (grid-of-cells, park/mount,
   single-pane = 1 cell). No user-visible change. Verify single + board unchanged.
1. **Data model + render** — `panes`, `renderPanes`, grid tracks, columns-of-
   stacks resolver (+ unit test). Drive via a temporary programmatic call to prove
   layouts.
2. **Quadrant drag + themed overlay + drop assignment** (the headline feature).
3. **Focus + pane chrome + tab↔pane click behaviour + un-split**.
4. **Dividers + ResizeObserver refit + persistence**.
5. **Board interaction, help/README, iwft coverage**.

## Resolved decisions (2026-07-02) & what shipped

1. **Persistence** — ratios only (`cc-split-col`, `cc-split-rows-l`,
   `cc-split-rows-r`). Slot→session mapping is ephemeral; the app boots
   single-pane.
2. **Occupied quadrant** — dragging a **parked tab** onto an occupied slot
   **replaces** it (the occupant parks, stays alive as a tab); the same replace
   happens when a click/`Cmd+n` loads a session into the focused pane. Dragging
   one **visible pane** onto another visible pane **swaps** the two (neither is
   evicted).
3. **On-screen tabs** — marked per quadrant: TL=`--accent` (blue), TR=
   `--attention` (peach), BL=`--success` (green), BR=`--info` (mauve). The pane
   ring, the drop-zone preview, and the tab top-border all share the slot colour
   (`.tab.in-pane` + `--pane-color`).
4. **Refit** — a single `ResizeObserver` over the pane cells. No double-fit issue
   observed (the `window.resize`→`refitActive` path only touches the focused
   pane; the observer covers the rest).

### Deviations from the draft above

- **Layout is nested flexbox**, not CSS grid — dividers are just flex items
  between panes, which is far simpler than grid + gutters.
- **Board mode collapses the split** (keeping the focused pane) rather than
  restoring it on return. Split is torn down in `setLayout` while the DOM is
  still in console layout, so board/console stay fully independent. Restoring a
  split across a board round-trip is a future nice-to-have.
- **No separate pure resolver unit** — the columns-of-stacks placement lives in
  `renderPanes` and is covered by the iwft DOM assertions instead.
- Building a **third/fourth pane requires dragging** each extra tab into a
  quadrant; a plain tab click loads into the *focused* pane (panes are a viewport
  over the shared tab bar).
