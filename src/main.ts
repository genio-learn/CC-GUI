import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { openReview, closeReview } from "./review";
import { toast, confirmDialog, promptDialog, deleteSessionDialog } from "./toast";
import { makeResizable, adjustPanelWidth } from "./resize";
import { showContextMenu, MenuItem } from "./menu";
import { registerPaletteProvider, togglePalette } from "./palette";
import { toggleHelp, setHelpKeybindings } from "./help";
import { initKeybindings, reloadKeybindings, loadedBindings, overlayOpen as keyOverlayOpen } from "./keys";
import { openSettings } from "./settings";
import { noTextAssist } from "./dom";
import {
  initTheme,
  setMode,
  currentTheme,
  onThemeChange,
  followSystem,
  resolveTheme,
  applyTheme,
  registerCustomThemes,
  validateTheme,
  type Theme,
} from "./theme";
import { openThemeModal } from "./themeModal";

// Apply the GUI theme (CSS custom properties) before any dynamic content renders,
// then follow the OS appearance via the native Tauri theme event when in System mode.
initTheme();
void getCurrentWindow().onThemeChanged(() => followSystem());

// Warm the bundled terminal font (both weights) before any xterm is created, so
// it measures glyph dimensions against MesloLGS NF rather than the fallback.
void Promise.all([
  document.fonts.load('13px "MesloLGS NF Embedded"'),
  document.fonts.load('bold 13px "MesloLGS NF Embedded"'),
]);

// Load user-authored themes from disk, register the valid ones, and re-apply if a
// custom theme now occupies the active light/dark slot. Runs after initTheme() so
// a built-in (or the cached vars from the no-flash boot script) is already on
// screen — this upgrades to the custom theme without blocking first paint.
async function loadCustomThemes(announce = false): Promise<void> {
  let files: { file: string; content: unknown }[];
  try {
    files = await invoke("list_custom_themes");
  } catch (e) {
    toast(`Failed to load custom themes: ${e}`, "error");
    return;
  }
  const valid: Theme[] = [];
  const errors: string[] = [];
  for (const { file, content } of files) {
    const result = validateTheme(content);
    if ("theme" in result) valid.push(result.theme);
    else errors.push(`${file}: ${result.error}`);
  }
  registerCustomThemes(valid);
  const next = resolveTheme();
  if (next.id !== currentTheme().id) applyTheme(next);
  if (errors.length) {
    toast(`Skipped ${errors.length} invalid theme file(s) — ${errors.join("; ")}`, "error");
  }
  // announce only on an explicit reload — the boot call stays silent.
  if (announce) toast(`Loaded ${valid.length} custom theme(s)`);
}
void loadCustomThemes();

// Write the active theme out as an editable starting template, then register it
// and reveal the folder. The id/label are fresh so the file never collides with
// its source (a built-in's id would be rejected on reload).
async function exportThemeTemplate(): Promise<void> {
  const name = await promptDialog(
    "Name for the new theme (saved as a .json in the themes folder):",
    "my-theme",
  );
  if (!name) return;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "custom-theme";
  const t = currentTheme();
  const template = {
    id: slug,
    label: name,
    appearance: t.appearance,
    cssVars: t.cssVars,
    terminal: t.terminal,
    shiki: t.shiki,
  };
  try {
    const path = await invoke<string>("save_custom_theme", { name: slug, theme: template });
    await loadCustomThemes(); // register it now so it's pickable immediately
    toast(`Saved ${path} — edit it, then pick it from the palette`);
    void invoke("open_themes_dir").catch(() => {});
  } catch (e) {
    toast(`Export failed: ${e}`, "error");
  }
}

type SessionRow = {
  id: string;
  title: string;
  branch: string;
  status: string;
  program: string;
  agent_state: string;
  tmux_session_name: string;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: "open" | "closed" | "merged" | null;
  pr_draft: boolean;
  pr_labels: string[];
  review_decision: string | null;
  has_pending_comments: boolean;
  unread: boolean;
  stacked_child: boolean;
  project_id: string;
  project_name: string;
  current_section: string | null;
};

type ProjectGroup = {
  id: string;
  name: string;
  repo_path: string;
  pull_blocked: string | null;
  sessions: SessionRow[];
};

type SectionBucket = { name: string; session_ids: string[] };

type Snapshot = {
  groups: ProjectGroup[];
  view_mode: string;
  sections: SectionBucket[] | null;
  section_names: string[];
  commander: { enabled: boolean; running: boolean };
};

type SessionDetail = {
  id: string;
  title: string;
  branch: string;
  status: string;
  program: string;
  project_name: string;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: string;
  pr_draft: boolean;
  created_at: string;
  agent_state: string;
  diff_stat: string | null;
};

const sessionsEl = document.querySelector<HTMLDivElement>("#sessions")!;
const tabsEl = document.querySelector<HTMLDivElement>("#tabs")!;
const terminalsEl = document.querySelector<HTMLDivElement>("#terminals")!;
const placeholderEl = document.querySelector<HTMLDivElement>("#placeholder")!;
const detailEl = document.querySelector<HTMLElement>("#detail")!;
const detailTitleEl = document.querySelector<HTMLSpanElement>("#detail-title")!;
const detailMetaEl = document.querySelector<HTMLDListElement>("#detail-meta")!;
const detailDiffstatEl = document.querySelector<HTMLDivElement>("#detail-diffstat")!;
const detailSummaryEl = document.querySelector<HTMLDivElement>("#detail-summary")!;
const detailTagsEl = document.querySelector<HTMLDivElement>("#detail-tags")!;
const summaryGenEl = document.querySelector<HTMLButtonElement>("#summary-gen")!;
const detailReviewEl = document.querySelector<HTMLButtonElement>("#detail-review")!;
const detailPrEl = document.querySelector<HTMLButtonElement>("#detail-pr")!;

// ---------------------------------------------------------------- terminals

type TermEntry = {
  term: Terminal;
  fit: FitAddon;
  container: HTMLDivElement;
  surface: HTMLDivElement; // inner element xterm renders into
  tab: HTMLDivElement;
  glyph: HTMLSpanElement;
  title: string;
  dead: boolean;
};

const terminals = new Map<string, TermEntry>(); // keyed by tmux session name
let activeTerm: string | null = null;

// ------------------------------------------------------------- split panes
// Console view can show up to 4 terminals at once, dragged into quadrant drop
// zones. Layout is "columns-of-stacks": up to two columns, each an independent
// stack of up to two rows (left = [TL, BL], right = [TR, BR]). Empty columns /
// rows collapse. This avoids the unresolvable L-shapes a free 2×2 grid produces.
// One PTY per tmux session (pty.rs) ⇒ a session lives in exactly one pane;
// dropping onto an occupied slot REPLACES (the displaced session parks as a
// hidden direct child of #terminals, still alive). Split is active when
// `panes.size >= 2`; single-pane keeps the classic `activateTerminal` path.
type Slot = "TL" | "TR" | "BL" | "BR";
const panes = new Map<Slot, string>(); // slot -> tmux session name (split mode)
let focusedSlot: Slot | null = null;

// Per-quadrant accent colour: reused for the pane ring, the drop-zone preview,
// and the matching tab top-border so it's obvious which tab is on screen where.
const SLOT_COLOR: Record<Slot, string> = {
  TL: "var(--accent)", // blue
  TR: "var(--attention)", // peach/orange
  BL: "var(--success)", // green
  BR: "var(--info)", // mauve
};

// Split ratios (grow fractions), persisted; slot→session mapping is NOT.
function loadRatio(key: string): number {
  const v = Number(localStorage.getItem(key));
  return v >= 0.15 && v <= 0.85 ? v : 0.5;
}
let colRatio = loadRatio("cc-split-col"); // left column width fraction
let leftRowRatio = loadRatio("cc-split-rows-l"); // TL height within left column
let rightRowRatio = loadRatio("cc-split-rows-r"); // TR height within right column

const splitActive = (): boolean => panes.size >= 2;

// Re-theme every live terminal when the GUI theme changes. The DOM renderer
// repaints automatically on an options.theme assignment.
onThemeChange((theme) => {
  for (const entry of terminals.values()) {
    entry.term.options.theme = theme.terminal;
  }
});

function activateTerminal(name: string): void {
  // Split mode: focus the pane already showing this session, else load it into
  // the focused pane (replacing whatever was there — the displaced session
  // parks but stays alive as a tab).
  if (splitActive()) {
    const slot = [...panes].find(([, n]) => n === name)?.[0];
    if (slot) focusPane(slot);
    else setPane(focusedSlot ?? firstSlot(), name);
    return;
  }
  activeTerm = name;
  for (const [key, entry] of terminals) {
    const active = key === name;
    entry.container.classList.toggle("active", active);
    entry.tab.classList.toggle("active", active);
  }
  placeholderEl.style.display = terminals.size ? "none" : "flex";
  const entry = terminals.get(name);
  if (entry) {
    // In board mode the terminal lives in the dock; dock+fit there (fitting in
    // the hidden #terminals would measure a zero-size element). Otherwise fit
    // in place.
    if (layout === "board") {
      dockActiveTerminal();
    } else {
      entry.fit.fit();
      void invoke("resize_pty", {
        tmuxSession: name,
        rows: entry.term.rows,
        cols: entry.term.cols,
      });
      entry.term.focus();
    }
  } else if (layout === "board") {
    // The active terminal was just removed: refresh the dock to its placeholder.
    updateDockHeader();
  }
  renderSidebar();
}

function closeTerminal(name: string): void {
  const entry = terminals.get(name);
  if (!entry) return;
  void invoke("detach", { tmuxSession: name });
  entry.term.dispose();
  entry.container.remove(); // drops it from a pane cell or from #terminals
  entry.tab.remove();
  terminals.delete(name);

  // Split bookkeeping: vacate the slot, then re-render or fall back to single.
  const wasSplit = splitActive();
  const slot = [...panes].find(([, n]) => n === name)?.[0];
  if (slot) panes.delete(slot);
  if (splitActive()) {
    if (focusedSlot === slot) focusedSlot = firstSlot();
    renderPanes();
    placeholderEl.style.display = "none";
    renderSidebar();
    return;
  }
  if (wasSplit) {
    // Dropped below two panes: leave split, keeping the remaining session.
    exitSplit([...panes.values()][0] ?? terminals.keys().next().value ?? null);
    placeholderEl.style.display = terminals.size ? "none" : "flex";
    renderSidebar();
    return;
  }

  if (activeTerm === name) {
    activeTerm = terminals.keys().next().value ?? null;
    if (activeTerm) activateTerminal(activeTerm);
    else if (layout === "board") updateDockHeader(); // no terminal left → dock placeholder
  }
  placeholderEl.style.display = terminals.size ? "none" : "flex";
  renderSidebar();
}

// --------------------------------------------------- tab drag-to-reorder
// HTML5 drag-and-drop reorders the tab strip. `dragover` shows an insertion
// marker at the drop point; `drop` performs the move and rebuilds the
// `terminals` Map to match the DOM so index/cycle navigation follows the
// visible order. Committing on `drop` (not `dragend`) means an Esc-cancelled
// drag leaves the order untouched.
let draggingTab: HTMLDivElement | null = null;

// Session rows drag onto section headers to move a session between sections
// (section view only — headers exist solely in renderSections). The dragged
// session's id is module state; section-header drop handlers read it.
let draggingSessionId: string | null = null;

/** The tab to insert the dragged tab before, given the pointer's x (null = end). */
function tabBeforeX(x: number): HTMLDivElement | null {
  const tabs = [...tabsEl.querySelectorAll<HTMLDivElement>(".tab:not(.dragging)")];
  for (const tab of tabs) {
    const box = tab.getBoundingClientRect();
    if (x < box.left + box.width / 2) return tab;
  }
  return null;
}

/** Show the insertion marker before `target` (or after the last tab when null). */
function showDropMarker(target: HTMLDivElement | null): void {
  clearDropMarker();
  if (target) {
    target.classList.add("drop-before");
  } else {
    const tabs = tabsEl.querySelectorAll<HTMLDivElement>(".tab:not(.dragging)");
    tabs[tabs.length - 1]?.classList.add("drop-after");
  }
}

function clearDropMarker(): void {
  for (const t of tabsEl.querySelectorAll(".drop-before, .drop-after")) {
    t.classList.remove("drop-before", "drop-after");
  }
}

/** Rebuild the Map's iteration order from the current tab DOM order. */
function syncTermOrderFromDom(): void {
  const order = [...tabsEl.querySelectorAll<HTMLDivElement>(".tab")]
    .map((t) => t.dataset.term)
    .filter((n): n is string => !!n && terminals.has(n));
  if (order.length !== terminals.size) return;
  const entries = order.map((n) => [n, terminals.get(n)!] as const);
  terminals.clear();
  for (const [n, e] of entries) terminals.set(n, e);
}

tabsEl.addEventListener("dragover", (e) => {
  if (!draggingTab) return;
  e.preventDefault(); // mark the strip a valid drop target
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  showDropMarker(tabBeforeX(e.clientX));
});

tabsEl.addEventListener("drop", (e) => {
  if (!draggingTab) return;
  e.preventDefault();
  const before = tabBeforeX(e.clientX);
  // Keep the trailing "+" button last: drop "at the end" means before it.
  if (before) tabsEl.insertBefore(draggingTab, before);
  else tabsEl.insertBefore(draggingTab, tabNewBtn);
  clearDropMarker();
  syncTermOrderFromDom();
});

// "+" new-terminal button — pinned to the end of the strip. It has no
// `dataset.term`, so the drag-reorder helpers (tabBeforeX queries `.tab`,
// syncTermOrderFromDom filters by dataset.term) ignore it; the drop handler
// keeps it last by inserting dragged tabs before it.
const tabNewBtn = document.createElement("button");
tabNewBtn.className = "tab-new";
tabNewBtn.textContent = "+";
tabNewBtn.title = "New session";
tabNewBtn.addEventListener("click", (e) => showContextMenu(e, projectPickerItems()));
tabsEl.appendChild(tabNewBtn);

async function openTerminal(session: SessionRow): Promise<void> {
  // A deliberate attach resets the crash-loop guard for this session.
  consecutiveEnds.delete(session.tmux_session_name);
  // Recreates the tmux session first if the session is stopped or its pane
  // died, matching the TUI's attach behaviour.
  await attachTerminal(session.tmux_session_name, session.title, () =>
    invoke("prepare_attach", { id: session.id }),
  );
}

/** Open the per-worktree shell terminal for a session. */
async function openShell(session: SessionRow): Promise<void> {
  let name: string;
  try {
    name = await invoke<string>("prepare_shell", { id: session.id });
  } catch (e) {
    toast(`shell failed: ${e}`, "error");
    return;
  }
  await attachTerminal(name, `${session.title} — shell`, null);
}

async function openProjectShell(group: ProjectGroup): Promise<void> {
  let name: string;
  try {
    name = await invoke<string>("prepare_project_shell", { id: group.id });
  } catch (e) {
    toast(`project shell failed: ${e}`, "error");
    return;
  }
  await attachTerminal(name, `${group.name} — shell`, null);
}

/**
 * Attach (or focus) a terminal tab for a tmux session. `prepare` runs before
 * the PTY attach to ensure the tmux session exists (null when the caller
 * already ensured it).
 */
