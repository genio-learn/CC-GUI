# CC-GUI

A desktop GUI for [`claude-commander`](https://github.com/sizeak/claude-commander) — manage your Claude coding sessions from a native window instead of the terminal TUI. Built with [Tauri 2](https://tauri.app) (Rust backend) and a TypeScript/Vite frontend.

It embeds `claude-commander` directly (as a library) and drives the same tmux-backed sessions, so it stays in sync with whatever the CLI does.

## Features

- **Session management** — grouped by project / section / section-stack (cycle with `⇄`); liveness and unread indicators; rename, restart, kill, delete, and "restart fresh".
- **Embedded terminals** — attach to any session in a real PTY (xterm.js); attaching recreates stopped sessions. `Cmd+W` closes the active tab.
- **Project shells** — open a plain shell terminal in a project or worktree directory.
- **Code review** — read-only diff view with inline comments; stage comments and **Apply** them back to the agent.
- **Cascade** — merge, resume, and abandon stacked sessions; push a stack.
- **Theming** — 10 built-in themes plus your own custom themes, with a live-preview picker. See [`docs/theming.md`](docs/theming.md).
- **Command palette** (`Cmd/Ctrl+K`) — fuzzy-jump to a session or run any command.
- **Config hot-reload** — picks up `claude-commander` config changes for multi-instance sync.

## Prerequisites

| Requirement | Why | Install |
|-------------|-----|---------|
| **Rust toolchain** | Compiles the Tauri backend | [rustup.rs](https://rustup.rs) |
| **Node.js** | Builds the frontend | [nodejs.org](https://nodejs.org) (or nvm) |
| **tmux** | `claude-commander` runs every session in a tmux session | `brew install tmux` |
| **`claude` CLI** | The default program each session launches | [Claude Code](https://claude.com/claude-code) |
| **`claude-commander` checkout** | Used as a local path dependency (see below) | clone as a sibling directory |

### Repo layout

`src-tauri/Cargo.toml` depends on `claude-commander` via a **local path** (`../../claude-commander`), so the two repos must sit side by side:

```
your-workspace/
├── CC-GUI/              # this repo
└── claude-commander/    # cloned alongside it
```

```sh
git clone git@github.com:Ed-Barnes937/CC-GUI.git
git clone git@github.com:sizeak/claude-commander.git
```

## Setup

```sh
cd CC-GUI
npm install
```

That's it — the Rust side is fetched and compiled on first build.

## Running

**Development** (hot-reload frontend, runs in a dev window):

```sh
npm run tauri dev
```

**Packaged app** (build a real `.app` and install it to `/Applications`):

```sh
npm run app:install
```

Then launch **CC-GUI** from Finder / Spotlight / Launchpad like any other app. The first build compiles the Rust backend from scratch and takes a few minutes; later builds are incremental.

## npm scripts

| Script | What it does |
|--------|--------------|
| `npm run tauri dev` | Run the app in development with hot reload. |
| `npm run app:build` | Build the bundles (`.app` + `.dmg`) under `src-tauri/target/release/bundle/`. |
| `npm run app:install` | Build **and** (re)install into `/Applications`. Idempotent — use it for first install **and** every update. |
| `npm run cc:pull` | Pull the latest `claude-commander` into the sibling checkout (fast-forward only). |
| `npm run cc:update` | `cc:pull` **then** `app:install` — update to the newest `claude-commander` and reinstall in one step. |

## Updating

- **GUI changes** → `npm run app:install`, then relaunch the app.
- **Newer `claude-commander`** → `npm run cc:update` (pulls latest CC source, rebuilds, reinstalls). Because CC is a path dependency, Cargo recompiles it from source — no version bump needed.

After any reinstall, fully quit the running app (`Cmd+Q`) before relaunching so you pick up the new binary.

## Keyboard & mouse quick reference

Press `?` in the app (outside a text input) for the full, always-current list.

| Action | Binding |
|--------|---------|
| Command palette (jump to session / run command) | `Cmd/Ctrl+K` |
| Help overlay | `?` |
| Close active terminal tab | `Cmd+W` |
| Attach / recreate a session | click its row |
| Full session menu (shell, review, rename, editor, PR, lifecycle) | right-click row |
| New session in a project | `+` on the project |
| Project shell | `$` on the project |
| Cycle sidebar view (project / sections / stacks) | `⇄` |
| Save a review comment | `Cmd/Ctrl+Enter` |

## Platform notes

The packaging scripts (`app:install`) and the login-shell PATH fix are macOS-specific. On a Finder-launched app, macOS provides a minimal `PATH`; the backend re-derives the full `PATH` from your login shell at startup so `tmux`, `node`, `git`, etc. resolve inside the app's terminals.

## Theming

CC-GUI owns its own theming (independent of `claude-commander` config). Ten themes ship built in, and you can drop your own JSON themes into the app's config folder without rebuilding. Full authoring guide: [`docs/theming.md`](docs/theming.md).
