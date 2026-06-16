# Drag-and-drop: move a session to a section

## Goal

Let a user move a session into a section by **dragging its sidebar row onto a
section header**, in addition to the existing right-click "Move to section: X"
context menu. Frictionless, direct-manipulation alternative to the menu.

## Scope & invariants

- **Section view modes only.** Section headers exist in the DOM only when the
  sidebar renders via `renderSections()` (`SectionGrouped` / `SectionStacks`).
  In project view there are no section drop targets, so DnD is inert there — no
  special handling needed.
- **Project membership never changes.** The only effect is a section
  pin/reassign. This is guaranteed by the backend: the move reuses the existing
  `move_to_section` command (`groups.rs:278-303`), which calls
  `place_created_session` / `clear_override_and_reassign` and never touches
  `project_id`. We add **no** new backend code.
- **Sections are global**, so a section bucket can hold sessions from multiple
  projects — dropping session A (project Foo) into "Review" is valid and leaves
  A in Foo. No cross-project validation is required because crossing projects is
  not representable in this gesture.
- **No new dependencies, no framework.** Native HTML5 drag, matching the
  existing tab drag-reorder pattern (`main.ts:405-416`, `257-263`).

## Non-goals

- Reordering sessions within a section (sections are predicate/pin-driven, not
  manually ordered).
- Drag in project view, or dragging onto project headers.
- Reparenting a session to another project.
- Dragging onto collapsed section headers expanding them (nice-to-have, see
  Open questions).

## Backend

**No changes.** Reuse `move_to_section(id, section: Option<String>)`. Drop onto
a section header → `invoke("move_to_section", { id, section: bucket.name })`.

## Frontend changes (`src/main.ts`)

All changes are localized to session-row creation, section-header creation, and
a small module-level drag-state variable + handlers, mirroring the tab-drag code.

### 1. Drag state

Add alongside the existing `draggingTab`:

```ts
let draggingSessionId: string | null = null;
```

### 2. Make session rows draggable (`renderSessionRow`, ~`main.ts:1177`)

- Tag the row with its id so the drop handler can read it without a `rowRefs`
  reverse lookup: `row.dataset.id = s.id;`
- **Skip draggable in rename mode.** `renderSessionRow` already early-returns a
  non-interactive row when `renamingId === s.id` (`main.ts:1188-1192`); leave
  `draggable` unset in that branch. `draggable=true` suppresses native text
  selection inside the rename `<input>` in some engines, so the early return is
  the clean place to avoid it. Set `row.draggable = true` only on the normal path.
- `dragstart`: set state and **guard `dataTransfer`** exactly like the tab
  handler (`main.ts:410`):
  ```ts
  row.addEventListener("dragstart", (e) => {
    draggingSessionId = s.id;
    row.classList.add("dragging");
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  });
  ```
  (The non-null `e.dataTransfer!` is unsound — synthetic `DragEvent`s in the
  iwft tests have `dataTransfer === null` and would throw.)
- `dragend`: `draggingSessionId = null; row.classList.remove("dragging");` and
  clear any lingering `.drop-target` highlight on headers.

Guard: only meaningful in section view, but making rows draggable on the normal
path is harmless — `draggingSessionId` is only ever consumed by the
section-header drop handler, which only exists in `renderSections`.

### 3. Make section headers drop targets (`renderSections`, ~`main.ts:1384`)

For each `header` (the `.project-header` div), when building the bucket:

- `header.dataset.section = bucket.name;`
- `dragover`: if `draggingSessionId` is set, `e.preventDefault()` (enables drop),
  guard `if (e.dataTransfer) e.dataTransfer.dropEffect = "move"`, add a
  `drop-target` highlight class. (Same `dataTransfer` guard as above.)
- `dragleave`: remove the `drop-target` class.
- The header also has a `click` collapse-toggle from `makeCollapsible`
  (`main.ts:760-768`); native `drop` does not synthesize a `click`, so a drop
  won't accidentally collapse the section — no conflict.
- `drop`: compute the target from the bucket **index** (see §4 for the index-0
  rule), not just `bucket.name`:
  ```ts
  header.addEventListener("drop", (e) => {
    if (!draggingSessionId) return;
    e.preventDefault();
    header.classList.remove("drop-target");
    const id = draggingSessionId;
    // buckets[0] is always the reserved "In Progress" catch-all (library invariant, §4).
    const target = bucketIndex === 0 ? null : bucket.name;
    const current = findSession(id)?.current_section ?? null;
    if (current === target) return;            // no-op drop
    void lifecycleArgs("move_to_section", { id, section: target });
  });
  ```

`lifecycleArgs` (`main.ts:910`) already does the `invoke` + error toast +
`refreshNow()`, which re-renders the sidebar and moves the row into its new
bucket. No optimistic DOM mutation needed — the refresh is the source of truth.

### 4. "In Progress" / unpinned drop target — clear the pin

Dropping onto the implicit default bucket clears the session's pin by passing
`section: null` to `move_to_section`.

