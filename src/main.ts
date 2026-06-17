import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { openReview } from "./review";
import { toast, confirmDialog, promptDialog } from "./toast";
import { makeResizable, adjustPanelWidth } from "./resize";
import { showContextMenu, MenuItem } from "./menu";
import { registerPaletteProvider } from "./palette";
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
const summaryGenEl = document.querySelector<HTMLButtonElement>("#summary-gen")!;

// ---------------------------------------------------------------- terminals

type TermEntry = {
  term: Terminal;
  fit: FitAddon;
  container: HTMLDivElement;
  tab: HTMLDivElement;
  glyph: HTMLSpanElement;
  title: string;
  dead: boolean;
};

const terminals = new Map<string, TermEntry>(); // keyed by tmux session name
let activeTerm: string | null = null;

// Re-theme every live terminal when the GUI theme changes. The DOM renderer
// repaints automatically on an options.theme assignment.
onThemeChange((theme) => {
  for (const entry of terminals.values()) {
    entry.term.options.theme = theme.terminal;
  }
});

function activateTerminal(name: string): void {
  activeTerm = name;
  for (const [key, entry] of terminals) {
    const active = key === name;
    entry.container.classList.toggle("active", active);
    entry.tab.classList.toggle("active", active);
  }
  placeholderEl.style.display = terminals.size ? "none" : "flex";
  const entry = terminals.get(name);
  if (entry) {
    entry.fit.fit();
    void invoke("resize_pty", {
      tmuxSession: name,
      rows: entry.term.rows,
      cols: entry.term.cols,
    });
    entry.term.focus();
  }
  renderSidebar();
}

