# Testing plan — CC-GUI

Status: ✅ **complete** — all 4 roadmap steps DONE & green. Vitest units + .iwft (7 surfaces) + CI workflow, all committed on the `tests` branch.
**Optional follow-ups:** `data-test` attribute rollout (POMs currently select existing ids/classes); deeper terminal/PTY coverage.
Run: `npm test` (52 unit/spike) · `npm run test-iwft` (41 scenarios). CI: `.github/workflows/tests.yml`. Owner: GUI. Last updated: 2026-06-14.

## Goal

Stand up automated testing for the CC-GUI frontend, modelled on the
`~/Code/Genio/genio` convention the team already uses:

- **Vitest unit tests** for pure logic islands.
- **`.iwft` (Isolated Whole Frontend Tests)** — the whole frontend booted in a
  real browser with the backend *simulated*, driven through class-based Page
  Objects. This is the genio `frontend/*/src/playwright/iwft` pattern.

We are **not** adding real end-to-end tests against the packaged Tauri app:
true Tauri E2E needs `tauri-driver` + a WebKit WebDriver, which doesn't exist on
macOS. The `.iwft` layer (Vite frontend + simulated backend) is our top tier.

## Current state

Zero tests, zero tooling. Quality gates today are `tsc --strict` and the Vite
build. Stack: Tauri 2 + **vanilla TypeScript** (no framework), Vite-served
frontend. Backend interaction crosses the Tauri `invoke()` IPC boundary (28
commands invoked from the frontend, of ~39 registered handlers) **plus a
push-based event channel** — the backend `emit`s and the frontend `listen`s:
- `get_groups` — the *only* snapshot read; called once at boot (`main.ts:716,1657`).
- `listen<Snapshot>("sessions-updated")` (`main.ts:1655`) — every subsequent
  snapshot update is **pushed** from the backend (`groups.rs:365`). There is **no
  `get_snapshot` / polling** of the sidebar.
- `listen("config-updated")` (`main.ts:1644`, emitted `groups.rs:326`).
- `listen<{session,ended}>("pty-exit")` (`main.ts:531`, emitted `pty.rs:146`) —
  signals a PTY ended; **distinct from** the PTY byte `Channel`.
- The PTY `Channel<number[]>` (`main.ts:314`, `pty.rs:71`) carries terminal
  output bytes.

## Two architectural facts that shape everything

1. **Modules run side effects at import time.** `review.ts` does
   `document.querySelector("#review")!` at module top level — it *throws on
   import* unless the full `index.html` skeleton exists. `palette.ts`,
   `settings.ts`, `help.ts`, `menu.ts`, `themeModal.ts`, `toast.ts` all build
   overlays and `document.body.appendChild` on import. → Most behaviour can only
   be exercised against a real DOM, which is what pushes the bulk of coverage
   into the `.iwft` layer rather than unit tests.

2. **`invoke()` + the event channel are the backend seam.** Stateful reads/writes
   are `invoke("cmd", args)` from `@tauri-apps/api/core`; **but the sidebar is
   reactive via pushed events**, not invoke return values. A fake backend must
   therefore (a) answer `invoke`, (b) **emit `sessions-updated` after any mutating
   command** so the UI re-renders, and (c) be able to fire `config-updated` /
   `pty-exit` and stream the PTY `Channel`. `mockIPC` answers (a); (b)/(c) need an
   event shim — see the spike below.

## How genio does `.iwft`, and the one adaptation we need

genio (`frontend/admin`, `frontend/account`, …) is **React**, so its `.iwft`
mounts `<App/>` via `@playwright/experimental-ct-react`'s `mount`, then
intercepts the backend with a stateful **`BackendSimulator`** that registers
Playwright `page.route(...)` HTTP handlers. POMs are class-based
`*PageObject.testHelper.ts` files selecting on a `data-test` attribute
(`testIdAttribute: 'data-test'`). Fixtures (`test.extend`) inject the simulator
and page objects so tests read `test('…', async ({ homePage }) => …)`. Scenarios
are `*.iwft.ts`, run via `playwright test -c playwright-ct.config.ts`.