async function attachTerminal(
  name: string,
  title: string,
  prepare: (() => Promise<unknown>) | null,
): Promise<void> {
  const existing = terminals.get(name);
  if (existing && !existing.dead) {
    activateTerminal(name);
    return;
  }
  if (existing) closeTerminal(name); // dead: rebuild from scratch

  // The terminal is a rounded surface that xterm renders into directly; the
  // FitAddon measures the whole container.
  const container = document.createElement("div");
  container.className = "term-container";

  const surface = document.createElement("div");
  surface.className = "term-surface";

  container.append(surface);
  terminalsEl.appendChild(container);

  const term = new Terminal({
    fontFamily: '"MesloLGS NF Embedded", "MesloLGS NF", Menlo, Monaco, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: currentTheme().terminal,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // Cmd+Click opens links. xterm underlines URLs on hover; the handler only
  // fires the platform opener when Cmd is held, so a plain click still places
  // the cursor / starts a selection like a native terminal.
  term.loadAddon(
    new WebLinksAddon((e, uri) => {
      if (e.metaKey) void invoke("open_external", { url: uri });
    }),
  );
  // xterm measures glyph dimensions at open(), so the bundled font must be
  // loaded first — otherwise it sizes cells against the fallback and icon
  // glyphs never render. The boot-time preload usually wins this race, but
  // await here to be certain before the first paint.
  await Promise.all([
    document.fonts.load('13px "MesloLGS NF Embedded"'),
    document.fonts.load('bold 13px "MesloLGS NF Embedded"'),
  ]).catch(() => {});
  term.open(surface);

  // Honor OSC 52: programs like Claude's TUI manage their own mouse selection
  // and copy by emitting an OSC 52 clipboard sequence (this is what makes a
  // plain drag-to-copy work inside Claude, no Cmd+C). xterm ignores OSC 52
  // unless this addon is loaded; route it through the Tauri clipboard plugin
  // so the write lands on the native pasteboard from the WKWebView.
  term.loadAddon(
    new ClipboardAddon(undefined, {
      readText: () => readText(),
      writeText: (_sel, text) => writeText(text),
    }),
  );

  // Copy-on-select for plain shells (no app mouse mode): finishing a drag
  // selection copies it to the clipboard and clears the highlight. mouseup on
  // the container bubbles after xterm's own handlers, so the selection is
  // final. In an app that grabs the mouse (Claude), xterm makes no selection
  // and this no-ops — OSC 52 above handles that case instead.
  surface.addEventListener("mouseup", () => {
    const sel = term.getSelection();
    if (!sel) return;
    void writeText(sel).catch((e) =>
      console.error("clipboard write failed", e),
    );
    term.clearSelection();
  });

  term.onData((data) => {
    void invoke("write_pty", { tmuxSession: name, data });
  });

  // macOS line-editing shortcuts. Native terminals (Terminal.app, iTerm2) map
  // these Cmd combos to readline control bytes; xterm.js passes Cmd through
  // untouched, so we translate them ourselves. Bare Cmd only — combos with
  // other modifiers (e.g. Cmd+W) must fall through to their own handlers.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    // Ctrl+\ — switch to this session's shell, mirroring claude-commander's
    // attach-mode shell toggle (it intercepts the same key while attached).
    // Handled here so it fires while the terminal is focused, where the
    // config-driven keybindings (including select_shell) are suppressed. A
    // no-op on shell/project-shell terminals, whose name matches no session.
    if (e.ctrlKey && e.key === "\\" && !e.metaKey && !e.altKey && !e.shiftKey) {
      const s = groups.flatMap((g) => g.sessions).find((x) => x.tmux_session_name === name);
      if (s) {
        e.preventDefault();
        void openShell(s);
        return false;
      }
    }
    // Shift+Enter: insert a newline instead of submitting. xterm.js sends a
    // plain CR (\r) for Enter regardless of Shift, which submits. Send LF (\n,
    // i.e. Ctrl+J) instead — the TUI's "insert newline" byte; in a plain shell
    // readline treats it the same as Enter, so it does no harm there.
    if (e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      void invoke("write_pty", { tmuxSession: name, data: "\n" });
      return false;
    }
    if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
      return true;
    }
    const byte =
      e.key === "Backspace" ? "\x15" : e.key === "ArrowLeft" ? "\x01" : e.key === "ArrowRight" ? "\x05" : null;
    if (byte === null) return true;
    e.preventDefault();
    void invoke("write_pty", { tmuxSession: name, data: byte });
    return false;
  });
  term.onResize(({ rows, cols }) => {
    void invoke("resize_pty", { tmuxSession: name, rows, cols });
  });

  const tab = document.createElement("div");
  tab.className = "tab";
  tab.draggable = true;
  tab.dataset.term = name;
  tab.addEventListener("dragstart", (e) => {
    draggingTab = tab;
    tab.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      // Some webviews won't fire dragover/drop unless drag data is set.
      e.dataTransfer.setData("text/plain", name);
    }
  });
  tab.addEventListener("dragend", () => {
    // Cleanup only — the reorder is committed in the `drop` handler, so an
    // Esc-cancelled drag (drop never fires) leaves the order unchanged.
    tab.classList.remove("dragging");
    draggingTab = null;
    clearDropMarker();
  });
  const glyph = document.createElement("span");
  glyph.className = "tab-glyph dot";
  glyph.hidden = true; // shown once a matching session status is known
  const label = document.createElement("span");
  label.className = "tab-label";
  label.textContent = title;
  const close = document.createElement("button");
  close.className = "tab-close";
  close.textContent = "×";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTerminal(name);
  });
  tab.append(glyph, label, close);
  tab.addEventListener("click", () => activateTerminal(name));
  tabsEl.insertBefore(tab, tabNewBtn); // keep the "+" button trailing

  const entry: TermEntry = {
    term,
    fit,
    container,
    surface,
    tab,
    glyph,
    title,
    dead: false,
  };
  terminals.set(name, entry);
  updateTabGlyphs();

  const onData = new Channel<number[]>();
  onData.onmessage = (chunk) => term.write(new Uint8Array(chunk));

  try {
    if (prepare) await prepare();
    await invoke("attach", { tmuxSession: name, onData });
  } catch (e) {
    term.write(`\r\nFailed to attach: ${e}\r\n`);
    entry.dead = true;
  }
  activateTerminal(name);
}

function refitActive(): void {
  if (!activeTerm) return;
  const entry = terminals.get(activeTerm);
  if (!entry) return;
  entry.fit.fit();
  void invoke("resize_pty", {
    tmuxSession: activeTerm,
    rows: entry.term.rows,
    cols: entry.term.cols,
  });
}

// ---------------------------------------------------------------- board dock
// In board mode the active session's terminal lives in the dock at the bottom
// of #board: we MOVE the existing `.term-container` node out of #terminals into
// #board-dock-surface (one PTY — no duplicate). The container is absolutely
// positioned (inset:4px), so it fills whichever positioned parent holds it;
// after any re-parent it must be re-fit once its new parent is laid out. When
// switching back to Console the container returns to #terminals.

// The user can "×" detach the dock without killing the PTY: the terminal goes
// back to #terminals and the dock shows its placeholder even though a terminal
// is still active. Cleared by attaching from a card or re-entering board mode.
let dockDetached = false;

/** Fill the dock header (session name + branch) from the active terminal's
 *  snapshot row, and toggle the placeholder vs. the docked terminal. */
function updateDockHeader(): void {
  const entry = activeTerm && !dockDetached ? terminals.get(activeTerm) : null;
  if (!entry) {
    boardDockNameEl.textContent = "";
    boardDockBranchEl.textContent = "";
    boardDockPlaceholderEl.style.display = "flex";
    return;
  }
  const s = groups.flatMap((g) => g.sessions).find((x) => x.tmux_session_name === activeTerm);
  boardDockNameEl.textContent = s ? s.title : entry.title;
  boardDockBranchEl.textContent = s ? s.branch : "";
  boardDockPlaceholderEl.style.display = "none";
}

/** Move the active terminal's container into the dock surface and re-fit. With
 *  no active terminal (or after an explicit detach) the dock shows its
 *  placeholder. Safe to call repeatedly (re-parenting a node into its current
 *  parent is a no-op move). */
function dockActiveTerminal(): void {
  updateDockHeader();
  if (!activeTerm || dockDetached) return;
  const entry = terminals.get(activeTerm);
  if (!entry) return;
  boardDockSurfaceEl.appendChild(entry.container);
  // Mirror activateTerminal: only the active container is shown, and fit must
  // run after the move so it measures the dock surface, not #terminals.
  entry.container.classList.add("active");
  entry.fit.fit();
  void invoke("resize_pty", {
    tmuxSession: activeTerm,
    rows: entry.term.rows,
    cols: entry.term.cols,
  });
  entry.term.focus();
}

/** Restore the active terminal's container to #terminals (Console layout) and
 *  re-fit it there. */
function undockTerminal(): void {
  if (!activeTerm) return;
  const entry = terminals.get(activeTerm);
  if (!entry) return;
  terminalsEl.appendChild(entry.container);
  refitActive();
}

// ------------------------------------------------------------- split render
// Split lives only in console layout: it re-parents the same `.term-container`
// nodes (one PTY each) into pane cells, exactly like the board dock does. A
// ResizeObserver on each cell re-fits its terminal on any size change (window,
// divider, panel). Entering board collapses the split (see setLayout).

/** First occupied slot in TL,TR,BL,BR order (fallback focus target). */
function firstSlot(): Slot {
  return (["TL", "TR", "BL", "BR"] as Slot[]).find((s) => panes.has(s)) ?? "TL";
}

// Re-fit a terminal to its current container, batched to one rAF per frame.
const pendingFits = new Set<string>();
let fitScheduled = false;
function fitTerminal(name: string): void {
  const entry = terminals.get(name);
  if (!entry) return;
  entry.fit.fit();
  void invoke("resize_pty", { tmuxSession: name, rows: entry.term.rows, cols: entry.term.cols });
}
function scheduleFit(name: string): void {
  pendingFits.add(name);
  if (fitScheduled) return;
  fitScheduled = true;
  requestAnimationFrame(() => {
    fitScheduled = false;
    for (const n of pendingFits) fitTerminal(n);
    pendingFits.clear();
  });
}
const paneResizeObserver = new ResizeObserver((entries) => {
  for (const e of entries) {
    const name = (e.target as HTMLElement).dataset.term;
    if (name) scheduleFit(name);
  }
});

// Drop-zone preview overlay: four themed quadrants shown while a tab is dragged
// over #terminals. pointer-events:none so it never intercepts the drag.
const splitOverlay = document.createElement("div");
splitOverlay.id = "split-overlay";
const dzEls = {} as Record<Slot, HTMLDivElement>;
for (const s of ["TL", "TR", "BL", "BR"] as Slot[]) {
  const dz = document.createElement("div");
  dz.className = `dz ${s.toLowerCase()}`;
  dz.style.setProperty("--dz-color", SLOT_COLOR[s]);
  dzEls[s] = dz;
  splitOverlay.appendChild(dz);
}
terminalsEl.appendChild(splitOverlay);

/** Quadrant of #terminals under a viewport point. */
function quadrantAt(x: number, y: number): Slot {
  const r = terminalsEl.getBoundingClientRect();
  const left = x < r.left + r.width / 2;
  const top = y < r.top + r.height / 2;
  return top ? (left ? "TL" : "TR") : left ? "BL" : "BR";
}
function showSplitOverlay(slot: Slot): void {
  splitOverlay.classList.add("show");
  for (const s of Object.keys(dzEls) as Slot[]) dzEls[s].classList.toggle("hot", s === slot);
}
function hideSplitOverlay(): void {
  splitOverlay.classList.remove("show");
  for (const dz of Object.values(dzEls)) dz.classList.remove("hot");
}

terminalsEl.addEventListener("dragover", (e) => {
  if (!draggingTab) return;
  e.preventDefault(); // mark #terminals a valid drop target for a tab
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  showSplitOverlay(quadrantAt(e.clientX, e.clientY));
});
terminalsEl.addEventListener("dragleave", (e) => {
  // dragleave fires crossing child boundaries; only hide when truly leaving.
  if (!terminalsEl.contains(e.relatedTarget as Node | null)) hideSplitOverlay();
});
terminalsEl.addEventListener("drop", (e) => {
  if (!draggingTab) return;
  e.preventDefault();
  const name = draggingTab.dataset.term;
  const slot = quadrantAt(e.clientX, e.clientY);
  hideSplitOverlay();
  if (name) assignPane(slot, name);
});
window.addEventListener("dragend", hideSplitOverlay);

/** Assign a dragged session to a quadrant. From single-pane this seeds a
 *  two-pane vertical split (the on-screen session takes the opposite column),
 *  so any first drop yields left|right — the documented default. Dragging one
 *  visible pane onto another swaps the two (neither is evicted); dragging a
 *  parked tab onto an occupied slot replaces it (the occupant parks, stays alive). */
function assignPane(slot: Slot, name: string): void {
  if (!terminals.has(name)) return;
  const wasSplit = splitActive();
  const srcSlot = [...panes].find(([, n]) => n === name)?.[0];
  if (srcSlot === slot) return; // dropped onto its own pane: no-op

  // Swap: both the dragged session and the target slot are already visible
  // panes, so trade their positions instead of collapsing/evicting.
  const occupant = panes.get(slot);
  if (wasSplit && srcSlot && occupant && occupant !== name) {
    panes.set(srcSlot, occupant);
    panes.set(slot, name);
    focusedSlot = slot;
    renderPanes();
    return;
  }

  if (srcSlot) panes.delete(srcSlot);
  if (!wasSplit) {
    const seed = activeTerm;
    if (seed && seed !== name) {
      const opposite: Record<Slot, Slot> = { TL: "TR", TR: "TL", BL: "BR", BR: "BL" };
      panes.set(opposite[slot], seed);
    }
  }
  panes.set(slot, name);
  if (!splitActive()) {
    // Couldn't form a split (e.g. only one session, dropped onto itself).
    panes.clear();
    activateTerminal(name);
    return;
  }
  focusedSlot = slot;
  renderPanes();
}

/** Load a session into a specific slot (used when clicking a parked tab in
 *  split mode); replaces the slot's current occupant, which parks but lives. */
function setPane(slot: Slot, name: string): void {
  if (!terminals.has(name)) return;
  for (const [s, n] of [...panes]) if (n === name && s !== slot) panes.delete(s);
  panes.set(slot, name);
  if (!splitActive()) {
    exitSplit(name);
    return;
  }
  focusedSlot = slot;
  renderPanes();
}

/** Remove a slot from the split (via its pane's × ); the session stays alive
 *  and returns to the tab bar. Collapses to single when fewer than two remain. */
function removePane(slot: Slot): void {
  panes.delete(slot);
  if (focusedSlot === slot) focusedSlot = firstSlot();
  if (splitActive()) renderPanes();
  else exitSplit([...panes.values()][0] ?? activeTerm);
}

/** Focus a pane: sync activeTerm (for Cmd+W / targetSession / dock), move the
 *  focus ring, and focus its xterm. */
function focusPane(slot: Slot): void {
  focusedSlot = slot;
  const name = panes.get(slot);
  if (name) activeTerm = name;
  for (const cell of terminalsEl.querySelectorAll<HTMLElement>(".pane")) {
    cell.classList.toggle("focused", cell.dataset.slot === slot);
  }
  if (name) terminals.get(name)?.term.focus();
  renderSidebar();
}

/** Tag each on-screen tab with its quadrant colour (top border). */
function updateTabPaneColors(): void {
  clearTabPaneColors();
  for (const [slot, name] of panes) {
    const entry = terminals.get(name);
    if (!entry) continue;
    entry.tab.classList.add("in-pane");
    entry.tab.style.setProperty("--pane-color", SLOT_COLOR[slot]);
  }
}
function clearTabPaneColors(): void {
  for (const entry of terminals.values()) {
    entry.tab.classList.remove("in-pane");
    entry.tab.style.removeProperty("--pane-color");
  }
}

function buildPane(slot: Slot, grow: number): HTMLDivElement {
  const pane = document.createElement("div");
  pane.className = "pane";
  pane.dataset.slot = slot;
  pane.style.flex = `${grow} 1 0`;
  pane.style.setProperty("--pane-color", SLOT_COLOR[slot]);
  const name = panes.get(slot)!;
  pane.dataset.term = name;
  const entry = terminals.get(name);

  const header = document.createElement("div");
  header.className = "pane-header";
  const title = document.createElement("span");
  title.className = "pane-title";
  title.textContent = entry?.title ?? name;
  const close = document.createElement("button");
  close.className = "pane-close";
  close.textContent = "×";
  close.title = "Remove from split";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    removePane(slot);
  });
  header.append(title, close);
  pane.append(header);
  if (entry) pane.appendChild(entry.container); // move the container into the cell
  pane.addEventListener("mousedown", () => focusPane(slot));
  paneResizeObserver.observe(pane);
  return pane;
}