function closeTerminal(name: string): void {
  const entry = terminals.get(name);
  if (!entry) return;
  void invoke("detach", { tmuxSession: name });
  entry.term.dispose();
  entry.container.remove();
  entry.tab.remove();
  terminals.delete(name);
  if (activeTerm === name) {
    activeTerm = terminals.keys().next().value ?? null;
    if (activeTerm) activateTerminal(activeTerm);
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
  if (before) tabsEl.insertBefore(draggingTab, before);
  else tabsEl.appendChild(draggingTab);
  clearDropMarker();
  syncTermOrderFromDom();
});

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

  const container = document.createElement("div");
  container.className = "term-container";
  terminalsEl.appendChild(container);

  const term = new Terminal({
    fontFamily: '"MesloLGS NF Embedded", "MesloLGS NF", Menlo, Monaco, monospace',
    fontSize: 13,
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
  term.open(container);

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
  container.addEventListener("mouseup", () => {
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
  glyph.className = "tab-glyph";
  glyph.hidden = true; // shown once a matching session status is known
  const label = document.createElement("span");
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
  tabsEl.appendChild(tab);

  const entry: TermEntry = {
    term,
    fit,
    container,
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

  detailMetaEl.innerHTML = "";
  const status =
    d.status.toLowerCase() === "running" ? `running · ${d.agent_state}` : d.status.toLowerCase();
  const rows: [string, string][] = [
    ["Project", d.project_name],
    ["Branch", d.branch],
    ["Status", status],
    ["Program", d.program],
    ["Created", new Date(d.created_at).toLocaleString()],
  ];
  if (d.pr_number != null) {
    rows.push([
      "PR",
      `#${d.pr_number} (${d.pr_draft ? "draft" : d.pr_state.toLowerCase()})${d.pr_url ? ` — ${d.pr_url}` : ""}`,
    ]);
  }
  for (const [label, value] of rows) {
    detailMetaEl.append(...metaRow(label, value));
  }

  detailDiffstatEl.innerHTML = "";
  if (d.diff_stat) {
    // Colorize "+N" / "-N" tokens in the diffstat summary.
    for (const token of d.diff_stat.split(/(\+\d+|-\d+)/)) {
      const span = document.createElement("span");
      if (/^\+\d+$/.test(token)) span.className = "added";
      if (/^-\d+$/.test(token)) span.className = "removed";
      span.textContent = token;
      detailDiffstatEl.appendChild(span);
    }
  } else {
    detailDiffstatEl.textContent = "No changes";
  }
}

function renderSummary(): void {
  if (!detailId) return;
  const summary = summaries.get(detailId);
  detailSummaryEl.classList.remove("placeholder", "error");
  summaryGenEl.disabled = summary?.state === "loading";
  summaryGenEl.textContent = summary?.state === "ready" ? "Regenerate" : "Generate";
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
  detailEl.classList.remove("hidden");
  detailTitleEl.textContent = s.title;
  detailMetaEl.innerHTML = "";
  detailDiffstatEl.textContent = "Loading…";
  renderSummary();
  if (detailTimer) clearInterval(detailTimer);
  detailTimer = setInterval(() => void refreshDetail(), 2000);
  void refreshDetail();
  refitActive();
}

document.querySelector("#detail-close")!.addEventListener("click", closeDetail);

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

void listen<{ session: string; ended: boolean }>("pty-exit", (event) => {
  const { session: name, ended } = event.payload;
  const entry = terminals.get(name);
  if (!entry) return;
  entry.dead = true;
  entry.tab.classList.add("dead");

  // The tmux session ended (program exited/crashed) rather than a detach:
  // auto-restart fresh and re-attach, with the crash-loop guard — the same
  // behaviour as the TUI's attach loop.
  if (ended && recordEndAndCheckRestart(name)) {
    entry.term.write("\r\n\x1b[90m[session ended — restarting…]\x1b[0m\r\n");
    void invoke("restart_fresh", { tmuxSession: name })
      .then(() => attachTerminal(name, entry.title, null))
      .catch((e) => entry.term.write(`\r\nAuto-restart failed: ${e}\r\n`));
    return;
  }
  entry.term.write("\r\n\x1b[90m[detached — click session to re-attach]\x1b[0m\r\n");
});

// ----------------------------------------------------------------- sidebar

let groups: ProjectGroup[] = [];
let viewMode = "project";
let sections: SectionBucket[] | null = null;
let sectionNames: string[] = [];
let newSessionProject: string | null = null; // project id with open create-input
let renamingId: string | null = null; // session id being renamed inline
let topInput: "add" | "scan" | null = null; // sidebar-top path input mode

const SECTION_VIEW = (): boolean => sections !== null;

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

/** Jump to the first row of the next/previous group. */
function moveGroup(dir: 1 | -1): void {
  const nonEmpty = visibleGroups.filter((g) => g.length);
  if (!nonEmpty.length) return;
  const cur = nonEmpty.findIndex((g) => selectedId !== null && g.includes(selectedId));
  const next = cur === -1 ? 0 : (cur + dir + nonEmpty.length) % nonEmpty.length;
  selectRow(nonEmpty[next][0]);
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

const AGENT_GLYPHS: Record<string, [string, string]> = {
  working: ["●", "agent-working"],
  waitingforinput: ["?", "agent-waiting"],
  idle: ["●", "agent-idle"],
};

const STATUS_GLYPH_CLASSES = [
  "agent-working",
  "agent-waiting",
  "agent-idle",
  "agent-unknown",
  "status-stopped",
  "status-transient",
];

/** Set `el`'s glyph/colour/tooltip from a session's status. Shared by the
 *  sidebar rows and the terminal tabs so they stay in lockstep. */
function applyStatusGlyph(el: HTMLSpanElement, s: SessionRow): void {
  el.classList.remove(...STATUS_GLYPH_CLASSES);
  let cls: string;
  if (s.status === "running") {
    const [glyph, c] = AGENT_GLYPHS[s.agent_state] ?? ["●", "agent-unknown"];
    el.textContent = glyph;
    cls = c;
  } else if (s.status === "stopped") {
    el.textContent = "○";
    cls = "status-stopped";
  } else {
    el.textContent = "⧖"; // creating / merging / pushing
    cls = "status-transient";
  }
  el.classList.add(cls);
  el.title = s.status === "running" ? s.agent_state : s.status;
}

function statusGlyph(s: SessionRow): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "glyph";
  applyStatusGlyph(el, s);
  return el;
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

/** Rebuild the inner content of a row's main span (cheap; no input state). */
function fillRowMain(main: HTMLDivElement, s: SessionRow): void {
  main.innerHTML = "";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = s.title;
  title.title = `Branch: ${s.branch}`;
  main.append(statusGlyph(s), title);
  // Only surface the branch when it has diverged from the title; otherwise the
  // two columns just repeat each other. (Always available via the hover title
  // above and the detail panel.) In section view we still show the project.
  const showBranch = !branchMatchesTitle(s.title, s.branch);
  const meta = SECTION_VIEW()
    ? showBranch
      ? `${s.project_name} · ${s.branch}`
      : s.project_name
    : showBranch
      ? s.branch
      : "";
  if (meta) {
    const branch = document.createElement("span");
    branch.className = "meta";
    branch.textContent = meta;
    main.append(branch);
  }
  const badge = prBadge(s);
  if (badge) main.appendChild(badge);
  if (s.has_pending_comments) {
    const c = document.createElement("span");
    c.className = "comment-badge";
    c.textContent = "🗨";
    c.title = "Has pending review comments";
    main.appendChild(c);
  }
  if (s.unread) {
    const dot = document.createElement("span");
    dot.className = "unread-dot";
    dot.textContent = "●";
    dot.title = "Finished while you were away";
    main.appendChild(dot);
  }
}

function sessionMenuItems(refs: RowRefs): MenuItem[] {
  const s = refs.session;
  const items: MenuItem[] = [
    { label: "Attach", action: () => void openTerminal(s) },
    { label: "Shell terminal", action: () => void openShell(s) },
    { label: "Review diff", action: () => void openReview(s.id, s.title) },
    { label: "Details", action: () => toggleDetail(s) },
    "separator",
    {
      label: "Rename…",
      action: () => {
        renamingId = s.id;
        renderSidebar();
      },
    },
    { label: "Open in editor", action: () => void lifecycle("open_in_editor", s.id) },
  ];
  if (s.pr_url) {
    const url = s.pr_url;
    items.push({
      label: `Open PR #${s.pr_number}`,
      action: () => void invoke("open_external", { url }),
    });
  }
  items.push("separator");
  items.push({
    label: "Cascade-merge main → stack",
    action: () => void invokeToast("cascade_merge", { id: s.id }),
  });
  items.push({
    label: "Push stack to origin",
    action: () => void invokeToast("push_stack", { id: s.id }),
  });
  if (s.status === "cascade_paused") {
    items.push({
      label: "Resume cascade",
      action: () => void invokeToast("cascade_resume", {}),
    });
    items.push({
      label: "Abandon cascade",
      danger: true,
      action: () => void invokeToast("cascade_abandon", {}),
    });
  }
  if (sectionNames.length) {
    items.push("separator");
    for (const name of sectionNames) {
      if (name !== s.current_section) {
        items.push({
          label: `Move to section: ${name}`,
          action: () => void lifecycleArgs("move_to_section", { id: s.id, section: name }),
        });
      }
    }
    if (s.current_section) {
      items.push({
        label: "Clear section pin",
        action: () => void lifecycleArgs("move_to_section", { id: s.id, section: null }),
      });
    }
  }
  items.push("separator");
  if (s.status === "stopped") {
    items.push({ label: "Restart", action: () => void lifecycle("restart_session", s.id) });
  }
  if (s.status === "running") {
    items.push({ label: "Kill", action: () => void lifecycle("kill_session", s.id), danger: true });
  }
  items.push({
    label: "Delete (worktree + branch)",
    danger: true,
    action: () => {
      void confirmDialog(
        `Delete session "${s.title}"?\nThis removes the worktree and branch.`,
        "Delete",
      ).then((ok) => {
        if (ok) deleteSession(s);
      });
    },
  });
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
function projectMenuItems(group: ProjectGroup): MenuItem[] {
  return [
    {
      label: "New session…",
      action: () => {
        newSessionProject = group.id;
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

/** Path input at the top of the sidebar for add-project / scan-directory. */
function renderTopInput(mode: "add" | "scan"): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "create-input";
  const input = noTextAssist(document.createElement("input"));
  input.placeholder = mode === "add" ? "path to git repo…" : "directory to scan for repos…";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      topInput = null;
      renderSidebar();
    }
    if (e.key === "Enter" && input.value.trim()) {
      const path = input.value.trim();
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
  });
  wrap.appendChild(input);
  setTimeout(() => input.focus(), 0);
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

const VIEW_LABELS: Record<string, string> = {
  project: "Project",
  sections: "Sections",
  section_stacks: "Section Stacks",
};

function cycleViewMode(): void {
  const order = ["project", "sections", "section_stacks"];
  const next = order[(order.indexOf(viewMode) + 1) % order.length];
  invoke("set_view_mode", { mode: next })
    .then(() => refreshNow())
    .catch((e) => toast(`${e}`, "error"));
}

/** Render section-grouped views: section headers with rows looked up by id. */
function renderSections(buckets: SectionBucket[]): void {
  buckets.forEach((bucket, bucketIndex) => {
    const header = document.createElement("div");
    header.className = "project-header";
    const name = document.createElement("span");
    name.textContent = bucket.name;
    const count = document.createElement("span");
    count.className = "meta";
    count.textContent = String(bucket.session_ids.length);
    header.append(name, count);
    const isCollapsed = makeCollapsible(header, name, `sect:${bucket.name}`);
    makeSectionDropTarget(header, bucket, bucketIndex);
    sessionsEl.appendChild(header);
    if (isCollapsed) return;
    const rendered: string[] = [];
    for (const id of bucket.session_ids) {
      const s = findSession(id);
      if (s) {
        sessionsEl.appendChild(renderSessionRow(s));
        rendered.push(id);
      }
    }
    visibleGroups.push(rendered);
  });
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
    `#${newSessionProject}#${renamingId}#${topInput}#${viewMode}` +
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

  // View-mode heading with cycle toggle.
  const viewBar = document.createElement("div");
  viewBar.className = "view-bar";
  const viewLabel = document.createElement("span");
  viewLabel.textContent = `View: ${VIEW_LABELS[viewMode] ?? viewMode}`;
  const cycle = document.createElement("button");
  cycle.className = "row-action";
  cycle.textContent = "⇄";
  cycle.title = "Cycle view mode (project / sections / section stacks)";
  cycle.addEventListener("click", cycleViewMode);
  viewBar.append(viewLabel, cycle);
  sessionsEl.appendChild(viewBar);

  if (sections) {
    renderSections(sections);
    return;
  }

  for (const group of groups) {
    const header = document.createElement("div");
    header.className = "project-header";
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
    header.append(name, buttons);
    const isCollapsed = makeCollapsible(header, name, `proj:${group.id}`);
    if (isCollapsed) {
      const count = document.createElement("span");
      count.className = "meta";
      count.textContent = String(group.sessions.length);
      buttons.prepend(count);
    }
    header.addEventListener("contextmenu", (e) => showContextMenu(e, projectMenuItems(group)));
    sessionsEl.appendChild(header);
    if (isCollapsed) continue;

    if (newSessionProject === group.id) {
      sessionsEl.appendChild(renderCreateInput(group));
    }
    for (const s of group.sessions) {
      sessionsEl.appendChild(renderSessionRow(s));
    }
    visibleGroups.push(group.sessions.map((s) => s.id));
  }
}

document.querySelector<HTMLButtonElement>("#sidebar-menu")!.addEventListener("click", (e) => {
  showContextMenu(e, sidebarMenuItems());
});

// ------------------------------------------------------------ commander chip

const commanderChip = document.querySelector<HTMLElement>("#commander-chip")!;

function renderCommander(c: Snapshot["commander"]): void {
  commanderChip.classList.toggle("hidden", !c.enabled);
  if (!c.enabled) return;
  commanderChip.innerHTML = "";
  const dot = document.createElement("span");
  dot.className = c.running ? "chip-dot running" : "chip-dot";
  dot.textContent = "●";
  const label = document.createElement("span");
  label.textContent = `commander · ${c.running ? "running" : "stopped"}`;
  commanderChip.append(dot, label);
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

function applySnapshot(snap: Snapshot): void {
  applyPendingOverlays(snap);
  groups = snap.groups;
  viewMode = snap.view_mode;
  sections = snap.sections;
  sectionNames = snap.section_names;
  renderSidebar();
  updateTabGlyphs();
  renderCommander(snap.commander);
}

// ---------------------------------------------------------------- palette

registerPaletteProvider(() =>
  groups.flatMap((g) =>
    g.sessions.map((s) => ({
      label: s.title,
      hint: `${g.name} · ${s.branch}`,
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

function applyHelpKeybindings(): void {
  setHelpKeybindings(
    Object.entries(KEY_ACTIONS)
      .map(
        ([action, a]) => [loadedBindings[action]?.join(", ") ?? "", a.label] as [string, string],
      )
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