**Detection (no backend change):** the library guarantees the default catch-all
is **always bucket index 0**, named with the reserved constant
`IN_PROGRESS = "In Progress"` (`claude-commander` `session/section.rs:179`,
`build_sections` at `section.rs:198-227` — *"In Progress is always returned
first"*). `groups.rs` preserves that order into the `sections` array, so in
`renderSections(buckets)` the bucket at `index === 0` is the default.

The `drop` handler computes `target = bucketIndex === 0 ? null : bucket.name`
(shown in §3). `renderSections` already iterates `for (const bucket of buckets)`
— switch to an indexed loop (or `.entries()`) so the handler can read
`bucketIndex`. Passing `null` (not the string `"In Progress"`) is required:
`place_created_session` no-ops on `name == IN_PROGRESS` (`section.rs:321-323`),
so only the `null` → `clear_override_and_reassign` path actually clears the pin.

**Predicate bounce-back (known, acceptable):** dropping a session onto In
Progress clears its pin and **re-runs the predicate scan**
(`clear_override_and_reassign` → `apply_assignment`). If the session still
matches a predicate section (e.g. its PR matches "Review"), it is immediately
re-assigned there and the drop appears to do nothing. This is identical to the
existing "Clear section pin" menu item's behavior (`main.ts:1112-1116`) and is
correct at the library level. Consider a toast when a clear-pin drop results in
no net section change, so the gesture isn't silently inert. Not a blocker.

Edge: a user could *configure* a section literally named "In Progress",
producing two buckets with that name; the library itself doesn't guard this
degenerate case, and using the index (not the name) means we still behave
correctly — index 0 is the catch-all, the configured one sits at its declared
index and pins by name like any other.

## Styling (`src/style.css`)

Add a drop-target affordance on section headers, using tokens that **actually
exist** in `style.css` (verified — there is no `--surface-hover`; rows hover to
`var(--border)` at `style.css:150-151`, `--accent` exists at `style.css:39`):

```css
.project-header.drop-target {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  background: var(--border); /* the existing hover background */
}
```

For the dragged row, reuse the tab pattern `.tab.dragging { opacity: 0.5; }`
(`style.css:819-821`) — add `.session-row.dragging { opacity: 0.5; }`.

## UX details

- **Cursor / dropEffect:** `move`, so the OS shows the move cursor.
- **Invalid targets:** anything that isn't a section header never calls
  `preventDefault` on dragover, so the browser shows "no-drop" and `drop` won't
  fire — no validation code needed.
- **Drop on current section:** early-return no-op (no backend call, no toast).
- **Collapsed sections:** headers still render when collapsed
  (`renderSections` appends the header then `continue`s), so they remain valid
  drop targets — dropping pins the session even though the bucket is collapsed.
- **Re-render race:** a background poll refresh (~2s) can fire mid-drag;
  `renderSidebar` rebuilds via `rowRefs.clear()` + `sessionsEl.innerHTML = ""`
  (`main.ts:1429-1431`), destroying the dragged node so the drag aborts and
  `dragend` may not fire. `draggingSessionId` is module-level and survives that,
  but a stale value only matters if a `drop` later fires (which needs a live
  header). As cheap insurance, clear `draggingSessionId = null` at the top of
  `renderSidebar`'s rebuild path.

## Discoverability

Drag is not self-advertising. Update:
- `src/help.ts` `HELP_SECTIONS` — add a line under the sidebar/section section
  ("Drag a session onto a section header to move it").
- `README.md` keyboard/interaction table — same note (per CLAUDE.md convention).

## Testing (per repo testing setup — Vitest units + `.iwft`)

**Prerequisite — extend `TauriSimulator`** (`src/playwright/iwft/network/
TauriSimulator.testHelper.ts`). Today it has no `move_to_section` case
(unhandled commands warn + return `null`, ~lines 158-162) and `get_groups`
returns a **static** snapshot whose `sections` buckets never recompute (~lines
100-101). The state-asserting tests below therefore require new fake code:
- add a `move_to_section` handler that mutates the target session's
  `current_section` (`Some(name)` or `None`), and
- rebuild the snapshot's `sections` buckets from `current_section`, replicating
  the index-0 In-Progress + declared-order placement the Rust does.

This is real work, not free. (Alternative: scope the iwft assertions down to the
invoke payload and cover bucket re-placement in a Vitest unit against a small
`build_sections`-style helper.)

- **iwft (whole-frontend, simulated Tauri):**
  - Enter section view → drag a session row onto another section header →
    assert `move_to_section` invoked with `{ id, section }` and the row appears
    under the new bucket after refresh.
  - Drop onto the session's current section → assert **no** `move_to_section`
    invoke.
  - Drop a pinned (non-predicate) session onto the index-0 "In Progress" bucket
    → assert `move_to_section` invoked with `section: null` and the row moves to
    the top bucket.
  - Note: synthetic `DragEvent`s carry `dataTransfer === null` (see
    `terminal.iwft.ts:133-143`); the guarded handlers must not touch it
    unconditionally.
- Fake-over-mock: assert the resulting section-assignment **state** in the
  rebuilt snapshot, not invoke call counts.

## Verification checklist

1. `npm run typecheck` passes.
2. `npm run tauri dev`: in section view, drag a session onto a different
   section header → it moves; project unchanged (project name in row label is
   the same).
3. Project view: dragging a row does nothing (no drop targets) — no errors.
4. Right-click "Move to section" still works (unchanged path).
5. iwft + unit suites green.

## Open questions

1. ~~Default/unpinned bucket detection~~ — **Resolved.** Default is always
   bucket index 0 ("In Progress", library invariant); drop there → `section:
   null`. See section 4. No backend change.
2. **Auto-expand on hover:** expand a collapsed section when a drag hovers its
   header for ~500ms? Deferring as a nice-to-have unless wanted in v1.
3. **`SectionStacks` view:** same header DOM (`renderSections`), so it should
   work identically — confirm there's no stack-specific placement constraint in
   the library that would reject a manual pin.
