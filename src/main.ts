import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { openReview } from "./review";
import { showContextMenu, MenuItem } from "./menu";
import { registerPaletteProvider } from "./palette";
import { toggleHelp } from "./help";
import { openSettings } from "./settings";

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
  title: string;
  dead: boolean;
};

const terminals = new Map<string, TermEntry>(); // keyed by tmux session name
let activeTerm: string | null = null;

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
    alert(`shell failed: ${e}`);
    return;
  }
  await attachTerminal(name, `${session.title} — shell`, null);
}

async function openProjectShell(group: ProjectGroup): Promise<void> {
  let name: string;
  try {
    name = await invoke<string>("prepare_project_shell", { id: group.id });
  } catch (e) {
    alert(`project shell failed: ${e}`);
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
    fontFamily: "Menlo, Monaco, monospace",
    fontSize: 13,
    theme: { background: "#1e1e2e" },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container);

  term.onData((data) => {
    void invoke("write_pty", { tmuxSession: name, data });
  });
  term.onResize(({ rows, cols }) => {
    void invoke("resize_pty", { tmuxSession: name, rows, cols });
  });

  const tab = document.createElement("div");
  tab.className = "tab";
  const label = document.createElement("span");
  label.textContent = title;
  const close = document.createElement("button");
  close.className = "tab-close";
  close.textContent = "×";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTerminal(name);
  });
  tab.append(label, close);
  tab.addEventListener("click", () => activateTerminal(name));
  tabsEl.appendChild(tab);

  const entry: TermEntry = {
    term,
    fit,
    container,
    tab,
    title,
    dead: false,
  };
  terminals.set(name, entry);

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

function findSession(id: string): SessionRow | undefined {
  for (const g of groups) {
    const s = g.sessions.find((s) => s.id === id);
    if (s) return s;
  }
  return undefined;
}

const AGENT_GLYPHS: Record<string, [string, string]> = {
  working: ["●", "agent-working"],
  waitingforinput: ["?", "agent-waiting"],
  idle: ["●", "agent-idle"],
};

function statusGlyph(s: SessionRow): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "glyph";
  if (s.status === "running") {
    const [glyph, cls] = AGENT_GLYPHS[s.agent_state] ?? ["●", "agent-unknown"];
    el.textContent = glyph;
    el.classList.add(cls);
  } else if (s.status === "stopped") {
    el.textContent = "○";
    el.classList.add("status-stopped");
  } else {
    el.textContent = "⧖"; // creating / merging / pushing
    el.classList.add("status-transient");
  }
  el.title = s.status === "running" ? s.agent_state : s.status;
  return el;
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

async function lifecycle(action: string, id: string): Promise<void> {
  await lifecycleArgs(action, { id });
}

async function lifecycleArgs(action: string, args: Record<string, unknown>): Promise<void> {
  try {
    await invoke(action, args);
  } catch (e) {
    alert(`${action} failed: ${e}`);
  }
}

/** Invoke a long-running command and surface its summary (or error). */
async function invokeToast(action: string, args: Record<string, unknown>): Promise<void> {
  try {
    const msg = await invoke<string | null>(action, args);
    if (msg) alert(msg);
  } catch (e) {
    alert(`${action} failed: ${e}`);
  }
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
    confirmButton("✕", "Delete session (removes worktree + branch)", () => {
      closeTerminal(s.tmux_session_name);
      void lifecycle("delete_session", s.id);
    }),
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

/** Rebuild the inner content of a row's main span (cheap; no input state). */
function fillRowMain(main: HTMLDivElement, s: SessionRow): void {
  main.innerHTML = "";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = s.title;
  const branch = document.createElement("span");
  branch.className = "meta";
  branch.textContent = SECTION_VIEW() ? `${s.project_name} · ${s.branch}` : s.branch;
  main.append(statusGlyph(s), title, branch);
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
      if (confirm(`Delete session "${s.title}"?\nThis removes the worktree and branch.`)) {
        closeTerminal(s.tmux_session_name);
        void lifecycle("delete_session", s.id);
      }
    },
  });
  return items;
}

/** Inline rename input shown in place of the row's title. */
function renderRenameInput(s: SessionRow): HTMLInputElement {
  const input = document.createElement("input");
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
      invoke("rename_session", { id: s.id, title }).catch((err) =>
        alert(`rename failed: ${err}`),
      );
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
  row.addEventListener("click", () => void openTerminal(refs.session));
  row.addEventListener("contextmenu", (e) => showContextMenu(e, sessionMenuItems(refs)));
  updateRow(refs, s);
  return row;
}

