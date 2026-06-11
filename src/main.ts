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

const sessionsEl = document.querySelector<HTMLDivElement>("#sessions")!;
const tabsEl = document.querySelector<HTMLDivElement>("#tabs")!;
const terminalsEl = document.querySelector<HTMLDivElement>("#terminals")!;
const placeholderEl = document.querySelector<HTMLDivElement>("#placeholder")!;

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

window.addEventListener("resize", () => {
  if (activeTerm) terminals.get(activeTerm)?.fit.fit();
});

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

function renderSessionRow(s: SessionRow): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "session-row";
  if (s.tmux_session_name === activeTerm) row.classList.add("active");
  if (terminals.has(s.tmux_session_name)) row.classList.add("attached");

  const main = document.createElement("div");
  main.className = "row-main";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = s.title;
  const branch = document.createElement("span");
  branch.className = "meta";
  branch.textContent = s.branch;
  main.append(statusGlyph(s), title, branch);

  const actions = document.createElement("div");
  actions.className = "row-actions";
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

  row.append(main, actions);
  row.addEventListener("click", () => void openTerminal(s));
  return row;
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

function renderSidebar(): void {
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