function makeColDivider(): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "col-divider";
  d.addEventListener("pointerdown", (e) => startDividerDrag(e, d, "col", null));
  return d;
}
function makeRowDivider(which: "l" | "r", colEl: HTMLElement): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "row-divider";
  d.addEventListener("pointerdown", (e) => startDividerDrag(e, d, "row", { which, colEl }));
  return d;
}
const clampRatio = (r: number): number => Math.min(0.85, Math.max(0.15, r));
// flex-basis 0 so the grow fraction maps linearly to pixel width/height (with
// basis:auto the panes' intrinsic size skews the ratio and makes the drag feel
// non-linear / reversed).
function applyColRatio(): void {
  const cols = terminalsEl.querySelectorAll<HTMLElement>(".split-col");
  if (cols.length === 2) {
    cols[0].style.flex = `${colRatio} 1 0`;
    cols[1].style.flex = `${1 - colRatio} 1 0`;
  }
}
function applyRowRatio(colEl: HTMLElement, ratio: number): void {
  const rows = colEl.querySelectorAll<HTMLElement>(".pane");
  if (rows.length === 2) {
    rows[0].style.flex = `${ratio} 1 0`;
    rows[1].style.flex = `${1 - ratio} 1 0`;
  }
}
// Pointer capture routes every move/up to the divider even when the pointer
// crosses an xterm surface (whose own mouse handling would otherwise swallow the
// mouseup and strand the drag — then a stale listener keeps following the cursor).
function startDividerDrag(
  e: PointerEvent,
  handle: HTMLElement,
  axis: "col" | "row",
  row: { which: "l" | "r"; colEl: HTMLElement } | null,
): void {
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  document.body.classList.add("resizing");
  if (axis === "row") document.body.classList.add("vertical");
  const onMove = (ev: PointerEvent) => {
    if (axis === "col") {
      const r = terminalsEl.getBoundingClientRect();
      if (!r.width) return;
      colRatio = clampRatio((ev.clientX - r.left) / r.width);
      applyColRatio();
      localStorage.setItem("cc-split-col", String(colRatio));
    } else if (row) {
      const r = row.colEl.getBoundingClientRect();
      if (!r.height) return;
      const ratio = clampRatio((ev.clientY - r.top) / r.height);
      if (row.which === "l") {
        leftRowRatio = ratio;
        localStorage.setItem("cc-split-rows-l", String(ratio));
      } else {
        rightRowRatio = ratio;
        localStorage.setItem("cc-split-rows-r", String(ratio));
      }
      applyRowRatio(row.colEl, ratio);
    }
  };
  const onUp = (ev: PointerEvent) => {
    document.body.classList.remove("resizing", "vertical");
    handle.releasePointerCapture(ev.pointerId);
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
}

/** Rebuild the split scaffolding from the `panes` map (console layout only). */
function renderPanes(): void {
  if (!splitActive()) {
    exitSplit(activeTerm);
    return;
  }
  if (!focusedSlot || !panes.has(focusedSlot)) focusedSlot = firstSlot();
  if (layout !== "console") {
    updateTabPaneColors(); // split DOM only exists in console; rebuild on return
    return;
  }
  paneResizeObserver.disconnect();
  // Park every container as a hidden direct child, then drop the old cells.
  for (const entry of terminals.values()) {
    entry.container.classList.remove("active");
    terminalsEl.appendChild(entry.container);
  }
  for (const el of terminalsEl.querySelectorAll(".split-col, .col-divider")) el.remove();

  terminalsEl.classList.add("split");
  placeholderEl.style.display = "none";

  const leftSlots = (["TL", "BL"] as Slot[]).filter((s) => panes.has(s));
  const rightSlots = (["TR", "BR"] as Slot[]).filter((s) => panes.has(s));
  const bothCols = leftSlots.length > 0 && rightSlots.length > 0;
  const columns: { slots: Slot[]; grow: number; which: "l" | "r"; ratio: number }[] = [];
  if (leftSlots.length)
    columns.push({ slots: leftSlots, grow: bothCols ? colRatio : 1, which: "l", ratio: leftRowRatio });
  if (rightSlots.length)
    columns.push({ slots: rightSlots, grow: bothCols ? 1 - colRatio : 1, which: "r", ratio: rightRowRatio });

  columns.forEach((col, ci) => {
    if (ci > 0) terminalsEl.insertBefore(makeColDivider(), splitOverlay);
    const colEl = document.createElement("div");
    colEl.className = "split-col";
    colEl.style.flex = `${col.grow} 1 0`;
    col.slots.forEach((slot, ri) => {
      if (ri > 0) colEl.appendChild(makeRowDivider(col.which, colEl));
      const grow = col.slots.length === 2 ? (ri === 0 ? col.ratio : 1 - col.ratio) : 1;
      colEl.appendChild(buildPane(slot, grow));
    });
    terminalsEl.insertBefore(colEl, splitOverlay); // keep the overlay last (on top)
  });

  updateTabPaneColors();
  focusPane(focusedSlot);
  for (const name of panes.values()) scheduleFit(name);
}

/** Leave split mode, keeping `keep` (if valid) as the single active terminal. */
function exitSplit(keep: string | null): void {
  const target = keep && terminals.has(keep) ? keep : (terminals.keys().next().value ?? null);
  panes.clear();
  focusedSlot = null;
  clearTabPaneColors();
  paneResizeObserver.disconnect();
  hideSplitOverlay();
  // Move every container back to a hidden direct child of #terminals, tear down
  // the split scaffolding, then re-show the kept terminal via the single path.
  for (const entry of terminals.values()) {
    entry.container.classList.remove("active");
    terminalsEl.appendChild(entry.container);
  }
  for (const el of terminalsEl.querySelectorAll(".split-col, .col-divider")) el.remove();
  terminalsEl.classList.remove("split");
  activeTerm = null; // force activateTerminal to re-show the kept terminal
  if (target) activateTerminal(target);
  else {
    placeholderEl.style.display = terminals.size ? "none" : "flex";
    if (layout === "board") updateDockHeader();
  }
}

window.addEventListener("resize", () => {
  refitActive();
});

// Cmd+W closes the active terminal tab first; only when no tabs remain does it
// close the window (the OS default). Capture phase so it beats xterm's own key
// handling on the focused terminal. Cmd, not Ctrl: Ctrl+W is the terminal's
// delete-word and must reach the shell.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "w" || !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (activeTerm) {
      closeTerminal(activeTerm);
    } else {
      void getCurrentWindow().close();
    }
  },
  true,
);

/** Activate the open terminal tab at `index` (0-based), if it exists. */
function activateTabByIndex(index: number): void {
  const name = [...terminals.keys()][index];
  if (name) activateTerminal(name);
}

/** Cycle the active terminal tab by `delta` (wraps around). */
function cycleTab(delta: number): void {
  const names = [...terminals.keys()];
  if (!names.length) return;
  const cur = activeTerm ? names.indexOf(activeTerm) : -1;
  activateTerminal(names[(cur + delta + names.length) % names.length]);
}

/** Move the sidebar cursor by `delta` and attach the newly selected session. */
function cycleSession(delta: number): void {
  // Seed the cursor from the active terminal so the first press moves relative
  // to what's on screen, not from the top of the list.
  if (!selectedId) {
    const cur = targetSession();
    if (cur) selectRow(cur.id);
  }
  moveSelection(delta);
  const s = selectedId ? findSession(selectedId) : undefined;
  if (s) void openTerminal(s);
}

// iTerm-style tab / session navigation. These are app actions (they never reach
// the shell), so — like Cmd+W — they're handled here rather than as terminal
// bytes. Capture phase to beat xterm's key handling on the focused terminal.
// Cmd+1..9 selects a tab; Cmd+Opt+Left/Right cycles tabs; Cmd+Opt+Up/Down walks
// the sidebar sessions. Bare Cmd+Left/Right stays the terminal's line-start/end.
window.addEventListener(
  "keydown",
  (e) => {
    if (!e.metaKey || e.ctrlKey || keyOverlayOpen()) return;
    if (!e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      activateTabByIndex(Number(e.key) - 1);
      return;
    }
    if (!e.altKey || e.shiftKey) return;
    const move: Record<string, () => void> = {
      ArrowLeft: () => cycleTab(-1),
      ArrowRight: () => cycleTab(1),
      ArrowUp: () => cycleSession(-1),
      ArrowDown: () => cycleSession(1),
    };
    const fn = move[e.key];
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  },
  true,
);

makeResizable({
  key: "cc-sidebar-width",
  target: document.querySelector<HTMLElement>("#sidebar")!,
  edge: "right",
  min: 200,
  max: 640,
  onResize: refitActive,
});
makeResizable({
  key: "cc-detail-width",
  target: detailEl,
  edge: "left",
  min: 240,
  max: 720,
  onResize: refitActive,
});

// ------------------------------------------------------------- detail panel

let detailId: string | null = null;
let detailTimer: ReturnType<typeof setInterval> | null = null;
let detailPrUrl: string | null = null; // PR url from the last fetched detail, for the footer

type Summary = { state: "loading" } | { state: "ready"; text: string } | { state: "error"; text: string };
const summaries = new Map<string, Summary>(); // keyed by session id, app-session cache

function metaRow(label: string, value: string): [HTMLElement, HTMLElement] {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  return [dt, dd];
}

function renderDetail(d: SessionDetail): void {
  detailTitleEl.textContent = d.title;
  detailPrUrl = d.pr_url;

  detailMetaEl.innerHTML = "";
  const status =
    d.status.toLowerCase() === "running" ? `running · ${d.agent_state}` : d.status.toLowerCase();
  // Order per the brief: branch / (worktree — omitted, not surfaced to the
  // frontend SessionDetail) / PR / status; project/program/created kept.
  const rows: [string, string][] = [["Project", d.project_name], ["Branch", d.branch]];
  if (d.pr_number != null) {
    rows.push([
      "PR",
      `#${d.pr_number} (${d.pr_draft ? "draft" : d.pr_state.toLowerCase()})${d.pr_url ? ` — ${d.pr_url}` : ""}`,
    ]);
  }
  rows.push(["Status", status], ["Program", d.program], ["Created", new Date(d.created_at).toLocaleString()]);
  for (const [label, value] of rows) {
    detailMetaEl.append(...metaRow(label, value));
  }

  detailDiffstatEl.innerHTML = "";
  if (d.diff_stat) {
    // Colorize "+N" / "-N" tokens in the diffstat summary.
    let adds = 0;
    let dels = 0;
    for (const token of d.diff_stat.split(/(\+\d+|-\d+)/)) {
      const span = document.createElement("span");
      if (/^\+\d+$/.test(token)) {
        span.className = "added";
        adds += Number(token.slice(1));
      }
      if (/^-\d+$/.test(token)) {
        span.className = "removed";
        dels += Number(token.slice(1));
      }
      span.textContent = token;
      detailDiffstatEl.appendChild(span);
    }
    // Proportional add/remove bar.
    const total = adds + dels;
    if (total > 0) {
      const bar = document.createElement("div");
      bar.className = "diffstat-bar";
      const a = document.createElement("span");
      a.className = "added";
      a.style.width = `${(adds / total) * 100}%`;
      const r = document.createElement("span");
      r.className = "removed";
      r.style.width = `${(dels / total) * 100}%`;
      bar.append(a, r);
      detailDiffstatEl.appendChild(bar);
    }
  } else {
    detailDiffstatEl.textContent = "No changes";
  }

  // Tag chips: derive from the matching snapshot row's PR labels (real data;
  // no dedicated tag source exists). Empty when the session has no labels.
  detailTagsEl.innerHTML = "";
  const row = groups.flatMap((g) => g.sessions).find((x) => x.id === d.id);
  for (const label of row?.pr_labels ?? []) {
    const chip = document.createElement("span");
    chip.className = "detail-tag";
    chip.textContent = label;
    detailTagsEl.appendChild(chip);
  }

  // Footer: Open PR is enabled only when this session has a PR url.
  detailPrEl.disabled = !d.pr_url;
}

function renderSummary(): void {
  if (!detailId) return;
  const summary = summaries.get(detailId);
  detailSummaryEl.classList.remove("placeholder", "error");
  summaryGenEl.disabled = summary?.state === "loading";
  summaryGenEl.textContent = summary?.state === "ready" ? "↻ Regenerate" : "↻ Generate";
  if (!summary) {
    detailSummaryEl.classList.add("placeholder");
    detailSummaryEl.textContent = "No summary yet — Generate sends the branch diff to Claude.";
  } else if (summary.state === "loading") {
    detailSummaryEl.classList.add("placeholder");
    detailSummaryEl.textContent = "Generating…";
  } else if (summary.state === "error") {
    detailSummaryEl.classList.add("error");
    detailSummaryEl.textContent = summary.text;
  } else {
    detailSummaryEl.textContent = summary.text;
  }
}

async function generateSummary(): Promise<void> {
  if (!detailId) return;
  const id = detailId;
  if (summaries.get(id)?.state === "loading") return;
  summaries.set(id, { state: "loading" });
  renderSummary();
  try {
    const text = await invoke<string>("generate_summary", { id });
    summaries.set(id, { state: "ready", text });
  } catch (e) {
    summaries.set(id, { state: "error", text: String(e) });
  }
  renderSummary();
}

summaryGenEl.addEventListener("click", () => void generateSummary());

async function refreshDetail(): Promise<void> {
  if (!detailId) return;
  let d: SessionDetail | null = null;
  try {
    d = await invoke<SessionDetail | null>("get_session_detail", { id: detailId });
  } catch {
    return; // transient failure; next tick retries
  }
  if (!detailId) return; // closed while fetching
  if (!d) {
    closeDetail();
    return;
  }
  renderDetail(d);
}

function closeDetail(): void {
  detailId = null;
  detailPrUrl = null;
  if (detailTimer) clearInterval(detailTimer);
  detailTimer = null;
  detailEl.classList.add("hidden");
  refitActive();
}

function toggleDetail(s: SessionRow): void {
  if (detailId === s.id) {
    closeDetail();
    return;
  }
  detailId = s.id;
  detailPrUrl = null;
  detailEl.classList.remove("hidden");
  detailTitleEl.textContent = s.title;
  detailMetaEl.innerHTML = "";
  detailDiffstatEl.textContent = "Loading…";
  detailTagsEl.innerHTML = "";
  detailPrEl.disabled = true;
  renderSummary();
  if (detailTimer) clearInterval(detailTimer);
  detailTimer = setInterval(() => void refreshDetail(), 2000);
  void refreshDetail();
  refitActive();
}

document.querySelector("#detail-close")!.addEventListener("click", closeDetail);
document.querySelector("#detail-collapse")!.addEventListener("click", closeDetail);
detailReviewEl.addEventListener("click", () => {
  if (detailId) void openReview(detailId, detailTitleEl.textContent ?? "");
});
detailPrEl.addEventListener("click", () => {
  if (detailPrUrl) void invoke("open_external", { url: detailPrUrl });
});

/**
 * Crash-loop guard, cap 3 *consecutive* ends per tmux name. "Consecutive"
 * means in quick succession: an end more than a minute after the previous one
 * starts a fresh count, so a session that ran healthily for a while regains
 * its auto-restart budget (the TUI gets this for free by scoping its counter
 * to one attach loop).
 */
const consecutiveEnds = new Map<string, { count: number; lastEnd: number }>();

function recordEndAndCheckRestart(name: string): boolean {
  if (name.endsWith("-sh") || name === "cc-commander") return false;
  const prev = consecutiveEnds.get(name);
  const now = Date.now();
  const count = prev && now - prev.lastEnd < 60_000 ? prev.count + 1 : 1;
  consecutiveEnds.set(name, { count, lastEnd: now });
  return count <= 3;
}

/**
 * Auto-restart a crashed session by reconnecting the PTY on the SAME terminal,
 * without tearing it down. This preserves the terminal's placement (its pane in
 * split mode, or parked/active in single mode) and the user's focus. A
 * user-initiated attach deliberately loads into the focused pane; an autonomous
 * restart must not — otherwise a background tab finishing would hijack the pane
 * you're working in, or a crashed pane would reappear in the wrong quadrant.
 */
async function restartTerminalInPlace(name: string): Promise<void> {
  const entry = terminals.get(name);
  if (!entry) return;
  try {
    await invoke("restart_fresh", { tmuxSession: name });
    const onData = new Channel<number[]>();
    onData.onmessage = (chunk) => entry.term.write(new Uint8Array(chunk));
    await invoke("attach", { tmuxSession: name, onData });
    entry.dead = false;
    entry.tab.classList.remove("dead");
    // Refit wherever it currently lives; parked terminals need no refit.
    if (splitActive() && [...panes.values()].includes(name)) scheduleFit(name);
    else if (activeTerm === name) refitActive();
  } catch (e) {
    entry.term.write(`\r\nAuto-restart failed: ${e}\r\n`);
  }
}