/** Refresh a row's dynamic bits without rebuilding it (preserves hover/confirm state). */
function updateRow(refs: RowRefs, s: SessionRow): void {
  refs.session = s;
  if (renamingId === s.id) return; // don't clobber the rename input
  fillRowMain(refs.main, s);
  refs.row.classList.toggle("active", s.tmux_session_name === activeTerm);
  refs.row.classList.toggle("attached", terminals.has(s.tmux_session_name));
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
  const input = document.createElement("input");
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
      invoke("create_session", { projectPath: group.repo_path, title }).catch((err) =>
        alert(`create failed: ${err}`),
      );
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
        if (
          confirm(
            `Remove project "${group.name}" and all ${group.sessions.length} session(s)?\nWorktrees and tmux sessions will be removed.`,
          )
        ) {
          void invoke("remove_project", { id: group.id }).catch((e) =>
            alert(`remove failed: ${e}`),
          );
        }
      },
    },
  ];
}

/** Path input at the top of the sidebar for add-project / scan-directory. */
function renderTopInput(mode: "add" | "scan"): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "create-input";
  const input = document.createElement("input");
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
              alert(`Scan complete: ${r.added} added, ${r.skipped} already present`),
            );
      call.catch((err) => alert(`${mode === "add" ? "add project" : "scan"} failed: ${err}`));
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
    alert(`failed to list merged sessions: ${e}`);
    return;
  }
  if (!merged.length) {
    alert("No sessions with merged PRs");
    return;
  }
  const preview = merged
    .slice(0, 8)
    .map(([, branch]) => `  • ${branch}`)
    .join("\n");
  const more = merged.length > 8 ? `\n  … and ${merged.length - 8} more` : "";
  if (
    !confirm(
      `Delete ${merged.length} session(s) with merged PRs?\n\n${preview}${more}\n\nThis removes their worktrees and branches.`,
    )
  )
    return;
  for (const [id] of merged) {
    await invoke("delete_session", { id }).catch((e) => alert(`delete failed: ${e}`));
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
  invoke("set_view_mode", { mode: next }).catch((e) => alert(`${e}`));
}

/** Render section-grouped views: section headers with rows looked up by id. */
function renderSections(buckets: SectionBucket[]): void {
  for (const bucket of buckets) {
    const header = document.createElement("div");
    header.className = "project-header";
    const name = document.createElement("span");
    name.textContent = bucket.name;
    const count = document.createElement("span");
    count.className = "meta";
    count.textContent = String(bucket.session_ids.length);
    header.append(name, count);
    sessionsEl.appendChild(header);
    for (const id of bucket.session_ids) {
      const s = findSession(id);
      if (s) sessionsEl.appendChild(renderSessionRow(s));
    }
  }
}

function renderSidebar(): void {
  const signature =
    groups
      .map((g) => `${g.id}@${g.pull_blocked}:${g.sessions.map((s) => s.id).join(",")}`)
      .join("|") +
    `#${newSessionProject}#${renamingId}#${topInput}#${viewMode}` +
    `#${sections?.map((b) => `${b.name}=${b.session_ids.join(",")}`).join("|") ?? ""}`;

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
    shell.addEventListener("click", () => void openProjectShell(group));
    const add = document.createElement("button");
    add.className = "row-action";
    add.textContent = "+";
    add.title = "New session in this project";
    add.addEventListener("click", () => {
      newSessionProject = newSessionProject === group.id ? null : group.id;
      renderSidebar();
    });
    buttons.append(shell, add);
    header.append(name, buttons);
    header.addEventListener("contextmenu", (e) => showContextMenu(e, projectMenuItems(group)));
    sessionsEl.appendChild(header);

    if (newSessionProject === group.id) {
      sessionsEl.appendChild(renderCreateInput(group));
    }
    for (const s of group.sessions) {
      sessionsEl.appendChild(renderSessionRow(s));
    }
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
      alert(`commander failed: ${e}`);
      return;
    }
    await attachTerminal(name, "commander", null);
  })();
});

function applySnapshot(snap: Snapshot): void {
  groups = snap.groups;
  viewMode = snap.view_mode;
  sections = snap.sections;
  sectionNames = snap.section_names;
  renderSidebar();
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

void listen<Snapshot>("sessions-updated", (event) => applySnapshot(event.payload));

invoke<Snapshot>("get_groups")
  .then((snap) => {
    // The push loop may have rendered already; don't regress its richer data.
    if (!groups.length) applySnapshot(snap);
  })
  .catch((e) => {
    sessionsEl.innerHTML = `<div class="error">Error: ${e}</div>`;
  });
