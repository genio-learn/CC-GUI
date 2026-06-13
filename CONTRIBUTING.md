# Contributing

Thanks for helping improve CC-GUI. This covers local setup, the dev loop, and
what's expected on a pull request. Architecture and coding conventions live in
[CLAUDE.md](CLAUDE.md).

## Setup

CC-GUI is a [Tauri 2](https://tauri.app) app (Rust backend + TypeScript/Vite
frontend) that depends on [`claude-commander`](https://github.com/sizeak/claude-commander)
via a **local path** dependency, so the two repos must sit side by side:

```
your-workspace/
├── CC-GUI/              # this repo
└── claude-commander/    # cloned alongside it
```

```sh
git clone git@github.com:Ed-Barnes937/CC-GUI.git
git clone git@github.com:sizeak/claude-commander.git
cd CC-GUI
npm install
```

You'll also need: the **Rust toolchain** ([rustup](https://rustup.rs)),
**Node.js**, **tmux** (`brew install tmux`), and the **`claude` CLI**. See the
[README](README.md#prerequisites) for the full prerequisite table.

## Dev loop

```sh
npm run tauri dev      # run the app with frontend hot reload
npm run typecheck      # tsc --noEmit
npm run app:install    # build a release bundle and install to /Applications (macOS)
```

Rust checks run from `src-tauri/` (they need the sibling `claude-commander`
checkout to resolve the dependency graph):

```sh
cd src-tauri
cargo fmt --all
cargo clippy --all-targets -- -D warnings
```

## Pull requests

Before opening a PR, make sure:

- `npm run typecheck` passes.
- `cargo fmt --all -- --check` passes (run `cargo fmt --all` to fix).
- `cargo clippy` is clean.
- Any change to keyboard interactions updates **both** `src/help.ts`
  (the `?` overlay) and the keyboard table in `README.md`.
- Changes to theming stay consistent with [`docs/theming.md`](docs/theming.md).

CI runs the frontend type-check + build and a Rust format check on every PR.

### Conventions

- Branch names: lowercase with hyphens, no slashes (e.g. `fix-terminal-path`).
- **Never force push** — create new commits instead.
- Match the style of the surrounding code; keep Tauri command handlers thin and
  push testable logic into library code (see [CLAUDE.md](CLAUDE.md)).

## Known caveat: the path dependency

The `claude-commander` path dependency keeps the GUI live against local CC
changes but isn't reproducible without the sibling checkout and pins no version.
Switching it to a pinned git dependency is the planned follow-up before any
wider distribution — see the comment in `src-tauri/Cargo.toml`.