void listen<{ session: string; ended: boolean }>("pty-exit", (event) => {
  const { session: name, ended } = event.payload;
  const entry = terminals.get(name);
  if (!entry) return;
  entry.dead = true;
  entry.tab.classList.add("dead");

  // The tmux session ended (program exited/crashed) rather than a detach:
  // auto-restart fresh and re-attach in place, with the crash-loop guard — the
  // same behaviour as the TUI's attach loop.
  if (ended && recordEndAndCheckRestart(name)) {
    entry.term.write("\r\n\x1b[90m[session ended — restarting…]\x1b[0m\r\n");
    void restartTerminalInPlace(name);
    return;
  }
  entry.term.write("\r\n\x1b[90m[detached — click session to re-attach]\x1b[0m\r\n");
});

// ----------------------------------------------------------------- sidebar

let groups: ProjectGroup[] = [];
let layout: "console" | "board" = (localStorage.getItem("cc-layout") as "console" | "board") ?? "console";
let viewMode = "project";
let sections: SectionBucket[] | null = null;
let sectionNames: string[] = [];
// Key of the project header with an open create-input. In project view this is
// the bare project id; in section view it's scoped to the section (see
// `sectionCreateKey`) so the same project across sections opens independently.
let newSessionProject: string | null = null;
let renamingId: string | null = null; // session id being renamed inline
let topInput: "add" | "scan" | null = null; // sidebar-top path input mode
// Project the session list is filtered to (toggled from the projects rail), or
// null for "all projects". Composes with whichever grouping is active.
let projectFilter: string | null = null;

// Board layout: which cards are visible (filter pills) + a name search. Mirrors
// projectFilter's "local UI state, re-render on change" shape.
let boardFilter: "all" | "review" | "running" | "blocked" = "all";
let boardSearch = "";
// Custom-section filter (composes with the four base pills + search). null = no
// section narrowing. Cleared if the section disappears from the snapshot.
let boardSectionFilter: string | null = null;
// Hide project columns with zero sessions (persisted).
let hideEmptyColumns = localStorage.getItem("cc-board-hide-empty") === "1";

const SECTION_VIEW = (): boolean => sections !== null;

/** Create-input key for a project sub-header inside a section. The `sect:`
 *  prefix can't collide with a bare project uuid (project-view key). */
const sectionCreateKey = (section: string, projectId: string): string =>
  `sect:${section} ${projectId}`;

// Collapsed sidebar groups ("proj:<id>" / "sect:<name>"), persisted.
const collapsed = new Set<string>(
  JSON.parse(localStorage.getItem("cc-collapsed") ?? "[]") as string[],
);

function toggleCollapsed(key: string): void {
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
  localStorage.setItem("cc-collapsed", JSON.stringify([...collapsed]));
  renderSidebar();
}

/** Chevron + collapse-toggling click handler for a group header. */
function makeCollapsible(header: HTMLDivElement, name: HTMLSpanElement, key: string): boolean {
  const isCollapsed = collapsed.has(key);
  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = isCollapsed ? "▸ " : "▾ ";
  name.prepend(chevron);
  header.classList.add("collapsible");
  header.addEventListener("click", () => toggleCollapsed(key));
  return isCollapsed;
}

/** A thin subtle hairline that grows to fill the rest of a group header row
 *  (after the name + count), trailing off toward the edge. */
function headerRule(): HTMLSpanElement {
  const rule = document.createElement("span");
  rule.className = "header-rule";
  return rule;
}

function findSession(id: string): SessionRow | undefined {
  for (const g of groups) {
    const s = g.sessions.find((s) => s.id === id);
    if (s) return s;
  }
  return undefined;
}

// ------------------------------------------------- keyboard selection model

// Keyboard cursor for the sidebar (the TUI's tree cursor). Session ids of
// visible rows, one array per rendered group, rebuilt on every full render.
let selectedId: string | null = null;
let visibleGroups: string[][] = [];

function updateSelectionClasses(): void {
  for (const [id, refs] of rowRefs) {
    refs.row.classList.toggle("selected", id === selectedId);
  }
  // Board cards share the sidebar's selection model.
  for (const [id, card] of boardCardRefs) {
    card.classList.toggle("selected", id === selectedId);
  }
  if (selectedId) {
    rowRefs.get(selectedId)?.row.scrollIntoView({ block: "nearest" });
  }
}

function selectRow(id: string | null): void {
  selectedId = id;
  updateSelectionClasses();
}

function moveSelection(delta: number): void {
  const flat = visibleGroups.flat();
  if (!flat.length) return;
  const idx = selectedId ? flat.indexOf(selectedId) : -1;
  const next = idx === -1 ? (delta > 0 ? 0 : flat.length - 1) : idx + delta;
  selectRow(flat[Math.min(flat.length - 1, Math.max(0, next))]);
}

/** Jump to the first row of the next/previous group and show its terminal. */
function moveGroup(dir: 1 | -1): void {
  const nonEmpty = visibleGroups.filter((g) => g.length);
  if (!nonEmpty.length) return;
  const cur = nonEmpty.findIndex((g) => selectedId !== null && g.includes(selectedId));
  const next = cur === -1 ? 0 : (cur + dir + nonEmpty.length) % nonEmpty.length;
  const id = nonEmpty[next][0];
  selectRow(id);
  // Switching groups attaches the target session so the displayed terminal (and
  // its `.active` highlight) follows the cursor, rather than leaving the old
  // session shown/highlighted.
  const s = findSession(id);
  if (s) void openTerminal(s);
}

/** The session keyboard actions operate on: cursor first, attached tab second. */
function targetSession(): SessionRow | undefined {
  if (selectedId) {
    const s = findSession(selectedId);
    if (s) return s;
  }
  if (activeTerm) {
    for (const g of groups) {
      const s = g.sessions.find((x) => x.tmux_session_name === activeTerm);
      if (s) return s;
    }
  }
  return undefined;
}

function groupOf(sessionId: string): ProjectGroup | undefined {
  return groups.find((g) => g.sessions.some((s) => s.id === sessionId));
}

/** Liveness-dot state classes set by applyStatusGlyph. `dot-running` carries
 *  the pulse; the rest are static colour. Removed wholesale before re-applying. */
const STATUS_GLYPH_CLASSES = [
  "dot-running",
  "dot-finished",
  "dot-idle",
  "dot-stopped",
  "dot-transient",
  "dot-waiting",
];

/** Set `el`'s liveness dot (colour/pulse/tooltip) from a session's status.
 *  Shared by the sidebar rows and the terminal tabs so they stay in lockstep.
 *  The element renders as an 8px circle (see `.dot`/.glyph/.tab-glyph CSS); the
 *  state class drives its colour and the running pulse. */
function applyStatusGlyph(el: HTMLSpanElement, s: SessionRow): void {
  el.classList.remove(...STATUS_GLYPH_CLASSES);
  el.textContent = "";
  let cls: string;
  let title: string;
  if (s.unread) {
    // Finished while away — surface as the "finished" colour regardless of the
    // underlying agent state.
    cls = "dot-finished";
    title = "finished — needs attention";
  } else if (s.status === "running") {
    if (s.agent_state === "working") {
      cls = "dot-running";
      title = "running";
    } else if (s.agent_state === "waitingforinput") {
      // Distinct from the in-progress dot: a yellow "?" glyph, not a circle.
      cls = "dot-waiting";
      el.textContent = "?";
      title = "waiting for input";
    } else if (s.agent_state === "idle") {
      cls = "dot-idle";
      title = "idle";
    } else {
      cls = "dot-idle";
      title = s.agent_state;
    }
  } else if (s.status === "stopped") {
    cls = "dot-stopped";
    title = "stopped";
  } else {
    cls = "dot-transient"; // creating / merging / pushing / cascade_paused
    title = s.status;
  }
  el.classList.add(cls);
  el.title = title;
}

function statusGlyph(s: SessionRow): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "glyph dot";
  applyStatusGlyph(el, s);
  return el;
}

/** Number of project-identity palette slots (--proj-0..--proj-7 in :root). */
const PROJ_COLORS = 8;

/** Deterministically hash a project_id to one of the PROJ_COLORS palette slots.
 *  FNV-1a over the id so the same project always maps to the same colour. */
function projIndex(projectId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < projectId.length; i++) {
    h ^= projectId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % PROJ_COLORS;
}

/** CSS class (`proj-N`) carrying a project's identity colour via `--proj-color`.
 *  Consumers read `var(--proj-color)` — never an inline hex. */
function projClass(projectId: string): string {
  return `proj-${projIndex(projectId)}`;
}

/** Mirror each open tab's status glyph from the latest session snapshot. Tabs
 *  with no matching session (e.g. commander) keep their glyph hidden. */
function updateTabGlyphs(): void {
  for (const [name, entry] of terminals) {
    const s = groups.flatMap((g) => g.sessions).find((x) => x.tmux_session_name === name);
    if (s) {
      entry.glyph.hidden = false;
      applyStatusGlyph(entry.glyph, s);
    } else {
      entry.glyph.hidden = true;
    }
  }
}

function actionButton(
  label: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "row-action";
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

/** Destructive actions require a second click within 2.5s. */
function confirmButton(
  label: string,
  title: string,
  onConfirm: () => void,
): HTMLButtonElement {
  const btn = actionButton(label, title, () => {
    if (btn.classList.contains("confirm")) {
      onConfirm();
    } else {
      btn.classList.add("confirm");
      btn.textContent = "sure?";
      setTimeout(() => {
        btn.classList.remove("confirm");
        btn.textContent = label;
      }, 2500);
    }
  });
  return btn;
}

/** Re-fetch the sidebar snapshot now instead of waiting for the 2s tick. */
async function refreshNow(): Promise<void> {
  try {
    applySnapshot(await invoke<Snapshot>("get_groups"));
  } catch {
    // transient; the next push tick recovers
  }
}

async function lifecycle(action: string, id: string): Promise<void> {
  await lifecycleArgs(action, { id });
}

async function lifecycleArgs(action: string, args: Record<string, unknown>): Promise<void> {
  try {
    await invoke(action, args);
  } catch (e) {
    toast(`${action} failed: ${e}`, "error");
  }
  await refreshNow();
}

/** Invoke a long-running command and surface its summary (or error). */
async function invokeToast(action: string, args: Record<string, unknown>): Promise<void> {
  try {
    const msg = await invoke<string | null>(action, args);
    if (msg) toast(msg);
  } catch (e) {
    toast(`${action} failed: ${e}`, "error");
  }
  await refreshNow();
}

// Optimistic-update overlays: sessions deleted (or retitled) locally before
// the backend confirms, applied over every incoming snapshot. A mask is held
// until a snapshot *confirms* the change (session absent for a delete; new
// title present for a rename) — NOT merely until the invoke resolves. The 2s
// push loop can build a snapshot just before our mutation lands and deliver it
// just after, so clearing on resolve alone would flash the stale row/title
// back until the next tick. On invoke error the mask is force-cleared instead.
const pendingDeletes = new Set<string>();
const pendingTitles = new Map<string, string>();

function applyPendingOverlays(snap: Snapshot): void {
  if (!pendingDeletes.size && !pendingTitles.size) return;

  // Reconcile against the raw (pre-mask) snapshot: drop masks the backend has
  // caught up on, so they don't linger and suppress a later re-creation.
  const present = new Map<string, string>();
  for (const g of snap.groups) for (const s of g.sessions) present.set(s.id, s.title);
  for (const id of [...pendingDeletes]) if (!present.has(id)) pendingDeletes.delete(id);
  for (const [id, title] of [...pendingTitles]) {
    if (present.get(id) === title) pendingTitles.delete(id);
  }

  for (const g of snap.groups) {
    g.sessions = g.sessions.filter((s) => !pendingDeletes.has(s.id));
    for (const s of g.sessions) {
      const title = pendingTitles.get(s.id);
      if (title) s.title = title;
    }
  }
  if (snap.sections) {
    for (const b of snap.sections) {
      b.session_ids = b.session_ids.filter((id) => !pendingDeletes.has(id));
    }
  }
}

/** Optimistically remove the row, then delete in the background. */
function deleteSession(s: SessionRow): void {
  closeTerminal(s.tmux_session_name);
  pendingDeletes.add(s.id);
  for (const g of groups) g.sessions = g.sessions.filter((row) => row.id !== s.id);
  if (sections) for (const b of sections) b.session_ids = b.session_ids.filter((id) => id !== s.id);
  renderSidebar();
  renderBoard();
  updateTitleBarCounts();
  invoke("delete_session", { id: s.id })
    .then(() => refreshNow()) // a fresh snapshot confirms absence and clears the mask
    .catch((e) => {
      pendingDeletes.delete(s.id); // failed: un-mask so the row returns
      toast(`delete failed: ${e}`, "error");
      void refreshNow();
    });
}

type RowRefs = {
  row: HTMLDivElement;
  main: HTMLDivElement;
  actions: HTMLDivElement;
  status: string;
  session: SessionRow;
};

const rowRefs = new Map<string, RowRefs>(); // keyed by session id

function buildActions(s: SessionRow): HTMLDivElement {
  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.appendChild(actionButton("ⓘ", "Session details", () => toggleDetail(s)));
  actions.appendChild(actionButton("±", "Review diff", () => void openReview(s.id, s.title)));
  if (s.status === "stopped") {
    actions.appendChild(
      actionButton("▶", "Restart session", () => void lifecycle("restart_session", s.id)),
    );
  }
  if (s.status === "running") {
    actions.appendChild(
      confirmButton("■", "Kill session", () => void lifecycle("kill_session", s.id)),
    );
  }
  actions.appendChild(
    confirmButton("✕", "Delete session (removes worktree + branch)", () => deleteSession(s)),
  );
  return actions;
}

/** PR badge: number colored by state, ✓/✗ review decision, draft styling. */
function prBadge(s: SessionRow): HTMLSpanElement | null {
  if (s.pr_number == null) return null;
  const badge = document.createElement("span");
  badge.className = `pr-badge pr-${s.pr_state ?? "open"}`;
  if (s.pr_draft) badge.classList.add("pr-draft");
  let text = `#${s.pr_number}`;
  if (s.review_decision === "approved") text += " ✓";
  if (s.review_decision === "changes_requested") text += " ✗";
  badge.textContent = text;
  badge.title =
    `PR #${s.pr_number} — ${s.pr_draft ? "draft " : ""}${s.pr_state ?? "open"}` +
    (s.review_decision ? `, ${s.review_decision.replace(/_/g, " ")}` : "") +
    (s.pr_labels.length ? `\nLabels: ${s.pr_labels.join(", ")}` : "");
  return badge;
}

/** True when the branch is just a slug of the title (the common case), so it
 *  carries no information worth its own column. */
function branchMatchesTitle(title: string, branch: string): boolean {
  const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug(title) === slug(branch);
}

/** Humanized liveness label. Mirrors renderDetail's `running · <agent_state>`
 *  shape. Used by the board card pill/preview and the palette
 *  (NOT the sidebar row sub-line — there the liveness dot conveys state). */
function humanState(s: SessionRow): string {
  if (s.status === "running") return `running · ${s.agent_state}`;
  return s.status.replace(/_/g, " ");
}

/** Rebuild the inner content of a row's main span (cheap; no input state). */
function fillRowMain(main: HTMLDivElement, s: SessionRow): void {
  main.innerHTML = "";

  // Top line: liveness dot · name · project tag · PR badge · right-side chips.
  const line = document.createElement("div");
  line.className = "row-line";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = s.title;
  title.title = `Branch: ${s.branch}`;
  line.append(statusGlyph(s), title);

  const badge = prBadge(s);
  if (badge) line.appendChild(badge);

  // Right-side chips: ✎ pending comments (mauve), ⚠ blocked (maroon, project
  // -level auto-pull block). Pushed right by .row-chips margin-left:auto.
  const chips = document.createElement("span");
  chips.className = "row-chips";
  if (s.has_pending_comments) {
    const c = document.createElement("span");
    c.className = "comment-badge";
    c.textContent = "✎";
    c.title = "Has pending review comments";
    chips.appendChild(c);
  }
  // pull_blocked is a project-level field; surface ⚠ on rows of a blocked
  // project. (No session-level blocked flag exists — see recon risks.)
  const blocked = groupOf(s.id)?.pull_blocked;
  if (blocked) {
    const b = document.createElement("span");
    b.className = "blocked-badge";
    b.textContent = "⚠";
    b.title = `Auto-pull blocked: ${blocked}`;
    chips.appendChild(b);
  }
  if (chips.childElementCount) line.appendChild(chips);

  // Sub-line: the 8px liveness dot already conveys state, so no textual state
  // label here. SessionRow carries no diff_stat (only SessionDetail does, and
  // we avoid per-row fetches), so there is no "+adds −dels" source for the row;
  // the sub-line shows only the branch when it diverges from the title
  // (otherwise it just repeats the name — always in the hover title), and is
  // omitted entirely when there is nothing to show.
  const showBranch = !branchMatchesTitle(s.title, s.branch);
  if (showBranch) {
    const sub = document.createElement("div");
    sub.className = "row-sub";
    const branch = document.createElement("span");
    branch.className = "meta";
    branch.textContent = s.branch;
    sub.append(branch);
    main.append(line, sub);
    return;
  }

  main.append(line);
}

function sessionMenuItems(refs: RowRefs): MenuItem[] {
  const s = refs.session;
  // Core actions, in the order from the design brief.
  const items: MenuItem[] = [
    { label: "Attach", action: () => void openTerminal(s) },
    { label: "Open shell", action: () => void openShell(s) },
    { label: "Review diff", action: () => void openReview(s.id, s.title) },
    {
      label: "Rename…",
      action: () => {
        renamingId = s.id;
        renderSidebar();
      },
    },
    "separator",
    { label: "Restart", action: () => void lifecycle("restart_session", s.id) },
    {
      label: "Restart fresh",
      action: () => {
        void invoke("restart_fresh", { tmuxSession: s.tmux_session_name })
          .catch((e) => toast(`restart_fresh failed: ${e}`, "error"))
          .finally(() => void refreshNow());
      },
    },
    {
      label: "Kill — stop process",
      warning: true,
      action: () => void lifecycle("kill_session", s.id),
    },
    "separator",
    {
      label: "Delete session…",
      danger: true,
      action: () => {
        void deleteSessionDialog(s.title, s.branch).then((ok) => {
          if (ok) deleteSession(s);
        });
      },
    },
  ];

  // Secondary capabilities, preserved below a separator so the rework doesn't
  // drop existing functionality (details, editor, PR, cascade, sections).
  const extras: MenuItem[] = [
    { label: "Details", action: () => toggleDetail(s) },
    { label: "Open in editor", action: () => void lifecycle("open_in_editor", s.id) },
  ];
  if (s.pr_url) {
    const url = s.pr_url;
    extras.push({
      label: `Open PR #${s.pr_number}`,
      action: () => void invoke("open_external", { url }),
    });
  }
  extras.push({
    label: "Cascade-merge main → stack",
    action: () => void invokeToast("cascade_merge", { id: s.id }),
  });
  extras.push({
    label: "Push stack to origin",
    action: () => void invokeToast("push_stack", { id: s.id }),
  });
  if (s.status === "cascade_paused") {
    extras.push({
      label: "Resume cascade",
      action: () => void invokeToast("cascade_resume", {}),
    });
    extras.push({
      label: "Abandon cascade",
      danger: true,
      action: () => void invokeToast("cascade_abandon", {}),
    });
  }
  if (sectionNames.length) {
    for (const name of sectionNames) {
      if (name !== s.current_section) {
        extras.push({
          label: `Move to section: ${name}`,
          action: () => void lifecycleArgs("move_to_section", { id: s.id, section: name }),
        });
      }
    }
    if (s.current_section) {
      extras.push({
        label: "Clear section pin",
        action: () => void lifecycleArgs("move_to_section", { id: s.id, section: null }),
      });
    }
  }

  items.push("separator", ...extras);
  return items;
}

/** Inline rename input shown in place of the row's title. */
function renderRenameInput(s: SessionRow): HTMLInputElement {
  const input = noTextAssist(document.createElement("input"));
  input.className = "rename-input";
  input.value = s.title;
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      renamingId = null;
      renderSidebar();
    }
    if (e.key === "Enter" && input.value.trim()) {
      const title = input.value.trim();
      renamingId = null;
      // Optimistic: show the new title immediately; the mask clears once a
      // snapshot carries the new title (see applyPendingOverlays).
      pendingTitles.set(s.id, title);
      s.title = title;
      invoke("rename_session", { id: s.id, title })
        .then(() => refreshNow())
        .catch((err) => {
          pendingTitles.delete(s.id); // failed: un-mask so the old title returns
          toast(`rename failed: ${err}`, "error");
          void refreshNow();
        });
      renderSidebar();
    }
  });
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
  return input;
}

