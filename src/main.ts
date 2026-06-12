import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./style.css";

type SessionRow = {
  id: string;
  title: string;
  branch: string;
  status: string;
  program: string;
  agent_state: string;
  tmux_session_name: string;
};

type ProjectGroup = {
  id: string;
  name: string;
  repo_path: string;
  sessions: SessionRow[];
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
  const name = session.tmux_session_name;
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
  label.textContent = session.title;
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
    title: session.title,
    dead: false,
  };
  terminals.set(name, entry);

  const onData = new Channel<number[]>();
  onData.onmessage = (chunk) => term.write(new Uint8Array(chunk));

  try {
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

void listen<string>("pty-exit", (event) => {
  const entry = terminals.get(event.payload);
  if (!entry) return;
  entry.dead = true;
  entry.tab.classList.add("dead");
  entry.term.write("\r\n\x1b[90m[detached — click session to re-attach]\x1b[0m\r\n");
});

// ----------------------------------------------------------------- sidebar

let groups: ProjectGroup[] = [];
let newSessionProject: string | null = null; // project id with open create-input

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
  try {
    await invoke(action, { id });
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

function renderSessionRow(s: SessionRow): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "session-row";

  const main = document.createElement("div");
  main.className = "row-main";
  const title = document.createElement("span");
  title.className = "title";
  const branch = document.createElement("span");
  branch.className = "meta";
  main.append(statusGlyph(s), title, branch);

  const refs: RowRefs = { row, main, actions: buildActions(s), status: s.status, session: s };
  rowRefs.set(s.id, refs);

  row.append(main, refs.actions);
  row.addEventListener("click", () => void openTerminal(refs.session));
  updateRow(refs, s);
  return row;
}

/** Refresh a row's dynamic bits without rebuilding it (preserves hover/confirm state). */
function updateRow(refs: RowRefs, s: SessionRow): void {
  refs.session = s;
  refs.main.replaceChild(statusGlyph(s), refs.main.firstChild!);
  (refs.main.children[1] as HTMLElement).textContent = s.title;
  (refs.main.children[2] as HTMLElement).textContent = s.branch;
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
function renderSidebar(): void {
  const signature =
    groups.map((g) => `${g.id}:${g.sessions.map((s) => s.id).join(",")}`).join("|") +
    `#${newSessionProject}`;

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
  for (const group of groups) {
    const header = document.createElement("div");
    header.className = "project-header";
    const name = document.createElement("span");
    name.textContent = group.name;
    const add = document.createElement("button");
    add.className = "row-action";
    add.textContent = "+";
    add.title = "New session in this project";
    add.addEventListener("click", () => {
      newSessionProject = newSessionProject === group.id ? null : group.id;
      renderSidebar();
    });
    header.append(name, add);
    sessionsEl.appendChild(header);

    if (newSessionProject === group.id) {
      sessionsEl.appendChild(renderCreateInput(group));
    }
    for (const s of group.sessions) {
      sessionsEl.appendChild(renderSessionRow(s));
    }
  }
}

void listen<ProjectGroup[]>("sessions-updated", (event) => {
  groups = event.payload;
  renderSidebar();
});

invoke<ProjectGroup[]>("get_groups")
  .then((g) => {
    // The push loop may have rendered already; don't regress its richer data.
    if (!groups.length) {
      groups = g;
      renderSidebar();
    }
  })
  .catch((e) => {
    sessionsEl.innerHTML = `<div class="error">Error: ${e}</div>`;
  });
