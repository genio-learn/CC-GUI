---
name: run-app
description: Launch the CC-GUI desktop app locally with `npm run tauri dev` (Tauri 2 — Rust backend + Vite/TS frontend in a native window). Use when asked to run, start, or open the app, or to verify a change in the real app rather than only in tests.
---

# Run CC-GUI locally

CC-GUI is a [Tauri 2](https://tauri.app) app: a Rust backend (`src-tauri/`) and a
TypeScript/Vite frontend (`src/`) rendered in a **native OS window** (WKWebView on
macOS — not Electron, so Playwright's `_electron` driver does **not** attach to it).

## Launch

```bash
npm install          # only if node_modules/ is missing (fresh clone or worktree)
npm run tauri dev    # compiles the Rust backend, then opens the app window
```

- **First build is slow** — it compiles the Rust backend (including the embedded
  `claude-commander`), which takes several minutes. Subsequent runs are fast.
- The **frontend hot-reloads** via Vite. Changes under `src/` (e.g. `settings.ts`,
  `style.css`) reflect in the open window without a rebuild. Changes under
  `src-tauri/` (Rust) trigger a recompile + relaunch.
- Run it **backgrounded** and watch the log, since `tauri dev` stays attached:

  ```bash
  npm run tauri dev > /tmp/tauri-dev.log 2>&1 &
  # ready when the window opens; watch for the Vite "ready" line and the
  # cargo "Running `target/debug/cc-gui`" line, or `error[`/`error:` on failure.
  ```

## Worktree note

`src-tauri/target/` is per-checkout, so a fresh git worktree recompiles Rust from
scratch the first time even if the main checkout is already built. `node_modules/`
is also per-checkout — run `npm install` in the worktree before the first launch.

## Drive / verify

The window is a native WKWebView, so there's no headless driver to attach. To verify
a change, **look at the window** (or have the user look) and exercise the feature.

For automated UI verification without the native window, the frontend runs unchanged
in the **iwft** Playwright suite against a simulated backend — this renders the real
DOM + CSS in Chromium and is the fastest way to confirm frontend behaviour:

```bash
npm run test-iwft -- <scenario>   # e.g. `settings` for the settings pane
npm run typecheck                 # tsc --noEmit
```

## Quick reference

| Command | What it does |
|---|---|
| `npm run tauri dev` | Run the app with frontend hot reload |
| `npm run typecheck` | Type-check the frontend (`tsc --noEmit`) |
| `npm run build` | Type-check + Vite build |
| `npm test` | Vitest unit tests |
| `npm run test-iwft` | Playwright whole-frontend tests (simulated backend) |