function renderSessionRow(s: SessionRow): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "session-row";
  if (s.stacked_child) row.classList.add("stacked");

  const main = document.createElement("div");
  main.className = "row-main";

  const refs: RowRefs = { row, main, actions: buildActions(s), status: s.status, session: s };
  rowRefs.set(s.id, refs);

  if (renamingId === s.id) {
    main.appendChild(renderRenameInput(s));
    row.append(main, refs.actions);
    return row;
  }

  row.append(main, refs.actions);
  row.addEventListener("click", () => {
    selectRow(refs.session.id);
    void openTerminal(refs.session);
  });
  row.addEventListener("contextmenu", (e) => showContextMenu(e, sessionMenuItems(refs)));
  // Draggable onto a section header (section view only). Not set in rename mode:
  // that branch returns above, and draggable=true suppresses input text selection.
  row.draggable = true;
  row.dataset.id = s.id;
  row.addEventListener("dragstart", (e) => {
    draggingSessionId = refs.session.id;
    row.classList.add("dragging");
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  });
  row.addEventListener("dragend", () => {
    draggingSessionId = null;
    row.classList.remove("dragging");
    clearDropTargets();
  });
  updateRow(refs, s);
  return row;
}

type StackUnit =
  | { kind: "single"; session: SessionRow }
  | { kind: "stack"; parent: SessionRow; children: SessionRow[] };

/** Infer cascade stacks from an ordered row list: a non-stacked parent followed
 *  by its consecutive `stacked_child` rows forms one stack (the backend keeps a
 *  stack root + its children contiguous). Children with no preceding parent
 *  (can't happen within one project, but guard anyway) fall back to singles. */
function groupStacks(rows: SessionRow[]): StackUnit[] {
  const units: StackUnit[] = [];
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    if (s.stacked_child) {
      units.push({ kind: "single", session: s }); // orphan child — render flat
      continue;
    }
    const children: SessionRow[] = [];
    while (i + 1 < rows.length && rows[i + 1].stacked_child) {
      children.push(rows[++i]);
    }
    units.push(children.length ? { kind: "stack", parent: s, children } : { kind: "single", session: s });
  }
  return units;
}

/** A cascade stack: bordered group (faint mauve tint) with a header carrying the
 *  stack name (parent title) and merge/push/⋯ actions, then the parent +
 *  indented child rows (each child gets a project-color left border). */
function renderStack(parent: SessionRow, children: SessionRow[]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = `stack ${projClass(parent.project_id)}`;

  const header = document.createElement("div");
  header.className = "stack-header";
  const glyph = document.createElement("span");
  glyph.className = "stack-glyph";
  glyph.textContent = "⌗";
  glyph.title = "Cascade stack";
  const name = document.createElement("span");
  name.className = "stack-name";
  name.textContent = parent.title;
  name.title = parent.title;
  header.append(glyph, name);

  const actions = document.createElement("span");
  actions.className = "stack-actions";
  const merge = actionButton("⛙", "Cascade-merge main → stack", () =>
    void invokeToast("cascade_merge", { id: parent.id }),
  );
  merge.classList.add("stack-merge");
  const push = actionButton("↑", "Push stack to origin", () =>
    void invokeToast("push_stack", { id: parent.id }),
  );
  push.classList.add("stack-push");
  // ⋯ opens the session menu (resume/abandon live there, gated on cascade_paused)
  // positioned at the click; can't reuse actionButton, which swallows the event.
  const more = document.createElement("button");
  more.className = "row-action";
  more.textContent = "⋯";
  more.title = "Stack actions";
  more.addEventListener("click", (e) => {
    e.stopPropagation();
    const refs = rowRefs.get(parent.id);
    if (refs) showContextMenu(e, sessionMenuItems(refs));
  });
  actions.append(merge, push, more);
  header.append(actions);

  wrap.append(header, renderSessionRow(parent));
  for (const c of children) wrap.append(renderSessionRow(c));
  return wrap;
}

/** Drop the section-header highlight from any header still showing it. */
function clearDropTargets(): void {
  for (const el of sessionsEl.querySelectorAll(".project-header.drop-target")) {
    el.classList.remove("drop-target");
  }
}

/** Refresh a row's dynamic bits without rebuilding it (preserves hover/confirm state). */
function updateRow(refs: RowRefs, s: SessionRow): void {
  refs.session = s;
  if (renamingId === s.id) return; // don't clobber the rename input
  fillRowMain(refs.main, s);
  refs.row.classList.toggle("active", s.tmux_session_name === activeTerm);
  refs.row.classList.toggle("attached", terminals.has(s.tmux_session_name));
  refs.row.classList.toggle("selected", s.id === selectedId);
  if (refs.status !== s.status) {
    const actions = buildActions(s);
    refs.row.replaceChild(actions, refs.actions);
    refs.actions = actions;
    refs.status = s.status;
  }
}

function renderCreateInput(group: ProjectGroup): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "create-input";
  const input = noTextAssist(document.createElement("input"));
  input.placeholder = "new session title…";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      newSessionProject = null;
      renderSidebar();
    }
    if (e.key === "Enter" && input.value.trim()) {
      const title = input.value.trim();
      newSessionProject = null;
      input.disabled = true;
      invoke("create_session", { projectPath: group.repo_path, title })
        .catch((err) => toast(`create failed: ${err}`, "error"))
        .finally(() => void refreshNow());
    }
  });
  wrap.appendChild(input);
  setTimeout(() => input.focus(), 0);
  return wrap;
}

let sidebarSignature = "";

/**
 * Rebuild the sidebar DOM only when its structure (projects, session set/order,
 * open create-input) changes; otherwise patch rows in place. A periodic full
 * rebuild would wipe the create-input text and confirm-button state every tick.
 */
function projectMenuItems(group: ProjectGroup, createKey: string = group.id): MenuItem[] {
  return [
    {
      label: "New session…",
      action: () => {
        newSessionProject = createKey;
        renderSidebar();
      },
    },
    { label: "Project shell", action: () => void openProjectShell(group) },
    "separator",
    {
      label: "Remove project (deletes all its sessions)",
      danger: true,
      action: () => {
        void confirmDialog(
          `Remove project "${group.name}" and all ${group.sessions.length} session(s)?\nWorktrees and tmux sessions will be removed.`,
          "Remove",
        ).then((ok) => {
          if (ok) void lifecycle("remove_project", group.id);
        });
      },
    },
  ];
}

/** Longest common prefix of a list of strings (drives Tab completion). */
function longestCommonPrefix(strings: string[]): string {
  if (!strings.length) return "";
  let prefix = strings[0];
  for (const s of strings.slice(1)) {
    while (prefix && !s.startsWith(prefix)) prefix = prefix.slice(0, -1);
    if (!prefix) break;
  }
  return prefix;
}

/** Path input at the top of the sidebar for add-project / scan-directory, with
 *  a live directory-completion dropdown (Tab → common prefix, ↑/↓ to pick,
 *  Enter on a match drills in, Enter on free text commits) and a native folder
 *  picker via "Browse…". Seeded with `~/` so the first listing shows $HOME. */
function renderTopInput(mode: "add" | "scan"): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "create-input path-input";
  const row = document.createElement("div");
  row.className = "path-input-row";
  const input = noTextAssist(document.createElement("input"));
  input.placeholder = mode === "add" ? "path to git repo…" : "directory to scan for repos…";
  input.value = "~/";
  const browse = document.createElement("button");
  browse.className = "path-browse";
  browse.textContent = "Browse…";
  const listEl = document.createElement("div");
  listEl.className = "path-completions";
  row.append(input, browse);
  wrap.append(row, listEl);

  let completions: string[] = [];
  let selected = -1; // -1 = nothing highlighted (Enter commits the typed value)
  let debounce: number | undefined;

  function renderCompletions(): void {
    listEl.innerHTML = "";
    completions.forEach((c, i) => {
      const r = document.createElement("div");
      r.className = "path-completion";
      r.classList.toggle("selected", i === selected);
      r.textContent = c;
      // mousedown (not click) so the pick lands before the input's blur.
      r.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = `${c}/`;
        selected = -1;
        void refresh();
        input.focus();
      });
      listEl.appendChild(r);
    });
  }

  async function refresh(): Promise<void> {
    let next: string[];
    try {
      next = await invoke<string[]>("complete_path", { partial: input.value });
    } catch {
      next = [];
    }
    completions = next;
    selected = completions.length ? Math.min(selected, completions.length - 1) : -1;
    renderCompletions();
  }

  function commit(path: string): void {
    topInput = null;
    input.disabled = true;
    const call =
      mode === "add"
        ? invoke("add_project", { path })
        : invoke<{ added: number; skipped: number }>("scan_directory", { path }).then((r) =>
            toast(`Scan complete: ${r.added} added, ${r.skipped} already present`),
          );
    call
      .catch((err) => toast(`${mode === "add" ? "add project" : "scan"} failed: ${err}`, "error"))
      .finally(() => void refreshNow());
    renderSidebar();
  }

  input.addEventListener("input", () => {
    selected = -1;
    clearTimeout(debounce);
    debounce = window.setTimeout(() => void refresh(), 100);
  });

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      topInput = null;
      renderSidebar();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (completions.length) {
        selected = (selected + 1) % completions.length;
        renderCompletions();
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (completions.length) {
        selected = selected <= 0 ? completions.length - 1 : selected - 1;
        renderCompletions();
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const lcp = longestCommonPrefix(completions);
      if (lcp && lcp.length > input.value.length) {
        input.value = lcp;
        void refresh();
      }
      return;
    }
    if (e.key === "Enter") {
      // A highlighted row drills into that directory; otherwise commit the
      // typed path (the "I typed the full path, just add it" case).
      if (selected >= 0 && completions[selected]) {
        input.value = `${completions[selected]}/`;
        selected = -1;
        void refresh();
      } else if (input.value.trim()) {
        commit(input.value.trim());
      }
    }
  });

  browse.addEventListener("click", () => {
    void openFolderDialog({ directory: true }).then((picked) => {
      if (typeof picked === "string") {
        input.value = picked;
        input.focus();
        void refresh();
      }
    });
  });

  setTimeout(() => {
    input.focus();
    void refresh();
  }, 0);
  return wrap;
}

async function deleteMergedSessions(): Promise<void> {
  let merged: [string, string][];
  try {
    merged = await invoke<[string, string][]>("merged_pr_sessions");
  } catch (e) {
    toast(`failed to list merged sessions: ${e}`, "error");
    return;
  }
  if (!merged.length) {
    toast("No sessions with merged PRs");
    return;
  }
  const preview = merged
    .slice(0, 8)
    .map(([, branch]) => `  • ${branch}`)
    .join("\n");
  const more = merged.length > 8 ? `\n  … and ${merged.length - 8} more` : "";
  const ok = await confirmDialog(
    `Delete ${merged.length} session(s) with merged PRs?\n\n${preview}${more}\n\nThis removes their worktrees and branches.`,
    "Delete all",
  );
  if (!ok) return;
  for (const [id] of merged) {
    const row = findSession(id);
    if (row) {
      deleteSession(row);
    } else {
      await invoke("delete_session", { id }).catch((e) => toast(`delete failed: ${e}`, "error"));
    }
  }
}