**The adaptation for CC-GUI:**

| genio (React)                                   | CC-GUI (vanilla + Tauri)                                              |
|-------------------------------------------------|----------------------------------------------------------------------|
| CT `mount(<App/>)`                              | No component to mount → boot real `index.html` via Vite `webServer` + `page.goto('/')` |
| `BackendSimulator.handleNetworking` via `page.route` (HTTP) | **`TauriSimulator`** injected via `page.addInitScript`, intercepting `invoke`/`Channel`/`listen` with `@tauri-apps/api/mocks` `mockIPC` |
| `experimental-ct-react`                         | plain `@playwright/test` (no CT adapter exists for vanilla)          |

**Everything else stays identical to genio:** directory layout, `.iwft.ts` /
`*PageObject.testHelper.ts` / `.testHelper.ts` naming, `data-test` selectors,
class-based POMs with `step()` helpers, fixture-injected page objects, a
stateful simulator seeded per test.

The one new piece of real design work is the **`TauriSimulator`** (below).

## Directory layout (mirrors genio)

```
src/
  playwright/
    iwft/
      scenarios/        # *.iwft.ts — the tests, grouped by surface
        review/
        sidebar/
        palette/
        theme/
        settings/
      support/
        fixture.testHelper.ts      # test.extend: tauriSimulator + page objects
        launchApp.testHelper.ts    # goto('/') + install simulator + wait for boot
      network/
        TauriSimulator.testHelper.ts   # stateful fake of the invoke surface
        seed.testHelper.ts             # default Snapshot / ReviewSnapshot / Config seeds
    pageObjects/        # *PageObject.testHelper.ts — shared, class-based
      AppPageObject.testHelper.ts      # base: step(), click(), expectVisible()…
      SidebarPageObject.testHelper.ts
      ReviewPanePageObject.testHelper.ts
      PalettePageObject.testHelper.ts
      ThemePickerPageObject.testHelper.ts
      SettingsModalPageObject.testHelper.ts
  __tests__/ or *.test.ts           # Vitest unit tests, colocated next to source
playwright-ct.config.ts             # the .iwft config (name kept for genio parity)
vitest.config.ts
```

Scripts (genio parity):
- `"test"`: `vitest run`
- `"test-iwft"`: `playwright test -c playwright-ct.config.ts`

## The `TauriSimulator` (the key new component)

**Fake, not mock.** The `TauriSimulator` is a *fake*: a working in-memory
implementation of the backend with real behaviour (seed state → drive the app →
assert on resulting state), like genio's `BackendSimulator`. It is **not** a mock
— we do not preset call expectations and verify interactions. The word `mockIPC`
below is just the name of Tauri's library function (`@tauri-apps/api/mocks`) that
swaps the IPC transport in-page; it's the *seam we hang the fake on*, not a
behavioural mock. Prefer state-based assertions throughout; reserve
interaction/payload checks for Layer-1 unit tests.

A stateful, in-page fake of the command surface **and the event channel**,
installed before app boot via `page.addInitScript`. It uses Tauri's official
`mockIPC(handler, { shouldMockEvents: true })` to route every `invoke(cmd, args)`
to an in-memory handler keyed by command name **and** wire the event plugin (spike
confirmed — see above). Snapshot pushes go through `emit("sessions-updated", snap)`;
PTY output is streamed by capturing the `attach` `Channel` and calling
`runCallback(channel.id, { index, message })`. Seeded per test with a default
`Snapshot`, so the first `get_groups` paints a populated sidebar.

**Reactivity contract:** the sidebar does not re-read on a timer. After any
mutating command, the simulator must **emit `sessions-updated`** with the new
snapshot for the UI to update (mirrors `groups.rs:365`).

Commands to simulate (names verified against `invoke(...)` call sites in `src/`):

