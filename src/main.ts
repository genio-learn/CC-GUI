import { invoke, Channel } from "@tauri-apps/api/core";
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
  project: string;
  tmux_session_name: string;
};

const sessionsEl = document.querySelector<HTMLUListElement>("#sessions")!;
const refreshEl = document.querySelector<HTMLButtonElement>("#refresh")!;
const headerEl = document.querySelector<HTMLDivElement>("#terminal-header")!;
const terminalEl = document.querySelector<HTMLDivElement>("#terminal")!;

const term = new Terminal({
  fontFamily: "Menlo, Monaco, monospace",
  fontSize: 13,
  theme: { background: "#1e1e2e" },
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open(terminalEl);
fit.fit();

term.onData((data) => {
  void invoke("write_pty", { data });
});

term.onResize(({ rows, cols }) => {
  void invoke("resize_pty", { rows, cols });
});

window.addEventListener("resize", () => fit.fit());

let attachedSession: string | null = null;

async function attach(session: SessionRow): Promise<void> {
  await invoke("detach");
  term.reset();

  const onData = new Channel<number[]>();
  onData.onmessage = (chunk) => {
    term.write(new Uint8Array(chunk));
  };

  try {
    await invoke("attach", { tmuxSession: session.tmux_session_name, onData });
  } catch (e) {
    headerEl.textContent = `Failed to attach: ${e}`;
    return;
  }

  attachedSession = session.tmux_session_name;
  headerEl.textContent = `${session.project} / ${session.title} (${session.tmux_session_name})`;
  fit.fit();
  void invoke("resize_pty", { rows: term.rows, cols: term.cols });
  term.focus();
}

async function loadSessions(): Promise<void> {
  let rows: SessionRow[];
  try {
    rows = await invoke<SessionRow[]>("list_sessions");
  } catch (e) {
    sessionsEl.innerHTML = `<li>Error: ${e}</li>`;
    return;
  }

  sessionsEl.innerHTML = "";
  for (const row of rows) {
    const li = document.createElement("li");
    if (row.tmux_session_name === attachedSession) li.classList.add("active");

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = row.title;

    const meta = document.createElement("div");
    meta.className = "meta";
    const status = document.createElement("span");
    status.className = `status-${row.status}`;
    status.textContent = row.status;
    meta.append(`${row.project} · ${row.branch} · `, status);

    li.append(title, meta);
    li.addEventListener("click", () => {
      sessionsEl
        .querySelectorAll("li.active")
        .forEach((el) => el.classList.remove("active"));
      li.classList.add("active");
      void attach(row);
    });
    sessionsEl.appendChild(li);
  }
}

refreshEl.addEventListener("click", () => void loadSessions());
void loadSessions();