function sidebarMenuItems(): MenuItem[] {
  return [
    {
      label: "Add project…",
      action: () => {
        topInput = "add";
        renderSidebar();
      },
    },
    {
      label: "Scan directory for repos…",
      action: () => {
        topInput = "scan";
        renderSidebar();
      },
    },
    "separator",
    { label: "Settings…", action: () => void openSettings() },
    { label: "Help", action: toggleHelp },
    "separator",
    {
      label: "Delete merged-PR sessions…",
      danger: true,
      action: () => void deleteMergedSessions(),
    },
  ];
}

/** Project list for the sidebar "New session…" picker. Sourced from `groups`,
 *  so it includes projects with no sessions — the one path to create a session
 *  for them in section views, where sessionless projects have no sub-header. */
function projectPickerItems(): MenuItem[] {
  if (!groups.length) {
    return [{ label: "No projects — add one first", action: () => {} }];
  }
  return groups.map((g) => ({
    label: g.name,
    action: () => void createSessionInProject(g),
  }));
}

async function createSessionInProject(group: ProjectGroup): Promise<void> {
  const title = await promptDialog(`New session in ${group.name}`, "session title…", "Create");
  if (!title) return;
  invoke("create_session", { projectPath: group.repo_path, title })
    .catch((err) => toast(`create failed: ${err}`, "error"))
    .finally(() => void refreshNow());
}

function cycleViewMode(): void {
  const order = ["project", "sections", "section_stacks"];
  const next = order[(order.indexOf(viewMode) + 1) % order.length];
  invoke("set_view_mode", { mode: next })
    .then(() => refreshNow())
    .catch((e) => toast(`${e}`, "error"));
}

/** Switch grouping to an explicit mode (the GROUP BY segmented control).
 *  viewMode is backend-owned — never set locally — so we round-trip through
 *  set_view_mode and let the next snapshot reflect it (mirror cycleViewMode). */
function setViewMode(mode: string): void {
  if (mode === viewMode) return;
  invoke("set_view_mode", { mode })
    .then(() => refreshNow())
    .catch((e) => toast(`${e}`, "error"));
}

/** GROUP BY segmented control. Binary [Sections | Projects], bound to viewMode
 *  (Projects→"project", Sections→"sections"). "section_stacks" still counts as
 *  the Sections side and stays reachable via the palette's cycleViewMode. */
function renderGroupByBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "group-by-bar";
  const label = document.createElement("span");
  label.className = "group-by-label";
  label.textContent = "GROUP BY";

  const seg = document.createElement("div");
  seg.className = "segmented";
  const sectionsActive = viewMode === "sections" || viewMode === "section_stacks";

  const sectionsBtn = document.createElement("button");
  sectionsBtn.className = "segment";
  sectionsBtn.textContent = "Sections";
  sectionsBtn.classList.toggle("active", sectionsActive);
  sectionsBtn.addEventListener("click", () => setViewMode("sections"));

  const projectsBtn = document.createElement("button");
  projectsBtn.className = "segment";
  projectsBtn.textContent = "Projects";
  projectsBtn.classList.toggle("active", !sectionsActive);
  projectsBtn.addEventListener("click", () => setViewMode("project"));

  seg.append(sectionsBtn, projectsBtn);
  bar.append(label, seg);
  return bar;
}

/** Banner shown when a project filter is active, with a clear affordance. */
function renderFilterBanner(group: ProjectGroup): HTMLElement {
  const banner = document.createElement("div");
  banner.className = "filter-banner";
  const square = document.createElement("span");
  square.className = `proj-square ${projClass(group.id)}`;
  const text = document.createElement("span");
  text.className = "filter-text";
  text.textContent = `filtered to ${group.name}`;
  const clear = document.createElement("button");
  clear.className = "row-action";
  clear.textContent = "✕";
  clear.title = "Clear project filter";
  clear.addEventListener("click", () => {
    projectFilter = null;
    renderSidebar();
  });
  banner.append(square, text, clear);
  return banner;
}

/** Render section-grouped views: section headers with rows looked up by id. */
function renderSections(buckets: SectionBucket[]): void {
  const projById = new Map(groups.map((g) => [g.id, g]));
  buckets.forEach((bucket, bucketIndex) => {
    // Compose with the project filter: only the filtered project's ids survive.
    const ids = projectFilter
      ? bucket.session_ids.filter((id) => findSession(id)?.project_id === projectFilter)
      : bucket.session_ids;
    const header = document.createElement("div");
    header.className = "project-header";
    const name = document.createElement("span");
    name.textContent = bucket.name;
    const count = document.createElement("span");
    count.className = "meta";
    count.textContent = String(ids.length);
    header.append(name, count, headerRule());
    const isCollapsed = makeCollapsible(header, name, `sect:${bucket.name}`);
    makeSectionDropTarget(header, bucket, bucketIndex);
    sessionsEl.appendChild(header);
    if (isCollapsed) return;

    // Cluster the section's sessions by project, preserving first-seen project
    // order and within-project order — a stack never spans projects, so its
    // root and indented children stay contiguous.
    const order: string[] = [];
    const byProject = new Map<string, SessionRow[]>();
    for (const id of ids) {
      const s = findSession(id);
      if (!s) continue;
      let rows = byProject.get(s.project_id);
      if (!rows) {
        rows = [];
        byProject.set(s.project_id, rows);
        order.push(s.project_id);
      }
      rows.push(s);
    }

    for (const pid of order) {
      const rows = byProject.get(pid)!;
      const group = projById.get(pid);
      if (group) {
        sessionsEl.appendChild(renderProjectSubheader(group, bucket.name));
        if (newSessionProject === sectionCreateKey(bucket.name, group.id)) {
          sessionsEl.appendChild(renderCreateInput(group));
        }
      }
      renderRows(rows);
      visibleGroups.push(rows.map((s) => s.id));
    }
  });
}

/** A project sub-header shown inside a section bucket: names the project and
 *  carries the same new-session affordances as the real project header. Not a
 *  drop target — only section headers accept dropped sessions. */
function renderProjectSubheader(group: ProjectGroup, sectionName: string): HTMLDivElement {
  const key = sectionCreateKey(sectionName, group.id);
  const header = document.createElement("div");
  header.className = "project-subheader";
  const name = document.createElement("span");
  name.textContent = group.name;
  const add = document.createElement("button");
  add.className = "row-action";
  add.textContent = "+";
  add.title = "New session in this project";
  add.addEventListener("click", (e) => {
    e.stopPropagation();
    newSessionProject = newSessionProject === key ? null : key;
    renderSidebar();
  });
  const buttons = document.createElement("span");
  buttons.className = "header-buttons";
  buttons.append(add);
  header.append(name, buttons);
  header.addEventListener("contextmenu", (e) =>
    showContextMenu(e, projectMenuItems(group, key)),
  );
  return header;
}

/** Wire a section header as a drop target for a dragged session row. Dropping
 *  pins the session to this section (or clears the pin on the index-0
 *  "In Progress" catch-all). Only headers call preventDefault on dragover, so
 *  drops can't land anywhere else. */