- **sessions/groups** — `get_groups` (initial snapshot), `create_session`,
  `rename_session`, `delete_session`, `set_view_mode`, `add_project`,
  `scan_directory`, `merged_pr_sessions` (the "delete merged" menu loops this +
  `delete_session`; there is **no** `delete_merged` command), `get_session_detail`,
  `generate_summary`. Mutations update state, then emit `sessions-updated`.
- **review** — `open_review` → `ReviewSnapshot`, `create_comment`, `delete_comment`,
  `apply_comments` → `ApplyOutcome`. The richest surface; seed diffs + comments.
- **themes** — `list_custom_themes`, `save_custom_theme`, `open_themes_dir`.
  (No `export_theme_template` command — template export is a frontend helper.)
- **pty** — `prepare_attach`, `prepare_shell`, `prepare_project_shell`, `attach`
  (+ `Channel` emitting canned bytes), `write_pty`, `resize_pty`, `detach`,
  `restart_fresh`. The auto-restart scenario is driven by the separate **`pty-exit`
  event**, which the simulator emits independently of the Channel bytes.
- **settings** — `get_config` → `serde_json::Value` (arbitrary shape; seed must
  match what `settings.ts` expects), `save_config` → restartRequired bool.
- **keybindings** — `get_keybindings` → `Record<string,string[]>` (a bad shape is
  swallowed at `keys.ts:115`, leaving the table empty) + `config-updated` event.
- **misc** — `open_external`.
- **Out of scope (registered but not invoked from the frontend):** `cascade_*`,
  `move_to_section`, `kill_session`, `restart_session`, `open_in_editor`,
  `remove_project`. Stub on demand only if a scenario reaches them.

Builder API in genio style: `addSession(...)`, `addProject(...)`,
`withReview(...)`, `withConfig(...)`, `withKeybindings(...)`, plus getters that
expose the fake's **state** (`getComments()`, `getConfig()`, …) so scenarios
assert on what the backend now holds, not on which calls fired. (A getter for the
last-received payload can exist as a last resort for cases with no observable
state change, but default to reading state.)

## Layer 1 — Vitest unit tests

Pure logic, no DOM (or trivial jsdom + stubbed `localStorage`/`matchMedia`).
Highest ROI; some need a one-line `export` or a small extract first.

| Module | Test targets | Refactor needed |
|---|---|---|
| `theme.ts` | `validateTheme` (base inheritance, per-key hex validation, bad-hex drop-not-fail, id-collision reject, shiki object/bundled-id/fallback, missing id/label/appearance) | none — exported, pure |
| `theme.ts` | `resolveTheme` / `getMode` / `preferredTheme` / `chooseTheme` / `registerCustomThemes` / `allThemes` (mode × OS-appearance × localStorage) | none; stub `localStorage` + `matchMedia` |
| `keys.ts` | `parseBinding` (Ctrl/Alt/Shift prefixes, named keys, `backtab`, F-keys, single-char shift), `matches` | export both |
| `palette.ts` | `score` (subsequence match, contiguity/earliness ranking, non-match → null) | export `score` |
| `review.ts` | `describeOutcome`, `displayPath`, `commentsByAnchor`, comment side/range/snippet derivation (mirrors TUI `build_draft`) | extract into a DOM-free `review/model.ts`; `commentsByAnchor` closes over module-level `snapshot` today — **parameterize it** (take `comments` + `path`) on the way out |

## Layer 2 — `.iwft` scenarios + Page Objects

Each surface gets a Page Object; scenarios drive user journeys against the
`TauriSimulator`. Component-level isolation is achieved by driving the app *to*
that surface (genio does not mount sub-components in isolation either).