function makeSectionDropTarget(
  header: HTMLDivElement,
  bucket: SectionBucket,
  bucketIndex: number,
): void {
  header.addEventListener("dragover", (e) => {
    if (!draggingSessionId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    header.classList.add("drop-target");
  });
  header.addEventListener("dragleave", () => header.classList.remove("drop-target"));
  header.addEventListener("drop", (e) => {
    if (!draggingSessionId) return;
    e.preventDefault();
    header.classList.remove("drop-target");
    const id = draggingSessionId;
    // buckets[0] is always the reserved "In Progress" catch-all; dropping there
    // clears the pin (section: null), which the backend re-runs predicates on.
    const target = bucketIndex === 0 ? null : bucket.name;
    const current = findSession(id)?.current_section ?? null;
    if (current === target) return; // no-op drop
    void lifecycleArgs("move_to_section", { id, section: target });
  });
}

function renderSidebar(): void {
  const signature =
    groups
      .map((g) => `${g.id}@${g.pull_blocked}:${g.sessions.map((s) => s.id).join(",")}`)
      .join("|") +
    `#${newSessionProject}#${renamingId}#${topInput}#${viewMode}#${projectFilter}` +
    `#${sections?.map((b) => `${b.name}=${b.session_ids.join(",")}`).join("|") ?? ""}` +
    `#${[...collapsed].sort().join(",")}`;

  if (signature === sidebarSignature) {
    for (const group of groups) {
      for (const s of group.sessions) {
        const refs = rowRefs.get(s.id);
        if (refs) updateRow(refs, s);
      }
    }
    return;
  }

  sidebarSignature = signature;
  rowRefs.clear();
  visibleGroups = [];
  // A rebuild (e.g. a poll refresh mid-drag) discards the dragged row's node, so
  // dragend may never fire — drop the stale id rather than leave it dangling.
  draggingSessionId = null;
  sessionsEl.innerHTML = "";
  if (topInput) {
    sessionsEl.appendChild(renderTopInput(topInput));
  }

  // Grouping control, shown in every view.
  sessionsEl.appendChild(renderGroupByBar());

  // When a project filter is active, show a banner with a clear affordance.
  const filterGroup = projectFilter ? groups.find((g) => g.id === projectFilter) : undefined;
  if (filterGroup) {
    sessionsEl.appendChild(renderFilterBanner(filterGroup));
  }

  if (sections) {
    // Section views group by section, so an empty project has no sub-header to
    // hang a "+" on. This full-width button is the universal create path there:
    // pick any project (incl. sessionless ones), then enter a title.
    const newBtn = document.createElement("button");
    newBtn.className = "new-session-btn";
    newBtn.textContent = "+ New session";
    newBtn.addEventListener("click", (e) => showContextMenu(e, projectPickerItems()));
    sessionsEl.appendChild(newBtn);
    renderSections(sections);
    return;
  }

  for (const group of groups) {
    if (projectFilter && group.id !== projectFilter) continue;
    const header = document.createElement("div");
    header.className = "project-header";
    const square = document.createElement("span");
    square.className = `proj-square ${projClass(group.id)}`;
    const name = document.createElement("span");
    name.textContent = group.name;
    if (group.pull_blocked) {
      const blocked = document.createElement("span");
      blocked.className = "pull-blocked";
      blocked.textContent = "⇣!";
      blocked.title = `Auto-pull of main blocked: ${group.pull_blocked}`;
      name.appendChild(blocked);
    }
    const buttons = document.createElement("span");
    buttons.className = "header-buttons";
    const shell = document.createElement("button");
    shell.className = "row-action";
    shell.textContent = "$";
    shell.title = "Project shell";
    shell.addEventListener("click", (e) => {
      e.stopPropagation();
      void openProjectShell(group);
    });
    const add = document.createElement("button");
    add.className = "row-action";
    add.textContent = "+";
    add.title = "New session in this project";
    add.addEventListener("click", (e) => {
      e.stopPropagation();
      newSessionProject = newSessionProject === group.id ? null : group.id;
      collapsed.delete(`proj:${group.id}`); // the create input must be visible
      renderSidebar();
    });
    buttons.append(shell, add);
    const count = document.createElement("span");
    count.className = "meta";
    count.textContent = String(group.sessions.length);
    header.append(square, name, count, headerRule(), buttons);
    const isCollapsed = makeCollapsible(header, name, `proj:${group.id}`);
    header.addEventListener("contextmenu", (e) => showContextMenu(e, projectMenuItems(group)));
    sessionsEl.appendChild(header);
    if (isCollapsed) continue;

    if (newSessionProject === group.id) {
      sessionsEl.appendChild(renderCreateInput(group));
    }
    if (!group.sessions.length && projectFilter === group.id) {
      sessionsEl.appendChild(renderEmptyProject(group));
      continue;
    }
    renderRows(group.sessions);
    visibleGroups.push(group.sessions.map((s) => s.id));
  }
}

/** Render an ordered row list, folding consecutive stacked_child rows into a
 *  bordered stack group. Shared by both groupings. */
function renderRows(rows: SessionRow[]): void {
  for (const unit of groupStacks(rows)) {
    if (unit.kind === "stack") {
      sessionsEl.appendChild(renderStack(unit.parent, unit.children));
    } else {
      sessionsEl.appendChild(renderSessionRow(unit.session));
    }
  }
}

/** Empty-project state shown when filtered to a project with no sessions: a
 *  dashed "＋" tile plus new-session / shell affordances (reusing the rail's
 *  backend wiring). */
function renderEmptyProject(group: ProjectGroup): HTMLDivElement {
  const block = document.createElement("div");
  block.className = "empty-project";
  const tile = document.createElement("div");
  tile.className = "empty-tile";
  tile.textContent = "＋";
  const msg = document.createElement("div");
  msg.className = "empty-msg";
  msg.textContent = `No sessions in ${group.name} yet`;
  const actions = document.createElement("div");
  actions.className = "empty-actions";
  const create = document.createElement("button");
  create.className = "row-action";
  create.textContent = "＋ New session";
  create.addEventListener("click", () => void createSessionInProject(group));
  const shell = document.createElement("button");
  shell.className = "row-action";
  shell.textContent = "$ Shell";
  shell.addEventListener("click", () => void openProjectShell(group));
  actions.append(create, shell);
  block.append(tile, msg, actions);
  return block;
}

document.querySelector<HTMLButtonElement>("#sidebar-menu")!.addEventListener("click", (e) => {
  showContextMenu(e, sidebarMenuItems());
});

// ----------------------------------------------------------------- title bar

const appEl = document.querySelector<HTMLElement>("#app")!;
const boardEl = document.querySelector<HTMLElement>("#board")!;
const boardFilterEl = document.querySelector<HTMLDivElement>("#board-filter")!;
const boardColumnsEl = document.querySelector<HTMLDivElement>("#board-columns")!;
const boardDockEl = document.querySelector<HTMLDivElement>("#board-dock")!;
const boardDockSurfaceEl = document.querySelector<HTMLDivElement>("#board-dock-surface")!;
const boardDockPlaceholderEl = document.querySelector<HTMLDivElement>("#board-dock-placeholder")!;
const boardDockNameEl = document.querySelector<HTMLSpanElement>("#board-dock-name")!;
const boardDockBranchEl = document.querySelector<HTMLSpanElement>("#board-dock-branch")!;
const tbCount = document.querySelector<HTMLElement>("#tb-count")!;
const tbConsole = document.querySelector<HTMLButtonElement>("#tb-console")!;
const tbBoard = document.querySelector<HTMLButtonElement>("#tb-board")!;

function updateTitleBarCounts(): void {
  const total = groups.reduce((n, g) => n + g.sessions.length, 0);
  const live = groups.flatMap((g) => g.sessions).filter((s) => s.status === "running").length;
  tbCount.textContent = `${total} sessions · ${live} live`;
}

function setLayout(next: "console" | "board"): void {
  if (next === layout) return;
  // Split lives only in console. Collapse it (keeping the focused pane) while
  // the DOM is still in console layout, before switching surfaces.
  if (splitActive()) exitSplit(focusedSlot ? panes.get(focusedSlot)! : activeTerm);
  layout = next;
  localStorage.setItem("cc-layout", next);
  closeReview();
  appEl.classList.toggle("board-mode", next === "board");
  boardEl.classList.toggle("hidden", next !== "board");
  tbConsole.classList.toggle("active", next === "console");
  tbBoard.classList.toggle("active", next === "board");
  // Re-parent the active terminal into/out of the dock now that the target
  // surface is visible, then fit it (dock/undock fit internally).
  if (next === "board") {
    dockDetached = false; // a fresh board entry re-docks the active terminal
    dockActiveTerminal();
  } else {
    setDockFullscreen(false);
    undockTerminal();
  }
}

tbConsole.addEventListener("click", () => setLayout("console"));
tbBoard.addEventListener("click", () => setLayout("board"));
document.querySelector<HTMLButtonElement>("#tb-jump")!.addEventListener("click", () => togglePalette());
document
  .querySelector<HTMLButtonElement>("#tb-theme")!
  .addEventListener("click", () => openThemeModal(currentTheme().appearance));
document.querySelector<HTMLButtonElement>("#tb-help")!.addEventListener("click", () => toggleHelp());

// Initialize segment + board visibility from persisted layout.
appEl.classList.toggle("board-mode", layout === "board");
boardEl.classList.toggle("hidden", layout !== "board");
tbConsole.classList.toggle("active", layout === "console");
tbBoard.classList.toggle("active", layout === "board");
// Dock the active terminal (if any) when booting straight into board mode.
if (layout === "board") dockActiveTerminal();

// Dock "×" detaches: undock the terminal back to #terminals and show the dock
// placeholder. It does NOT kill the PTY — the session stays attached and the
// terminal reappears in Console (or on the next card ▸). Also drops out of the
// fullscreen overlay if it was open (nothing left to show fullscreen).
document.querySelector<HTMLButtonElement>("#board-dock-close")!.addEventListener("click", () => {
  setDockFullscreen(false);
  undockTerminal();
  dockDetached = true;
  updateDockHeader();
});
// Dock "⤢": float the docked terminal into a centred ~85% overlay over a dimmed
// backdrop — obviously a dismissable dialog, not a panel that ate the window.
// Toggling clears any drag-set inline height so the overlay's CSS size wins, and
// re-fits the xterm into the new surface.
const boardDockBackdropEl = document.querySelector<HTMLDivElement>("#board-dock-backdrop")!;
function setDockFullscreen(on: boolean): void {
  boardDockEl.classList.toggle("dock-fullscreen", on);
  boardDockBackdropEl.classList.toggle("hidden", !on);
  // makeResizable sets an inline `position: relative` (+ height) on the dock, and
  // inline styles beat the overlay's stylesheet rule — so toggle them directly.
  if (on) {
    boardDockEl.style.position = "fixed";
    boardDockEl.style.height = ""; // let the overlay's CSS inset size win
  } else {
    boardDockEl.style.position = "relative";
    const saved = Number(localStorage.getItem("cc-dock-height"));
    boardDockEl.style.height = saved ? `${saved}px` : ""; // restore the resized height
  }
  if (layout === "board") dockActiveTerminal();
}
document.querySelector<HTMLButtonElement>("#board-dock-expand")!.addEventListener("click", () => {
  setDockFullscreen(!boardDockEl.classList.contains("dock-fullscreen"));
});
boardDockBackdropEl.addEventListener("click", () => setDockFullscreen(false));

// Dock vertical resize: drag the separator between the columns and the dock to
// set the dock height. Re-fits the docked xterm on each frame.
makeResizable({
  key: "cc-dock-height",
  target: boardDockEl,
  edge: "top",
  min: 120,
  max: 600,
  onResize: () => {
    if (layout === "board") dockActiveTerminal();
  },
});

// ------------------------------------------------------------ commander chip

const commanderChip = document.querySelector<HTMLElement>("#commander-chip")!;

function renderCommander(c: Snapshot["commander"]): void {
  commanderChip.classList.toggle("hidden", !c.enabled);
  if (!c.enabled) return;
  commanderChip.innerHTML = "";
  const square = document.createElement("span");
  square.className = "commander-square";
  square.title = c.running ? "running" : "stopped";
  const label = document.createElement("span");
  label.className = "commander-label";
  label.textContent = "commander";
  const attach = document.createElement("span");
  attach.className = "commander-attach";
  attach.textContent = "attach ⏎";
  commanderChip.append(square, label, attach);
}

commanderChip.addEventListener("click", () => {
  void (async () => {
    let name: string;
    try {
      name = await invoke<string>("prepare_commander");
    } catch (e) {
      toast(`commander failed: ${e}`, "error");
      return;
    }
    await attachTerminal(name, "commander", null);
  })();
});

// ------------------------------------------------------------------- board
//
// The Board layout renders the SAME snapshot `groups` as the sidebar — one
// column per project, agent cards inside — reusing the Console helpers
// (projClass / applyStatusGlyph / humanState / sessionMenuItems / openReview /
// openTerminal). Selection is shared with the sidebar via `selectedId`.

/** Card DOM refs by session id, so updateSelectionClasses can toggle the
 *  selected border without a full rebuild. Rebuilt on every renderBoard. */
const boardCardRefs = new Map<string, HTMLDivElement>();

/** Per-session diffstat cache, lazily filled from get_session_detail, keyed by
 *  id so a card keeps its bar across re-renders. `null` = fetched, no diff;
 *  absent = not yet fetched. */
const boardDiffStats = new Map<string, string | null>();
const boardDiffPending = new Set<string>();

/** Map a liveness `.dot` state class to the semantic token class the accent
 *  bar / state pill use. Keeps the board in lockstep with the dot colours
 *  without re-deriving the status logic (we read applyStatusGlyph's output). */
function boardStateClass(s: SessionRow): string {
  const probe = document.createElement("span");
  applyStatusGlyph(probe, s);
  for (const cls of STATUS_GLYPH_CLASSES) {
    if (probe.classList.contains(cls)) return `state-${cls.slice(4)}`; // dot-running → state-running
  }
  return "state-idle";
}

/** Does a session pass the active board filter pill? The base pill and the
 *  optional custom-section pill both must pass; search composes on top. */
function boardMatchesFilter(s: SessionRow): boolean {
  if (boardSectionFilter && s.current_section !== boardSectionFilter) return false;
  switch (boardFilter) {
    case "review":
      return s.has_pending_comments;
    case "running":
      return s.status === "running";
    case "blocked":
      return groupOf(s.id)?.pull_blocked != null;
    default:
      return true;
  }
}

function boardMatchesSearch(s: SessionRow): boolean {
  if (!boardSearch) return true;
  return s.title.toLowerCase().includes(boardSearch.toLowerCase());
}

/** Sessions of a project visible under the current filter + search. */
function boardVisibleSessions(g: ProjectGroup): SessionRow[] {
  return g.sessions.filter((s) => boardMatchesFilter(s) && boardMatchesSearch(s));
}

/** Lazy-fetch a session's diffstat for its card bar; fill in place when it
 *  lands. Skips while a fetch is in flight or already cached. */
function ensureBoardDiffStat(id: string, bar: HTMLElement): void {
  if (boardDiffStats.has(id)) {
    fillDiffstatBar(bar, boardDiffStats.get(id) ?? null);
    return;
  }
  if (boardDiffPending.has(id)) return;
  boardDiffPending.add(id);
  invoke<SessionDetail | null>("get_session_detail", { id })
    .then((d) => {
      boardDiffStats.set(id, d?.diff_stat ?? null);
      if (bar.isConnected) fillDiffstatBar(bar, d?.diff_stat ?? null);
    })
    .catch(() => {
      /* transient — leave uncached so a later render retries */
    })
    .finally(() => boardDiffPending.delete(id));
}

/** Render a diffstat into a card's bar: colorized +adds/−dels counts above a
 *  proportional add/remove bar. Mirrors renderDetail's parsing. Omits both when
 *  there is no diff (graceful — never fabricated). */
function fillDiffstatBar(container: HTMLElement, diffStat: string | null): void {
  container.innerHTML = "";
  if (!diffStat) {
    container.classList.add("hidden");
    return;
  }
  let adds = 0;
  let dels = 0;
  const counts = document.createElement("div");
  counts.className = "card-diffcounts";
  for (const token of diffStat.split(/(\+\d+|-\d+)/)) {
    if (/^\+\d+$/.test(token)) {
      adds += Number(token.slice(1));
      const span = document.createElement("span");
      span.className = "added";
      span.textContent = token;
      counts.appendChild(span);
    } else if (/^-\d+$/.test(token)) {
      dels += Number(token.slice(1));
      const span = document.createElement("span");
      span.className = "removed";
      span.textContent = token;
      counts.appendChild(span);
    }
  }
  const total = adds + dels;
  if (total === 0) {
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  const bar = document.createElement("div");
  bar.className = "diffstat-bar";
  const a = document.createElement("span");
  a.className = "added";
  a.style.width = `${(adds / total) * 100}%`;
  const r = document.createElement("span");
  r.className = "removed";
  r.style.width = `${(dels / total) * 100}%`;
  bar.append(a, r);
  container.append(counts, bar);
}

/** One agent card for a session. */
function renderAgentCard(s: SessionRow): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "agent-card";
  card.classList.toggle("selected", selectedId === s.id);
  boardCardRefs.set(s.id, card);

  // 3px top accent bar in the liveness state colour.
  const accent = document.createElement("div");
  accent.className = `card-accent ${boardStateClass(s)}`;
  card.appendChild(accent);

  // Header: liveness dot + name + ⋯ menu. The dot (and the accent bar) already
  // convey the state, so no textual state pill is repeated here.
  const header = document.createElement("div");
  header.className = "card-header";
  const name = document.createElement("span");
  name.className = "card-title";
  name.textContent = s.title;
  name.title = `Branch: ${s.branch}`;
  const menu = document.createElement("button");
  menu.className = "row-action card-menu";
  menu.textContent = "⋯";
  menu.title = "Session menu";
  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    showContextMenu(e, sessionMenuItems(cardRefs(s)));
  });
  header.append(statusGlyph(s), name, menu);
  card.appendChild(header);

  // Branch line under the title — only when it diverges from the title (it's
  // usually just a slug of the name), mirroring the sidebar row. Omitted
  // otherwise to keep cards compact. The PR badge lives in the footer.
  if (!branchMatchesTitle(s.title, s.branch)) {
    const sub = document.createElement("div");
    sub.className = "card-subtitle";
    const branch = document.createElement("span");
    branch.className = "card-branch";
    branch.textContent = s.branch;
    branch.title = `Branch: ${s.branch}`;
    sub.appendChild(branch);
    card.appendChild(sub);
  }

  // Diffstat bar (lazy; hidden until a diff lands).
  const diff = document.createElement("div");
  diff.className = "card-diffstat hidden";
  card.appendChild(diff);
  ensureBoardDiffStat(s.id, diff);

  // Footer: PR badge + ✎/⚠ chips + quick actions ▸ attach (success) / ± review
  // (info). Keeping the PR badge on this always-present row keeps cards a
  // consistent shape rather than adding a variable extra line above.
  const footer = document.createElement("div");
  footer.className = "card-footer";
  const chips = document.createElement("span");
  chips.className = "card-chips";
  const prChip = prBadge(s);
  if (prChip) chips.appendChild(prChip);
  if (s.has_pending_comments) {
    const c = document.createElement("span");
    c.className = "comment-badge";
    c.textContent = "✎";
    c.title = "Has pending review comments";
    chips.appendChild(c);
  }
  const blocked = groupOf(s.id)?.pull_blocked;
  if (blocked) {
    const b = document.createElement("span");
    b.className = "blocked-badge";
    b.textContent = "⚠";
    b.title = `Auto-pull blocked: ${blocked}`;
    chips.appendChild(b);
  }
  const actions = document.createElement("span");
  actions.className = "card-actions";
  // Attach path shared by the ▸ button and a card-body click: select, clear any
  // prior "×" detach, and open the terminal (which docks in board mode).
  const attachCard = (): void => {
    selectRow(s.id);
    dockDetached = false; // an explicit attach re-docks even after a "×" detach
    void openTerminal(s);
  };
  const attach = document.createElement("button");
  attach.className = "card-action attach";
  attach.textContent = "▸";
  attach.title = "Attach";
  attach.addEventListener("click", (e) => {
    e.stopPropagation();
    attachCard();
  });
  const review = document.createElement("button");
  review.className = "card-action review";
  review.textContent = "±";
  review.title = "Review diff";
  review.addEventListener("click", (e) => {
    e.stopPropagation();
    void openReview(s.id, s.title);
  });
  actions.append(attach, review);
  footer.append(chips, actions);
  card.appendChild(footer);

  // Click attaches (same as ▸); right-click opens the same menu as the ⋯ button.
  // The ▸/±/⋯ buttons stopPropagation, so they never double-trigger this.
  card.addEventListener("click", attachCard);
  card.addEventListener("contextmenu", (e) => showContextMenu(e, sessionMenuItems(cardRefs(s))));
  return card;
}

/** Minimal RowRefs for sessionMenuItems from a card (it reads only .session;
 *  rename routes through the sidebar, which is acceptable on the board). */
function cardRefs(s: SessionRow): RowRefs {
  return {
    row: document.createElement("div"),
    main: document.createElement("div"),
    actions: document.createElement("div"),
    status: s.status,
    session: s,
  };
}

// Board column order is GUI-owned (like theme/layout prefs): the backend always
// returns projects alphabetically, and we re-sort client-side from a persisted
// id list so drag-to-reorder sticks across reloads without touching CC config.
const BOARD_ORDER_KEY = "cc-board-col-order";
function loadBoardOrder(): string[] {
  try {
    const raw = localStorage.getItem(BOARD_ORDER_KEY);
    return Array.isArray(JSON.parse(raw ?? "")) ? (JSON.parse(raw!) as string[]) : [];
  } catch {
    return [];
  }
}
let boardColOrder = loadBoardOrder();

/** `groups` re-sorted by the persisted column order. Projects absent from the
 *  saved order (new ones) keep their backend alphabetical position, after the
 *  ranked ones — Array.sort is stable, so unranked relative order is preserved. */
function orderedGroups(): ProjectGroup[] {
  const rank = new Map(boardColOrder.map((id, i) => [id, i] as const));
  return [...groups].sort(
    (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity),
  );
}

/** The column to drop before, given the pointer's x (null = past the last). */
let draggingColId: string | null = null;
function colBeforeX(x: number): HTMLElement | null {
  const cols = [...boardColumnsEl.querySelectorAll<HTMLElement>(".board-col:not(.dragging)")];
  for (const c of cols) {
    const r = c.getBoundingClientRect();
    if (x < r.left + r.width / 2) return c;
  }
  return null;
}

/** Insertion marker, mirroring the tab strip: an accent line on the edge where
 *  the dragged column will land (left for "before", right of the last for end). */
function showColDropMarker(target: HTMLElement | null): void {
  clearColDropMarker();
  if (target) {
    target.classList.add("drop-before");
  } else {
    const cols = boardColumnsEl.querySelectorAll<HTMLElement>(".board-col:not(.dragging)");
    cols[cols.length - 1]?.classList.add("drop-after");
  }
}
function clearColDropMarker(): void {
  for (const c of boardColumnsEl.querySelectorAll(".board-col.drop-before, .board-col.drop-after")) {
    c.classList.remove("drop-before", "drop-after");
  }
}

/** One project column: header (color square + name + visible count + +/$) over
 *  a body of stacked agent cards. Rendered for every project incl. sessionless. */
function renderBoardColumn(g: ProjectGroup): HTMLDivElement {
  const col = document.createElement("div");
  col.className = "board-col";
  col.dataset.project = g.id;

  const header = document.createElement("div");
  header.className = "board-col-header";
  // Drag the header to reorder columns. Commit lands on `drop` (see the
  // boardColumnsEl listeners), so an Esc-cancelled drag leaves the order intact.
  header.draggable = true;
  header.addEventListener("dragstart", (e) => {
    draggingColId = g.id;
    col.classList.add("dragging");
    e.dataTransfer?.setData("text/plain", g.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  });
  header.addEventListener("dragend", () => {
    draggingColId = null;
    col.classList.remove("dragging");
    clearColDropMarker(); // in case the drop landed outside the strip
  });
  const square = document.createElement("span");
  square.className = `proj-square ${projClass(g.id)}`;
  const name = document.createElement("span");
  name.className = "board-col-name";
  name.textContent = g.name;
  name.title = g.name;

  const visible = boardVisibleSessions(g);
  const count = document.createElement("span");
  count.className = "board-col-count";
  count.textContent = String(visible.length);

  const add = document.createElement("button");
  add.className = "proj-btn add";
  add.textContent = "+";
  add.title = "New session in this project";
  add.addEventListener("click", (e) => {
    e.stopPropagation();
    void createSessionInProject(g);
  });
  const shell = document.createElement("button");
  shell.className = "proj-btn shell";
  shell.textContent = "$";
  shell.title = "Project shell";
  shell.addEventListener("click", (e) => {
    e.stopPropagation();
    void openProjectShell(g);
  });
  header.append(square, name, count, add, shell);
  col.appendChild(header);

  const body = document.createElement("div");
  body.className = "board-col-body";
  body.dataset.project = g.id;
  for (const s of visible) body.appendChild(renderAgentCard(s));
  col.appendChild(body);
  return col;
}

/** Filter bar: pill filters + name search + primary "New session". */
function renderBoardFilterBar(): void {
  boardFilterEl.innerHTML = "";

  const pills = document.createElement("div");
  pills.className = "board-pills";
  const defs: { key: typeof boardFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "review", label: "Needs review" },
    { key: "running", label: "Running" },
    { key: "blocked", label: "Blocked" },
  ];
  for (const { key, label } of defs) {
    const pill = document.createElement("button");
    pill.className = "board-pill";
    pill.textContent = label;
    pill.classList.toggle("active", boardFilter === key);
    pill.addEventListener("click", () => {
      boardFilter = key;
      renderBoardFilterBar();
      renderBoardColumns();
    });
    pills.appendChild(pill);
  }

  // One pill per configured custom section. Selecting toggles a section filter
  // that narrows cards to that section (composes with the base pills + search).
  for (const sectionName of sectionNames) {
    const pill = document.createElement("button");
    pill.className = "board-pill section";
    pill.textContent = sectionName;
    pill.classList.toggle("active", boardSectionFilter === sectionName);
    pill.addEventListener("click", () => {
      boardSectionFilter = boardSectionFilter === sectionName ? null : sectionName;
      renderBoardFilterBar();
      renderBoardColumns();
    });
    pills.appendChild(pill);
  }

  // Toggle: hide project columns with zero sessions.
  const hideEmpty = document.createElement("button");
  hideEmpty.className = "board-pill hide-empty";
  hideEmpty.textContent = "Hide empty";
  hideEmpty.title = "Hide project columns with no sessions";
  hideEmpty.classList.toggle("active", hideEmptyColumns);
  hideEmpty.addEventListener("click", () => {
    hideEmptyColumns = !hideEmptyColumns;
    localStorage.setItem("cc-board-hide-empty", hideEmptyColumns ? "1" : "0");
    renderBoardFilterBar();
    renderBoardColumns();
  });
  pills.appendChild(hideEmpty);

  const search = noTextAssist(document.createElement("input"));
  search.className = "board-search";
  search.type = "search";
  search.placeholder = "Search sessions…";
  search.value = boardSearch;
  search.addEventListener("input", () => {
    boardSearch = search.value;
    renderBoardColumns();
  });

  const create = document.createElement("button");
  create.className = "board-new primary";
  create.textContent = "＋ New session";
  create.title = "New session";
  create.addEventListener("click", (e) => showContextMenu(e, projectPickerItems()));

  boardFilterEl.append(pills, search, create);
}

/** Rebuild the columns from the current snapshot + filter + search. */
function renderBoardColumns(): void {
  // Columns are rebuilt wholesale on every snapshot tick (~2s); capture the
  // per-column vertical scroll (keyed by project) + the strip's horizontal
  // scroll so an in-progress session doesn't yank the view back to the top.
  const prevScroll = new Map<string, number>();
  for (const body of boardColumnsEl.querySelectorAll<HTMLElement>(".board-col-body")) {
    if (body.dataset.project) prevScroll.set(body.dataset.project, body.scrollTop);
  }
  const prevScrollLeft = boardColumnsEl.scrollLeft;

  boardCardRefs.clear();
  boardColumnsEl.innerHTML = "";
  for (const g of orderedGroups()) {
    // "Hide empty" hides columns with no VISIBLE cards, so a project whose
    // sessions are all filtered out (e.g. by the section filter) drops too.
    if (hideEmptyColumns && boardVisibleSessions(g).length === 0) continue;
    boardColumnsEl.appendChild(renderBoardColumn(g));
  }

  for (const body of boardColumnsEl.querySelectorAll<HTMLElement>(".board-col-body")) {
    const top = body.dataset.project ? prevScroll.get(body.dataset.project) : undefined;
    if (top) body.scrollTop = top;
  }
  boardColumnsEl.scrollLeft = prevScrollLeft;
}

// Column drag-to-reorder: only the strip calls preventDefault on dragover (so it
// is the drop target), and the new order is committed on `drop` against the full
// ordered group list — inserting before a visible column is well-defined even
// when "Hide empty" omits some columns, and a dropped-at-end column lands last.
boardColumnsEl.addEventListener("dragover", (e) => {
  if (!draggingColId) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  showColDropMarker(colBeforeX(e.clientX));
});
boardColumnsEl.addEventListener("drop", (e) => {
  if (!draggingColId) return;
  e.preventDefault();
  clearColDropMarker();
  const beforeId = colBeforeX(e.clientX)?.dataset.project ?? null;
  const order = orderedGroups()
    .map((g) => g.id)
    .filter((id) => id !== draggingColId);
  const idx = beforeId ? order.indexOf(beforeId) : order.length;
  order.splice(idx, 0, draggingColId);
  boardColOrder = order;
  localStorage.setItem(BOARD_ORDER_KEY, JSON.stringify(order));
  draggingColId = null;
  renderBoardColumns();
});

/** Full board render. The filter bar is rebuilt only when needed (it owns the
 *  live search input); columns rebuild on every snapshot tick. Preserving the
 *  search field's focus/value: the input keeps its own value, and a snapshot
 *  re-render only touches columns, never the filter bar. */
function renderBoard(): void {
  if (!boardFilterEl.childElementCount) renderBoardFilterBar();
  renderBoardColumns();
}

function applySnapshot(snap: Snapshot): void {
  applyPendingOverlays(snap);
  groups = snap.groups;
  viewMode = snap.view_mode;
  sections = snap.sections;
  const prevSectionNames = sectionNames;
  sectionNames = snap.section_names;
  // A section filter referencing a now-removed section can no longer match.
  if (boardSectionFilter && !sectionNames.includes(boardSectionFilter)) {
    boardSectionFilter = null;
  }
  // Rebuild the (otherwise sticky) filter bar when the section pills change.
  if (prevSectionNames.join(" ") !== sectionNames.join(" ")) {
    boardFilterEl.innerHTML = "";
  }
  updateTitleBarCounts();
  renderSidebar();
  renderBoard();
  updateTabGlyphs();
  renderCommander(snap.commander);
}

// ---------------------------------------------------------------- palette

registerPaletteProvider(() =>
  groups.flatMap((g) =>
    g.sessions.map((s) => ({
      kind: "session" as const,
      label: s.title,
      hint: `${g.name} · ${s.branch}`,
      dotClass: statusGlyph(s).className.split(" ").find((c) => c.startsWith("dot-")) ?? "",
      project: g.name,
      state: humanState(s),
      action: () => void openTerminal(s),
    })),
  ),
);

registerPaletteProvider(() => [
  { label: "Cycle view mode", hint: "command", action: cycleViewMode },
  {
    label: "Add project…",
    hint: "command",
    action: () => {
      topInput = "add";
      renderSidebar();
    },
  },
  {
    label: "Scan directory for repos…",
    hint: "command",
    action: () => {
      topInput = "scan";
      renderSidebar();
    },
  },
  {
    label: "Delete merged-PR sessions…",
    hint: "command",
    action: () => void deleteMergedSessions(),
  },
  {
    label: "Refresh PR status",
    hint: "command",
    action: () => {
      toast("Refreshing PR status…");
      void invoke("refresh_pr_status").catch((e) => toast(`${e}`, "error"));
    },
  },
  {
    label: "Attach commander session",
    hint: "command",
    action: () => commanderChip.click(),
  },
  { label: "Settings", hint: "command", action: () => void openSettings() },
  { label: "Help", hint: "command", action: toggleHelp },
]);

// Theme commands: the two slot pickers (open a modal listing that appearance's
// themes, with live preview), the mode toggles, and custom-theme management.
registerPaletteProvider(() => [
  { label: "Theme: Set dark theme…", hint: "command", action: () => openThemeModal("dark") },
  { label: "Theme: Set light theme…", hint: "command", action: () => openThemeModal("light") },
  { label: "Theme: Dark mode", hint: "force dark", action: () => setMode("dark") },
  { label: "Theme: Light mode", hint: "force light", action: () => setMode("light") },
  { label: "Theme: Follow system", hint: "follow OS appearance", action: () => setMode("system") },
  { label: "Theme: Reload custom themes", hint: "command", action: () => void loadCustomThemes(true) },
  {
    label: "Theme: Export current theme as template…",
    hint: "command",
    action: () => void exportThemeTemplate(),
  },
  {
    label: "Theme: Open themes folder…",
    hint: "command",
    action: () => void invoke("open_themes_dir").catch((e) => toast(`${e}`, "error")),
  },
]);

// ------------------------------------------------------------- keybindings

/**
 * GUI handlers for claude-commander's bindable actions, dispatched with the
 * key table from the shared config (`[keybindings]` in config.toml). Actions
 * with no GUI equivalent (checkout_branch, new_stacked_session, scrolling,
 * quit, …) are simply not listed here.
 */
const KEY_ACTIONS: Record<string, { label: string; run: () => void }> = {
  navigate_up: { label: "Move cursor up", run: () => moveSelection(-1) },
  navigate_down: { label: "Move cursor down", run: () => moveSelection(1) },
  next_group: { label: "Jump to next group", run: () => moveGroup(1) },
  previous_group: { label: "Jump to previous group", run: () => moveGroup(-1) },
  navigate_first: {
    label: "Jump to first session",
    run: () => {
      const flat = visibleGroups.flat();
      if (flat.length) selectRow(flat[0]);
    },
  },
  navigate_last: {
    label: "Jump to last session",
    run: () => {
      const flat = visibleGroups.flat();
      if (flat.length) selectRow(flat[flat.length - 1]);
    },
  },
  select: {
    label: "Attach cursor session",
    run: () => {
      const s = targetSession();
      if (s) void openTerminal(s);
    },
  },
  select_shell: {
    label: "Open shell for cursor session",
    run: () => {
      const s = targetSession();
      if (s) void openShell(s);
    },
  },
  new_session: {
    label: "New session in cursor project",
    run: () => {
      const s = targetSession();
      const g = s ? groupOf(s.id) : groups[0];
      if (!g) return;
      // In a section view the create-input lives under the cursor session's
      // project sub-header within its section bucket, so scope the key to it.
      if (SECTION_VIEW() && s && sections) {
        const bucket = sections.find((b) => b.session_ids.includes(s.id));
        if (bucket) {
          newSessionProject = sectionCreateKey(bucket.name, g.id);
          collapsed.delete(`sect:${bucket.name}`);
          renderSidebar();
          return;
        }
      }
      newSessionProject = g.id;
      collapsed.delete(`proj:${g.id}`);
      renderSidebar();
    },
  },
  new_project: {
    label: "Add project",
    run: () => {
      topInput = "add";
      renderSidebar();
    },
  },
  scan_directory: {
    label: "Scan directory for repos",
    run: () => {
      topInput = "scan";
      renderSidebar();
    },
  },
  rename_session: {
    label: "Rename cursor session",
    run: () => {
      const s = targetSession();
      if (!s) return;
      renamingId = s.id;
      renderSidebar();
    },
  },
  delete_session: {
    label: "Delete cursor session",
    run: () => {
      const s = targetSession();
      if (!s) return;
      void confirmDialog(
        `Delete session "${s.title}"?\nThis removes the worktree and branch.`,
        "Delete",
      ).then((ok) => {
        if (ok) deleteSession(s);
      });
    },
  },
  delete_merged_pr_sessions: {
    label: "Delete merged-PR sessions",
    run: () => void deleteMergedSessions(),
  },
  restart_session: {
    label: "Restart cursor session (if stopped)",
    run: () => {
      const s = targetSession();
      if (s?.status === "stopped") void lifecycle("restart_session", s.id);
    },
  },
  remove_project: {
    label: "Remove cursor project",
    run: () => {
      const s = targetSession();
      const g = s ? groupOf(s.id) : undefined;
      if (!g) return;
      void confirmDialog(
        `Remove project "${g.name}" and all ${g.sessions.length} session(s)?\nWorktrees and tmux sessions will be removed.`,
        "Remove",
      ).then((ok) => {
        if (ok) void lifecycle("remove_project", g.id);
      });
    },
  },
  open_in_editor: {
    label: "Open cursor session in editor",
    run: () => {
      const s = targetSession();
      if (s) void lifecycle("open_in_editor", s.id);
    },
  },
  open_pull_request: {
    label: "Open cursor session's PR",
    run: () => {
      const s = targetSession();
      if (s?.pr_url) void invoke("open_external", { url: s.pr_url });
    },
  },
  open_commander: { label: "Attach commander session", run: () => commanderChip.click() },
  open_review_diff: {
    label: "Review diff of cursor session",
    run: () => {
      const s = targetSession();
      if (s) void openReview(s.id, s.title);
    },
  },
  cascade_merge_main: {
    label: "Cascade-merge main into cursor stack",
    run: () => {
      const s = targetSession();
      if (s) void invokeToast("cascade_merge", { id: s.id });
    },
  },
  cascade_resume: { label: "Resume paused cascade", run: () => void invokeToast("cascade_resume", {}) },
  cascade_abandon: { label: "Abandon paused cascade", run: () => void invokeToast("cascade_abandon", {}) },
  push_stack: {
    label: "Push cursor stack to origin",
    run: () => {
      const s = targetSession();
      if (s) void invokeToast("push_stack", { id: s.id });
    },
  },
  generate_summary: {
    label: "Generate AI summary for cursor session",
    run: () => {
      const s = targetSession();
      if (!s) return;
      if (detailId !== s.id) toggleDetail(s);
      void generateSummary();
    },
  },
  toggle_section: {
    label: "Collapse/expand cursor group",
    run: () => {
      const s = targetSession();
      if (SECTION_VIEW() && sections) {
        const b = s ? sections.find((b) => b.session_ids.includes(s.id)) : sections[0];
        if (b) toggleCollapsed(`sect:${b.name}`);
      } else {
        const g = s ? groupOf(s.id) : groups[0];
        if (g) toggleCollapsed(`proj:${g.id}`);
      }
    },
  },
  toggle_view_mode: { label: "Cycle view mode", run: cycleViewMode },
  shrink_left_pane: { label: "Shrink sidebar", run: () => adjustPanelWidth("cc-sidebar-width", -24) },
  grow_left_pane: { label: "Grow sidebar", run: () => adjustPanelWidth("cc-sidebar-width", 24) },
  // toggle_pane (bare Tab in the TUI) is intentionally not mapped: the GUI has
  // no two-pane focus model, and stealing Tab would break normal focus
  // traversal across the chrome. Clicking a row already focuses its terminal.
  show_help: { label: "Toggle help", run: toggleHelp },
  show_settings: { label: "Open settings", run: () => void openSettings() },
};

// A single-char key's glyph already implies Shift (e.g. "?" is Shift+/), and the
// GUI dispatch ignores the Shift bit for single chars — so the commander default
// binding both "Shift-?" and "?" lists the same physical key twice. Drop the
// redundant "Shift-" prefix and de-dupe so each key shows once.
function helpKeyLabel(keys: string[]): string {
  const seen = new Set(keys.map((k) => k.replace(/^Shift-(?=\S$)/, "")));
  return [...seen].join(", ");
}

function applyHelpKeybindings(): void {
  setHelpKeybindings(
    Object.entries(KEY_ACTIONS)
      .map(([action, a]) => [helpKeyLabel(loadedBindings[action] ?? []), a.label] as [string, string])
      .filter(([keys]) => keys.length > 0),
  );
}

void initKeybindings(
  Object.fromEntries(Object.entries(KEY_ACTIONS).map(([action, a]) => [action, a.run])),
).then((loaded) => {
  if (!loaded) {
    // Keep "?" working even when the keybinding table couldn't be fetched.
    document.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement;
      const typing =
        t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.closest(".xterm");
      if (e.key === "?" && !typing && !keyOverlayOpen()) toggleHelp();
    });
    return;
  }
  applyHelpKeybindings();
});

// Backend hot-reloaded config.toml (edited by another instance or by hand):
// refresh the keybinding table and the help overlay's listing.
void listen("config-updated", async () => {
  if (await reloadKeybindings()) applyHelpKeybindings();
});

// Esc clears the keyboard cursor (overlays handle their own Esc).
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selectedId && !keyOverlayOpen() && !(e.target as HTMLElement).closest(".xterm")) {
    selectRow(null);
  }
});

void listen<Snapshot>("sessions-updated", (event) => applySnapshot(event.payload));

invoke<Snapshot>("get_groups")
  .then((snap) => {
    // The push loop may have rendered already; don't regress its richer data.
    if (!groups.length) applySnapshot(snap);
  })
  .catch((e) => {
    sessionsEl.innerHTML = `<div class="error">Error: ${e}</div>`;
  });