| Surface (POM) | Scenarios |
|---|---|
| **ReviewPane** | open review; select line (click / shift-extend / click-to-deselect); write + save comment → **assert the comment renders** (the fake stores it and returns it on the next `open_review`), not that `create_comment` was called; delete comment → row disappears; Apply states + each `describeOutcome` branch; file-list dir grouping + counts; empty-diff; theme-change re-highlight. *(Payload-shape correctness — side/range/snippet derivation — is a Layer-1 unit test, not asserted here.)* |
| **Sidebar** | render seeded snapshot; view-mode cycle (project/sections/stacks); create session (Enter creates, Esc cancels); inline rename; delete with pending-overlay optimism; delete-merged-PR flow; unread/comment/blocked glyphs |
| **Palette** | Cmd/K open-close; filter + ranking order; ↑/↓ nav; Enter runs action; backdrop close |
| **ThemePicker** | ↑/↓ live preview; Enter commits (persists, survives reload via no-flash boot); Esc reverts; current/custom tags. *Persistence assertions read the exact `localStorage` keys the boot script uses (`cc-theme-mode`, `cc-theme-vars-{light,dark}`); ensure `addInitScript` ordering doesn't clobber the `vite.config.ts` boot `<script>`* |
| **SettingsModal** | typed fields per kind; invalid number + invalid JSON → toast + abort; round-trip through `save_config` |
| **Dialogs** (toast.ts) | `confirmDialog`/`promptDialog` resolve semantics (Enter/Esc/backdrop, Cancel-focused Enter, empty→null) |
| **Terminal tabs** | attach opens a tab (Channel emits canned bytes); Cmd+W closes; auto-restart on consecutive PTY ends (`recordEndAndCheckRestart`) |

## Prerequisite refactors (testability investment)

1. **Add `data-test` attributes** to the elements POMs select (genio selects on
   `data-test`, set via `testIdAttribute`). Currently CC-GUI uses `id`/class only.
   Minimal, additive — start with the surfaces in Layer 2.
2. **Export / extract pure functions** for Layer 1 (`parseBinding`, `matches`,
   `score`; extract `review/model.ts`).
These also shrink how much *must* be tested at the more expensive `.iwft` tier.

## Phase-2 gating spike: can `mockIPC` drive events? — ✅ RESOLVED (yes)

Run as `src/tauri-mock.spike.test.ts` (runnable evidence, 3 passing tests) against
the installed `@tauri-apps/api` 2.11.0. **`mockIPC` covers the whole seam; no
hand-rolled `__TAURI_INTERNALS__` replacement is needed.** Findings:

1. **invoke** — `mockIPC((cmd, args) => …)` routes every `invoke(cmd, args)` to the
   handler (incl. `get_groups`, `save_config`). ✓
2. **events** — `mockIPC(cb, { shouldMockEvents: true })` wires the event plugin
   (`plugin:event|listen|emit|unlisten`). The simulator pushes a snapshot by calling
   `emit("sessions-updated", snap)` from `@tauri-apps/api/event`; the app's
   `listen("sessions-updated", e => …)` fires with `e.payload === snap`. `unlisten`
   stops delivery. ✓ (mocks ignore event `target`, so target filtering is a non-issue.)
3. **PTY Channel** — `mockIPC` does **not** serialize args, so the `attach` handler
   receives the real `Channel` instance; capture `channel.id` and push bytes via
   `window.__TAURI_INTERNALS__.runCallback(channel.id, { index, message })` with a
   **monotonic per-channel index** (the Channel reorders by index). ✓

**Implications for the `TauriSimulator`:** build on `mockIPC` with
`shouldMockEvents: true`; push events with `emit(...)`; track a per-channel index
for PTY streaming; `clearMocks()` in `afterEach`. The one remaining (low-risk,
well-understood) rig task is **injection ordering** — the simulator must install
before `main.ts` evaluates (it calls `get_groups` + registers `listen`s at module
top level), i.e. bundle it into a `page.addInitScript`. Not a capability risk.

## Roadmap

1. ✅ **DONE — Tooling + Layer 1.** Vitest + jsdom; export/extract refactors
   (`review/model.ts`, exported `score`/`parseBinding`/`matches`); 49 unit tests +
   3 spike tests green via `npm test`.
2. ✅ **DONE — `.iwft` rig + first POM.** Playwright + `playwright-ct.config.ts` +
   Vite `webServer`; `TauriSimulator` (esbuild-bundled, injected via
   `addInitScript`, built on `mockIPC`+`mockWindows`+`shouldMockEvents`) + `seed` +
   `launchApp` + fixtures; `AppPageObject` base + `ReviewPanePageObject`. 3 review
   scenarios (comment renders + fake stores derived draft; apply; delete) green via
   `npm run test-iwft`. Boot gotcha recorded: main.ts calls `getCurrentWindow()` at
   load, so the simulator must `mockWindows("main")` or boot throws on `metadata`.
3. ✅ **DONE — Fan out `.iwft`** (serial, per user). All POMs + scenarios, 41 iwft green.
   - ✅ **Sidebar** — `SidebarPageObject` + 9 scenarios (render, view-cycle,
     create Enter/Esc, inline rename, delete optimism, event-push, glyphs/badges,
     merged-PR sweep). Simulator gained `set_view_mode`/`create_session`/
     `rename_session`/`delete_session`/`merged_pr_sessions` + `getSessions`/
     `getViewMode` getters; added a `sidebar` fixture. Bespoke-state scenarios use
     `test.use({ seed })`.
   - ✅ **Palette** — 6 scenarios (Cmd/K open, filter+ranking, ↑/↓ nav, Enter runs,
     Esc + backdrop close). Quirk found: the focused input `stopPropagation`s, so
     Cmd/K can't *close* the palette (only Esc/backdrop) — encoded as the real behaviour.
   - ✅ **ThemePicker** — 5 scenarios (↑/↓ live preview, Enter commits + survives
     reload, Esc reverts, current tag, custom tag). Simulator now serves seed
     `config`/`keybindings`/`customThemes` (`list_custom_themes` returns `{file,content}`).
   - ✅ **SettingsModal** — 3 scenarios (typed control per kind, invalid-JSON abort,
     valid round-trip via `save_config`; sim records last `save_config` payload).
     Note: the `number`-kind NaN→toast path is unreachable in-browser (`<input type=number>`).
   - ✅ **Dialogs** — 11 scenarios (confirm + prompt resolve semantics incl.
     Cancel-focused Enter, backdrop, empty→null). Sim entry exposes the app's real
     `confirmDialog`/`promptDialog` on `window.__CC_DIALOGS__` for direct driving.
   - ✅ **Terminal** — 4 scenarios (attach opens tab + streamed Channel bytes render;
     Cmd+W close; tab-close button; PTY-end auto-restart re-attaches a live tab).
     Sim captures the `attach` Channel and pushes bytes via `runCallback` (spike Q3);
     `emitPtyExit` drives the restart path. Kept shallow per the open-question lean.
4. ✅ **DONE — CI.** `.github/workflows/tests.yml`: push-to-main + PR; `npm ci` →
   Vitest units (fast gate) → `npx playwright install --with-deps chromium` →
   `npm run test-iwft` against the Vite dev server. Frontend-only (no Rust toolchain);
   uploads the Playwright report on failure. Config is already CI-aware
   (`forbidOnly`/`retries`/`reuseExistingServer` gated on `process.env.CI`).

## Open questions

- **`data-test` rollout scope** — add attributes lazily per surface as POMs are
  written, or one upfront pass? (Lean: lazy, per surface.)
- **PTY/terminal depth** — how far to simulate the `Channel` byte stream; assert
  a tab opens and bytes render, or deeper xterm assertions? (Lean: shallow —
  tab-opens + canned bytes visible.)
- **`mockIPC` event coverage** — ✅ resolved (yes); see the spike section +
  `src/tauri-mock.spike.test.ts`. Was the highest-risk unknown.

*(Resolved during review: the sidebar is event-push, not poll-based — initial
`get_groups`, then pushed `sessions-updated`. The simulator emits, it does not
wait for a poll. No `get_snapshot` command exists.)*
</content>
</invoke>
